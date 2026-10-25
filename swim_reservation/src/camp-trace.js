import { randomUUID } from 'node:crypto';

export function maskedProfile(profile = {}) {
  const name = value => {
    const chars = [...String(value || '').trim()];
    return chars.length < 2 ? (chars.length ? '*' : '') : chars[0] + '*'.repeat(Math.max(1, chars.length - 2)) + (chars.length > 2 ? chars.at(-1) : '');
  };
  const phone = String(profile.phone || '').replace(/\D/g, '');
  return { reserverName: name(profile.reserverName), depositorName: name(profile.depositorName), phone: phone.length >= 10 ? `${phone.slice(0, 3)}-****-${phone.slice(-4)}` : (phone ? '***' : '') };
}

export function safeCampError(error, code = 'CAMP_PROCESSING_ERROR') {
  if (error?.safeToLog) return error;
  const source = String(error?.message || '');
  const failureKind = error?.name === 'TimeoutError' || /timeout|timed out/i.test(source) ? 'timeout'
    : /closed|crashed/i.test(source) ? 'page-closed'
    : /net::|network|ECONN|ENOTFOUND/i.test(source) ? 'network' : 'unexpected';
  return Object.assign(new Error('화면 처리에 실패했습니다. 입력값·응답 원문은 기록하지 않습니다.'), { code, failureKind, safeToLog: true });
}

export function diagnosticError(code, message, checks) {
  return Object.assign(new Error(message), { code, checks, safeToLog: true });
}

// Isolated per operation: concurrent lookups cannot mix IDs or masked identities.
export function operationTrace(log, context = {}, event = 'reservation-lookup-step') {
  const writes = [];
  let currentStep = 'initializing';
  context = { attemptId: randomUUID(), ...context };
  const emit = (step, outcome, extra = {}) => {
    const details = { ...context, step, outcome, ...extra };
    const labels = { 'lookup-session': '조회 세션 준비·종료', 'lookup-open': '예약확인 화면 접속', 'lookup-form-verify': '조회 폼·보안값 확인', 'lookup-fill': '조회 정보 입력', 'lookup-submit': '조회 전송', 'lookup-result-parse': '조회 결과 해석', 'lookup-selections-verify': '상세 조회 대상 검증', 'lookup-detail-wait': '상세 조회 간격 대기', 'lookup-detail-fetch': '개별 예약 상세 조회', 'lookup-detail-verify': '개별 예약 상세 대조', 'lookup-summary': '전체 조회 결과', 'watch-lookup': '취소 자리 조회', 'watch-match': '취소 자리 조건 대조' };
    const outcomes = { start: '시작', complete: '완료', error: '실패', checks: '검사 결과', http: 'HTTP 응답' };
    writes.push(Promise.resolve().then(() => log(outcome === 'error' || extra.httpStatus >= 400 ? 'error' : 'info', event, `${labels[step] || step} · ${outcomes[outcome] || outcome}`, details)).catch(() => {}));
  };
  return {
    emit,
    get currentStep() { return currentStep; },
    async step(step, action, metadata = {}) {
      currentStep = step;
      const startedAt = Date.now();
      emit(step, 'start', metadata);
      try {
        const result = await action();
        emit(step, 'complete', { ...metadata, elapsedMs: Date.now() - startedAt });
        return result;
      } catch (raw) {
        const error = safeCampError(raw, 'LOOKUP_PROCESSING_ERROR');
        error.step ||= step;
        emit(step, 'error', { ...metadata, elapsedMs: Date.now() - startedAt, failedStep: error.step,
          error: { code: error.code, message: error.message, failureKind: error.failureKind || 'validation', checks: error.checks || null } });
        throw error;
      }
    },
    async flush() { await Promise.all(writes); }
  };
}
