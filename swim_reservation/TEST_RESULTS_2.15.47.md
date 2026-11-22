# 2.15.47 검증

- 정상 PC 결제창과 공개 공식 scriptCommon_v1.4.8.js, scriptEventCommon_v1.8.8.js를 대조. /payMain/Card 화면 렌더링과 /jsApi/visa3d/before 및 /payAuthentication/visa3d 인증창 초기화만 각 1회 허용. /done, /payDoneView, /after 및 알 수 없는 POST는 계속 차단.
- 팝업은 checkWin.jsp를 거친 후 삼성 400 화면이 될 때까지 기다림.
- 합성 검증에도 AJAX Card 화면 렌더링 및 사전 POST와 팝업 중간 페이지를 반영함.
- 실제 카드 자동입력 전체 통과는 아직 미검증.
