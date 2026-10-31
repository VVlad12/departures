import * as tfl from './tfl.js';
import { loadStations, saveStations, newUid } from './store.js';
import {
  applyFilter, boardRows, minutesLeft, leaveIn, fmtClock, lineColor, esc, MODE_LABELS,
} from './util.js';

const $ = (s) => document.querySelector(s);
const REFRESH_MS = 30000;
const WALK_M_PER_MIN = 80;

// Saved cards: stations ({ id, lines, filter, rows, walk }) and From -> To routes ({ type: 'route', from, to, walk }).
let stations = loadStations();
const isRoute = (s) => s.type === 'route';
const boards = new Map(); // station id, or 'r:' + route uid -> { list, at, error }
let problems = {}; // lineId -> disruption
let lastFetch = 0;
let fetching = false;
let nearby = null; // { state, list, open, error }
const openAlerts = new Set();

// ---------- Data

async function load(key, fetcher) {
  try {
    boards.set(key, { list: await fetcher(), at: Date.now() });
  } catch (e) {
    const old = boards.get(key) || { list: [] };
    boards.set(key, { ...old, error: e.message || 'network error' });
  }
}
const loadBoard = (id) => load(id, () => tfl.arrivals(id));
// Ask for trains from the time you could be on the platform, so the first one is catchable.
const loadRoute = (s) => load('r:' + s.uid, () => tfl.nextTrains(s.from.id, s.to.id, Date.now() + s.walk * 60000));

async function refresh() {
  if (fetching) return;
  fetching = true;
  $('#refreshBtn').classList.add('spin');
  const ids = new Set(stations.filter((s) => !isRoute(s)).map((s) => s.id));
  if (nearby?.open) ids.add(nearby.open);
  await Promise.all([
    ...[...ids].map(loadBoard),
    ...stations.filter(isRoute).map(loadRoute),
    ids.size ? tfl.lineProblems().then((p) => { problems = p; }).catch(() => {}) : null,
  ]);
  lastFetch = Date.now();
  fetching = false;
  $('#refreshBtn').classList.remove('spin');
  render();
}

// ---------- Rendering

// Replace the markup only when it changed, so a tap is not lost to a redraw.
function setHTML(el, html) {
  if (el._html === html) return;
  el._html = html;
  el.innerHTML = html;
}

function depRow(a, now) {
  const m = minutesLeft(a.time, now);
  const sub = [a.lineName, a.platform, a.via].filter(Boolean).join(' · ');
  return `<li class="dep">
    <span class="bar" style="--c:${lineColor(a.line, a.mode)}"></span>
    <span class="dest"><b>${esc(a.dest)}</b><small>${esc(sub)}</small></span>
    <span class="when">${m === 0 ? '<b>Due</b>' : `<b>${m}</b><i>min</i>`}<small>${fmtClock(a.time)}</small></span>
  </li>`;
}

// Lines a saved station cares about: the filter, or every line of the station.
const careLines = (s) => (s.filter.lines?.length ? s.lines.filter((l) => s.filter.lines.includes(l.id)) : s.lines);

function railOnlyNote(lines) {
  const rail = lines.filter((l) => !tfl.LIVE_MODES.includes(l.mode));
  if (!rail.length) return '';
  const names = rail.map((l) => l.name).join(', ');
  return rail.length === lines.length
    ? `<p class="note">No departure board for ${esc(names)}. Add a <b>From → To</b> card instead to see the next train and delays.</p>`
    : `<p class="note small">${esc(names)} not shown here: use a From → To card for those.</p>`;
}

function routeRow(t, now) {
  const m = minutesLeft(t.time, now);
  const late = Math.round((t.time - t.sched) / 60000);
  const status = late > 0 ? `<em class="late">${late} min late</em>` : late < 0 ? 'Early' : 'On time';
  const info = [t.operator, t.changes ? `${t.changes} change${t.changes > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ');
  return `<li class="dep">
    <span class="bar" style="--c:${lineColor('', 'national-rail')}"></span>
    <span class="dest"><b>${fmtClock(t.time)}${late > 0 ? ` <s>${fmtClock(t.sched)}</s>` : ''} → ${fmtClock(t.arrive)}</b>
      <small>${status}${info ? ' · ' + esc(info) : ''}</small></span>
    <span class="when">${m === 0 ? '<b>Due</b>' : `<b>${m}</b><i>min</i>`}</span>
  </li>`;
}

function routeCard(s) {
  const now = Date.now();
  const b = boards.get('r:' + s.uid);
  let body = '';
  let leave = '';
  if (!b) body = '<p class="note">Loading…</p>';
  else {
    const rows = b.list.filter((t) => t.time - now >= s.walk * 60000 && t.time - now > -30000).slice(0, 2);
    body = rows.length ? `<ol class="deps">${rows.map((t) => routeRow(t, now)).join('')}</ol>`
      : '<p class="note">No direct train found soon.</p>';
    if (b.error) body += `<p class="note err">Couldn't update (${esc(b.error)}). Times may be out of date.</p>`;
    if (rows[0] && s.walk) {
      const n = leaveIn(rows[0].time, now, s.walk);
      leave = n <= 0 ? '<span class="leave now">Leave now</span>' : `<span class="leave">Leave in <b>${n}</b> min</span>`;
    }
  }
  return `<article class="card" data-uid="${s.uid}">
    <header>
      <div class="title"><h2>${esc(s.name)}</h2><p class="muted small">Next trains${s.walk ? ` · ${s.walk} min walk` : ''}</p></div>
      ${leave}
      <button class="icon-btn" data-edit="${s.uid}" aria-label="Edit ${esc(s.name)}">
        <svg viewBox="0 0 24 24" width="20" height="20"><circle cx="5" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="19" cy="12" r="2" fill="currentColor"/></svg>
      </button>
    </header>
    ${body}
  </article>`;
}

function filterSummary(s) {
  const parts = [];
  if (s.filter.lines?.length) parts.push(careLines(s).map((l) => l.name).join(', '));
  if (s.filter.dests?.length) parts.push('to ' + s.filter.dests.join(', '));
  if (s.filter.platforms?.length) parts.push(s.filter.platforms.join(', '));
  if (s.walk) parts.push(`${s.walk} min walk`);
  return parts.join(' · ');
}

function savedCard(s) {
  if (isRoute(s)) return routeCard(s);
  const now = Date.now();
  const b = boards.get(s.id);
  const lines = careLines(s);
  let body = '';
  let leave = '';

  for (const l of lines) {
    const p = problems[l.id];
    if (!p) continue;
    const key = s.uid + l.id;
    body += `<button class="alert${openAlerts.has(key) ? ' open' : ''}" data-alert="${key}">
      <span class="bar" style="--c:${lineColor(l.id, l.mode)}"></span>
      <span><b>${esc(p.name)}:</b> ${esc(p.text)}${p.reason ? `<small>${esc(p.reason)}</small>` : ''}</span>
    </button>`;
  }

  if (!b) {
    body += '<p class="note">Loading…</p>';
  } else {
    const { rows, missed } = boardRows(b.list, s.filter, { now, walk: s.walk, rows: s.rows });
    if (rows.length) body += `<ol class="deps">${rows.map((a) => depRow(a, now)).join('')}</ol>`;
    else if (lines.some((l) => tfl.LIVE_MODES.includes(l.mode))) body += '<p class="note">No matching departures in the next half hour or so.</p>';
    if (missed && s.walk) body += `<p class="note small">${missed} earlier train${missed > 1 ? 's' : ''} too soon to catch with a ${s.walk} min walk.</p>`;
    body += railOnlyNote(lines);
    if (b.error) body += `<p class="note err">Couldn't update (${esc(b.error)}). Times may be out of date.</p>`;
    if (rows[0] && s.walk) {
      const n = leaveIn(rows[0].time, now, s.walk);
      leave = n <= 0 ? '<span class="leave now">Leave now</span>' : `<span class="leave">Leave in <b>${n}</b> min</span>`;
    }
  }

  return `<article class="card" data-uid="${s.uid}">
    <header>
      <div class="title"><h2>${esc(s.name)}</h2><p class="muted small">${esc(filterSummary(s))}</p></div>
      ${leave}
      <button class="icon-btn" data-edit="${s.uid}" aria-label="Edit ${esc(s.name)}">
        <svg viewBox="0 0 24 24" width="20" height="20"><circle cx="5" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="19" cy="12" r="2" fill="currentColor"/></svg>
      </button>
    </header>
    ${body}
  </article>`;
}

function renderNearby() {
  const el = $('#nearby');
  el.hidden = !nearby;
  if (!nearby) return;
  let body;
  if (nearby.state === 'locating') body = '<p class="note">Finding your location…</p>';
  else if (nearby.state === 'loading') body = '<p class="note">Looking for stations…</p>';
  else if (nearby.state === 'error') body = `<p class="note err">${esc(nearby.error)}</p>`;
  else if (!nearby.list.length) body = '<p class="note">No train or tube station within 3 km.</p>';
  else {
    const now = Date.now();
    body = '<ul class="near-list">' + nearby.list.map((st) => {
      const open = nearby.open === st.id;
      const walk = Math.max(1, Math.round(st.distance / WALK_M_PER_MIN));
      let board = '';
      if (open) {
        const b = boards.get(st.id);
        if (!b) board = '<p class="note">Loading…</p>';
        else {
          const { rows } = boardRows(b.list, {}, { now, rows: 8 });
          board = rows.length ? `<ol class="deps">${rows.map((a) => depRow(a, now)).join('')}</ol>`
            : st.modes.some((m) => tfl.LIVE_MODES.includes(m)) ? '<p class="note">No departures in the next half hour or so.</p>'
              : '<p class="note">National Rail only: TfL has no live times for this station.</p>';
          if (b.error) board += `<p class="note err">Couldn't update (${esc(b.error)}).</p>`;
        }
        board += `<button class="btn small" data-save-near="${st.id}" data-walk="${walk}">☆ Save this station…</button>`;
      }
      return `<li class="${open ? 'open' : ''}">
        <button class="near-row" data-near="${st.id}">
          <b>${esc(st.name)}</b>
          <small>${esc(st.modes.map((m) => MODE_LABELS[m] || m).join(', '))} · ${st.distance} m · ~${walk} min walk</small>
        </button>${board}</li>`;
    }).join('') + '</ul>';
  }
  setHTML(el, `<header><h2>Near you</h2>
    <button class="icon-btn" id="nearClose" aria-label="Close nearby">✕</button></header>${body}`);
}

function render() {
  setHTML($('#saved'), stations.map(savedCard).join(''));
  $('#empty').hidden = stations.length > 0 || !!nearby;
  renderNearby();
  $('#updated').textContent = lastFetch ? `Updated ${fmtClock(lastFetch)}` : '';
}

// ---------- Nearest station (only on tap: no background location)

function locate() {
  const q = new URLSearchParams(location.search);
  if (q.has('lat') && q.has('lon')) return Promise.resolve({ lat: +q.get('lat'), lon: +q.get('lon') });
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('This browser cannot share its location.')); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      (e) => reject(new Error(e.code === 1
        ? 'Location is blocked. Allow it for this site in the browser settings, then try again.'
        : 'Could not get your location. Try again outside or with Wi-Fi on.')),
      { enableHighAccuracy: false, maximumAge: 60000, timeout: 15000 },
    );
  });
}

async function findNearest() {
  nearby = { state: 'locating' };
  render();
  try {
    const pos = await locate();
    nearby = { state: 'loading' };
    render();
    let list = await tfl.nearbyStations(pos.lat, pos.lon);
    if (!list.length) list = await tfl.nearbyStations(pos.lat, pos.lon, 3000);
    nearby = { state: 'ready', list, open: list[0]?.id };
    render();
    if (nearby.open) { await loadBoard(nearby.open); render(); }
  } catch (e) {
    nearby = { state: 'error', error: e.message };
    render();
  }
}

// ---------- Add / edit station

let ed = null; // station: { type, uid, id, info, draft } / route: { type, uid, from, to, draft, preview }
let pick = null; // search in progress: { kind: 'station' | 'route', from }
const dlg = $('#editor');

function openSearch(kind = 'station', from = null) {
  ed = null;
  pick = { kind, from };
  $('#edTitle').textContent = 'Add';
  const label = kind === 'station' ? 'Station' : from ? `To <span class="muted">(from ${esc(from.name)})</span>` : 'From';
  $('#edBody').innerHTML = `
    <div class="seg">
      <button type="button" data-kind="station" aria-pressed="${kind === 'station'}">Station departures</button>
      <button type="button" data-kind="route" aria-pressed="${kind === 'route'}">From → To</button>
    </div>
    <p class="hint">${kind === 'station'
      ? 'Live departure board: Tube, DLR, Overground, Elizabeth line, tram.'
      : 'Next train and its delay between two National Rail stations (Southeastern, Southern, Thameslink…).'}</p>
    <label class="field">${label}
      <input id="edSearch" type="search" placeholder="Station name" autocomplete="off" enterkeyhint="search"></label>
    <ul id="edResults" class="results"></ul>`;
  if (!dlg.open) dlg.showModal();
  $('#edSearch').focus();
}

let searchTimer;
let searchSeq = 0;
function onSearchInput(q) {
  clearTimeout(searchTimer);
  const out = $('#edResults');
  if (q.trim().length < 2) { out.innerHTML = ''; return; }
  searchTimer = setTimeout(async () => {
    const seq = ++searchSeq;
    out.innerHTML = '<li class="note">Searching…</li>';
    try {
      const list = pick.kind === 'route'
        ? (await tfl.searchRailStations(q.trim())).filter((r) => r.id !== pick.from?.id)
        : await tfl.searchStations(q.trim());
      if (seq !== searchSeq) return;
      out.innerHTML = list.length ? list.map((r) => `<li><button class="near-row" data-pick="${r.id}" data-name="${esc(r.name)}">
        <b>${esc(r.name)}</b><small>${esc((r.modes || ['national-rail']).map((m) => MODE_LABELS[m] || m).join(', '))}</small></button></li>`).join('')
        : '<li class="note">No station found.</li>';
    } catch (e) {
      if (seq === searchSeq) out.innerHTML = `<li class="note err">${esc(e.message)}</li>`;
    }
  }, 350);
}

async function openConfig(stationId, existing, walkGuess = 0) {
  $('#edTitle').textContent = existing ? 'Edit station' : 'Add station';
  $('#edBody').innerHTML = '<p class="note">Loading station…</p>';
  if (!dlg.open) dlg.showModal();
  try {
    const [info] = await Promise.all([tfl.stationInfo(stationId), loadBoard(stationId)]);
    ed = {
      type: 'station',
      uid: existing?.uid,
      info,
      id: stationId,
      draft: existing
        ? structuredClone({ name: existing.name, filter: existing.filter, walk: existing.walk, rows: existing.rows })
        : { name: info.name, filter: { lines: [], dests: [], platforms: [] }, walk: walkGuess, rows: 5 },
    };
    renderConfig();
  } catch (e) {
    $('#edBody').innerHTML = `<p class="note err">Couldn't load the station (${esc(e.message)}).</p>`;
  }
}

function chips(group, options, selected, label = (o) => o) {
  if (!options.length) return '<p class="note small">None right now.</p>';
  return '<div class="chips">' + options.map((o) => {
    const v = typeof o === 'string' ? o : o.id;
    return `<button type="button" class="chip" data-chip="${group}" data-v="${esc(v)}" aria-pressed="${selected.includes(v)}"
      ${o.id ? `style="--c:${lineColor(o.id, o.mode)}"` : ''}>${esc(label(o))}</button>`;
  }).join('') + '</div>';
}

function renderConfig() {
  const { info, draft } = ed;
  const f = draft.filter;
  const list = boards.get(ed.id)?.list || [];
  const onLines = applyFilter(list, { lines: f.lines });
  const uniq = (arr) => [...new Set(arr)].sort((a, b) => a.localeCompare(b));
  const dests = uniq([...onLines.map((a) => a.dest), ...f.dests]);
  const plats = uniq([...onLines.map((a) => a.platform).filter(Boolean), ...f.platforms]);
  const match = applyFilter(list, f).length;

  $('#edBody').innerHTML = `
    <p class="station-name">${esc(info.name)}</p>
    <label class="field">Name on the card<input id="edName" value="${esc(draft.name)}"></label>
    <p class="hint">Pick what you care about. Nothing picked in a group means everything.</p>
    <fieldset><legend>Lines</legend>${chips('lines', info.lines, f.lines, (l) => l.name)}</fieldset>
    <fieldset><legend>Destinations <span class="muted small">(from trains due now)</span></legend>${chips('dests', dests, f.dests)}</fieldset>
    <fieldset><legend>Platform / direction</legend>${chips('platforms', plats, f.platforms)}</fieldset>
    <div class="row2">
      <label class="field">Walk to the station<span class="unit"><input id="edWalk" type="number" inputmode="numeric" min="0" max="90" value="${draft.walk || ''}" placeholder="0"> min</span></label>
      <label class="field">Show<span class="unit"><select id="edRows">${[3, 5, 8, 12].map((n) => `<option ${n === draft.rows ? 'selected' : ''}>${n}</option>`).join('')}</select> trains</span></label>
    </div>
    <p class="hint">With a walking time, trains you can't catch are hidden and the card says when to leave.</p>
    <p class="note small">${match} of ${list.length} trains due now match.</p>
    ${edFooter()}`;
}

function edFooter() {
  const idx = stations.findIndex((s) => s.uid === ed.uid);
  return `<div class="ed-foot">
      ${ed.uid ? `<button type="button" class="btn danger" data-ed="delete">Delete</button>
        <button type="button" class="btn" data-ed="up" ${idx <= 0 ? 'disabled' : ''} aria-label="Move up">↑</button>
        <button type="button" class="btn" data-ed="down" ${idx >= stations.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button>` : ''}
      <span class="spacer"></span>
      <button type="button" class="btn primary" data-ed="save">Save</button>
    </div>`;
}

const routeName = (from, to) => `${from.name.replace(/^London /, '')} → ${to.name.replace(/^London /, '')}`;

async function openRouteConfig(from, to, existing) {
  $('#edTitle').textContent = existing ? 'Edit trip' : 'Add trip';
  ed = {
    type: 'route', uid: existing?.uid, from, to,
    draft: { name: existing?.name || routeName(from, to), walk: existing?.walk || 0 },
    preview: null,
  };
  renderRouteConfig();
  if (!dlg.open) dlg.showModal();
  const mine = ed;
  try {
    mine.preview = await tfl.nextTrains(from.id, to.id, Date.now());
  } catch (e) {
    mine.preview = { error: e.message };
  }
  if (ed === mine) { readInputs(); renderRouteConfig(); }
}

function renderRouteConfig() {
  const { from, to, draft, preview } = ed;
  let next;
  if (!preview) next = 'Looking for trains…';
  else if (preview.error) next = `<span class="err">Couldn't check (${esc(preview.error)}).</span>`;
  else if (!preview.length) next = 'No direct train found soon. Check the two stations are on the same line.';
  else {
    const t = preview[0];
    const late = Math.round((t.time - t.sched) / 60000);
    next = `Next train ${fmtClock(t.time)} → ${fmtClock(t.arrive)}${late > 0 ? `, ${late} min late` : ''}${t.operator ? ` (${esc(t.operator)})` : ''}.`;
  }
  $('#edBody').innerHTML = `
    <p class="station-name">${esc(from.name)} → ${esc(to.name)}</p>
    <label class="field">Name on the card<input id="edName" value="${esc(draft.name)}"></label>
    <label class="field">Walk to the station<span class="unit"><input id="edWalk" type="number" inputmode="numeric" min="0" max="90" value="${draft.walk || ''}" placeholder="0"> min</span></label>
    <p class="hint">With a walking time, the card shows the first train you can catch and when to leave.</p>
    <p class="note small">${next}</p>
    ${edFooter()}`;
}

function readInputs() {
  ed.draft.name = $('#edName')?.value.trim() ?? ed.draft.name;
  ed.draft.walk = Math.max(0, Math.min(90, parseInt($('#edWalk')?.value, 10) || 0));
  if ($('#edRows')) ed.draft.rows = +$('#edRows').value;
}

function editorAction(act) {
  readInputs();
  const i = stations.findIndex((s) => s.uid === ed.uid);
  if (act === 'save') {
    const s = ed.type === 'route' ? {
      uid: ed.uid || newUid(),
      type: 'route',
      from: ed.from,
      to: ed.to,
      name: ed.draft.name || routeName(ed.from, ed.to),
      walk: ed.draft.walk,
    } : {
      uid: ed.uid || newUid(),
      id: ed.id,
      name: ed.draft.name || ed.info.name,
      lines: ed.info.lines,
      filter: ed.draft.filter,
      walk: ed.draft.walk,
      rows: ed.draft.rows,
    };
    if (i >= 0) stations[i] = s; else stations.push(s);
    dlg.close();
  } else if (act === 'delete') {
    if (!confirm(`Remove ${stations[i].name}?`)) return;
    stations.splice(i, 1);
    dlg.close();
  } else if (act === 'up' || act === 'down') {
    const j = act === 'up' ? i - 1 : i + 1;
    [stations[i], stations[j]] = [stations[j], stations[i]];
    if (ed.type === 'route') renderRouteConfig(); else renderConfig();
  }
  saveStations(stations);
  render();
  if (act === 'save') refresh();
}

// ---------- Events

document.addEventListener('click', (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.id === 'refreshBtn') refresh();
  else if (t.id === 'nearBtn') findNearest();
  else if (t.id === 'addBtn') openSearch();
  else if (t.id === 'nearClose') { nearby = null; render(); }
  else if (t.id === 'edClose') dlg.close();
  else if (t.dataset.near) {
    nearby.open = nearby.open === t.dataset.near ? null : t.dataset.near;
    render();
    if (nearby.open) loadBoard(nearby.open).then(render);
  } else if (t.dataset.saveNear) openConfig(t.dataset.saveNear, null, +t.dataset.walk);
  else if (t.dataset.kind) openSearch(t.dataset.kind);
  else if (t.dataset.pick) {
    const st = { id: t.dataset.pick, name: t.dataset.name };
    if (pick.kind === 'station') openConfig(st.id, null);
    else if (!pick.from) openSearch('route', st);
    else openRouteConfig(pick.from, st);
  } else if (t.dataset.edit) {
    const s = stations.find((x) => x.uid === t.dataset.edit);
    if (isRoute(s)) openRouteConfig(s.from, s.to, s); else openConfig(s.id, s);
  } else if (t.dataset.alert) {
    openAlerts.has(t.dataset.alert) ? openAlerts.delete(t.dataset.alert) : openAlerts.add(t.dataset.alert);
    render();
  } else if (t.dataset.chip) {
    readInputs();
    const list = ed.draft.filter[t.dataset.chip];
    const k = list.indexOf(t.dataset.v);
    if (k >= 0) list.splice(k, 1); else list.push(t.dataset.v);
    renderConfig();
  } else if (t.dataset.ed) editorAction(t.dataset.ed);
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'edSearch') onSearchInput(e.target.value);
});

// Tick: countdowns every 10 s, new data every 30 s, nothing while the app is in the background.
setInterval(() => {
  if (document.hidden) return;
  if (Date.now() - lastFetch >= REFRESH_MS) refresh(); else render();
}, 10000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && Date.now() - lastFetch >= REFRESH_MS) refresh();
});

render();
refresh();

if ('serviceWorker' in navigator && location.hostname !== 'localhost') {
  navigator.serviceWorker.register('sw.js');
}
