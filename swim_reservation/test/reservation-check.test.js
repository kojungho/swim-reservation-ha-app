import test from "node:test";
import assert from "node:assert/strict";
import { reservationCancelUrl, reservationCheckUrl } from "../src/reservation-check.js";

test("예약자명은 EUC-KR로 인코딩하고 휴대폰 번호는 세 부분으로 나눈다", () => {
  assert.equal(
    reservationCheckUrl({ reserverName: "고중호", phone: "01074302277" }),
    "http://newpension.logosweb.or.kr/reservation/order_ok7.php?id=swim&name=%B0%ED%C1%DF%C8%A3&tel1=010&tel2=7430&tel3=2277"
  );
});

test("저장된 예약자명이나 휴대폰 번호가 없으면 확인 주소를 만들지 않는다", () => {
  assert.throws(() => reservationCheckUrl({ reserverName: "", phone: "01074302277" }), /예약자명/);
  assert.throws(() => reservationCheckUrl({ reserverName: "고중호", phone: "123" }), /휴대폰 번호/);
});

test("취소 주소에는 예약 식별값과 동일한 예약자 정보가 포함된다", () => {
  assert.equal(
    reservationCancelUrl({ reserverName: "고중호", phone: "01074302277" }, "493304"),
    "http://newpension.logosweb.or.kr/reservation/order_del3.php?no=493304&id=swim&name=%B0%ED%C1%DF%C8%A3&tel1=010&tel2=7430&tel3=2277"
  );
  assert.throws(() => reservationCancelUrl({ reserverName: "고중호", phone: "01074302277" }, "../1"), /식별값/);
});
