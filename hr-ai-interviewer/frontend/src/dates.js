const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n) => String(n).padStart(2, "0");

function to24h(hour, meridiem) {
  if (!meridiem) return hour;
  const pm = meridiem.toLowerCase() === "pm";
  return (hour % 12) + (pm ? 12 : 0);
}

// The sheets this app reads are edited by hand and by the chatbot, so the same column can hold
// "29-Sep-2026 22:50:36", Google Sheets' own "9/29/2026 22:50:36" (US order, 12h with AM/PM when
// the sheet locale asks for it) or an ISO string. Returns epoch ms, or null when it isn't a date.
export function parseSheetDate(value) {
  const s = (value ?? "").toString().trim();
  if (!s) return null;

  let m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?$/.exec(s);
  if (m) {
    const month = MONTHS.findIndex((x) => x.toLowerCase() === m[2].toLowerCase());
    if (month < 0) return null;
    return new Date(+m[3], month, +m[1], to24h(+(m[4] || 0), m[7]), +(m[5] || 0), +(m[6] || 0)).getTime();
  }

  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[\sT]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?$/.exec(s);
  if (m) {
    // Sheets exports month/day/year; only flip to day/month when the first number can't be a month.
    const first = +m[1];
    const second = +m[2];
    const [month, day] = first > 12 ? [second, first] : [first, second];
    return new Date(+m[3], month - 1, day, to24h(+(m[4] || 0), m[7]), +(m[5] || 0), +(m[6] || 0)).getTime();
  }

  m = /^(\d{4})-(\d{2})-(\d{2})(?:[\sT]+(\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)).getTime();

  return null;
}

// DD-MMM-YYYY HH:MM:SS, e.g. 29-Sep-2026 22:50:36
export function formatSheetDate(ts) {
  const d = new Date(ts);
  return `${pad(d.getDate())}-${MONTHS[d.getMonth()]}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// Formats a raw cell for display; anything that isn't a date is shown untouched.
export function displayDate(value) {
  const ts = parseSheetDate(value);
  return ts == null ? value || "—" : formatSheetDate(ts);
}
