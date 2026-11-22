# 2.15.54 검증

- 카드번호/CVC 입력란은 label/title/aria-label/placeholder/표준 autocomplete의 의미로 각각 유일한 표시 입력란만 선택. 정확한 접근성 이름 하나에 의존하지 않음.
- 실패 진단은 고정 형태의 id/name, type, 표시/읽기전용 여부 및 의미 일치 여부만 포함. 입력값과 라벨 원문은 기록하지 않음.
- 합성 화면은 연관 label 없이 title에 입력 문구가 붙은 password 타입 카드번호/CVC로 변경.
- 실제 카드 자동입력 전체 통과는 아직 검증되지 않음.
