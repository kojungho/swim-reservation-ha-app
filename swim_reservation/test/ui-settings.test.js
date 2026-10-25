import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { UiSettings, DEFAULT_UI_SETTINGS, normalizeUiSettings } from "../src/ui-settings.js";

test("표시·글꼴·모서리·메뉴 간격 설정은 독립 저장되고 재시작 후 유지된다", async t => {
  const dir = await mkdtemp(path.join(tmpdir(), "swim-settings-")); t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new UiSettings(dir);
  assert.deepEqual(await store.read(), DEFAULT_UI_SETTINGS);
  const input = { ...DEFAULT_UI_SETTINGS, fonts: { ...DEFAULT_UI_SETTINGS.fonts, room: 20 }, menuCorner: "bottom-left", mapCorner: "bottom-left", menuSpacing: 0, serverTime: false, safety: false, reservationInfo: false, watchInfo: false, stayRange: true, mapIcon: false, floatingSize: 64 };
  await store.save(input);
  assert.deepEqual(await new UiSettings(dir).read(), input);
  assert.equal((await stat(store.file)).mode & 0o777, 0o600);
  const before = await readFile(store.file);
  for (const invalid of [{ menuCorner: "../../" }, { fonts: { body: "20px" } }, { menuSpacing: -1 }, { menuSpacing: 20 }, { serverTime: "false" }, { fonts: { room: 99 } }, { stayRange: "true" }]) assert.throws(() => normalizeUiSettings(invalid));
  assert.equal(normalizeUiSettings({ stayRange: true }).stayRange, true);
  for (const floatingSize of [43, 65, 46.5, "48"]) assert.throws(() => normalizeUiSettings({ floatingSize }));
  assert.throws(() => normalizeUiSettings({ mapIcon: "off" }));
  assert.equal(normalizeUiSettings({}).floatingSize, 46);
  assert.deepEqual(await readFile(store.file), before);
  await Promise.all([store.save({ menuSpacing: 1 }), store.save({ menuSpacing: 3 })]);
  assert.equal((await store.read()).menuSpacing, 3);
});

test('기존 애드온의 입실·퇴실 표시를 한번 전환하고 이후 명시적 해제는 유지한다',()=>{
 assert.equal(normalizeUiSettings({stayRange:false}).stayRange,true);
 assert.equal(normalizeUiSettings({stayRange:false}).dateInputVersion,1);
 assert.equal(normalizeUiSettings({stayRange:false,dateInputVersion:1}).stayRange,false);
 assert.throws(()=>normalizeUiSettings({dateInputVersion:'1'}));
});
