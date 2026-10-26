"""No live HA/campsite calls: synthetic PNG, fake Supervisor, anonymous HTTP client."""
import asyncio
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import struct
import sys
import types
import unittest
from unittest.mock import patch
import zlib

ROOT = Path(__file__).resolve().parents[1] / "custom_components" / "swim_phone_display"
spec = importlib.util.spec_from_file_location("swim_public", ROOT / "public.py")
public = importlib.util.module_from_spec(spec)
spec.loader.exec_module(public)


def png():
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(b"\x00\x00\x00\x00")) + chunk(b"IEND", b"")


def source():
    return {"schema": 1, "settings": {"appMenus": {"watch": False}, "fonts": {"body": 17}},
            "photoSha256": hashlib.sha256(png()).hexdigest(), "submitIntervalSeconds": 0}


class ProjectionTest(unittest.TestCase):
    def test_whitelist_only_even_with_sensitive_extra_fields(self):
        raw = source()
        raw.update(profiles=["private"], logs=["private"], token="private", url="https://evil.test")
        raw["settings"].update(reserverName="private", phone="private", appMenuLabels={"watch": "대기 예약", "secret": "private"}, fonts={"body": 17, "private": "private"})
        value = public.project(raw, png())
        self.assertNotIn("private", json.dumps(value))
        self.assertEqual(0, value["submitIntervalSeconds"])
        self.assertFalse(value["settings"]["appMenus"]["watch"])
        self.assertEqual("대기 예약", value["settings"]["appMenuLabels"]["watch"])

    def test_invalid_photo_interval_and_schema_rejected(self):
        for field, value in (("photoSha256", "wrong"), ("schema", 2), ("settings", None), ("submitIntervalSeconds", True), ("submitIntervalSeconds", 61)):
            with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                public.project({**source(), field: value}, png())
        with self.assertRaises(ValueError):
            public.project(source(), b"<html>private</html>")

    def test_slug_cannot_select_other_internal_services(self):
        for value in ("swim_reservation", "a1234_swim_reservation", "local_swim_reservation"):
            self.assertTrue(public.SLUG.fullmatch(value))
        for value in ("supervisor", "homeassistant", "http://host", "../api", "x/swim_reservation"):
            self.assertIsNone(public.SLUG.fullmatch(value))


class CacheTest(unittest.IsolatedAsyncioTestCase):
    async def test_singleflight_and_copy_isolation(self):
        calls = []
        async def fetch():
            calls.append(1)
            await asyncio.sleep(.01)
            return source(), png()
        cache = public.Snapshot(fetch)
        values = await asyncio.gather(*(cache.read() for _ in range(25)))
        self.assertEqual(1, len(calls))
        values[0][0]["settings"]["appMenus"]["watch"] = True
        self.assertFalse((await cache.read())[0]["settings"]["appMenus"]["watch"])

    async def test_failure_throttled_and_recovers_without_fresh_stale_data(self):
        clock, failing, calls = [1], [False], []
        async def fetch():
            calls.append(1)
            if failing[0]:
                raise ValueError("private server details")
            return source(), png()
        cache = public.Snapshot(fetch, lambda: clock[0])
        await cache.read()
        clock[0] += 61
        failing[0] = True
        for _ in range(4):
            with self.assertRaisesRegex(ValueError, "^Display temporarily unavailable$"):
                await cache.read()
        self.assertEqual(2, len(calls))
        clock[0] += 61
        failing[0] = False
        await cache.read()
        self.assertEqual(3, len(calls))


class RouteTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        from aiohttp import web
        from aiohttp.test_utils import TestClient, TestServer
        import voluptuous as vol
        self.calls = []
        owner = self

        class Reply:
            status = 200
            def __init__(self, data):
                self.data = json.dumps(data).encode() if isinstance(data, dict) else data
                self.content_length = len(self.data)
                self.content = self
            async def iter_chunked(self, n):
                yield self.data
            async def __aenter__(self):
                return self
            async def __aexit__(self, *args):
                pass

        class Session:
            def get(self, url, **options):
                owner.calls.append((url, options))
                replies = {
                    "http://supervisor/addons": {"result": "ok", "data": {"addons": [{"slug": "local_swim_reservation"}]}},
                    "http://supervisor/addons/local_swim_reservation/info": {"result": "ok", "data": {"hostname": "local-swim-reservation", "state": "started"}},
                    "http://local-swim-reservation:8099/api/ui-settings": {**source()["settings"], "profiles": ["PRIVATE"]},
                    "http://local-swim-reservation:8099/api/submission-settings": {"intervalSeconds": 0},
                    "http://local-swim-reservation:8099/api/site-map": png(),
                }
                return Reply(replies[url])

        modules = {}
        for name in ("homeassistant", "homeassistant.components", "homeassistant.components.http", "homeassistant.helpers", "homeassistant.helpers.aiohttp_client", "homeassistant.helpers.config_validation"):
            modules[name] = types.ModuleType(name)
        modules["homeassistant.components.http"].HomeAssistantView = type("HomeAssistantView", (), {})
        modules["homeassistant.helpers.config_validation"].boolean = vol.Boolean()
        modules["homeassistant.helpers"].config_validation = modules["homeassistant.helpers.config_validation"]
        modules["homeassistant.helpers.aiohttp_client"].async_get_clientsession = lambda hass: Session()
        self.patcher = patch.dict(sys.modules, modules)
        self.patcher.start()
        spec = importlib.util.spec_from_file_location("test_swim_integration", ROOT / "__init__.py", submodule_search_locations=[str(ROOT)])
        self.integration = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = self.integration
        spec.loader.exec_module(self.integration)
        self.app = web.Application()
        self.views = []
        class Http:
            def register_view(_, view):
                owner.views.append(view)
                owner.app.router.add_get(view.url, view.get)
        self.hass = types.SimpleNamespace(http=Http())
        with patch.dict(os.environ, {"SUPERVISOR_TOKEN": "SERVER_ONLY_SECRET"}):
            self.assertTrue(await self.integration.async_setup(self.hass, {"swim_phone_display": {"publish": True, "addon_slug": "auto"}}))
        self.client = TestClient(TestServer(self.app))
        await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close()
        self.patcher.stop()

    async def test_anonymous_get_only_routes_and_no_credentials(self):
        self.assertTrue(all(view.requires_auth is False for view in self.views))
        response = await self.client.get("/api/swim_phone/display")
        self.assertEqual(200, response.status)
        text = await response.text()
        self.assertNotIn("PRIVATE", text)
        self.assertNotIn("SERVER_ONLY_SECRET", text)
        self.assertEqual(5, len(self.calls))
        for url, options in self.calls:
            self.assertFalse(options["allow_redirects"])
            self.assertEqual({"Authorization": "Bearer SERVER_ONLY_SECRET"} if url.startswith("http://supervisor/") else {}, options["headers"])
        photo = await self.client.get("/api/swim_phone/map")
        self.assertEqual(png(), await photo.read())
        etag = photo.headers["ETag"]
        self.assertEqual(304, (await self.client.get("/api/swim_phone/map", headers={"If-None-Match": etag})).status)
        for method in ("post", "put", "delete"):
            self.assertEqual(405, (await getattr(self.client, method)("/api/swim_phone/display")).status)
        self.assertEqual(400, (await self.client.get("/api/swim_phone/display?path=/api/states")).status)
        self.assertEqual(404, (await self.client.get("/api/swim_phone/logs")).status)

    async def test_opt_out_registers_nothing(self):
        count = len(self.views)
        self.assertTrue(await self.integration.async_setup(self.hass, {"swim_phone_display": {"publish": False}}))
        self.assertEqual(count, len(self.views))
