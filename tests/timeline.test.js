import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sessionMinutes,
  localDateFromIso,
  clockTime,
  sessionSegment,
  checkpointForPillar,
  totalSessionMinutes,
} from '../timeline.js';

test('sessionMinutes floors partial minutes and clamps skew', () => {
  assert.equal(sessionMinutes('2026-06-14T10:00:00Z', '2026-06-14T11:23:59Z'), 83);
  assert.equal(sessionMinutes('2026-06-14T10:00:00Z', '2026-06-14T09:59:59Z'), 0);
});

test('localDateFromIso returns the local date string for the timestamp', () => {
  assert.equal(localDateFromIso('2026-06-14T10:00:00Z'), '2026-06-14');
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

test('checkpointForPillar returns first real session crossing target', () => {
  const sessions = [
    { id: 'a', pillar: 'skill', started_at: '2026-06-14T08:00:00', ended_at: '2026-06-14T09:30:00', minutes: 90 },
    { id: 'b', pillar: 'skill', started_at: '2026-06-14T10:00:00', ended_at: '2026-06-14T12:30:00', minutes: 150 },
    { id: 'c', pillar: 'skill', started_at: '2026-06-14T13:00:00', ended_at: '2026-06-14T14:00:00', minutes: 60 },
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

test('checkpointForPillar returns null when sessions never reach target', () => {
  const sessions = [
    { id: 'a', pillar: 'health', started_at: '2026-06-14T20:00:00', ended_at: '2026-06-14T20:45:00', minutes: 45 },
  ];
  assert.equal(checkpointForPillar(sessions, 'health', 60), null);
});
