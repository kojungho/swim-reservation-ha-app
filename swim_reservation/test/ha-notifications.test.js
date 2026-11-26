import test from 'node:test';
import assert from 'node:assert/strict';
import { HaNotifications, notificationOptions } from '../src/ha-notifications.js';
import { Store } from '../src/store.js';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const failure = (planId = 'one', stage = 'exception') => ({ event: 'status', level: 'error', message: 'SECRET raw message', details: { planId, state: 'failed', stage, technicalMessage: 'SECRET phone' } });
const flush = n => Promise.all([...n.pending]);

test('booking failures notify only S25 without raw private data, with timeout and ingress link', async () => {
  const calls = [];
  const n = new HaNotifications({ token: 'token', fetchImpl: async (url, options) => { calls.push({ url, options }); return { ok: true }; } });
  n.observe(failure());
  await flush(n);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://supervisor/core/api/services/notify/mobile_app_sm_s938n');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer token');
  assert.ok(calls[0].options.signal);
  assert.ok(!calls[0].options.body.includes('SECRET'));
  assert.equal(JSON.parse(calls[0].options.body).data.clickAction, '/app/76980dac_swim_reservation');
});

test('watch failures throttled per plan, serious booking failures still notify; new run resets', async () => {
  let clock = 0;
  let count = 0;
  const n = new HaNotifications({ token: 'token', now: () => clock, fetchImpl: async () => { count++; return { ok: true }; } });
  const watch = { event: 'status', details: { planId: 'one', state: 'waiting', stage: 'watch-read-error' } };
  n.observe(watch); n.observe(watch);
  n.observe(failure()); n.observe(failure()); n.observe(failure('two'));
  await flush(n);
  assert.equal(count, 3);
  clock = 300_000;
  n.observe(watch);
  await flush(n);
  assert.equal(count, 4);
  n.observe({ event: 'status', details: { planId: 'one', stage: 'starting-now' } });
  n.observe(failure());
  await flush(n);
  assert.equal(count, 5);
});

test('normal status, manual lookup errors and trace errors do not send notifications', async () => {
  let count = 0;
  const n = new HaNotifications({ token: 'token', fetchImpl: async () => { count++; return { ok: true }; } });
  for (const entry of [{ event: 'status', details: { state: 'waiting', stage: 'armed' } }, { event: 'lookup', level: 'error' }, { event: 'trace', level: 'error' }]) n.observe(entry);
  await flush(n);
  assert.equal(count, 0);
});

test('delivery errors isolated and missing token does not send', async () => {
  let errors = 0;
  const n = new HaNotifications({ token: 'token', onError: () => { errors++; }, fetchImpl: async () => ({ ok: false }) });
  n.observe(failure()); await flush(n);
  assert.equal(errors, 1);
  const disabled = new HaNotifications({ token: '', fetchImpl: () => { throw new Error('must not send'); } });
  disabled.observe(failure());
  assert.equal(disabled.pending.size, 0);
  await assert.rejects(disabled.send('test', 'test'));
});

test('root store observes forwarded plan errors and notification hook cannot break logs', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'swim-notifications-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const s = new Store(dir);
  await s.init();
  let seen;
  s.onLog = entry => { seen = entry; throw new Error('notification failure'); };
  await s.recordLog('error', 'status', 'failed', { state: 'failed', planId: 'one' });
  assert.equal(seen.details.planId, 'one');
  assert.equal((await s.listLogs()).length, 1);
});

test('daily opt-out suppresses only daily push notifications', async () => {
  const titles = [];
  const n = new HaNotifications({ token: 'token', dailyCheckNotifications: false,
    fetchImpl: async (_, options) => { titles.push(JSON.parse(options.body).title); return { ok: true }; }
  });
  for (const state of ['passed', 'failed', 'unavailable', 'interrupted']) {
    n.observe({event: 'preflight-result', details: {kind: 'daily', state, key: state}});
  }
  n.observe({event: 'preflight-result', details: {kind: 'scheduled', state: 'failed'}});
  n.observe(failure());
  await flush(n);
  assert.deepEqual(titles, ['쉼오지 예약 · 사전 점검 확인 필요', '쉼오지 예약 · 오류 알림']);
});

test('HA options preserve old installs and load an explicit daily opt-out', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'swim-notification-options-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'options.json');
  for (const [options, enabled] of [[null, true], [{}, true], [{daily_check_notifications: false}, false]]) {
    if (options) await writeFile(file, JSON.stringify(options));
    const n = new HaNotifications(await notificationOptions(file));
    assert.equal(n.dailyCheckNotifications, enabled);
    assert.equal(n.service, 'mobile_app_sm_s938n');
  }
});

test('each HA notification switch mutes only its category; master also mutes test pushes', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'swim-push-switches-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'options.json');
  const preflight = (kind, state) => ({event: 'preflight-result', details: {kind, state, key: kind + state}});
  const cases = [
    ['daily_check_notifications', preflight('daily', 'failed')],
    ['scheduled_pass_notifications', preflight('scheduled', 'passed')],
    ['scheduled_unavailable_notifications', preflight('scheduled', 'unavailable')],
    ['scheduled_issue_notifications', preflight('scheduled', 'interrupted')],
    ['booking_error_notifications', failure()],
    ['watch_error_notifications', {event:'plan-watch', level:'error'}]
  ];
  for (const muted of ['notifications_enabled', ...cases.map(([key]) => key)]) {
    await writeFile(file, JSON.stringify({[muted]: false}));
    let calls = 0;
    const n = new HaNotifications({...await notificationOptions(file), token:'test', fetchImpl:async () => { calls++; return {ok:true}; }});
    for (const [key, entry] of cases) {
      const before = calls;
      n.observe(entry);
      await flush(n);
      assert.equal(calls - before, Number(muted !== 'notifications_enabled' && muted !== key), muted + '/' + key);
    }
    assert.equal(await n.send('test', 'test'), muted !== 'notifications_enabled');
  }
});
