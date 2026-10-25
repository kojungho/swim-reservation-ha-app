import test from 'node:test';
import assert from 'node:assert/strict';
import { maskedProfile, safeCampError, operationTrace } from '../src/camp-trace.js';

test('개인정보는 가운데를 가리고 짧은 값도 원문을 노출하지 않는다', () => {
  assert.deepEqual(maskedProfile({ reserverName: '가나다', depositorName: '라마', phone: '01012345678' }), { reserverName: '가*다', depositorName: '라*', phone: '010-****-5678' });
  assert.equal(maskedProfile({ reserverName: '가' }).reserverName, '*');
  assert.equal(maskedProfile({ phone: '123' }).phone, '***');
});
test('원문 오류 없이 시간초과·네트워크·페이지 종료 원인을 분류한다', () => {
  for (const [message, kind] of [['Timeout 12345 SECRET', 'timeout'], ['net::ERR_FAILED SECRET', 'network'], ['page closed SECRET', 'page-closed'], ['fill SECRET', 'unexpected']]) {
    const error = safeCampError(new Error(message));
    assert.equal(error.failureKind, kind);
    assert.ok(!error.message.includes('SECRET'));
  }
});
test('조회마다 독립 ID, 단계·HTTP·소요시간·안전한 실패 코드가 남고 로그 장애는 전파하지 않는다', async () => {
  const logs = [];
  const a = operationTrace(async (...entry) => logs.push(entry));
  const b = operationTrace(async (...entry) => logs.push(entry));
  await a.step('lookup-open', async () => a.emit('lookup-open', 'http', { httpStatus: 200 }));
  await assert.rejects(b.step('lookup-fill', async () => { throw new Error('fill SECRET 01012345678'); }));
  await Promise.all([a.flush(), b.flush()]);
  assert.equal(new Set(logs.map(entry => entry[3].attemptId)).size, 2);
  const failed = logs.find(entry => entry[3].outcome === 'error')[3];
  assert.equal(failed.failedStep, 'lookup-fill');
  assert.equal(failed.error.failureKind, 'unexpected');
  assert.ok(Number.isFinite(failed.elapsedMs));
  assert.ok(!JSON.stringify(logs).includes('SECRET'));
  const broken = operationTrace(async () => { throw new Error('disk'); });
  assert.equal(await broken.step('test', async () => 42), 42);
  await broken.flush();
});
