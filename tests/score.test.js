import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WEIGHTS, DEFAULT_TARGETS, pillarPoints, dayPoints, dayScore, dayStatus,
  toDateStr, prevDate, addDays, startOfWeek, streak,
  balanceAlert, lifeTrend,
  elapsedMinutes, fmtElapsed,
  bestStreak,
  RECOVERY, daysBetween, recoveryWindowEndMs, recoveryEligibleDates,
  fmtCountdown, forgivenSet,
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

test('date helpers', () => {
  assert.equal(toDateStr(new Date(2026, 5, 12)), '2026-06-12'); // month is 0-based
  assert.equal(prevDate('2026-06-01'), '2026-05-31');
  assert.equal(addDays('2026-06-12', -35), '2026-05-08');
  assert.equal(addDays('2026-06-12', 2), '2026-06-14');
  assert.equal(startOfWeek('2026-06-12'), '2026-06-08'); // Fri -> Monday
  assert.equal(startOfWeek('2026-06-08'), '2026-06-08'); // Monday stays
});

test('streak counts consecutive days >= 40 back from today', () => {
  const s = { '2026-06-12': 80, '2026-06-11': 45, '2026-06-10': 90 };
  assert.equal(streak(s, '2026-06-12'), 3);
});

test('streak: today below 40 does not break it (day not finished)', () => {
  const s = { '2026-06-12': 10, '2026-06-11': 45, '2026-06-10': 90 };
  assert.equal(streak(s, '2026-06-12'), 2);
});

test('streak: red day or missing day breaks it', () => {
  assert.equal(streak({ '2026-06-12': 80, '2026-06-11': 20, '2026-06-10': 90 }, '2026-06-12'), 1);
  assert.equal(streak({ '2026-06-12': 80, '2026-06-10': 90 }, '2026-06-12'), 1);
  assert.equal(streak({}, '2026-06-12'), 0);
});

// helper: build {date: pointsObj} for n consecutive days ending at `end`
function pointsRun(end, n, pointsObj) {
  const out = {};
  let d = end;
  for (let i = 0; i < n; i++) { out[d] = pointsObj; d = prevDate(d); }
  return out;
}

test('balanceAlert: fires at 5 consecutive below-50% days, not at 4', () => {
  const good = { skill: 40, uni: 20, health: 20, fin: 5, eng: 5, mind: 5, refl: 5 };
  const noEng = { ...good, eng: 1 }; // eng below 2.5 (50% of 5)
  const four = { ...pointsRun('2026-06-11', 4, noEng), ...pointsRun('2026-06-07', 10, good) };
  assert.equal(balanceAlert(four, '2026-06-11'), null);
  const five = { ...pointsRun('2026-06-11', 5, noEng), ...pointsRun('2026-06-06', 10, good) };
  assert.deepEqual(balanceAlert(five, '2026-06-11'), { pillar: 'eng', days: 5 });
});

test('balanceAlert: picks the pillar with the longest miss run', () => {
  const good = { skill: 40, uni: 20, health: 20, fin: 5, eng: 5, mind: 5, refl: 5 };
  const missEng = { ...good, eng: 0 };
  const missBoth = { ...good, eng: 0, mind: 0 };
  const rows = { ...pointsRun('2026-06-11', 6, missBoth), ...pointsRun('2026-06-05', 3, missEng), ...pointsRun('2026-06-02', 5, good) };
  assert.deepEqual(balanceAlert(rows, '2026-06-11'), { pillar: 'eng', days: 9 });
});

test('balanceAlert: missing days count as 0 but never before first recorded day', () => {
  const good = { skill: 40, uni: 20, health: 20, fin: 5, eng: 5, mind: 5, refl: 5 };
  assert.equal(balanceAlert({}, '2026-06-11'), null); // brand-new user
  // recorded 2026-06-10 only; 11th missing -> counts as 0, but run stops at earliest record
  const rows = { '2026-06-10': good };
  assert.equal(balanceAlert(rows, '2026-06-11'), null); // run length 1 < 5
});

test('lifeTrend: percent change of summed points, last 30 vs previous 30', () => {
  const mk = pts => ({ points: pts, score: dayScore(pts) });
  const rows = {};
  // previous window (2026-04-14 .. 2026-05-13): skill 20/day
  let d = '2026-05-13';
  for (let i = 0; i < 30; i++) { rows[d] = mk({ skill: 20, uni: 0, health: 0, fin: 0, eng: 0, mind: 0, refl: 0 }); d = prevDate(d); }
  // current window (2026-05-14 .. 2026-06-12): skill 30/day
  d = '2026-06-12';
  for (let i = 0; i < 30; i++) { rows[d] = mk({ skill: 30, uni: 0, health: 0, fin: 0, eng: 0, mind: 0, refl: 0 }); d = prevDate(d); }
  const t = lifeTrend(rows, '2026-06-12');
  assert.equal(t.pillars.skill, 50);   // (900-600)/600
  assert.equal(t.pillars.uni, null);   // prev sum 0 -> no fake %
  assert.equal(t.overall, 50);         // avg score 30 vs 20
});

test('lifeTrend: no data in previous window -> all null', () => {
  const rows = { '2026-06-12': { points: { skill: 40 }, score: 40 } };
  const t = lifeTrend(rows, '2026-06-12');
  assert.equal(t.pillars.skill, null);
  assert.equal(t.overall, null);
});

test('elapsedMinutes floors partial minutes', () => {
  const start = '2026-06-12T10:00:00.000Z';
  const now = Date.parse('2026-06-12T10:23:41.000Z');
  assert.equal(elapsedMinutes(start, now), 23);
  assert.equal(elapsedMinutes(start, Date.parse(start)), 0);
});

test('fmtElapsed renders MM:SS under an hour, H:MM:SS above', () => {
  const start = '2026-06-12T10:00:00.000Z';
  assert.equal(fmtElapsed(start, Date.parse('2026-06-12T10:23:41Z')), '23:41');
  assert.equal(fmtElapsed(start, Date.parse('2026-06-12T11:02:09Z')), '1:02:09');
  assert.equal(fmtElapsed(start, Date.parse('2026-06-12T10:00:05Z')), '00:05');
});

test('pillarPoints throws on unknown pillar key instead of returning NaN', () => {
  assert.throws(() => pillarPoints('typo', { minutes: {} }, T), /unknown key/);
});

test('elapsedMinutes clamps clock skew to 0', () => {
  const start = '2026-06-12T10:00:00.000Z';
  assert.equal(elapsedMinutes(start, Date.parse('2026-06-12T09:59:00Z')), 0);
});

test('bestStreak finds the longest >=40 run anywhere in history', () => {
  assert.equal(bestStreak({}), 0);
  assert.equal(bestStreak({
    '2026-06-01': 80, '2026-06-02': 45, '2026-06-03': 20, // run of 2
    '2026-06-05': 80, '2026-06-06': 80, '2026-06-07': 80, // gap on 04, run of 3
  }), 3);
});

test('daysBetween counts whole calendar days', () => {
  assert.equal(daysBetween('2026-06-01', '2026-06-30'), 29);
  assert.equal(daysBetween('2026-06-01', '2026-06-01'), 0);
  assert.equal(daysBetween('2026-06-15', '2026-07-15'), 30);
});

test('recovery window: end is 00:00 of broken_date + 3 days; eligible dates are +1 and +2', () => {
  assert.equal(recoveryWindowEndMs('2026-06-15'), Date.parse('2026-06-18T00:00:00'));
  assert.deepEqual(recoveryEligibleDates('2026-06-15'), ['2026-06-16', '2026-06-17']);
});

test('recovery constants', () => {
  assert.equal(RECOVERY.MIN_STREAK, 7);
  assert.equal(RECOVERY.COOLDOWN_DAYS, 30);
  assert.equal(RECOVERY.GREEN, 80);
  assert.equal(RECOVERY.MAX_BREAK_AGE, 4); // don't surface breaks older than window + 1 day grace
});

test('fmtCountdown: Hh Mm above an hour, Mm under, 0m at/after expiry', () => {
  const now = Date.parse('2026-06-16T00:00:00');
  assert.equal(fmtCountdown(now + (47 * 60 + 12) * 60000, now), '47h 12m');
  assert.equal(fmtCountdown(now + 12 * 60000, now), '12m');
  assert.equal(fmtCountdown(now + 60 * 60000, now), '1h 0m');
  assert.equal(fmtCountdown(now, now), '0m');
  assert.equal(fmtCountdown(now - 5000, now), '0m'); // already expired clamps to 0
});

test('forgivenSet: only recovered entries whose green day still scores >= 80', () => {
  const history = [
    { outcome: 'recovered', broken_date: '2026-06-01', recovered_date: '2026-06-02' }, // green ok
    { outcome: 'recovered', broken_date: '2026-06-10', recovered_date: '2026-06-11' }, // green now < 80
    { outcome: 'reverted',  broken_date: '2026-06-20', recovered_date: '2026-06-21' }, // excluded
    { outcome: 'expired',   broken_date: '2026-06-25' },                                // excluded
  ];
  const scoreByDate = { '2026-06-02': 90, '2026-06-11': 50, '2026-06-21': 90 };
  const f = forgivenSet(history, scoreByDate);
  assert.equal(f.has('2026-06-01'), true);
  assert.equal(f.has('2026-06-10'), false); // revoke condition: green dropped below 80
  assert.equal(f.has('2026-06-20'), false);
  assert.equal(f.has('2026-06-25'), false);
  assert.equal(f.size, 1);
});

test('streak: bridges a forgiven break without counting it', () => {
  // 3-day run through 06-10, 06-11 missing (a recovered break), 06-12 green
  const s = { '2026-06-08': 80, '2026-06-09': 80, '2026-06-10': 80, '2026-06-12': 85 };
  assert.equal(streak(s, '2026-06-12'), 1);                                  // no bridging: only 06-12
  assert.equal(streak(s, '2026-06-12', new Set(['2026-06-11'])), 4);         // bridge 06-11, it adds 0
});

test('bestStreak: bridges a forgiven break without counting it', () => {
  const s = { '2026-06-08': 80, '2026-06-09': 80, '2026-06-10': 80, '2026-06-12': 85 };
  assert.equal(bestStreak(s), 3);                                            // longest raw run = 3
  assert.equal(bestStreak(s, new Set(['2026-06-11'])), 4);                   // bridged run = 4
});
