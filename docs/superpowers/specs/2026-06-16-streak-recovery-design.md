# Streak Recovery — Design Spec

**Date:** 2026-06-16
**Status:** Approved for planning
**Feature:** Streak Recovery for Momentum

> Philosophy: *"Consistency is not about never falling. It is about coming back quickly."*
> Product principle for this feature: **Recovery protects rare setbacks, not repeated inconsistency.**

---

## 1. Problem & goals

A single bad day can erase a long streak, which is discouraging and drives abandonment. Streak Recovery softens the emotional damage of a broken streak **without removing accountability** and **without ever feeling like cheating**.

Design rules (from product owner):

- Reward recovery, not perfection.
- Recovery should feel **meaningful**, **not free**, and **not impossible**.
- On any product-decision conflict, choose the option that increases **long-term consistency**, not short-term engagement.
- Keep it simple (fewer files, fewer abstractions). Never swallow errors.

---

## 2. Key architectural fact

**The streak is computed, not stored.** `streak()` in `score.js` walks backward from today counting days that scored ≥ 40 (yellow or better) and stops at the first day below 40 (a red day or a missing day). There is no persisted streak counter — it is re-derived on every render.

Consequence: to make a long streak survive a broken day, the system must record that the broken day was **recovered** and teach `streak()` to *bridge* over it.

### Chosen approach: forgiven-dates ledger

Record recovered break dates in `app_state`, plus the one in-flight recovery window. `streak()` gains an optional `forgiven` argument and bridges over a forgiven day instead of stopping.

Rejected alternatives:

- **Stored streak counter** — two sources of truth, cross-device drift, large departure from current derived model.
- **Overwrite the broken day's score to 40** — dishonest; corrupts history, hides the fall, pollutes the month calendar/heatmap. Directly violates "do not hide recovery history."

---

## 3. Recovery rules (resolved)

| Rule | Value |
|---|---|
| Streak survives on | score ≥ 40 (yellow), unchanged |
| A break is | a completed day scoring < 40 (red **or** missing) |
| Eligible to recover only if broken streak was | **≥ 7 days** |
| Recovery condition | **1 Green Day (score ≥ 80)** |
| Recovery window | **48 hours**, real-time, anchored to the break (never paused by app-open) |
| Repeat limit | **at most one recovery per 30 calendar days** (cooldown) |
| Cooldown anchor | **30 calendar days measured from the last successful `recovered_date`** |
| Break again during cooldown | no offer → permanent reset to Day 1 |
| Today (in progress) | never counts as a break |

### 3.1 Window timing (resolved)

The window is derived from the **first broken day** after the last good streak day.

- `broken_date` = first missed/red day after the streak (the "Monday").
- `window_start` = `00:00` local of `broken_date + 1 day`.
- `window_end`  = `window_start + 48h` = `00:00` local of `broken_date + 3 days`.
- Eligible Green-Day dates = `broken_date + 1` and `broken_date + 2`.

Example: streak strong through **Sunday**; **Monday** is missed (`broken_date`). Window runs **Tue 00:00 → Thu 00:00**. A Green Day on **Tuesday or Wednesday** recovers it.

All boundaries are derived from **local date strings** (consistent with the app's existing midnight-rollover logic). An explicit user-configurable timezone is **future expansion**, not built now.

### 3.2 Late-open handling (resolved — change #4)

On evaluation, **find the earliest unresolved broken day and derive its window first**, then decide:

1. If any eligible date already scores ≥ 80 → **success** (recover retroactively — recovery is anchored to real events, not to when the app is opened).
2. Else if `now ≥ window_end` → **failure**, recorded **once**, **without ever creating a transient active recovery state**.
3. Else → open the active recovery (banner).

This guarantees we never briefly flash an active recovery that is already expired.

---

## 4. Streak-number accounting (resolved — change #1)

**Forgiven, not credited.** A bridged broken day is skipped but **not counted**; the surrounding real days still count normally.

Example: 120-day streak runs through **Sunday**, **Monday** is missed, **Tuesday** is a Green Day and recovers the streak.

- Monday is bridged (forgiven) but contributes **0**.
- Tuesday is a real ≥ 40 day and contributes **+1**.
- Displayed streak = **121** (120 through Sunday + Tuesday), shown as `🔥 121 ⭐`.

You never earn credit for the day you missed; you only keep the chain. This is the most honest reading of "recovery should not feel free."

---

## 5. Data model

One new `app_state` row, key `recovery`. No SQL migration (it is a JSON blob, like `timer`/`mission`/`targets`). `setup.sql` is unchanged; this shape is documented here.

```jsonc
{
  "version": 1,
  "active": {                      // the one in-flight recovery, or null
    "broken_date": "2026-06-15",   // first missed/red day after the streak
    "protected_streak": 120,       // streak length as of the last good day (display + analytics)
    "condition": {                 // extensibility hook (future: adaptive / personalized)
      "type": "green_day",
      "required": 1,
      "min_score": 80
    }
  },
  "history": [                     // recovery-record ledger: dedupe + analytics (controlled mutation: recovered → reverted)
    { "broken_date": "2026-05-02", "protected_streak": 31,
      "outcome": "recovered", "recovered_date": "2026-05-03", "resolved_on": "2026-05-03" },
    { "broken_date": "2026-06-15", "protected_streak": 120,
      "outcome": "expired", "resolved_on": "2026-06-18" }
  ]
}
```

### Ledger semantics (resolved — change #2)

`history` is a **recovery-record ledger**, not a true append-only event log. The MVP permits exactly one **controlled mutation**: a `recovered` entry may be flipped to `reverted` when its Green Day later falls below 80 (§6.3). No other in-place edits occur. (If we later want a strict append-only event model, that is a deliberate future change, not the MVP.)

`outcome` values: `"recovered"`, `"expired"`, `"reverted"`.

### Derived (never stored, so nothing can drift)

- **`forgiven` set** = `broken_date`s of `history` entries with `outcome === "recovered"` **whose paired `recovered_date` still scores ≥ 80** (see §6.3 revoke). `reverted` entries are excluded. This is what `streak()` bridges.
- **48h window** = derived from a `broken_date` (timezone-portable).
- **Cooldown anchor** = the latest `recovered_date` among entries that are **currently** `outcome === "recovered"` (resolved — change #3). A `reverted` entry **no longer triggers** the 30-day cooldown.
- **Total recovery count** = number of **currently** `recovered` entries in `history` (analytics/history only — **not** shown on the streak number; see §7.D).

The `condition` object is the seam for **future expansion** (personalized conditions, adaptive difficulty). Today it is always `{green_day, 1, 80}`; no UI reads its internals, so it can evolve without UI changes.

---

## 6. Backend logic — pure functions in `score.js`

All logic is pure (no DOM, no network) and unit-tested, matching the existing `score.js` style.

### 6.1 `streak()` and `bestStreak()` bridging

Add an optional, backward-compatible third argument:

```
streak(scoreByDate, todayStr, forgiven = <empty>)
  Walking backward, when a day scores < 40:
    if its date is in `forgiven` → step over it WITHOUT counting it, continue
    else → stop
```

`bestStreak(scoreByDate, forgiven = <empty>)` gets the same bridging so the Month view's "best streak" stays consistent with the live streak.

**All existing streak/bestStreak tests must still pass unchanged** (empty `forgiven` ⇒ current behavior).

### 6.2 `evaluateRecovery(state, scoreByDate, todayStr, nowMs)` — the brain

Pure function. Returns `{ next, event }` where `event ∈ { null, 'banner', 'success', 'failure' }`.

```
forgiven = recovered broken_dates from state.history whose recovered_date still scores >= 80

# --- STEP 1: reconcile a previously-granted recovery against live scores (revoke; §6.3) ---
# This transition handles reopen/expiry DIRECTLY, so a reverted record never depends on
# the detection path's dedupe to be reprocessed.
r = most recent entry with outcome == "recovered"
if r exists and scoreByDate[r.recovered_date] < 80:
    set r.outcome = "reverted"                      # controlled mutation (§5)
    if now < window_end(r.broken_date):
        active = { broken_date: r.broken_date, protected_streak: r.protected_streak, condition }
        -> persist, event: 'banner'   (reopened; progress 0/1)
    else:
        append { outcome:'expired', broken_date:r.broken_date, protected_streak:r.protected_streak, resolved_on: today }
        -> persist, event: 'failure'
    return                                            # done this pass

# --- STEP 2: resolve an in-flight recovery ---
if state.active:
    eligible = [broken_date+1, broken_date+2]   (dates <= today)
    if any eligible date scores >= 80      -> SUCCESS   (recovered_date = that date)
    else if now >= window_end              -> FAILURE (expired)
    else                                   -> BANNER (still ticking)

# --- STEP 3: detect a fresh break (the only path subject to dedupe) ---
else:
    scan = earliest UNRESOLVED broken day after the last good day + the streak it ended
           # "unresolved" = broken_date is NOT already in history as recovered or expired.
           #  reverted entries do NOT block detection.
    if no break, OR protected_streak < 7   -> { unchanged, null }   # quiet reset
    if within 30-day cooldown (latest currently-`recovered` recovered_date) -> { unchanged, null }
    derive window from scan.broken_date
    if any eligible date scores >= 80      -> SUCCESS   (retroactive)
    else if now >= window_end              -> FAILURE (record once, NO transient active)
    else                                   -> open active recovery -> BANNER
```

Transitions mutate `state`:

- **SUCCESS** → append `{outcome:'recovered', broken_date, recovered_date, protected_streak, resolved_on: today}`, clear `active`. Adds the forgiven date.
- **FAILURE** → append `{outcome:'expired', broken_date, protected_streak, resolved_on: today}`, clear `active`. **No forgiveness** → `streak()` resets naturally.
- **Dedupe (detection path only, STEP 3):** a `broken_date` already in `history` as `recovered` or `expired` is never re-detected. `reverted` entries are **excluded from dedupe** so a revoked recovery can be reopened or expired. Resolving an existing/reopened `active` (STEP 1–2) is independent of dedupe.

### 6.3 Revoke on invalidation (resolved — change #3)

Recovery state must stay consistent with the underlying score data. Because a score can drop below 80 **indirectly** (changing a daily target in Settings re-scores every day — `app.js:546`), reconciliation is **reactive**, not edit-blocking.

Rule, applied at the top of every `evaluateRecovery` run:

> A `recovered` entry whose `recovered_date` no longer scores ≥ 80 is **revoked**: its `outcome` becomes `"reverted"` and its `broken_date` leaves the `forgiven` set, so the streak recalculates (it breaks again at that `broken_date`).
> The reopen-or-expire decision is made **directly in the revoke transition** (STEP 1 of §6.2), not by falling through to fresh-break detection — this avoids any conflict with detection-path dedupe:
> - 48h window (from `broken_date`) **still open** → reopen an active recovery (banner returns, progress 0/1).
> - window **expired** → record an `expired` entry once and show the failure state.

This is one consistency rule evaluated in one place, and it catches both direct minute edits and indirect target re-scoring. (Because a `reverted` record is excluded from dedupe, the reopened recovery can later succeed or expire normally.)

### 6.4 `fmtCountdown(endMs, nowMs)`

Pure formatter → `"47h 12m"`, and `"12m"` under an hour, `"0m"` at/after expiry. Driven by the existing 1-second `tick()`.

### 6.5 Where it runs

- `boot()` evaluates once so a banner/success/failure is caught immediately regardless of landing view.
- `renderToday()` re-evaluates with live data (it already loads the 60-day window and computes today's live score), so a Green Day crossing 80 **right now** triggers the celebration instantly.
- Each `success`/`failure`/`open` transition persists through the **reload-and-confirm guard** (§8) so concurrent devices don't clobber each other; the cleared/updated state makes subsequent re-renders silent, so each modal shows **once** per device.
- All failures propagate to the existing retry banner (`showError`) — **never swallowed**.

---

## 7. UI states

Match existing patterns: the `.alert` banner slot on Today (`app.js:446`) and an overlay like `#login` / `#err`. Dark-theme tokens already in `style.css`. **No external libraries.**

### A. Recovery banner (Today view)

```
💔 Your streak was broken — but you can bring it back.
Complete 1 Green Day (score ≥ 80) to recover your 120-day streak.
Progress: 0 / 1 Green Day      Time remaining: 47h 12m
```

- `Progress` is `0 / 1` until the eligible Green Day lands.
- `Time remaining` is the live `fmtCountdown` value, updated by `tick()` (reuses the `[data-elapsed]` pattern via a `[data-countdown]` hook).

### B. Success modal (overlay, shown once)

> **Welcome back.**
> You lost momentum for a moment, but you chose to return.
> That's what real consistency looks like. Keep going.
>
> 🔥 **121 ⭐** — *streak recovered*

The number shown is the **live current streak** (includes the Green recovery day — e.g. 121), not the pre-break `protected_streak`.

### C. Failure / reset message (overlay, shown once)

> **You didn't recover this streak — and that's okay.**
> Starting again doesn't erase the progress you've already made. Every meaningful journey includes restarts. Today can be Day 1.

Tone: compassionate, non-judgmental, never shaming.

### D. Recovery marker `⭐` (resolved — change #2)

- Render **a single `⭐`** next to the streak number wherever the streak shows (Today header `app.js:428`, Week "STREAK" stat) **whenever the current streak contains ≥ 1 forgiven date**.
- **Never show `⭐×N`.** Repeated setbacks must not become a permanent public scar on the streak number.
- The **total recovery count** lives in `history` (analytics/history surfaces only), not next to the streak.

---

## 8. API contracts (`db.js`)

No new tables, no SQL change. Add two thin named wrappers over the generic state accessors for one call-site of truth (both throw on error like every other `db.js` function):

```js
getRecovery()      // → db.getState('recovery', { version: 1, active: null, history: [] })
setRecovery(state) // → db.setState('recovery', state)
```

### Reload-and-confirm guard (resolved — change #4)

A single JSON `app_state` blob has **no transactional guarantee**: two devices writing near-simultaneously can overwrite each other (last write wins). So a bare "first transition wins" claim is false. Before committing a `success` or `failure` (or opening an `active`), re-read the latest state and confirm the work isn't already done:

```
async function commitTransition(brokenDate, mutate):
    latest = await getRecovery()                       # re-read just before writing
    if latest.history has an entry for brokenDate with outcome 'recovered' or 'expired':
        return latest                                  # another device already resolved it — abort, adopt theirs
    next = mutate(latest)                              # apply success/failure/open onto the freshest state
    await setRecovery(next)
    return next
```

This is **best-effort optimistic concurrency**, not a true transaction: a genuinely simultaneous read-modify-write on two devices can still race (the window between read and write is unguarded). It removes the common case (a stale device clobbering a fresh resolution) and is sufficient for a single-user, low-concurrency app. A compare-and-swap / version-stamped write is noted as future hardening, not MVP.

That is the entire new data-access surface.

---

## 9. Edge cases

1. **Missed several days, opened late but still in-window** — window anchors to the *earliest* unresolved broken day; if `now < window_end`, recover by making today green.
2. **Opened after window expired** — find earliest broken day, derive window, record failure **once without a transient active state**; streak resets.
3. **Short streak (< 7) breaks** — silent normal reset, no banner.
4. **Break during 30-day cooldown** — no offer, permanent reset to Day 1.
5. **Already-green eligible day** (missed Mon, crushed Tue, open Wed) — resolves straight to success.
6. **Live recovery** — today's score crosses 80 inside the window → celebration fires immediately.
7. **Green Day edited/ re-scored below 80 after success** — revoked per §6.3; streak recalculates; banner returns if window still open, else failure.
8. **Today in progress is never a break** — unchanged.
9. **Cross-device** — single source of truth in `app_state`, written through the reload-and-confirm guard (§8). Consistency is **best-effort**: the common stale-clobber case is prevented, but a truly simultaneous read-modify-write on two devices can still race until optimistic-concurrency hardening is added (future).
10. **Timezone/travel** — boundaries derived from local date strings, consistent with existing rollover; configurable timezone is future work.
11. **`history` grows unbounded** — fine at personal scale; entries behind a hard reset are harmless to `streak()`.

---

## 10. Testing

Pure-function tests in `tests/score.test.js`, same style as the existing suite:

- `streak()` / `bestStreak()` bridge a forgiven date and **do not count it** (regression: all current streak tests still pass with default empty `forgiven`).
- `fmtCountdown()` formatting (hours+minutes, minutes-only, zero at expiry).
- `evaluateRecovery()` truth table:
  - fresh break, streak ≥ 7 → banner; streak < 7 → null.
  - within cooldown → null.
  - green within window → success (+ forgiven date added; live streak = protected + 1).
  - expired (no green) → failure; **no transient active** created on late open.
  - already-green eligible day → instant success (retroactive).
  - dedupe: same `broken_date` already `recovered`/`expired` → no re-detection; a `reverted` `broken_date` **is** reprocessable.
  - revoke: recovered day edited below 80 → entry `reverted`, streak recalculates; window-open → reopen active; window-expired → failure (decided in the revoke transition).
  - cooldown ignores `reverted`: a reverted recovery does not block a new recovery within 30 days.

Cross-device guard (§8) is verified at the `db.js` layer (or a thin unit around `commitTransition`): a stale `mutate` is aborted when the latest state already resolved the `broken_date`.

---

## 11. Future expansion (data structures prepared, not implemented)

The `condition` object and the `history` recovery-record ledger are the seams for:

- Personalized recovery conditions
- Adaptive difficulty
- Habit reduction suggestions
- Burnout detection
- Recovery analytics

None are implemented now; the data model simply does not block them.

---

## 12. Out of scope (MVP)

- User-configurable timezone.
- Multi-day or multi-condition recovery missions.
- Any analytics UI for recovery history beyond the single `⭐` marker.
- Edit-blocking (we use reactive revoke instead).
