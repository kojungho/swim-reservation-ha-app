"""Strict public projection and single-flight cache; never proxy arbitrary APIs."""
import asyncio
import copy
import hashlib
import re
import time

MODES = ("priority", "multiple", "profiles-parallel", "watch", "book", "people", "monthly", "logs")
FONTS = ("title", "heading", "body", "field", "button", "room", "status", "calendar", "list", "log")
MAX_PHOTO = 12 * 1024 * 1024
SLUG = re.compile(r"(?:[a-z0-9]+_)?swim_reservation")
PROBLEM_CODES = set("DIAGNOSTIC_TEST PAYMENT_METHOD_UNRECOGNIZED FORM_FIELDS_UNRECOGNIZED FORM_FIELDS_AMBIGUOUS FORM_VALIDATION_FAILED FORM_DOM_ERROR TERMS_UNRECOGNIZED FORM_MISMATCH FORM_UNRECOGNIZED LIST_UNRECOGNIZED CATALOG_MISMATCH PRE_SUBMIT_MISMATCH PREFLIGHT_SOURCE DOM_ERROR NOT_OPEN NO_ROOM NO_VACANCY PROFILE PLAN CONNECTION RENDERER SCRIPT TIMEOUT INTERRUPTED BACKGROUND_START CHECK_FAILED STOPPED BUSY EXECUTION_FAILED CHECK_REQUIRED HTTP_403 HTTP_429 HTTP_OTHER".split())


def project_problem(raw):
    keys = {"id", "clientId", "version", "versionCode", "category", "state", "code", "stage", "occurredAt"}
    uuid = r"[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}"
    if not isinstance(raw, dict) or set(raw) != keys:
        raise ValueError("Invalid problem")
    if any(not isinstance(raw[k], str) or not re.fullmatch(uuid, raw[k]) for k in ("id", "clientId")):
        raise ValueError("Invalid ID")
    if not isinstance(raw["version"], str) or not re.fullmatch(r"\d{1,3}\.\d{1,3}\.\d{1,3}", raw["version"]):
        raise ValueError("Invalid version")
    if type(raw["versionCode"]) is not int or not 1 <= raw["versionCode"] <= 100000:
        raise ValueError("Invalid version code")
    if raw["category"] not in ("preflight", "execution") or raw["state"] not in ("failed", "unavailable", "check_required") or raw["code"] not in PROBLEM_CODES or raw["stage"] not in ("listing", "prepare", "preflight", "execution", "unknown"):
        raise ValueError("Invalid enum")
    if type(raw["occurredAt"]) is not int or not 1577836800000 <= raw["occurredAt"] <= 4102444800000:
        raise ValueError("Invalid time")
    return dict(raw)


def project_catalog(raw):
    if not isinstance(raw, dict) or type(raw.get("checkedAt")) is not int or not 0 <= raw["checkedAt"] <= 4102444800000 or not isinstance(raw.get("entries"), list) or len(raw["entries"]) > 128:
        raise ValueError("Invalid catalog")
    entries, names, ids = [], set(), set()
    for room in raw["entries"]:
        if not isinstance(room, dict):
            raise ValueError("Invalid site")
        name, display, site = room.get("name"), room.get("displayName"), room.get("siteId")
        if not isinstance(name, str) or not 1 <= len(name) <= 80 or any(c.isspace() or ord(c) < 32 or ord(c) == 127 for c in name) or not isinstance(display, str) or not 1 <= len(display) <= 80 or type(site) is not int or not 1 <= site <= 10000:
            raise ValueError("Invalid site")
        match = re.fullmatch(r"(하늘존|산맥존)(.+)", display)
        canonical = f"{match[2]}_{match[1]}" if match else display
        if canonical != name or name in names or site in ids:
            raise ValueError("Ambiguous site")
        names.add(name); ids.add(site)
        entries.append({"name": name, "displayName": display, "siteId": site})
    if bool(entries) != (raw["checkedAt"] > 0):
        raise ValueError("Incomplete catalog")
    return {"checkedAt": raw["checkedAt"], "entries": entries}


def project(raw, image):
    if not isinstance(raw, dict) or type(raw.get("schema")) is not int or raw["schema"] != 1:
        raise ValueError("Invalid schema")
    if not isinstance(image, bytes) or len(image) > MAX_PHOTO or len(image) < 45:
        raise ValueError("Invalid image size")
    if image[:8] != b"\x89PNG\r\n\x1a\n" or image[12:16] != b"IHDR" or image[-8:-4] != b"IEND":
        raise ValueError("Invalid PNG")
    width, height = int.from_bytes(image[16:20], "big"), int.from_bytes(image[20:24], "big")
    if not (1 <= width <= 2400 and 1 <= height <= 2400):
        raise ValueError("Invalid image dimensions")
    digest = hashlib.sha256(image).hexdigest()
    if digest != raw.get("photoSha256"):
        raise ValueError("Photo changed; retry later")
    source = raw.get("settings")
    if not isinstance(source, dict):
        raise ValueError("Invalid settings")
    interval = raw.get("submitIntervalSeconds")
    if type(interval) is not int or not 0 <= interval <= 60:
        raise ValueError("Invalid interval")
    settings = {"appMenus": {}, "appMenuLabels": {}, "fonts": {}}
    menus, labels, fonts = (source.get(key, {}) for key in ("appMenus", "appMenuLabels", "fonts"))
    for mode in MODES:
        if isinstance(menus, dict) and type(menus.get(mode)) is bool:
            settings["appMenus"][mode] = menus[mode]
        label = labels.get(mode) if isinstance(labels, dict) else None
        if isinstance(label, str) and 1 <= len(label.strip()) <= 20 and not any(ord(c) < 32 or ord(c) == 127 for c in label):
            settings["appMenuLabels"][mode] = label.strip()
    for key in FONTS:
        value = fonts.get(key) if isinstance(fonts, dict) else None
        if type(value) is int and 10 <= value <= (42 if key == "title" else 24):
            settings["fonts"][key] = value
    for key in ("serverTime", "watchInfo", "stayRange", "mapIcon"):
        if type(source.get(key)) is bool:
            settings[key] = source[key]
    for key in ("menuCorner", "mapCorner"):
        if source.get(key) in ("top-left", "top-right", "bottom-left", "bottom-right"):
            settings[key] = source[key]
    for key, low, high in (("menuSpacing", 0, 16), ("floatingSize", 44, 64), ("dateInputVersion", 0, 1)):
        value = source.get(key)
        if type(value) is int and low <= value <= high:
            settings[key] = value
    # Never copy profiles, schedules, logs, tokens, gallery entries, URLs or unknown fields.
    value = {"schema": 1, "settings": settings, "submitIntervalSeconds": interval, "photoSha256": digest}
    if "siteCatalog" in raw:
        value["siteCatalog"] = project_catalog(raw["siteCatalog"])
    return value


class Snapshot:
    """At most one upstream refresh/minute globally, including after failures."""
    def __init__(self, fetch, clock=time.monotonic):
        self.fetch = fetch
        self.clock = clock
        self.lock = asyncio.Lock()
        self.until = 0
        self.value = None
        self.failed = False

    async def read(self):
        async with self.lock:
            if self.clock() >= self.until:
                self.until = self.clock() + 60
                try:
                    raw, image = await self.fetch()
                    value = project(raw, image)
                    self.value = (value, image)
                    self.failed = False
                except Exception:
                    # Do not present old configuration as a fresh server snapshot.
                    self.failed = True
            if self.failed or self.value is None:
                raise ValueError("Display temporarily unavailable")
            return copy.deepcopy(self.value[0]), self.value[1]
