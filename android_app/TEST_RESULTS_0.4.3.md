# 0.4.3-preview · 입실·퇴실 기본 입력

검증일: 2026-10-25. 앱 날짜 UI만 수정했으며 HA 애드온·실제 예약·로그·이력 처리는 변경하지 않았다.

- versionCode 9 / versionName 0.4.3-preview. 최소 지원 코드 5 유지, 선택 업데이트.
- APK SHA-256: `5b0194784b923a962d56c33c507bf1e476b07f4df38376bcb5eeca594bc0c058`.
- 기존 APK와 동일한 서명 인증서 확인. assembleDebug / assembleDebugAndroidTest / lintDebug 성공. 오류 0, 기존 경고 4개 유지.
- 브라우저 UI 테스트 5개 통과: 날짜 확인 숫자 DOM 제거, 입실·퇴실 기본 입력, 퇴실일 변경 시 3박 자동 계산, 연말 경계를 넘는 기존 4박 일정 복원, 이전 박수 표시 설정의 1회 전환, 전환 후 사용자가 선택한 기존 방식 유지, 날짜 변경 시 잔여 표시 무효화.
- 실제 안드로이드에서 새 UI 기동과 네이티브 저장 회귀 5개 통과. 입금자명 없이 단독·정보 편집·다인 저장 및 Keystore 복호화 재확인. 이 5개를 날짜 선택 전용 네이티브 검증으로 계산하지 않았다.
- 기존 일정의 날짜·박수·예약자를 변경하거나 실제 예약을 제출하지 않았다. 폰 실기기에서의 실제 예약 성공은 미검증이다.

네이티브 저장 회귀 실행:

```sh
./gradlew :app:assembleDebug :app:assembleDebugAndroidTest -PphoneTestRunner=kr.swim.phone.ProfileSaveTestRunner
adb -s emulator-5556 shell am instrument -w kr.swim.phone.test/kr.swim.phone.ProfileSaveTestRunner
```
