# 2.15.49 검증

- 삼성 팝업 대기와 시작 클릭의 Promise를 즉시 함께 처리. 팝업 실패 시 대기 중 클릭이 있어도 미처리 rejection이 서버를 종료시키지 않음.
- 다음 버튼이 표시된 후에 팝업 대기를 시작하며 삼성 인증창 연결 상태를 따로 표시.
- 팝업은 즉시 거절되고 클릭은 지연되는 경합 테스트 추가.
- 실제 카드 자동입력 전체 통과는 아직 미검증.

- 로컬 34개 테스트 및 오프라인 전체 흐름 통과. Publish 45034045044 및 Verify 45034430978 amd64/aarch64 모두 성공. HA 2.15.49 started 확인.
- 실제 연결 전용 진단에서 PG 약관 통과, issuer-popup timeout으로 정상 중지. 서버는 계속 응답함. 저장 카드 복호화·입력·최종 결제 없음.
- 정상 PC 공개 scriptEventCard.js의 termsAndAgreement에서 /payMain/checkAssentAll, scriptEventCommon_v1.8.8.js의 getCardCodeQuotaBase에서 /payMain/getCardCodeQuota를 확인함. 동기 POST의 실패는 다음 버튼 처리를 막을 수 있음.
