"""Opt-in, anonymous public display ONLY. All HA management auth remains unchanged."""
import json
import hashlib
import os
import re

import aiohttp
import voluptuous as vol
from aiohttp import web
from homeassistant.components.http import HomeAssistantView
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers import config_validation as cv

from .public import MAX_PHOTO, SLUG, Snapshot

DOMAIN = "swim_phone_display"
CONFIG_SCHEMA = vol.Schema(
    {DOMAIN: vol.Schema({
        vol.Required("publish"): cv.boolean,
        vol.Optional("addon_slug", default="auto"): vol.Any("auto", vol.Match(SLUG.pattern + r"$")),
    })}, extra=vol.ALLOW_EXTRA,
)


async def async_setup(hass, config):
    options = config.get(DOMAIN)
    if not options or not options["publish"]:
        return True
    # This token stays inside HA Core; it is NEVER included in a public response or APK.
    token = os.environ.get("SUPERVISOR_TOKEN") or os.environ.get("HASSIO_TOKEN")
    if not token:
        return False
    session = async_get_clientsession(hass)
    headers = {"Authorization": "Bearer " + token}
    selected_slug = options["addon_slug"]

    async def read(url, limit, *, supervisor=False):
        async with session.get(url, headers=headers if supervisor else {},
                               allow_redirects=False,
                               timeout=aiohttp.ClientTimeout(total=12)) as response:
            if response.status != 200 or (response.content_length or 0) > limit:
                raise ValueError("Display source unavailable")
            parts, length = [], 0
            async for part in response.content.iter_chunked(16384):
                length += len(part)
                if length > limit:
                    raise ValueError("Display source too large")
                parts.append(part)
            return b"".join(parts)

    async def supervisor(path):
        response = json.loads(await read("http://supervisor" + path, 1048576, supervisor=True))
        if response.get("result") != "ok" or not isinstance(response.get("data"), dict):
            raise ValueError("Supervisor unavailable")
        return response["data"]

    async def fetch():
        slug = selected_slug
        if slug == "auto":
            addons = (await supervisor("/addons")).get("addons", [])
            found = [item.get("slug", "") for item in addons
                     if isinstance(item, dict) and SLUG.fullmatch(item.get("slug", ""))]
            if len(found) != 1:
                raise ValueError("Select exactly one swim addon")
            slug = found[0]
        if not SLUG.fullmatch(slug):
            raise ValueError("Invalid addon")
        info = await supervisor("/addons/" + slug + "/info")
        # Only the exact swim addon's internal DNS name is allowed, never an arbitrary URL/IP.
        hostname = slug.replace("_", "-")
        if info.get("hostname") != hostname or info.get("state") != "started":
            raise ValueError("Addon unavailable")
        base = "http://" + hostname + ":8099"
        settings = json.loads(await read(base + "/api/ui-settings", 131072))
        submission = json.loads(await read(base + "/api/submission-settings", 4096))
        image = await read(base + "/api/site-map", MAX_PHOTO)
        raw = {"schema": 1, "settings": settings,
               "submitIntervalSeconds": submission.get("intervalSeconds"),
               "photoSha256": hashlib.sha256(image).hexdigest()}
        return raw, image

    snapshot = Snapshot(fetch)

    class PublicDisplay(HomeAssistantView):
        url = "/api/swim_phone/display"
        name = "api:swim_phone:display"
        requires_auth = False

        async def get(self, request):
            if request.query_string:
                return web.Response(status=400)
            try:
                value, _ = await snapshot.read()
                return web.json_response(value, headers={"Cache-Control": "public, max-age=60",
                                                        "X-Content-Type-Options": "nosniff"})
            except Exception:
                return web.json_response({"error": "display_unavailable"}, status=503,
                                         headers={"Cache-Control": "no-store"})

    class PublicMap(HomeAssistantView):
        url = "/api/swim_phone/map"
        name = "api:swim_phone:map"
        requires_auth = False

        async def get(self, request):
            if request.query_string:
                return web.Response(status=400)
            try:
                value, image = await snapshot.read()
                etag = '"' + value["photoSha256"] + '"'
                headers = {"Cache-Control": "public, max-age=60", "ETag": etag,
                           "X-Content-Type-Options": "nosniff",
                           "Content-Disposition": "inline"}
                if request.headers.get("If-None-Match") == etag:
                    return web.Response(status=304, headers=headers)
                return web.Response(body=image, content_type="image/png", headers=headers)
            except Exception:
                return web.Response(status=503, headers={"Cache-Control": "no-store"})

    # No POST/PUT/DELETE, wildcard routes, command services or forwarding of caller headers.
    hass.http.register_view(PublicDisplay())
    hass.http.register_view(PublicMap())
    return True
