// Saved stations live in this browser only (localStorage).
const KEY = 'departures.v1';

export function loadStations() {
  try {
    const j = JSON.parse(localStorage.getItem(KEY) || '{}');
    return Array.isArray(j.stations) ? j.stations : [];
  } catch {
    return [];
  }
}

export function saveStations(stations) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ stations }));
  } catch {
    // Private mode or storage full: the list still works until the page closes.
  }
}

export const newUid = () => Math.random().toString(36).slice(2, 10);
