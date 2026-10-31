// Pure helpers (no DOM, no network), covered by tests/util.test.mjs.

// "Clapham Common Underground Station" -> "Clapham Common", "Stratford (London) Rail Station" -> "Stratford"
export function cleanName(s = '') {
  return s
    .replace(/\s+(Underground|Rail|DLR|Tram|Overground|Elizabeth line)\s+(Station|Stop)$/i, '')
    .replace(/\s+(Station|Stop)$/i, '')
    .replace(/\s*\(London\)/i, '')
    .trim();
}

// An empty list in the filter means "everything".
export function applyFilter(arrivals, f = {}) {
  const has = (list, v) => !list || !list.length || list.includes(v);
  return arrivals.filter((a) => has(f.lines, a.line) && has(f.dests, a.dest) && has(f.platforms, a.platform));
}

// Departures worth showing: filtered, not already gone, and reachable with the walking time.
export function boardRows(arrivals, f, { now, walk = 0, rows = 5 }) {
  const live = applyFilter(arrivals, f).filter((a) => a.time - now > -30000);
  const reach = walk * 60000;
  const ok = live.filter((a) => a.time - now >= reach);
  return { rows: ok.slice(0, rows), missed: live.length - ok.length, total: live.length };
}

export function minutesLeft(time, now) {
  return Math.max(0, Math.floor((time - now) / 60000));
}

// Minutes before you must walk out of the door to catch a departure.
export function leaveIn(time, now, walk) {
  return Math.floor((time - now - walk * 60000) / 60000);
}

const clock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
export const fmtClock = (t) => clock.format(new Date(t));

const partsFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
function londonParts(t) {
  const o = {};
  for (const p of partsFmt.formatToParts(new Date(t))) o[p.type] = p.value;
  return o;
}

// The journey planner wants London date "20261031" and time "2100".
export function londonDateTime(t) {
  const p = londonParts(t);
  return { date: p.year + p.month + p.day, time: p.hour + p.minute };
}

// The journey planner answers in London local time without a zone: "2026-10-31T21:13:00".
export function londonToEpoch(s) {
  const guess = Date.parse(s + 'Z');
  const p = londonParts(guess);
  return guess - (Date.UTC(+p.year, p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - guess);
}

const LINE_COLORS = {
  bakerloo: '#B36305', central: '#E32017', circle: '#FFD300', district: '#00782A',
  'hammersmith-city': '#F3A9BB', jubilee: '#A0A5A9', metropolitan: '#9B0056', northern: '#000000',
  piccadilly: '#003688', victoria: '#0098D4', 'waterloo-city': '#95CDBA', dlr: '#00A4A7',
  elizabeth: '#6950A1', tram: '#5FB526', liberty: '#61686B', lioness: '#F1B41C', mildmay: '#2774AE',
  suffragette: '#5BBD72', weaver: '#893B67', windrush: '#DC241F',
};
const MODE_COLORS = { overground: '#EE7C0E', 'national-rail': '#7a7a85', tram: '#5FB526', dlr: '#00A4A7' };
export const lineColor = (line, mode) => LINE_COLORS[line] || MODE_COLORS[mode] || '#7a7a85';

export const MODE_LABELS = {
  tube: 'Tube', dlr: 'DLR', overground: 'Overground', 'elizabeth-line': 'Elizabeth line',
  tram: 'Tram', 'national-rail': 'National Rail',
};

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
