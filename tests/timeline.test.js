import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  sessionMinutes,
  localDateFromIso,
  clockTime,
  sessionSegment,
  checkpointForPillar,
  totalSessionMinutes,
} from '../timeline.js';
import { syncCurrentDayState, checkpointMessage } from '../app-state.js';

test('sessionMinutes floors partial minutes and clamps skew', () => {
  assert.equal(sessionMinutes('2026-06-14T10:00:00Z', '2026-06-14T11:23:59Z'), 83);
  assert.equal(sessionMinutes('2026-06-14T10:00:00Z', '2026-06-14T09:59:59Z'), 0);
});

test('localDateFromIso returns the local date string for the timestamp', () => {
  assert.equal(localDateFromIso('2026-06-14T10:00:00Z'), '2026-06-14');
});

test('localDateFromIso uses local timezone near midnight', () => {
  const cwd = fileURLToPath(new URL('..', import.meta.url));
  const text = execFileSync(process.execPath, [
    '--input-type=module',
    '-e',
    "import { localDateFromIso } from './timeline.js'; console.log(localDateFromIso('2026-06-14T20:00:00Z'));",
  ], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, TZ: 'Asia/Bangkok' },
  }).trim();

  assert.equal(text, '2026-06-15');
});

test('clockTime renders local HH:MM', () => {
  const text = clockTime('2026-06-14T10:05:00Z');
  assert.match(text, /^[0-2][0-9]:[0-5][0-9]$/);
});

test('sessionSegment maps a same-day session to lane percentages', () => {
  const seg = sessionSegment({
    id: 's1',
    started_at: '2026-06-14T06:00:00',
    ended_at: '2026-06-14T12:00:00',
  });
  assert.deepEqual(seg, { left: 25, width: 25 });
});

test('sessionSegment clamps a cross-midnight session inside the visible day', () => {
  const seg = sessionSegment({
    id: 's1',
    started_at: '2026-06-14T22:00:00',
    ended_at: '2026-06-15T02:00:00',
  });
  assert.deepEqual(seg, { left: 91.67, width: 8.33 });
});

test('totalSessionMinutes sums only real timer sessions', () => {
  assert.equal(totalSessionMinutes([
    { minutes: 30 },
    { minutes: 45 },
    { minutes: 0 },
  ]), 75);
});

test('totalSessionMinutes ignores invalid or negative minutes', () => {
  assert.equal(totalSessionMinutes([
    { minutes: 30 },
    { minutes: -10 },
    { minutes: '20' },
    {},
  ]), 30);
});

test('checkpointForPillar returns first real session crossing target', () => {
  const sessions = [
    { id: 'b', pillar: 'skill', started_at: '2026-06-14T10:00:00', ended_at: '2026-06-14T12:30:00', minutes: 150 },
    { id: 'c', pillar: 'skill', started_at: '2026-06-14T13:00:00', ended_at: '2026-06-14T14:00:00', minutes: 60 },
    { id: 'a', pillar: 'skill', started_at: '2026-06-14T08:00:00', ended_at: '2026-06-14T09:30:00', minutes: 90 },
  ];
  assert.deepEqual(checkpointForPillar(sessions, 'skill', 240), {
    sessionId: 'b',
    at: '2026-06-14T12:30:00.000',
    left: 52.08,
    time: '12:30',
  });
});

test('checkpointForPillar places badge inside the crossing session', () => {
  const sessions = [
    { id: 'a', pillar: 'uni', started_at: '2026-06-14T09:00:00', ended_at: '2026-06-14T10:30:00', minutes: 90 },
    { id: 'b', pillar: 'uni', started_at: '2026-06-14T15:00:00', ended_at: '2026-06-14T16:00:00', minutes: 60 },
  ];
  assert.deepEqual(checkpointForPillar(sessions, 'uni', 120), {
    sessionId: 'b',
    at: '2026-06-14T15:30:00.000',
    left: 64.58,
    time: '15:30',
  });
});

test('checkpointForPillar returns null when manual minutes hit target without sessions', () => {
  assert.equal(checkpointForPillar([], 'skill', 240), null);
});

test('checkpointForPillar returns null when crossing happens outside visible day', () => {
  const sessions = [
    { id: 'a', pillar: 'mind', started_at: '2026-06-14T23:00:00', ended_at: '2026-06-15T01:00:00', minutes: 120 },
  ];
  assert.equal(checkpointForPillar(sessions, 'mind', 90), null);
});

test('checkpointForPillar returns null when sessions never reach target', () => {
  const sessions = [
    { id: 'a', pillar: 'health', started_at: '2026-06-14T20:00:00', ended_at: '2026-06-14T20:45:00', minutes: 45 },
  ];
  assert.equal(checkpointForPillar(sessions, 'health', 60), null);
});

test('syncCurrentDayState replaces in-memory today after editing today detail', () => {
  const current = { minutes: { skill: 10 }, notes: { skill: 'old' } };
  const edited = { minutes: { skill: 20 }, notes: { skill: 'new' } };

  assert.deepEqual(syncCurrentDayState('2026-06-14', current, '2026-06-14', edited), edited);
});

test('syncCurrentDayState leaves today unchanged after editing another date', () => {
  const current = { minutes: { skill: 10 }, notes: { skill: 'today' } };
  const edited = { minutes: { skill: 20 }, notes: { skill: 'past' } };

  assert.equal(syncCurrentDayState('2026-06-14', current, '2026-06-13', edited), current);
});

test('checkpointMessage names the reached target time', () => {
  assert.equal(checkpointMessage('13:42'), 'Target reached at 13:42');
});
