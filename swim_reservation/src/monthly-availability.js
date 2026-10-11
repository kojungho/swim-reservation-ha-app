import { bookingOpenIso, triggerEpoch } from "./config.js";

export function monthlyUrl(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month)) || Number(month.slice(0, 4)) < 2000 || Number(month.slice(0, 4)) > 2100) throw new Error("조회할 월을 확인해 주세요.");
  const [year, number] = month.split("-");
  return `https://newpension.logosweb.or.kr/reservation/reservation2.php?id=swim&year=${year}&month=${Number(number)}`;
}

export async function inspectMonth(engine, { month, nowMs, knownRooms = [] }) {
  const url = monthlyUrl(month);
  const response = await engine.page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
  if (!response?.ok()) throw new Error(`월별 예약 현황 연결 실패 (응답 ${response?.status() || "미확인"}).`);
  const parsed = await engine.page.evaluate(readMonthlyCalendar);
  if (parsed.month && parsed.month !== month) throw new Error(`월별 페이지가 다른 달을 표시하고 있습니다: 요청 ${month}, 사이트 ${parsed.month}`);
  if (!parsed.month && !parsed.restricted) throw new Error("정상적인 월별 예약 현황 페이지를 확인하지 못했습니다.");
  const opensAt = bookingOpenIso(`${month}-01`);
  const beforeOpen = triggerEpoch(opensAt) > nowMs;
  const discovered = [...new Set(parsed.days.flatMap(day => day.rooms.map(room => room.name)))];
  const roomNames = discovered.length ? discovered : [...new Set(knownRooms)];
  const [year, number] = month.split("-").map(Number);
  const count = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const days = Array.from({ length: count }, (_, index) => {
    const day = index + 1, found = parsed.days.find(item => item.day === day);
    return { date: `${month}-${String(day).padStart(2, "0")}`, rooms: roomNames.map(name => ({ name, status: found?.rooms.find(room => room.name === name)?.status || "unknown" })) };
  });
  return { month, opensAt, beforeOpen, roomNames, days, sourceUrl: url, capturedAt: Date.now(), provided: discovered.length > 0,
    message: discovered.length ? "월별 현황은 사이트의 날짜별 표시이며 선택한 박수의 예약 가능 여부를 보장하지 않습니다." : "사이트가 이 달의 객실 현황을 제공하지 않습니다. 예약 가능·완료로 판단할 수 없습니다." };
}

export function readMonthlyCalendar() {
  const clean = text => String(text || "").replace(/\s+/g, " ").trim();
  const text = document.body?.innerText || "";
  const caption = text.match(/(\d{4})\s*년\s*(\d{1,2})\s*월/);
  const month = caption ? `${caption[1]}-${caption[2].padStart(2, "0")}` : null;
  const restricted = [...document.querySelectorAll("a[href]")].some(link => /아직\s*예약/.test(link.getAttribute("href") || ""));
  const days = [...document.querySelectorAll("td.line_lb")].flatMap(cell => {
    const dayText = clean(cell.querySelector("font")?.textContent || "");
    if (!/^\d{1,2}$/.test(dayText) || Number(dayText) < 1 || Number(dayText) > 31) return [];
    const icons = [...cell.querySelectorAll("img")].filter(img => /\/i_ok_[012]\.gif(?:[?#]|$)/i.test(img.getAttribute("src") || ""));
    const rooms = icons.flatMap((img, index) => {
      const range = document.createRange();
      range.setStartAfter(img);
      if (icons[index + 1]) range.setEndBefore(icons[index + 1]);
      else range.setEnd(cell, cell.childNodes.length);
      const name = clean(range.toString()).split(" ")[0];
      if (!name || name.length > 80) return [];
      const code = img.getAttribute("src").match(/i_ok_([012])\.gif/i)[1];
      return [{ name, status: { "0": "available", "1": "booked", "2": "pending" }[code] }];
    });
    return [{ day: Number(dayText), rooms }];
  });
  return { month, restricted, days };
}
