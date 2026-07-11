const SHIPPING_TIME_ZONE = "Europe/Bratislava";
const SHIPPING_CUTOFF_MINUTES = 15 * 60;

function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function isoDate(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function dateKeyFromUtcDate(date) {
  return isoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function slovakNonWorkingHolidayKeys(year) {
  const fixed = [
    [1, 1],
    [1, 6],
    [5, 1],
    [7, 5],
    [8, 29],
    [11, 1],
    [12, 24],
    [12, 25],
    [12, 26],
  ];

  // Mimoriadna zákonná úprava pre rok 2026: 8. máj a 15. september
  // nie sú dňami pracovného pokoja. V ostatných rokoch ich počítame ako sviatky.
  if (year !== 2026) {
    fixed.push([5, 8], [9, 15]);
  }

  const easter = easterSunday(year);
  const goodFriday = new Date(easter);
  goodFriday.setUTCDate(easter.getUTCDate() - 2);
  const easterMonday = new Date(easter);
  easterMonday.setUTCDate(easter.getUTCDate() + 1);

  return new Set([
    ...fixed.map(([month, day]) => isoDate(year, month, day)),
    dateKeyFromUtcDate(goodFriday),
    dateKeyFromUtcDate(easterMonday),
  ]);
}

function bratislavaParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SHIPPING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    weekday: weekdayMap[values.weekday],
  };
}

export function isSlovakNonWorkingHoliday(date = new Date()) {
  const parts = bratislavaParts(date);
  return slovakNonWorkingHolidayKeys(parts.year).has(isoDate(parts.year, parts.month, parts.day));
}

export function getDispatchMessage(date = new Date()) {
  const parts = bratislavaParts(date);
  const isWeekend = parts.weekday === 0 || parts.weekday === 6;
  const isHoliday = slovakNonWorkingHolidayKeys(parts.year).has(isoDate(parts.year, parts.month, parts.day));
  const minutes = parts.hour * 60 + parts.minute;

  if (isWeekend || isHoliday || minutes > SHIPPING_CUTOFF_MINUTES) {
    return "Expedujeme najbližší pracovný deň";
  }

  return "Expedujeme dnes pri objednávke do 15:00";
}
