# 로그인 없는 앱 표시 설정

이 통합은 HA의 인증을 끄지 않습니다. 아래 두 GET 경로만 누구나 읽을 수 있게 합니다.

- `https://ha.badara.co.kr/api/swim_phone/display`: 앱 표시 설정·메뉴 이름·메뉴 표시 여부·최종 제출 간격·사진 해시
- `https://ha.badara.co.kr/api/swim_phone/map`: 애드온에 적용한 메인 사진 한 장

예약자·전화번호·일정·예약 내역·로그·사진 이력·HA 토큰은 반환하지 않습니다. 공개 사진은 누구나 저장할 수 있으므로 개인정보가 있는 사진을 등록하지 마세요. 앱의 사진 저장/수정 버튼을 없애도 공개 이미지 자체의 복사를 방지할 수는 없습니다.

## 관리자 최초 설치 (사용자는 설치/로그인 불필요)

1. 애드온 2.15.16 이상이 실행 중인지 확인합니다. 공개 연결은 기존 버전에서도 작동하며, 새 메뉴 이름/표시 설정은 해당 설정이 추가된 애드온 버전에서 제공됩니다. 진행 중인 예약이 있으면 종료 후 작업하세요.
2. 이 폴더의 `custom_components/swim_phone_display` 폴더를 HA의 `/config/custom_components/swim_phone_display`로 복사합니다. 기존 custom_components 폴더 전체를 덮어쓰지 마세요.
3. HA의 configuration.yaml에 아래를 추가합니다. 기존 내용은 보존하세요.

```yaml
swim_phone_display:
  publish: true
  addon_slug: auto
```

4. HA 설정 검사를 실행한 뒤 안전한 시점에 HA Core를 재시작합니다. 이 작업에서는 자동으로 재시작하지 않습니다.
5. 로그아웃/시크릿 창에서 위 두 주소를 확인합니다. display는 JSON, map은 사진이어야 합니다. HA 설정 화면과 일반 API는 계속 로그인을 요구해야 합니다.
6. 앱 0.4.12 이상을 기존 앱 위에 업데이트합니다. 별도 HA 연결 화면 없이 실행/재진입 때 동기화합니다. 서버 캐시는 60초이므로 변경이 바로 안 보이면 1~2분 기다립니다. 연결 실패 시 폰의 마지막 정상 설정과 사진은 유지합니다.

HA OS/Supervised와 Supervisor가 필요합니다. 애드온이 여러 개 발견되면 `addon_slug`에 실제 쉼오지 애드온 slug를 지정합니다. 내부 네트워크 접근만 사용하며 8099 포트를 인터넷에 공개하지 않습니다. 외부 프록시는 기존 HA HTTPS 주소를 그대로 전달해야 합니다. Cloudflare Access 등 별도 인증이 있으면 이 두 정확한 경로만 예외로 설정해야 합니다. HA 전체 또는 /api 전체를 공개하지 마세요.

## 중지

`publish: false`로 변경 후 HA Core를 재시작합니다. 이 통합의 공개 경로는 사라집니다. 이미 공개된 사진은 회수할 수 없으며 앱의 마지막 캐시는 남습니다.

## 검증

`python3 -m unittest discover -s ha_integration/tests -v`

테스트는 합성 사진·가짜 서버만 사용하며 실제 예약/취소/입금은 실행하지 않습니다. 구현 근거: [HA REST API](https://contributors.home-assistant.io/core/internals/rest-api/), [Supervisor 앱 정보](https://contributors.home-assistant.io/apps/supervisor-api/apps/).
