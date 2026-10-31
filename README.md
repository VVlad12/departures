# Departures

A phone web app (PWA) with live departure times for London stations, so you know when to leave the
house without opening a map.

## Features

- **Saved stations** show as soon as the app opens. Each one can be filtered by:
  - **Lines** (e.g. only the Northern line at King's Cross),
  - **Destinations** (e.g. only trains to Morden),
  - **Platform / direction** (e.g. only Northbound).

  Nothing picked in a group means everything.
- **Walking time** per station: trains you can no longer catch are hidden and the card shows
  **Leave in N min** (or **Leave now**) for the next train you can catch.
- **Nearest station**: one tap reads your location once and lists stations within 1.2 km
  (3 km if none), nearest first, with their departures. Location is never read in the background.
  Any of them can be saved with **Save this station…** (the walk time is pre-filled from the distance).
- **From → To trips** for National Rail (Southeastern, Southern, Thameslink…), e.g. Stratford International →
  St Pancras: the next two trains, arrival time, and how late they are (the timetabled time is struck through).
  With a walking time, it starts from the first train you can catch and shows **Leave in N min**.
- Line disruptions (delays, closures) for the lines a card cares about; tap one for the details.
- Times refresh every 30 s while the app is on screen, and pause in the background.
- Edit, reorder (↑ ↓) or delete a station with the **⋯** button on its card.

Saved stations are kept in the browser on the phone (localStorage), not on any server.

## Data and its limits

Live data comes from the [TfL Unified API](https://api.tfl.gov.uk/) (free, no key needed for this use):

- **Covered**: Tube, DLR, London Overground, Elizabeth line, trams.
- **No departure board** for National Rail operators (Southern, South Western Railway, Thameslink, Southeastern…):
  TfL does not publish them. From → To cards use the TfL **journey planner** instead, which returns about
  three trains with expected and timetabled times, so delays show. It gives no platforms, and a cancelled
  train may simply be missing rather than marked cancelled. Full live boards would need National Rail's
  Darwin feed (free account token plus a small server, as it can't be called from a browser).
  The journey planner rejects interchange ids, so trips use the rail station inside an interchange
  (e.g. St Pancras International rather than "King's Cross & St Pancras").
- Predictions reach about 30 minutes ahead, so with a long walk only a few trains may show.
- Interchanges such as "King's Cross & St Pancras" read the departures of the stations inside them.

## Using it on the phone

Host the folder on any HTTPS static host (e.g. GitHub Pages, like Sun Path), open it in Chrome or Safari,
then **Add to Home screen**. HTTPS is needed for the location button.

## Local testing

```
node serve.mjs 8767
```

Then open http://localhost:8767/. On a desktop, add `?lat=51.4618&lon=-0.1385` to the URL to fake a
location for **Nearest station**.

Tests (pure helpers: name cleanup, filters, walking time): `npm test`.
Icons are drawn by `node scripts/make-icons.mjs` (no dependencies).

When changing any file, bump `VERSION` in `sw.js` so installed phones pick up the update.
