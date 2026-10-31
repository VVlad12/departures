// TfL Unified API: free, no key needed for light use, CORS enabled.
import { cleanName, londonDateTime, londonToEpoch } from './util.js';

const BASE = 'https://api.tfl.gov.uk';
export const RAIL_MODES = ['tube', 'dlr', 'overground', 'elizabeth-line', 'tram', 'national-rail'];
// TfL only publishes live predictions for its own services, not National Rail operators.
export const LIVE_MODES = ['tube', 'dlr', 'overground', 'elizabeth-line', 'tram'];

async function get(path) {
  const res = await fetch(BASE + path);
  if (!res.ok) throw new Error(`TfL answered ${res.status}`);
  return res.json();
}

export async function searchStations(query) {
  const j = await get(`/StopPoint/Search/${encodeURIComponent(query)}?modes=${RAIL_MODES.join(',')}&maxResults=15`);
  return (j.matches || []).map((m) => ({
    id: m.id,
    name: cleanName(m.name),
    modes: (m.modes || []).filter((x) => RAIL_MODES.includes(x)),
  }));
}

export async function nearbyStations(lat, lon, radius = 1200) {
  const j = await get(`/StopPoint?lat=${lat}&lon=${lon}&radius=${radius}` +
    `&stopTypes=NaptanMetroStation,NaptanRailStation&modes=${RAIL_MODES.join(',')}`);
  return (j.stopPoints || []).map((s) => ({
    id: s.naptanId,
    name: cleanName(s.commonName),
    modes: (s.modes || []).filter((x) => RAIL_MODES.includes(x)),
    distance: Math.round(s.distance),
  })).sort((a, b) => a.distance - b.distance).slice(0, 8);
}

// Interchanges ("HUB…" ids, e.g. King's Cross) often have no arrivals of their own,
// so their departures are read from the stations inside them.
const hubStops = new Map();
const liveChildren = (j) => (j.children || [])
  .filter((c) => /NaptanMetroStation|NaptanRailStation/.test(c.stopType) && c.modes.some((m) => LIVE_MODES.includes(m)))
  .map((c) => c.naptanId);

async function stopsFor(id) {
  if (!id.startsWith('HUB')) return [id];
  if (!hubStops.has(id)) hubStops.set(id, liveChildren(await get(`/StopPoint/${encodeURIComponent(id)}`)));
  return hubStops.get(id).length ? hubStops.get(id) : [id];
}

// Station name and its train lines (bus lines at interchanges are dropped).
export async function stationInfo(id) {
  const j = await get(`/StopPoint/${encodeURIComponent(id)}`);
  if (id.startsWith('HUB')) hubStops.set(id, liveChildren(j));
  const names = Object.fromEntries((j.lines || []).map((l) => [l.id, l.name]));
  const lines = [];
  for (const g of j.lineModeGroups || []) {
    if (!RAIL_MODES.includes(g.modeName)) continue;
    for (const id of g.lineIdentifier) lines.push({ id, name: names[id] || id, mode: g.modeName });
  }
  return { id: j.naptanId || id, name: cleanName(j.commonName), lines };
}

export async function arrivals(id) {
  const stops = await stopsFor(id);
  const j = (await Promise.all(stops.map((s) => get(`/StopPoint/${encodeURIComponent(s)}/Arrivals`)))).flat();
  const seen = new Set();
  const out = [];
  for (const a of j) {
    if (!RAIL_MODES.includes(a.modeName)) continue;
    const key = `${a.vehicleId}|${a.lineId}|${a.platformName}|${a.expectedArrival}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const via = /\bvia\b.*/i.exec(a.towards || '');
    out.push({
      line: a.lineId,
      lineName: a.lineName,
      mode: a.modeName,
      dest: cleanName(a.destinationName || a.towards) || 'Check front of train',
      via: via ? via[0] : '',
      platform: a.platformName && a.platformName !== 'Platform Unknown' ? a.platformName : '',
      time: Date.parse(a.expectedArrival),
    });
  }
  return out.sort((a, b) => a.time - b.time);
}

// National Rail stations for a From -> To card. The journey planner rejects interchange ("HUB…") ids,
// so an interchange is replaced by its rail stations (one per name, the one with most lines).
export async function searchRailStations(query) {
  const j = await get(`/StopPoint/Search/${encodeURIComponent(query)}?modes=national-rail&maxResults=10`);
  const out = [];
  const add = (id, name) => { if (!out.some((o) => o.name === name)) out.push({ id, name }); };
  for (const m of j.matches || []) {
    if (!m.id.startsWith('HUB')) { add(m.id, cleanName(m.name)); continue; }
    const hub = await get(`/StopPoint/${encodeURIComponent(m.id)}`);
    (hub.children || [])
      .filter((c) => c.modes.includes('national-rail'))
      .sort((a, b) => (b.lines?.length || 0) - (a.lines?.length || 0))
      .forEach((c) => add(c.naptanId, cleanName(c.commonName)));
  }
  // "st pancras" finds the King's Cross interchange: list St Pancras before King's Cross.
  const q = query.trim().toLowerCase();
  return out.sort((a, b) => b.name.toLowerCase().includes(q) - a.name.toLowerCase().includes(q));
}

// Next National Rail trains from -> to leaving from `after` on. TfL's journey planner gives about three,
// with the expected time (delays included) and the timetabled one.
export async function nextTrains(from, to, after) {
  const { date, time } = londonDateTime(after);
  const j = await get(`/Journey/JourneyResults/${encodeURIComponent(from)}/to/${encodeURIComponent(to)}` +
    `?mode=national-rail&timeIs=Departing&date=${date}&time=${time}`);
  const out = [];
  for (const x of j.journeys || []) {
    const legs = x.legs.filter((l) => l.mode?.id !== 'walking');
    if (!legs.length) continue;
    const first = legs[0];
    const last = legs[legs.length - 1];
    out.push({
      time: londonToEpoch(first.departureTime),
      sched: londonToEpoch(first.scheduledDepartureTime || first.departureTime),
      arrive: londonToEpoch(last.arrivalTime),
      operator: first.routeOptions?.[0]?.name || '',
      changes: legs.length - 1,
    });
  }
  return out.sort((a, b) => a.time - b.time);
}

// Map of lineId -> { severity, text, reason } for lines that are not on good service.
export async function lineProblems() {
  const j = await get(`/Line/Mode/${LIVE_MODES.join(',')}/Status`);
  const out = {};
  for (const line of j) {
    const bad = (line.lineStatuses || []).filter((s) => s.statusSeverity !== 10);
    if (bad.length) {
      out[line.id] = {
        name: line.name,
        text: bad.map((s) => s.statusSeverityDescription).join(', '),
        reason: bad.map((s) => s.reason).filter(Boolean)[0] || '',
      };
    }
  }
  return out;
}
