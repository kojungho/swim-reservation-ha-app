# 2.15.44 검증

- 관련 테스트 32개 통과. 공식 INICIS CDN의 정적 GET만 허용하며, POST·페이지 이동·알 수 없는 엔드포인트·유사 도메인·freeze 이후 요청은 차단하는 테스트 추가.
- 합성 PG 화면도 별도 CDN 스크립트가 성공해야 iframe POST가 실행되도록 변경해 누락 회귀를 검증한다.
- 공식 출처: https://stdpay.inicis.com/stdjs/INIStdPay.js (cdnDomain 및 INIStdPay_third-party.js 로드), https://stdux.inicis.com/stdpay/stdjs/INIStdPay_third-party.js 공개 GET 확인.
- 실제 카드 자동입력 전체 통과는 아직 확인되지 않았다. 최종 결제 경로는 추가하지 않았다.

- Publish 45029066711 및 Verify 45029394211: 두 아키텍처 모두 성공. HA 2.15.44 started 확인.
- 실제 연결 전용 진단에서 PG_FRAME_NOT_READY는 해소. pg-terms에서 timeout으로 중지했으며 카드 입력·복호화·최종 결제 없음.
