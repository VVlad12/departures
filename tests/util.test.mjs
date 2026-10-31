import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanName, applyFilter, boardRows, leaveIn, minutesLeft, londonToEpoch, londonDateTime,
} from '../js/util.js';

test('cleanName strips station suffixes', () => {
  assert.equal(cleanName('Clapham Common Underground Station'), 'Clapham Common');
  assert.equal(cleanName('Stratford (London) Rail Station'), 'Stratford');
  assert.equal(cleanName('Bank DLR Station'), 'Bank');
  assert.equal(cleanName('Wimbledon Tram Stop'), 'Wimbledon');
  assert.equal(cleanName("King's Cross & St Pancras International"), "King's Cross & St Pancras International");
});

const now = Date.UTC(2026, 9, 30, 10, 0);
const min = (m) => now + m * 60000;
const list = [
  { line: 'northern', dest: 'Morden', platform: 'Southbound - Platform 2', time: min(-2) },
  { line: 'northern', dest: 'High Barnet', platform: 'Northbound - Platform 1', time: min(1) },
  { line: 'northern', dest: 'Morden', platform: 'Southbound - Platform 2', time: min(3) },
  { line: 'victoria', dest: 'Brixton', platform: 'Southbound - Platform 4', time: min(6) },
  { line: 'northern', dest: 'Morden', platform: 'Southbound - Platform 2', time: min(9) },
];

test('empty filter groups match everything', () => {
  assert.equal(applyFilter(list, {}).length, 5);
  assert.equal(applyFilter(list, { lines: [], dests: [] }).length, 5);
});

test('filter groups combine', () => {
  assert.equal(applyFilter(list, { lines: ['northern'] }).length, 4);
  assert.equal(applyFilter(list, { lines: ['northern'], dests: ['Morden'] }).length, 3);
  assert.equal(applyFilter(list, { platforms: ['Southbound - Platform 4'] })[0].dest, 'Brixton');
});

test('boardRows drops gone trains and the ones you cannot reach', () => {
  const r = boardRows(list, { dests: ['Morden'] }, { now, walk: 0, rows: 5 });
  assert.deepEqual(r.rows.map((a) => a.time), [min(3), min(9)]);
  const w = boardRows(list, { dests: ['Morden'] }, { now, walk: 5, rows: 5 });
  assert.deepEqual(w.rows.map((a) => a.time), [min(9)]);
  assert.equal(w.missed, 1);
  assert.equal(boardRows(list, {}, { now, rows: 2 }).rows.length, 2);
});

test('leave and countdown minutes', () => {
  assert.equal(leaveIn(min(9), now, 5), 4);
  assert.equal(leaveIn(min(5.5), now, 5), 0);
  assert.equal(minutesLeft(min(0.5), now), 0);
  assert.equal(minutesLeft(min(-1), now), 0);
  assert.equal(minutesLeft(min(4.9), now), 4);
});

test('London local times from the journey planner', () => {
  assert.equal(londonToEpoch('2026-07-01T09:00:00'), Date.UTC(2026, 6, 1, 8, 0)); // BST
  assert.equal(londonToEpoch('2026-12-01T09:00:00'), Date.UTC(2026, 11, 1, 9, 0)); // GMT
  assert.deepEqual(londonDateTime(Date.UTC(2026, 6, 1, 23, 30)), { date: '20260702', time: '0030' });
});
