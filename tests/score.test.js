import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WEIGHTS, DEFAULT_TARGETS, pillarPoints, dayPoints, dayScore, dayStatus,
} from '../score.js';

const T = { ...DEFAULT_TARGETS }; // {skill:240, uni:120, health:60, fin:20, eng:30, mind:10}

test('weights sum to 100', () => {
  assert.equal(Object.values(WEIGHTS).reduce((a, b) => a + b, 0), 100);
});

test('timed pillar points: proportional, rounded, capped at target', () => {
  assert.equal(pillarPoints('skill', { minutes: { skill: 210 } }, T), 35); // 210/240*40
  assert.equal(pillarPoints('skill', { minutes: { skill: 0 } }, T), 0);
  assert.equal(pillarPoints('skill', { minutes: {} }, T), 0);              // missing = 0
  assert.equal(pillarPoints('skill', { minutes: { skill: 300 } }, T), 40); // over target capped
  assert.equal(pillarPoints('uni', { minutes: { uni: 90 } }, T), 15);      // 90/120*20
  assert.equal(pillarPoints('eng', { minutes: { eng: 25 } }, T), 4);       // 4.166 -> 4
  assert.equal(pillarPoints('mind', { minutes: { mind: 10 } }, T), 5);
});

test('health: 15 pts from workout minutes + 5 pts sleep', () => {
  assert.equal(pillarPoints('health', { minutes: { health: 45 }, sleep_ok: false }, T), 11); // 11.25 -> 11
  assert.equal(pillarPoints('health', { minutes: { health: 60 }, sleep_ok: true }, T), 20);
  assert.equal(pillarPoints('health', { minutes: {}, sleep_ok: true }, T), 5);
});

test('reflection: 5 pts across win + 2 questions', () => {
  const d = (win, wrong, tomorrow) => ({ win, reflect: { wrong, tomorrow } });
  assert.equal(pillarPoints('refl', d('', '', ''), T), 0);
  assert.equal(pillarPoints('refl', d('a', '', ''), T), 2);   // round(5/3)
  assert.equal(pillarPoints('refl', d('a', 'b', ''), T), 3);  // round(10/3)
  assert.equal(pillarPoints('refl', d('a', 'b', 'c'), T), 5);
  assert.equal(pillarPoints('refl', d('  ', 'b', ''), T), 2); // whitespace-only = empty
});

test('dayPoints + dayScore reproduce the approved mockup day = 80', () => {
  const data = {
    minutes: { skill: 210, uni: 90, health: 45, fin: 20, eng: 25, mind: 10 },
    sleep_ok: false,
    win: 'Shipped the auth flow',
    reflect: { wrong: 'Slept late', tomorrow: 'Finish problem set' },
  };
  const pts = dayPoints(data, T);
  assert.deepEqual(pts, { skill: 35, uni: 15, health: 11, fin: 5, eng: 4, mind: 5, refl: 5 });
  assert.equal(dayScore(pts), 80);
});

test('dayStatus thresholds', () => {
  assert.equal(dayStatus(80), 'green');
  assert.equal(dayStatus(79), 'yellow');
  assert.equal(dayStatus(40), 'yellow');
  assert.equal(dayStatus(39), 'red');
});
