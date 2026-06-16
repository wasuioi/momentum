# Streak Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a streak of ≥ 7 days survive one bad day — a single Green Day (score ≥ 80) inside a real-time 48-hour window restores it, once per 30-day cooldown, with an honest `⭐` marker.

**Architecture:** A forgiven-dates ledger lives in one `app_state` row (`recovery`). All decision logic is pure functions in `score.js` (unit-tested); `streak()`/`bestStreak()` gain an optional `forgiven` set that bridges recovered breaks without counting them. `app.js` wires a single `evaluateRecovery()` brain into boot and the Today render, drawing the banner, success/failure modals, and marker. No new tables, no libraries.

**Tech Stack:** Vanilla ES modules, Supabase (`app_state` JSON blob), `node --test` for unit tests.

**Spec:** `docs/superpowers/specs/2026-06-16-streak-recovery-design.md`

---

## File Structure

- **`score.js`** (modify) — pure logic: recovery constants, `daysBetween`, `recoveryWindowEndMs`, `recoveryEligibleDates`, `fmtCountdown`, `forgivenSet`, `evaluateRecovery`; bridging added to `streak`/`bestStreak`.
- **`tests/score.test.js`** (modify) — unit tests for everything above.
- **`db.js`** (modify) — `getRecovery` / `setRecovery` thin wrappers.
- **`app.js`** (modify) — load state, `syncRecovery`, banner, modals, marker, countdown tick.
- **`index.html`** (modify) — `#modal` overlay element.
- **`style.css`** (modify) — `.recovery` banner + `.modal` styles.

**Testing convention (follow the existing repo):** only `score.js` is unit-tested (it is pure). `db.js`/`app.js`/`index.html`/`style.css` are integration/UI and are verified manually, exactly as the current codebase does. Run all tests with `node --test`.

---

## Task 1: Recovery constants + date/window helpers (`score.js`)

**Files:**
- Modify: `score.js` (append a new section after `bestStreak`)
- Test: `tests/score.test.js`

- [ ] **Step 1: Write the failing tests**

Add to `tests/score.test.js` (and add the new names to the import block at the top: `RECOVERY, daysBetween, recoveryWindowEndMs, recoveryEligibleDates`):

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test --test-name-pattern="recovery window|daysBetween|recovery constants"`
Expected: FAIL (e.g. `RECOVERY is not defined` / import error).

- [ ] **Step 3: Implement the helpers**

Append to `score.js`:

```js
// ---- streak recovery (spec: docs/superpowers/specs/2026-06-16-streak-recovery-design.md) ----

export const RECOVERY = { MIN_STREAK: 7, COOLDOWN_DAYS: 30, GREEN: 80, MAX_BREAK_AGE: 4 };

export function daysBetween(fromStr, toStr) {
  return Math.round((Date.parse(toStr + 'T00:00:00') - Date.parse(fromStr + 'T00:00:00')) / 86400000);
}

// window derived from the first broken day: [broken+1 00:00, broken+3 00:00)
export function recoveryWindowEndMs(brokenDate) {
  return Date.parse(addDays(brokenDate, 3) + 'T00:00:00');
}

export function recoveryEligibleDates(brokenDate) {
  return [addDays(brokenDate, 1), addDays(brokenDate, 2)];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test --test-name-pattern="recovery window|daysBetween|recovery constants"`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add score.js tests/score.test.js
git commit -m "$(printf 'feat: recovery date/window helpers\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 2: `fmtCountdown` (`score.js`)

**Files:**
- Modify: `score.js`
- Test: `tests/score.test.js`

- [ ] **Step 1: Write the failing test**

Add the name `fmtCountdown` to the import block, then add:

```js
test('fmtCountdown: Hh Mm above an hour, Mm under, 0m at/after expiry', () => {
  const now = Date.parse('2026-06-16T00:00:00');
  assert.equal(fmtCountdown(now + (47 * 60 + 12) * 60000, now), '47h 12m');
  assert.equal(fmtCountdown(now + 12 * 60000, now), '12m');
  assert.equal(fmtCountdown(now + 60 * 60000, now), '1h 0m');
  assert.equal(fmtCountdown(now, now), '0m');
  assert.equal(fmtCountdown(now - 5000, now), '0m'); // already expired clamps to 0
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern="fmtCountdown"`
Expected: FAIL (`fmtCountdown is not defined`).

- [ ] **Step 3: Implement**

Append to `score.js` (under the helpers from Task 1):

```js
export function fmtCountdown(endMs, nowMs) {
  const totalMin = Math.max(0, Math.floor((endMs - nowMs) / 60000));
  const h = Math.floor(totalMin / 60);
  return h > 0 ? `${h}h ${totalMin % 60}m` : `${totalMin % 60}m`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --test-name-pattern="fmtCountdown"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add score.js tests/score.test.js
git commit -m "$(printf 'feat: fmtCountdown for the recovery window timer\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 3: `forgivenSet` (`score.js`)

**Files:**
- Modify: `score.js`
- Test: `tests/score.test.js`

- [ ] **Step 1: Write the failing test**

Add `forgivenSet` to the import block, then add:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern="forgivenSet"`
Expected: FAIL (`forgivenSet is not defined`).

- [ ] **Step 3: Implement**

Append to `score.js`:

```js
// recovered broken_dates whose green day still scores >= GREEN (reverted/expired excluded; §6.3)
export function forgivenSet(history, scoreByDate) {
  const s = new Set();
  for (const h of history) {
    if (h.outcome === 'recovered' && (scoreByDate[h.recovered_date] ?? 0) >= RECOVERY.GREEN) {
      s.add(h.broken_date);
    }
  }
  return s;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --test-name-pattern="forgivenSet"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add score.js tests/score.test.js
git commit -m "$(printf 'feat: forgivenSet derives bridged dates from recovery history\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 4: `streak` / `bestStreak` bridging (`score.js`)

**Files:**
- Modify: `score.js:58-64` (`streak`) and `score.js:127-138` (`bestStreak`)
- Test: `tests/score.test.js`

- [ ] **Step 1: Write the failing tests**

Add to `tests/score.test.js`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test --test-name-pattern="bridges a forgiven break"`
Expected: FAIL (the 3rd-arg calls return the un-bridged values 1 and 3).

- [ ] **Step 3: Update `streak` and `bestStreak`**

Replace `streak` (`score.js:58-64`) with:

```js
export function streak(scoreByDate, todayStr, forgiven = new Set()) {
  let d = todayStr;
  if ((scoreByDate[d] ?? 0) < 40) d = prevDate(d); // today is still in progress
  let n = 0;
  while (true) {
    if ((scoreByDate[d] ?? 0) >= 40) { n++; d = prevDate(d); continue; }
    if (forgiven.has(d)) { d = prevDate(d); continue; } // bridge a recovered break, don't count it
    break;
  }
  return n;
}
```

Replace `bestStreak` (`score.js:127-138`) with:

```js
export function bestStreak(scoreByDate, forgiven = new Set()) {
  const dates = Object.keys(scoreByDate).filter(d => scoreByDate[d] >= 40).sort();
  let best = 0, run = 0, prev = null;
  for (const d of dates) {
    if (prev === null) {
      run = 1;
    } else {
      // a run continues across a gap only if every day in the gap is forgiven (each adds 0)
      let g = prevDate(d), bridged = true;
      while (g > prev) { if (!forgiven.has(g)) { bridged = false; break; } g = prevDate(g); }
      run = (bridged && g === prev) ? run + 1 : 1;
    }
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}
```

- [ ] **Step 4: Run the FULL suite to verify new tests pass and nothing regressed**

Run: `node --test`
Expected: PASS — including the pre-existing `streak counts consecutive days`, `streak: today below 40`, `streak: red day or missing day`, and `bestStreak finds the longest >=40 run` tests (they call the 2-arg form, so `forgiven` defaults to empty and behavior is unchanged).

- [ ] **Step 5: Commit**

```bash
git add score.js tests/score.test.js
git commit -m "$(printf 'feat: streak/bestStreak bridge forgiven recovery breaks\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 5: `evaluateRecovery` — the brain (`score.js`)

**Files:**
- Modify: `score.js`
- Test: `tests/score.test.js`

This is the core state machine (spec §6.2). It is pure: `evaluateRecovery(state, scoreByDate, todayStr, nowMs)` → `{ next, event, changed, payload }`, `event ∈ {null,'banner','success','failure'}`.

- [ ] **Step 1: Write the failing tests**

Add `evaluateRecovery` to the import block, then add this block to `tests/score.test.js`:

```js
// ---- evaluateRecovery ----
const EMPTY_REC = { version: 1, active: null, history: [] };
const NOON = d => Date.parse(d + 'T12:00:00'); // a "now" inside day d
// build n consecutive green days (score 90) ending at `end`
function greenRun(end, n) {
  const out = {}; let d = end;
  for (let i = 0; i < n; i++) { out[d] = 90; d = prevDate(d); }
  return out;
}

test('evaluateRecovery: fresh break on a >=7 streak opens a banner', () => {
  // 7 green days through Sun 06-14, Mon 06-15 missing (break), today Tue 06-16, not yet green
  const s = { ...greenRun('2026-06-14', 7), '2026-06-16': 10 };
  const r = evaluateRecovery(EMPTY_REC, s, '2026-06-16', NOON('2026-06-16'));
  assert.equal(r.event, 'banner');
  assert.equal(r.changed, true);
  assert.equal(r.next.active.broken_date, '2026-06-15');
  assert.equal(r.next.active.protected_streak, 7);
});

test('evaluateRecovery: break on a <7 streak does nothing', () => {
  const s = { ...greenRun('2026-06-14', 6), '2026-06-16': 10 };
  const r = evaluateRecovery(EMPTY_REC, s, '2026-06-16', NOON('2026-06-16'));
  assert.equal(r.event, null);
  assert.equal(r.changed, false);
  assert.equal(r.next.active, null);
});

test('evaluateRecovery: a Green Day today inside the window recovers', () => {
  const s = { ...greenRun('2026-06-14', 7), '2026-06-16': 85 }; // today is green
  const r = evaluateRecovery(EMPTY_REC, s, '2026-06-16', NOON('2026-06-16'));
  assert.equal(r.event, 'success');
  assert.equal(r.next.active, null);
  const h = r.next.history.at(-1);
  assert.equal(h.outcome, 'recovered');
  assert.equal(h.broken_date, '2026-06-15');
  assert.equal(h.recovered_date, '2026-06-16');
});

test('evaluateRecovery: window expires with no Green Day -> failure, no active', () => {
  // break Mon 06-15; window ends 06-18 00:00; now Thu 06-18 noon; nothing green after
  const s = { ...greenRun('2026-06-14', 7), '2026-06-16': 10, '2026-06-17': 10 };
  const active = { broken_date: '2026-06-15', protected_streak: 7,
    condition: { type: 'green_day', required: 1, min_score: 80 } };
  const r = evaluateRecovery({ ...EMPTY_REC, active }, s, '2026-06-18', NOON('2026-06-18'));
  assert.equal(r.event, 'failure');
  assert.equal(r.next.active, null);
  assert.equal(r.next.history.at(-1).outcome, 'expired');
});

test('evaluateRecovery: retroactive success when an eligible day was green but app opened late', () => {
  // break Mon 06-15; Tue 06-16 was green; user opens Wed 06-17 (still in window)
  const s = { ...greenRun('2026-06-14', 7), '2026-06-16': 88, '2026-06-17': 10 };
  const r = evaluateRecovery(EMPTY_REC, s, '2026-06-17', NOON('2026-06-17'));
  assert.equal(r.event, 'success');
  assert.equal(r.next.history.at(-1).recovered_date, '2026-06-16');
});

test('evaluateRecovery: opened after window expired -> failure once, never a transient active', () => {
  // break Mon 06-15; no green; user opens Fri 06-19 (window ended 06-18 00:00)
  const s = { ...greenRun('2026-06-14', 7), '2026-06-16': 10, '2026-06-17': 10, '2026-06-18': 10 };
  const r = evaluateRecovery(EMPTY_REC, s, '2026-06-19', NOON('2026-06-19'));
  assert.equal(r.event, 'failure');
  assert.equal(r.next.active, null);
  assert.equal(r.next.history.at(-1).outcome, 'expired');
});

test('evaluateRecovery: dedupe -> an already-expired break is not re-offered', () => {
  const s = { ...greenRun('2026-06-14', 7), '2026-06-16': 10 };
  const state = { ...EMPTY_REC, history: [
    { outcome: 'expired', broken_date: '2026-06-15', protected_streak: 7, resolved_on: '2026-06-18' }] };
  const r = evaluateRecovery(state, s, '2026-06-16', NOON('2026-06-16'));
  assert.equal(r.event, null);
  assert.equal(r.changed, false);
});

test('evaluateRecovery: cooldown blocks a new recovery within 30 days of last recovered_date', () => {
  // recovered on 06-02 (its green day still scores 90, so it is NOT revoked);
  // new break on 06-15 is only 13 days later -> blocked by the 30-day cooldown
  const s = { ...greenRun('2026-06-14', 7), '2026-06-16': 10, '2026-06-02': 90 };
  const state = { ...EMPTY_REC, history: [
    { outcome: 'recovered', broken_date: '2026-06-01', recovered_date: '2026-06-02', protected_streak: 9 }] };
  const r = evaluateRecovery(state, s, '2026-06-16', NOON('2026-06-16'));
  assert.equal(r.event, null);
  assert.equal(r.changed, false);
});

test('evaluateRecovery: a reverted entry does NOT trigger cooldown', () => {
  const s = { ...greenRun('2026-06-14', 7), '2026-06-16': 10 };
  const state = { ...EMPTY_REC, history: [
    { outcome: 'reverted', broken_date: '2026-06-01', recovered_date: '2026-06-02', protected_streak: 9 }] };
  const r = evaluateRecovery(state, s, '2026-06-16', NOON('2026-06-16'));
  assert.equal(r.event, 'banner'); // reverted is ignored by cooldown -> recovery offered
});

test('evaluateRecovery: revoke when a recovered green day drops below 80 (window still open -> reopen)', () => {
  // recovered Mon 06-15 via Tue 06-16; Tue later edited to 50; today Wed 06-17 (window open until 06-18)
  const s = { ...greenRun('2026-06-14', 7), '2026-06-16': 50, '2026-06-17': 10 };
  const state = { ...EMPTY_REC, history: [
    { outcome: 'recovered', broken_date: '2026-06-15', recovered_date: '2026-06-16', protected_streak: 7 }] };
  const r = evaluateRecovery(state, s, '2026-06-17', NOON('2026-06-17'));
  assert.equal(r.event, 'banner');
  assert.equal(r.changed, true);
  assert.equal(r.next.active.broken_date, '2026-06-15');
  assert.equal(r.next.history[0].outcome, 'reverted');
});

test('evaluateRecovery: revoke after the window already passed -> failure', () => {
  const s = { ...greenRun('2026-06-14', 7), '2026-06-16': 50, '2026-06-17': 10, '2026-06-18': 10 };
  const state = { ...EMPTY_REC, history: [
    { outcome: 'recovered', broken_date: '2026-06-15', recovered_date: '2026-06-16', protected_streak: 7 }] };
  const r = evaluateRecovery(state, s, '2026-06-19', NOON('2026-06-19'));
  assert.equal(r.event, 'failure');
  assert.equal(r.next.active, null);
  assert.equal(r.next.history[0].outcome, 'reverted');
  assert.equal(r.next.history.at(-1).outcome, 'expired');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test --test-name-pattern="evaluateRecovery"`
Expected: FAIL (`evaluateRecovery is not defined`).

- [ ] **Step 3: Implement `evaluateRecovery` and its private helpers**

Append to `score.js`:

```js
const RECOVERY_CONDITION = { type: 'green_day', required: 1, min_score: RECOVERY.GREEN };

function isResolved(history, brokenDate) {
  return history.some(h => h.broken_date === brokenDate &&
    (h.outcome === 'recovered' || h.outcome === 'expired'));
}

function latestRecoveredDate(history) {
  let latest = null;
  for (const h of history) {
    if (h.outcome === 'recovered' && (!latest || h.recovered_date > latest)) latest = h.recovered_date;
  }
  return latest;
}

// Find the most recent break cluster and anchor to its EARLIEST day (the spec's
// "earliest unresolved broken day"), plus the streak it interrupted. A break is only
// actionable within MAX_BREAK_AGE days, so an old break followed by good days (organic
// recovery) is never surfaced as a stale failure.
function scanBreak(scoreByDate, todayStr, forgiven) {
  const recorded = Object.keys(scoreByDate);
  if (recorded.length === 0) return null;
  const earliest = recorded.sort()[0];
  const horizon = addDays(todayStr, -RECOVERY.MAX_BREAK_AGE);
  const broken = dt => (scoreByDate[dt] ?? 0) < 40 && !forgiven.has(dt);
  // most recent completed broken day within the horizon (skips good days after a break)
  let d = prevDate(todayStr);
  while (d >= earliest && d >= horizon && !broken(d)) d = prevDate(d);
  if (!(d >= earliest && d >= horizon && broken(d))) return null;
  // walk back to the earliest day of this contiguous broken cluster
  let b = d;
  while (b > earliest && broken(prevDate(b))) b = prevDate(b);
  return { firstBroken: b, protectedStreak: streak(scoreByDate, prevDate(b), forgiven) };
}

function resolveActive(state, active, history, scoreByDate, todayStr, nowMs, isNew) {
  const greenDate = recoveryEligibleDates(active.broken_date)
    .filter(dt => dt <= todayStr)
    .find(dt => (scoreByDate[dt] ?? 0) >= RECOVERY.GREEN);
  if (greenDate) {
    history.push({ outcome: 'recovered', broken_date: active.broken_date, recovered_date: greenDate,
      protected_streak: active.protected_streak, resolved_on: todayStr });
    return { next: { ...state, active: null, history }, event: 'success', changed: true,
      payload: { broken_date: active.broken_date, protected_streak: active.protected_streak } };
  }
  if (nowMs >= recoveryWindowEndMs(active.broken_date)) {
    history.push({ outcome: 'expired', broken_date: active.broken_date,
      protected_streak: active.protected_streak, resolved_on: todayStr });
    return { next: { ...state, active: null, history }, event: 'failure', changed: true,
      payload: { broken_date: active.broken_date, protected_streak: active.protected_streak } };
  }
  return { next: { ...state, active, history }, event: 'banner', changed: isNew,
    payload: { broken_date: active.broken_date, protected_streak: active.protected_streak,
      window_end_ms: recoveryWindowEndMs(active.broken_date) } };
}

export function evaluateRecovery(state, scoreByDate, todayStr, nowMs) {
  const history = state.history.map(h => ({ ...h }));      // clone; one controlled mutation allowed (§5)
  let active = state.active ? { ...state.active } : null;

  // STEP 1 — revoke the most recent recovery if its green day fell below 80 (§6.3)
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].outcome !== 'recovered') continue;
    const r = history[i];
    if ((scoreByDate[r.recovered_date] ?? 0) < RECOVERY.GREEN) {
      history[i] = { ...r, outcome: 'reverted', reverted_on: todayStr };
      if (nowMs < recoveryWindowEndMs(r.broken_date)) {     // window still open -> reopen
        active = { broken_date: r.broken_date, protected_streak: r.protected_streak, condition: RECOVERY_CONDITION };
        return { next: { ...state, active, history }, event: 'banner', changed: true,
          payload: { broken_date: r.broken_date, protected_streak: r.protected_streak,
            window_end_ms: recoveryWindowEndMs(r.broken_date) } };
      }
      history.push({ outcome: 'expired', broken_date: r.broken_date,             // window passed -> fail
        protected_streak: r.protected_streak, resolved_on: todayStr });
      return { next: { ...state, active: null, history }, event: 'failure', changed: true,
        payload: { broken_date: r.broken_date, protected_streak: r.protected_streak } };
    }
    break; // only the most recent recovered entry is reconciled
  }

  const forgiven = forgivenSet(history, scoreByDate);

  // STEP 2 — resolve an in-flight recovery
  if (active) return resolveActive(state, active, history, scoreByDate, todayStr, nowMs, false);

  // STEP 3 — detect a fresh break (dedupe + cooldown apply only here)
  const scan = scanBreak(scoreByDate, todayStr, forgiven);
  if (!scan || scan.protectedStreak < RECOVERY.MIN_STREAK) return { next: state, event: null, changed: false };
  if (isResolved(history, scan.firstBroken)) return { next: state, event: null, changed: false };
  const last = latestRecoveredDate(history);
  if (last && daysBetween(last, scan.firstBroken) < RECOVERY.COOLDOWN_DAYS)
    return { next: state, event: null, changed: false };
  const candidate = { broken_date: scan.firstBroken, protected_streak: scan.protectedStreak, condition: RECOVERY_CONDITION };
  return resolveActive(state, candidate, history, scoreByDate, todayStr, nowMs, true);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test --test-name-pattern="evaluateRecovery"`
Expected: PASS (all 11 cases).

- [ ] **Step 5: Run the FULL suite (no regressions)**

Run: `node --test`
Expected: PASS (all tests).

- [ ] **Step 6: Commit**

```bash
git add score.js tests/score.test.js
git commit -m "$(printf 'feat: evaluateRecovery state machine for streak recovery\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 6: `getRecovery` / `setRecovery` (`db.js`)

**Files:**
- Modify: `db.js` (add after `setState`, before `getAllForExport`)

No unit test (network wrapper — matches the existing untested `db.js` accessors).

- [ ] **Step 1: Add the wrappers**

Insert into `db.js` after the `setState` function (around `db.js:53`):

```js
export async function getRecovery() {
  return getState('recovery', { version: 1, active: null, history: [] });
}

export async function setRecovery(state) {
  await setState('recovery', state);
}
```

- [ ] **Step 2: Sanity-check the module loads**

Run: `node -e "import('./db.js').then(m => { if (!m.getRecovery || !m.setRecovery) throw new Error('missing exports'); console.log('ok'); })"`
Expected: prints `ok` (the Supabase client constructs against the configured URL; no network call is made by import).

- [ ] **Step 3: Commit**

```bash
git add db.js
git commit -m "$(printf 'feat: getRecovery/setRecovery app_state wrappers\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 7: Wire recovery into boot + streak/marker (`app.js`)

**Files:**
- Modify: `app.js` — module state (`app.js:19-26`), `boot()` (`app.js:63-73`), `renderToday()` (`app.js:400-465`), `renderWeek()` (`app.js:122-123`)

- [ ] **Step 1: Add the module-level recovery state**

In `app.js`, after the `let timer = ...` line (`app.js:22`), add:

```js
let recovery = { version: 1, active: null, history: [] };
let recoveryBusy = false; // guards the expiry re-render in tick()
```

- [ ] **Step 2: Add `buildScoreByDate`, `syncRecovery`, and the marker helper**

Add these functions in `app.js` just above `async function renderToday() {` (`app.js:400`):

```js
// last 60 days of scores + today's live score (same window the Today/Week views use)
async function buildScoreByDate() {
  const rows = await db.getDays(S.addDays(today, -60), S.prevDate(today));
  const scoreByDate = {};
  for (const r of rows) scoreByDate[r.date] = r.score;
  scoreByDate[today] = S.dayScore(S.dayPoints(day, targets));
  return scoreByDate;
}

// Reload-and-confirm guard (spec §8): always evaluate against the freshest stored state,
// persist only on a real transition, then surface the one-shot modal.
async function syncRecovery(scoreByDate) {
  const latest = await db.getRecovery();
  const res = S.evaluateRecovery(latest, scoreByDate, today, Date.now());
  if (res.changed) await db.setRecovery(res.next);
  recovery = res.next;
  if (res.event === 'success') {
    const forgiven = S.forgivenSet(recovery.history, scoreByDate);
    showRecoveryModal('success', { streak: S.streak(scoreByDate, today, forgiven) });
  } else if (res.event === 'failure') {
    showRecoveryModal('failure', {});
  }
  return res;
}

// a single ⭐ when the current live streak bridges at least one forgiven break (never ⭐×N)
function recoveryMarker(scoreByDate, forgiven) {
  const withF = S.streak(scoreByDate, today, forgiven);
  const without = S.streak(scoreByDate, today);
  return withF > 0 && withF > without ? ' ⭐' : '';
}
```

- [ ] **Step 3: Load recovery state and run an initial check in `boot()`**

In `boot()`, after `timer = await db.getState('timer', null);` (`app.js:68`), add:

```js
  recovery = await db.getRecovery();
```

Then, still in `boot()`, replace:

```js
  await loadToday();
  window.addEventListener('hashchange', render);
```

with:

```js
  await loadToday();
  await syncRecovery(await buildScoreByDate()); // catch banner/modal regardless of landing view
  window.addEventListener('hashchange', render);
```

- [ ] **Step 4: Use forgiven-aware streak + marker in `renderToday()`**

In `renderToday()`, replace these lines (`app.js:408-409`):

```js
  scoreByDate[today] = score;
  const stk = S.streak(scoreByDate, today);
  const best = S.bestStreak(scoreByDate);
```

with:

```js
  scoreByDate[today] = score;
  await syncRecovery(scoreByDate);
  const forgiven = S.forgivenSet(recovery.history, scoreByDate);
  const stk = S.streak(scoreByDate, today, forgiven);
  const best = S.bestStreak(scoreByDate, forgiven);
  const marker = recoveryMarker(scoreByDate, forgiven);
```

Then in the same function's template, change the streak chip (`app.js:428`) from:

```js
      <div class="streak">🔥 ${stk} <small>DAYS</small></div>
```

to:

```js
      <div class="streak">🔥 ${stk}${marker} <small>DAYS</small></div>
```

- [ ] **Step 5: Use forgiven-aware streak + marker in `renderWeek()`**

In `renderWeek()`, replace (`app.js:122-123`):

```js
  const scoreByDate = {}; for (const r of rows) scoreByDate[r.date] = r.score;
  const stk = S.streak(scoreByDate, today);
```

with:

```js
  const scoreByDate = {}; for (const r of rows) scoreByDate[r.date] = r.score;
  const forgiven = S.forgivenSet(recovery.history, scoreByDate);
  const stk = S.streak(scoreByDate, today, forgiven);
  const wkMarker = recoveryMarker(scoreByDate, forgiven);
```

Then change the STREAK stat (`app.js:155`) from:

```js
      <div class="stat3"><b>🔥 ${stk}</b><span>STREAK</span></div>
```

to:

```js
      <div class="stat3"><b>🔥 ${stk}${wkMarker}</b><span>STREAK</span></div>
```

- [ ] **Step 6: Verify the test suite still passes (no `score.js` change, but confirm imports)**

Run: `node --test`
Expected: PASS (unchanged).

> Note: `showRecoveryModal` is referenced here but defined in Task 9. Between Task 7 and Task 9 the app would throw if a modal event fired. Implement Tasks 8 and 9 before manually loading the app. (The commit below is still safe — it does not run automatically.)

- [ ] **Step 7: Commit**

```bash
git add app.js
git commit -m "$(printf 'feat: wire recovery sync, forgiven streaks, and ⭐ marker\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 8: Recovery banner + live countdown (`app.js`, `index.html`, `style.css`)

**Files:**
- Modify: `app.js` — add `recoveryBannerHtml`, insert banner in `renderToday`, extend `tick()`
- Modify: `style.css` — `.recovery` styles

- [ ] **Step 1: Add `recoveryBannerHtml`**

In `app.js`, add just above `async function renderToday() {`:

```js
function recoveryBannerHtml(active) {
  const endMs = S.recoveryWindowEndMs(active.broken_date);
  return `<div class="recovery" data-recovery>
    <div class="rec-head">💔 Your streak was broken — but you can bring it back.</div>
    <p class="rec-body">Complete <b>1 Green Day</b> (score ≥ 80) to recover your
      <b>${active.protected_streak}-day</b> streak.</p>
    <div class="rec-foot">
      <span>Progress <b>0 / 1 Green Day</b></span>
      <span>Time remaining <b data-countdown="${endMs}">${S.fmtCountdown(endMs, Date.now())}</b></span>
    </div>
  </div>`;
}
```

- [ ] **Step 2: Render the banner on Today**

In `renderToday()`'s template, find the alert line (`app.js:446`):

```js
    ${alert ? `<div class="alert">⚠️ ${pillarName(alert.pillar)} below target — ${alert.days} days in a row</div>` : ''}
```

and insert the banner immediately **above** it:

```js
    ${recovery.active ? recoveryBannerHtml(recovery.active) : ''}
    ${alert ? `<div class="alert">⚠️ ${pillarName(alert.pillar)} below target — ${alert.days} days in a row</div>` : ''}
```

- [ ] **Step 3: Tick the countdown + fire expiry while the banner is visible**

In `tick()` (`app.js:468-480`), replace:

```js
  if (timer) {
    const txt = S.fmtElapsed(timer.started_at, Date.now());
    document.querySelectorAll('[data-elapsed]').forEach(el => { el.textContent = txt; });
  }
```

with:

```js
  if (timer) {
    const txt = S.fmtElapsed(timer.started_at, Date.now());
    document.querySelectorAll('[data-elapsed]').forEach(el => { el.textContent = txt; });
  }
  document.querySelectorAll('[data-countdown]').forEach(el => {
    el.textContent = S.fmtCountdown(Number(el.dataset.countdown), Date.now());
  });
  // when the window runs out while the user is on Today, re-render to resolve it (failure modal)
  if (route() === 'today' && !recoveryBusy && recovery.active &&
      Date.now() >= S.recoveryWindowEndMs(recovery.active.broken_date)) {
    recoveryBusy = true;
    render().catch(e => { showError(e); console.error(e); }).finally(() => { recoveryBusy = false; });
  }
```

- [ ] **Step 4: Style the banner**

Append to `style.css`:

```css
/* ---- streak recovery banner ---- */
.recovery {
  background: linear-gradient(180deg, rgba(248,97,90,.14), rgba(248,97,90,.06));
  border: 1px solid rgba(248,97,90,.45);
  border-radius: 16px;
  padding: 16px 18px;
  margin: 12px 0;
}
.recovery .rec-head { font-weight: 700; font-size: 15px; margin-bottom: 6px; }
.recovery .rec-body { margin: 0 0 12px; color: var(--muted, #9aa4b2); font-size: 14px; line-height: 1.5; }
.recovery .rec-foot {
  display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap;
  font-size: 12px; letter-spacing: .04em; text-transform: uppercase; color: var(--muted, #9aa4b2);
}
.recovery .rec-foot b { color: #fff; font-variant-numeric: tabular-nums; }
```

- [ ] **Step 5: Manual verification (browser)**

Serve the app and sign in. To exercise the banner deterministically, in the browser console run:

```js
// simulate yesterday-broke-a-7-day-streak by writing a recovery directly, then reload
await (await import('./db.js')).setRecovery({ version:1,
  active:{ broken_date: new Date(Date.now()-86400000).toISOString().slice(0,10),
           protected_streak: 12, condition:{type:'green_day',required:1,min_score:80} },
  history: [] });
location.reload();
```

Expected: the 💔 banner shows on Today with a live `Time remaining` countdown that decrements each second.
Cleanup: `await (await import('./db.js')).setRecovery({version:1,active:null,history:[]}); location.reload();`

- [ ] **Step 6: Commit**

```bash
git add app.js style.css
git commit -m "$(printf 'feat: recovery banner with live 48h countdown\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 9: Success / failure modal (`index.html`, `app.js`, `style.css`)

**Files:**
- Modify: `index.html` — add `#modal` overlay
- Modify: `app.js` — `showRecoveryModal`, close handler
- Modify: `style.css` — `.modal` styles

- [ ] **Step 1: Add the overlay element**

In `index.html`, after the error banner block (after `</div>` of `#err`, `index.html:46`), add:

```html
<!-- recovery success / failure modal -->
<div id="modal" class="modal hidden" role="dialog" aria-modal="true">
  <div class="modal-card" id="modal-card"></div>
</div>
```

- [ ] **Step 2: Add `showRecoveryModal`**

In `app.js`, add just above `function recoveryBannerHtml(active) {`:

```js
function showRecoveryModal(kind, payload) {
  const card = $('#modal-card');
  if (kind === 'success') {
    card.innerHTML = `
      <div class="modal-emoji">🔥 ${payload.streak} ⭐</div>
      <h2>Welcome back.</h2>
      <p>You lost momentum for a moment, but you chose to return.<br>
         That's what real consistency looks like. Keep going.</p>
      <p class="modal-sub">streak recovered</p>
      <button class="btn" data-action="closemodal">Keep going</button>`;
  } else {
    card.innerHTML = `
      <div class="modal-emoji">🔥 0</div>
      <h2>You didn't recover this streak — and that's okay.</h2>
      <p>Starting again doesn't erase the progress you've already made.
         Every meaningful journey includes restarts. Today can be Day 1.</p>
      <button class="btn" data-action="closemodal">Start again</button>`;
  }
  $('#modal').classList.remove('hidden');
}
```

- [ ] **Step 3: Add the close action**

In the click delegation handler, after the `logout` branch (`app.js:520-522`), add a new branch before the closing of the `if/else` chain:

```js
    } else if (a === 'closemodal') {
      $('#modal').classList.add('hidden');
```

(The line above `logout` ends with `}`; insert this `else if` so it reads `... } else if (a === 'logout') { ... } else if (a === 'closemodal') { ... }`.)

- [ ] **Step 4: Style the modal**

Append to `style.css`:

```css
/* ---- recovery modal ---- */
.modal {
  position: fixed; inset: 0; z-index: 50;
  display: flex; align-items: center; justify-content: center;
  background: rgba(7,9,13,.72); backdrop-filter: blur(4px); padding: 24px;
}
.modal.hidden { display: none; }
.modal-card {
  background: #141821; border: 1px solid rgba(255,255,255,.08); border-radius: 20px;
  padding: 28px 24px; max-width: 360px; width: 100%; text-align: center;
  box-shadow: 0 24px 60px rgba(0,0,0,.5);
}
.modal-card .modal-emoji { font-size: 30px; font-weight: 800; margin-bottom: 12px; font-variant-numeric: tabular-nums; }
.modal-card h2 { font-size: 18px; margin: 0 0 10px; }
.modal-card p { color: var(--muted, #9aa4b2); font-size: 14px; line-height: 1.6; margin: 0 0 16px; }
.modal-card .modal-sub { text-transform: uppercase; letter-spacing: .06em; font-size: 11px; margin-top: -8px; }
.modal-card .btn { width: 100%; }
```

- [ ] **Step 5: Manual verification (browser)**

With the app open and signed in, in the console:

```js
// success modal: write an active recovery whose eligible day is already green, then re-open Today
const db = await import('./db.js');
const today = new Date().toISOString().slice(0,10);
// (do this on a day where today's score >= 80, or temporarily log enough minutes to cross 80)
await db.setRecovery({ version:1,
  active:{ broken_date: new Date(Date.now()-86400000).toISOString().slice(0,10),
           protected_streak: 12, condition:{type:'green_day',required:1,min_score:80} },
  history: [] });
location.hash = '#today'; location.reload();
```

Expected: when today's score is ≥ 80, the **success** modal appears showing `🔥 <streak> ⭐`; "Keep going" closes it; the `⭐` marker stays on the streak chip. For the **failure** modal, set `broken_date` to 3+ days ago (window expired) and reload — the compassionate reset modal appears.
Cleanup: `await db.setRecovery({version:1,active:null,history:[]}); location.reload();`

- [ ] **Step 6: Commit**

```bash
git add index.html app.js style.css
git commit -m "$(printf 'feat: recovery success/failure celebration modals\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 10: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full unit suite**

Run: `node --test`
Expected: PASS — all pre-existing tests plus the new recovery tests (Tasks 1–5). Zero failures.

- [ ] **Step 2: End-to-end manual smoke (browser), then clean up state**

1. Banner appears for a ≥ 7-day streak broken yesterday; countdown ticks down.
2. Logging a Green Day (score ≥ 80) today flips the banner to the success modal and shows `🔥 N ⭐`.
3. Editing that day's minutes back below 80 (or lowering a target) **revokes**: streak drops and the banner returns (or failure modal if the window has passed) — confirming §6.3.
4. A break on a < 7-day streak shows **nothing**.
5. Reset test state: `await (await import('./db.js')).setRecovery({version:1,active:null,history:[]}); location.reload();`

Record the actual observed result for each (per superpowers:verification-before-completion — evidence, not assertion).

- [ ] **Step 3: Confirm clean tree**

Run: `git status`
Expected: clean (all changes committed across Tasks 1–9). The pre-existing untracked `tests/app-state.test.js` is unrelated and left as-is.

---

## Self-Review (completed during planning)

**Spec coverage:**

- §2/§4 forgiven-not-credited bridging → Task 4 (`streak`/`bestStreak`) + test asserting 121-style count (4 = 3-run + green, bridged day adds 0).
- §3.1 window + §3.2 late-open (no transient active) → Task 5 (`scanBreak`, `recoveryWindowEndMs`) + dedicated "opened after window expired" test.
- §5 ledger + controlled mutation → Task 5 (`evaluateRecovery` clones history, single `recovered→reverted` flip).
- §6.2 three-step machine + dedupe → Task 5 with dedupe/cooldown/revert tests.
- §6.3 revoke (reopen vs expire) → Task 5 two revoke tests.
- §6.4 `fmtCountdown` → Task 2.
- §6.5 run sites + persistence → Task 7 (`boot` + `renderToday` `syncRecovery`).
- §7.A banner → Task 8; §7.B/C modals → Task 9; §7.D single `⭐` → Task 7 `recoveryMarker` (never `⭐×N`).
- §8 reload-and-confirm guard → Task 7 `syncRecovery` (re-reads latest, evaluates on freshest, writes only on change).
- §10 test list → Tasks 1–5 mirror it.

**Placeholder scan:** none — every step has concrete code/commands.

**Type/name consistency:** `evaluateRecovery` returns `{next,event,changed,payload}` everywhere; `recovery` state shape `{version,active,history}` consistent across `db.js`, `app.js`, tests; `forgivenSet`/`recoveryWindowEndMs`/`recoveryEligibleDates` names match between `score.js`, `app.js`, and tests.

**Known limitations:**

- **60-day lookback (matches existing app):** streak/recovery look back 60 days (`buildScoreByDate`, the same window `renderToday`/`renderWeek` already use), so `protected_streak` is capped at ~60 — consistent with how the app already displays streaks. Widening the window is out of scope.
- **Staleness bound (`MAX_BREAK_AGE = 4`):** `scanBreak` only surfaces a break whose most-recent broken day is within 4 days (the 48h window + ~1 day grace). This refines spec §3.2 "show failure once on late open": the compassionate reset fires when the user opens within a few days of the break, but a break left untouched for longer — especially one already followed by good days (organic recovery) — is silently let go rather than surfacing a stale modal. This is the bounded, best-effort reading of §3.2; it never affects an already-`active` recovery (those resolve regardless of age via STEP 2).
