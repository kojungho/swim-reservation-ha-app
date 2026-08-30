# 쉼오지 예약 도우미 — Home Assistant App

Home Assistant OS 미니 PC에서 쉼오지캠프 예약을 실행하고, Home Assistant Ingress 웹 화면을 통해 휴대폰·Mac·Windows에서 설정하는 App입니다.

## 주요 기능

- 숙박 시작 날짜에서 `adaystart` Unix 타임스탬프 자동 생성
- 숙박월 두 달 전 1일 00:00:00을 예약 오픈 시각으로 자동 제안
- 복수 객실 선택 및 우선순위 저장
- 박수, 예약자명, 입금자명, 휴대폰 번호, 생년월일 영구 저장
- 예약 15초 전 Chromium 예열 및 지정 시각 정밀 실행
- 예약 오픈 전 즉시 실행 차단 및 단계별 숙박 날짜 검증
- 이미 열린 날짜를 위한 확인형 **지금 바로 예약** 실행
- 날짜·박수 조합별 설정 이력 저장, 불러오기 및 삭제
- 우선순위 중 예약 가능한 첫 객실 선택
- 환불 규정 동의, 예약자 정보 입력, 최종 예약 자동 진행
- 실패 페이지의 비식별 폼 구조 진단 및 원클릭 복사
- `amd64` 및 `aarch64` Home Assistant OS 지원

## Home Assistant OS 설치

1. Home Assistant에서 **설정 → Apps → App 스토어**로 이동합니다.
2. 사용자 지정 저장소에 다음 주소를 추가합니다.

   `https://github.com/kojungho/swim-reservation-ha-app`

3. 저장소를 새로고침하고 **쉼오지 예약 도우미**를 설치합니다.
4. App을 시작하고 **웹 UI 열기**를 누릅니다.

세부 사용법과 개인정보 보관 주의사항은 [App 설명서](swim_reservation/DOCS.md)를 확인하세요.

## 저장소 구성

- `swim_reservation/`: Home Assistant App
- `browser-extension/`: 초기 Mac·Windows 브라우저 확장 버전
- `repository.yaml`: Home Assistant 사용자 지정 App 저장소 정보

## 주의

예약 성공은 사이트 응답과 동시 접속 경쟁 상황에 따라 보장할 수 없습니다. 대상 사이트가 HTTP 연결을 사용하므로 사이트로 전송되는 개인정보는 HTTPS로 보호되지 않습니다. App 포트를 직접 인터넷에 공개하지 말고 Home Assistant Ingress를 사용하세요.
