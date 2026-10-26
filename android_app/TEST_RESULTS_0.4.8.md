# 0.4.8 · 실행 안내와 일정별 버튼 상태

- 앱 소스 0.4.8 / versionCode 14. 공개 업데이트 메타데이터는 기존 0.4.7 유지.
- 브라우저 UI 9개 통과: 기존 사이트 선택·초안·달력·사진 기능과 시작 확인/취소, 일정별 대기/실행/감시/제출/정지/성공/실패, 버튼 잠금, 다른 일정 중지 비활성화, 화면 재진입 복원, 객실 조회와 예약 일정 구분을 확인.
- JVM 안내문 테스트 4개 통과: 한국 시간 날짜 경계·초 단위 예정 시각, 즉시 실행/현재 시각 기준, 실제 감시 간격·기본/지정 종료 시각, 모든 예약 모드의 배터리·실행 실패 조건 안내.
- `:app:assembleRelease :app:assembleDebugAndroidTest :app:lintDebug :app:testDebugUnitTest` 성공. Lint 오류 0, 경고 4개.
- Android 에뮬레이터와 실기기 검증은 수행하지 않음. native 실제 알람·확인창·암호화 저장 동작은 이 실행에서 검증하지 않음. 실제 예약·취소·결제는 실행하지 않음.
- Release unsigned APK 생성 완료. 기존 서명 키가 없어 설치용 업데이트 APK로 게시하지 않음. unsigned 파일은 그대로 설치할 수 없음. 새 키로 서명한 대체 APK를 기존 앱 업데이트로 배포하지 않음.
- HA 애드온 파일·예약 상태는 변경하지 않음.

검증 명령:

```sh
CHROMIUM_PATH=/usr/bin/chromium node --test test/*.test.cjs
./gradlew :app:assembleRelease :app:assembleDebugAndroidTest :app:lintDebug :app:testDebugUnitTest
```
