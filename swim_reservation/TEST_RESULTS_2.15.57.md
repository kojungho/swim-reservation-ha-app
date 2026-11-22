# 2.15.57 검증

- vendor의 공개 DOM 등록 클래스 nppfs-npv도 준비 신호로 인정. 값·속성·내부 vendor 함수는 조작하지 않으며 실제 키패드 숫자 10개를 확인하기 전 입력하지 않음.
- 실패 시 입력란 메타데이터를 다시 확인해 초기 관측과 최종 준비 상태를 구별함.
- 안내창은 원문 없이 고정 유형 및 OS/미지원/보안/설치/연결 키워드 여부만 기록. 로컬 보안프로그램 탐색은 주소·포트·쿼리 없이 분류만 기록. 네트워크 허용 범위 변경 없음.
- 실제 카드 자동입력 전체 성공은 아직 미검증.

- 관련 테스트 25개 및 로컬 오프라인 전체 흐름 통과. Publish 45042223768 및 Verify 45042579784 두 아키텍처 성공. HA 2.15.57 started 확인.
- 실제 진단은 초기화 30초 후 KEYPAD_NOT_READY. 최종 keypadRegistered=false, runtimeErrors=[], dialogChecks=[]. 카드 복호화/입력/최종 결제 없음.
- 공식 https://vbv.samsungcard.co.kr/ipinsidelws/IPinside_v6_engine.js에서 wss://127.0.0.1:21400 로컬 탐색의 onclose는 로그만 남기고 onerror만 params.onFailure를 호출함을 확인. 모든 WS를 mock normal close하는 기존 코드가 실패 콜백을 막을 수 있음.
