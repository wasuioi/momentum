# Day Journey Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multi-user-safe day journey timelines with timer session history, check-badge milestones, editable day notes, share previews, and minimal friend live status.

**Architecture:** Keep the app vanilla HTML/CSS/JS with Supabase as the only backend. Add owner-scoped database rows first, then add pure timeline helpers, then wire timer stop/start into `activity_sessions` and `live_status`, then render day detail and friends UI from those safe APIs.

**Tech Stack:** Vanilla ES modules, Supabase JS v2 CDN, Postgres/RLS SQL, `node:test`.

**Worktree:** Before executing, run `git fetch origin` and use an isolated worktree per `AGENTS.md`. If already in a linked worktree, continue there and do not nest worktrees.

---

## File Structure

- Modify: `setup.sql`  
  Owns schema and RLS. Replace single-user tables/policies with multi-user-safe tables: `profiles`, owner-scoped `days`, owner-scoped `app_state`, `activity_sessions`, `friendships`, and `live_status`.

- Modify: `db.js`  
  Owns Supabase access. Add authenticated user helpers, owner-scoped reads/writes, session APIs, profile/live-status APIs, and export updates. Every function throws on error.

- Modify: `score.js`  
  Keep existing score helpers. Add small date/session helpers only if they are general scoring/time helpers.

- Create: `timeline.js`  
  Pure timeline logic: session duration normalization, activity-lane positions, checkpoint calculation, time formatting.

- Create: `tests/timeline.test.js`  
  Unit tests for timeline/checkpoint behavior.

- Modify: `app.js`  
  Add day-detail route, session-aware timer stop/start, live status updates, per-pillar note-sharing toggle, friends-now section, editable old-day notes, and share preview rendering.

- Modify: `style.css`  
  Add minimal timeline, check badge, day detail, friends-now, and share-card styles.

- Modify: `tests/score.test.js`  
  Only if a helper lands in `score.js`; prefer new timeline tests in `tests/timeline.test.js`.

---

### Task 1: Multi-User Schema And RLS

**Files:**
- Modify: `setup.sql`

- [ ] **Step 1: Replace `setup.sql` with the multi-user schema**

Replace the file with this SQL:

```sql
-- Momentum schema. Paste into Supabase Dashboard > SQL Editor > Run.
-- Multi-user foundation: private diary data, friend-visible live status only.

create extension if not exists pgcrypto;

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now()
);

create table if not exists days (
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  data jsonb not null default '{}'::jsonb,
  score int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);

create table if not exists app_state (
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null,
  value jsonb,
  primary key (user_id, key)
);

create table if not exists activity_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  pillar text not null,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  minutes int not null check (minutes >= 0),
  tag_ids text[] not null default '{}',
  note_snapshot text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists friendships (
  requester_id uuid not null references auth.users(id) on delete cascade,
  addressee_id uuid not null references auth.users(id) on delete cascade,
  status text not null check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (requester_id, addressee_id),
  check (requester_id <> addressee_id)
);

create table if not exists live_status (
  user_id uuid primary key references profiles(id) on delete cascade,
  pillar text,
  tag_ids text[] not null default '{}',
  shared_note text not null default '',
  is_tracking boolean not null default false,
  updated_at timestamptz not null default now()
);

create index if not exists activity_sessions_user_date_idx on activity_sessions (user_id, date, started_at);
create index if not exists friendships_addressee_idx on friendships (addressee_id, status);

alter table profiles enable row level security;
alter table days enable row level security;
alter table app_state enable row level security;
alter table activity_sessions enable row level security;
alter table friendships enable row level security;
alter table live_status enable row level security;

drop policy if exists "authenticated full access" on days;
drop policy if exists "authenticated full access" on app_state;

drop policy if exists "profiles owner read write" on profiles;
create policy "profiles owner read write" on profiles
  for all to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists "profiles accepted friends read" on profiles;
create policy "profiles accepted friends read" on profiles
  for select to authenticated
  using (
    exists (
      select 1 from friendships f
      where f.status = 'accepted'
        and (
          (f.requester_id = auth.uid() and f.addressee_id = profiles.id)
          or (f.addressee_id = auth.uid() and f.requester_id = profiles.id)
        )
    )
  );

drop policy if exists "days owner access" on days;
create policy "days owner access" on days
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "app_state owner access" on app_state;
create policy "app_state owner access" on app_state
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "activity_sessions owner access" on activity_sessions;
create policy "activity_sessions owner access" on activity_sessions
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "friendships participant access" on friendships;
create policy "friendships participant access" on friendships
  for all to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid())
  with check (requester_id = auth.uid() or addressee_id = auth.uid());

drop policy if exists "live_status owner write" on live_status;
create policy "live_status owner write" on live_status
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "live_status accepted friends read" on live_status;
create policy "live_status accepted friends read" on live_status
  for select to authenticated
  using (
    exists (
      select 1 from friendships f
      where f.status = 'accepted'
        and (
          (f.requester_id = auth.uid() and f.addressee_id = live_status.user_id)
          or (f.addressee_id = auth.uid() and f.requester_id = live_status.user_id)
        )
    )
  );
```

- [ ] **Step 2: Run the existing test suite**

Run:

```bash
npm test
```

Expected: all existing JS tests still pass because SQL changes do not affect pure scoring tests.

- [ ] **Step 3: Manual Supabase verification**

In Supabase SQL editor, after applying `setup.sql`, verify these checks with two test auth users:

```sql
-- As user A via the app or SQL JWT context:
-- insert own day: should pass
-- select user B day: should return 0 rows
-- select accepted friend live_status: should return rows
-- select non-friend live_status: should return 0 rows
```

Expected: private data is owner-only; accepted friend can read only `profiles` and `live_status`.

- [ ] **Step 4: Commit**

```bash
git add setup.sql
git commit -m "feat: add multi-user schema and live status policies"
```

---

### Task 2: Pure Timeline Helpers

**Files:**
- Create: `timeline.js`
- Create: `tests/timeline.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/timeline.test.js`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test
```

Expected: FAIL with module/function not found for `timeline.js`.

- [ ] **Step 3: Implement `timeline.js`**

Create `timeline.js`:

```js
import { toDateStr } from './score.js';

const MINUTES_PER_DAY = 24 * 60;

function round2(n) {
  return Math.round(n * 100) / 100;
}

function localDateTimeMs(iso) {
  return Date.parse(iso);
}

function localDayStartMs(iso) {
  const d = new Date(localDateTimeMs(iso));
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function localIsoMinute(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:00.000`;
}

export function sessionMinutes(startedAtIso, endedAtIso) {
  return Math.max(0, Math.floor((localDateTimeMs(endedAtIso) - localDateTimeMs(startedAtIso)) / 60000));
}

export function localDateFromIso(iso) {
  return toDateStr(new Date(localDateTimeMs(iso)));
}

export function clockTime(iso) {
  const d = new Date(localDateTimeMs(iso));
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function sessionSegment(session) {
  const dayStart = localDayStartMs(session.started_at);
  const dayEnd = dayStart + MINUTES_PER_DAY * 60000;
  const start = Math.max(localDateTimeMs(session.started_at), dayStart);
  const end = Math.min(localDateTimeMs(session.ended_at), dayEnd);
  const left = (start - dayStart) / 60000 / MINUTES_PER_DAY * 100;
  const width = Math.max(0, (end - start) / 60000 / MINUTES_PER_DAY * 100);
  return { left: round2(left), width: round2(width) };
}

export function totalSessionMinutes(sessions) {
  return sessions.reduce((sum, s) => sum + (s.minutes || 0), 0);
}

export function checkpointForPillar(sessions, pillar, targetMinutes) {
  let total = 0;
  const sorted = sessions
    .filter(s => s.pillar === pillar && (s.minutes || 0) > 0)
    .sort((a, b) => localDateTimeMs(a.started_at) - localDateTimeMs(b.started_at));

  for (const session of sorted) {
    const next = total + session.minutes;
    if (total < targetMinutes && next >= targetMinutes) {
      const offsetMinutes = targetMinutes - total;
      const atMs = localDateTimeMs(session.started_at) + offsetMinutes * 60000;
      const at = localIsoMinute(atMs);
      const dayStart = localDayStartMs(session.started_at);
      return {
        sessionId: session.id,
        at,
        left: round2((atMs - dayStart) / 60000 / MINUTES_PER_DAY * 100),
        time: clockTime(at),
      };
    }
    total = next;
  }
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add timeline.js tests/timeline.test.js
git commit -m "feat: add timeline checkpoint helpers"
```

---

### Task 3: Owner-Scoped Database API

**Files:**
- Modify: `db.js`

- [ ] **Step 1: Replace user/session helpers at the top of `db.js`**

Add this after `export const sb = ...`:

```js
let cachedUserId = null;

export async function requireUserId() {
  if (cachedUserId) return cachedUserId;
  const session = await getSession();
  if (!session?.user?.id) throw new Error('Not signed in');
  cachedUserId = session.user.id;
  return cachedUserId;
}
```

Update `signOut` to clear the cache:

```js
export async function signOut() {
  cachedUserId = null;
  const { error } = await sb.auth.signOut();
  if (error) throw error;
}
```

- [ ] **Step 2: Replace day/state functions with owner-scoped versions**

Replace `getDay`, `getDays`, `saveDay`, `getState`, `setState` with:

```js
export async function getDay(date) {
  const userId = await requireUserId();
  const { data, error } = await sb.from('days')
    .select('*').eq('user_id', userId).eq('date', date).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getDays(from, to) {
  const userId = await requireUserId();
  const { data, error } = await sb.from('days')
    .select('*').eq('user_id', userId).gte('date', from).lte('date', to).order('date');
  if (error) throw error;
  return data;
}

export async function saveDay(date, dayData, score) {
  const userId = await requireUserId();
  const { error } = await sb.from('days')
    .upsert({ user_id: userId, date, data: dayData, score, updated_at: new Date().toISOString() });
  if (error) throw error;
}

export async function getState(key, fallback) {
  const userId = await requireUserId();
  const { data, error } = await sb.from('app_state')
    .select('value').eq('user_id', userId).eq('key', key).maybeSingle();
  if (error) throw error;
  return data && data.value !== null ? data.value : fallback;
}

export async function setState(key, value) {
  const userId = await requireUserId();
  const { error } = await sb.from('app_state').upsert({ user_id: userId, key, value });
  if (error) throw error;
}
```

- [ ] **Step 3: Add activity session APIs**

Append:

```js
export async function getActivitySessions(date) {
  const userId = await requireUserId();
  const { data, error } = await sb.from('activity_sessions')
    .select('*').eq('user_id', userId).eq('date', date).order('started_at');
  if (error) throw error;
  return data;
}

export async function createActivitySession(session) {
  const userId = await requireUserId();
  const { error } = await sb.from('activity_sessions').insert({ ...session, user_id: userId });
  if (error) throw error;
}
```

- [ ] **Step 4: Add profile and live status APIs**

Append:

```js
export async function upsertProfile(displayName) {
  const userId = await requireUserId();
  const { error } = await sb.from('profiles').upsert({ id: userId, display_name: displayName });
  if (error) throw error;
}

export async function setLiveStatus(status) {
  const userId = await requireUserId();
  const { error } = await sb.from('live_status').upsert({
    user_id: userId,
    pillar: status.pillar ?? null,
    tag_ids: status.tag_ids ?? [],
    shared_note: status.shared_note ?? '',
    is_tracking: !!status.is_tracking,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

export async function getFriendLiveStatuses() {
  const { data, error } = await sb.from('live_status')
    .select('user_id,pillar,tag_ids,shared_note,is_tracking,updated_at,profiles:user_id(display_name)')
    .eq('is_tracking', true)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return data;
}
```

- [ ] **Step 5: Update export backup**

Replace `getAllForExport` with:

```js
export async function getAllForExport() {
  const userId = await requireUserId();
  const days = await getDays('2000-01-01', '2999-12-31');
  const sessions = await sb.from('activity_sessions').select('*').eq('user_id', userId).order('started_at');
  if (sessions.error) throw sessions.error;
  const appState = await sb.from('app_state').select('*').eq('user_id', userId);
  if (appState.error) throw appState.error;
  return {
    exported_at: new Date().toISOString(),
    days,
    activity_sessions: sessions.data,
    app_state: appState.data,
  };
}
```

- [ ] **Step 6: Run tests**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add db.js
git commit -m "feat: scope database access to signed-in user"
```

---

### Task 4: Timer Writes Sessions And Live Status

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Add note-share state**

Near existing module state, add:

```js
let shareNote = {};             // per-pillar live note sharing for the current tracking context
```

Use the extended timer shape:

```js
// timer: {pillar, started_at, share_note?: boolean} | null
```

- [ ] **Step 2: Add helper functions under `renderNavTimer`**

```js
function selectedTagsFor(pillar) {
  return day.tags[pillar] || [];
}

function sharedNoteFor(pillar) {
  return shareNote[pillar] ? (day.notes[pillar] || '').trim() : '';
}

async function publishLiveStatus() {
  if (!timer) {
    await db.setLiveStatus({ is_tracking: false });
    return;
  }
  await db.setLiveStatus({
    is_tracking: true,
    pillar: timer.pillar,
    tag_ids: selectedTagsFor(timer.pillar),
    shared_note: sharedNoteFor(timer.pillar),
  });
}
```

- [ ] **Step 3: Update `toggleTimer` start path**

Replace the timer creation block in `toggleTimer`:

```js
timer = { pillar, started_at: new Date().toISOString(), share_note: false };
shareNote = { ...shareNote, [pillar]: false };
await db.setState('timer', timer);
await publishLiveStatus();
await render();
```

- [ ] **Step 4: Update `stopTimer` to create an activity session**

After `const mins = S.elapsedMinutes(t.started_at, Date.now());`, add:

```js
const endedAt = new Date().toISOString();
```

Inside both same-day and cross-midnight save paths, after the day save succeeds and only when `mins > 0`, create:

```js
await db.createActivitySession({
  date: startDate,
  pillar: t.pillar,
  started_at: t.started_at,
  ended_at: endedAt,
  minutes: mins,
  tag_ids: selectedTagsFor(t.pillar),
  note_snapshot: day.notes[t.pillar] || '',
});
```

At every successful stop, after `await db.setState('timer', null);`, call:

```js
await publishLiveStatus();
```

For the cross-midnight branch, use the loaded historical day object for the snapshot if today's `day.notes` no longer matches:

```js
note_snapshot: d.notes?.[t.pillar] || day.notes[t.pillar] || '',
```

- [ ] **Step 5: Add action for note-share toggle in pillar cards**

In `pillarCard`, after the note input, add this only when the pillar is running:

```js
${running ? `<label class="share-note"><input type="checkbox" data-action="sharenote" data-pillar="${p.key}" ${shareNote[p.key] ? 'checked' : ''}> Share note with friends</label>` : ''}
```

In the delegated click handler, add before timer actions:

```js
} else if (a === 'sharenote') {
  const p = btn.dataset.pillar;
  shareNote[p] = !shareNote[p];
  if (timer?.pillar === p) {
    timer = { ...timer, share_note: !!shareNote[p] };
    await db.setState('timer', timer);
    await publishLiveStatus();
  }
  await render();
```

- [ ] **Step 6: Update note/tag input live status while tracking**

In the tag click branch, after `await saveToday();`, add:

```js
if (timer?.pillar === pillar) await publishLiveStatus();
```

In the input handler for `data-note`, after setting the note, add:

```js
if (timer?.pillar === t.dataset.note && shareNote[t.dataset.note]) {
  publishLiveStatus().catch(e => { showError(e); console.error(e); });
}
```

- [ ] **Step 7: Run tests**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 8: Manual browser test**

Run the app, sign in, start a timer, type a note, toggle sharing, stop the timer.

Expected:
- `activity_sessions` has one row for the stopped timer.
- `live_status` shows tracking while running.
- `live_status.shared_note` is empty until the share toggle is on.
- Stopping clears `is_tracking`.

- [ ] **Step 9: Commit**

```bash
git add app.js
git commit -m "feat: record timer sessions and live status"
```

---

### Task 5: Day Detail Route And Timeline UI

**Files:**
- Modify: `app.js`
- Modify: `style.css`

- [ ] **Step 1: Update route parsing**

Replace `route()` with:

```js
function route() {
  const h = location.hash.replace('#', '') || 'today';
  if (h.startsWith('day/')) return { name: 'day', date: h.slice(4) };
  return { name: h };
}
```

Update `render()`:

```js
async function render() {
  const r = route();
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('on', a.getAttribute('href') === '#' + r.name));
  try {
    if (r.name === 'week') await renderWeek();
    else if (r.name === 'month') await renderMonth();
    else if (r.name === 'settings') await renderSettings();
    else if (r.name === 'day') await renderDayDetail(r.date);
    else await renderToday();
  } catch (e) { showError(e); throw e; }
}
```

- [ ] **Step 2: Make Week and Month dates clickable**

In `renderWeek`, wrap each existing dot in a link:

```js
<a class="daylink" href="#day/${d}">
  <div class="dot ${cls} ${d === today ? 'today' : ''}">${r ? r.score : '·'}</div>
</a>
```

In `renderMonth`, replace calendar cells for non-future dates:

```js
cells += d <= today
  ? `<a class="${cls}" href="#day/${d}">${n}</a>`
  : `<div class="${cls}">${n}</div>`;
```

- [ ] **Step 3: Import timeline helpers**

At the top of `app.js`:

```js
import { sessionSegment, checkpointForPillar, totalSessionMinutes } from './timeline.js';
```

- [ ] **Step 4: Add day detail render helpers**

Add below `renderToday`:

```js
function fmtHours(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h ${m ? `${m}m` : ''}`.trim() : `${m}m`;
}

function timelineHtml(sessions, dayData) {
  const ticks = ['00', '04', '08', '12', '16', '20'];
  const tickHtml = `<div class="tl-ticks"><span></span>${ticks.map(t => `<span>${t}</span>`).join('')}</div>`;
  const rows = PILLARS.map(p => {
    const laneSessions = sessions.filter(s => s.pillar === p.key);
    const bars = laneSessions.map(s => {
      const seg = sessionSegment(s);
      return `<i class="tl-bar" style="left:${seg.left}%;width:${seg.width}%;--c:var(--${p.key})"></i>`;
    }).join('');
    const checkpoint = checkpointForPillar(sessions, p.key, targets[p.key]);
    const badge = checkpoint
      ? `<button class="tl-badge" style="left:${checkpoint.left}%;--c:var(--${p.key})" title="Target reached at ${checkpoint.time}" data-checkpoint="${checkpoint.time}">✓</button>`
      : '';
    const manual = Math.max(0, (dayData.minutes?.[p.key] || 0) - totalSessionMinutes(laneSessions));
    return `<div class="tl-row"><b style="color:var(--${p.key})">${p.icon} ${p.name}</b><div class="tl-lane">${bars}${badge}</div>${manual ? `<em>+${manual}m manual</em>` : ''}</div>`;
  }).join('');
  return `<div class="timeline">${tickHtml}${rows}</div>`;
}
```

- [ ] **Step 5: Add `renderDayDetail`**

```js
async function renderDayDetail(date) {
  const row = await db.getDay(date);
  const data = row ? { ...emptyDay(), ...row.data } : emptyDay();
  const sessions = await db.getActivitySessions(date);
  const points = S.dayPoints(data, targets);
  const score = row?.score ?? S.dayScore(points);
  const status = S.dayStatus(score);
  const totalMins = Object.values(data.minutes || {}).reduce((a, b) => a + b, 0);
  $('#view').innerHTML = `
    <div class="headrow">
      <div><h1>${fmtLongDate(date)}</h1><p>Day journey</p></div>
      <div class="streak">${score}<small>${status.toUpperCase()}</small></div>
    </div>
    <section class="card day-summary">
      <h2>Summary</h2>
      <div class="day-score"><b>${score}</b><span>${fmtHours(totalMins)} tracked + manual</span></div>
    </section>
    <section class="card">
      <h2>Timeline</h2>
      ${sessions.length ? timelineHtml(sessions, data) : '<p class="empty">Timeline starts after this feature was added.</p>'}
    </section>
    <section class="win">🏆
      <div><label>BIGGEST WIN</label>
        <input id="detail-win" data-detail-date="${date}" value="${esc(data.win)}" placeholder="What happened this day?"></div>
    </section>
    <section class="card">
      <h2>Notes</h2>
      ${PILLARS.map(p => `<input class="note" data-detail-note="${p.key}" data-detail-date="${date}" placeholder="${p.name} note" value="${esc(data.notes[p.key])}">`).join('')}
    </section>
    <section class="card">
      <h2>Reflection</h2>
      <div class="refl-qs">
        <div><label>What went wrong?</label><textarea data-detail-reflect="wrong" data-detail-date="${date}" rows="2">${esc(data.reflect.wrong)}</textarea></div>
        <div><label>One thing for tomorrow?</label><textarea data-detail-reflect="tomorrow" data-detail-date="${date}" rows="2">${esc(data.reflect.tomorrow)}</textarea></div>
      </div>
    </section>
    <section class="card">
      <button class="btn" data-action="shareday" data-date="${date}">Share preview</button>
    </section>`;
  renderNavTimer();
}
```

- [ ] **Step 6: Add save helper for day-detail edits**

Add near `saveToday`:

```js
async function saveDayData(date, data) {
  data.points = S.dayPoints(data, targets);
  try { await db.saveDay(date, data, S.dayScore(data.points)); hideError(); }
  catch (e) { lastFailed = () => saveDayData(date, data); showError(e); throw e; }
}
```

Update input/change handlers to support `detail-win`, `data-detail-note`, and `data-detail-reflect`:

```js
if (t.id === 'detail-win' || t.dataset.detailNote !== undefined || t.dataset.detailReflect !== undefined) {
  const date = t.dataset.detailDate;
  const row = await db.getDay(date);
  const data = row ? { ...emptyDay(), ...row.data } : emptyDay();
  if (t.id === 'detail-win') data.win = t.value;
  else if (t.dataset.detailNote !== undefined) data.notes[t.dataset.detailNote] = t.value;
  else data.reflect[t.dataset.detailReflect] = t.value;
  await saveDayData(date, data);
}
```

- [ ] **Step 7: Add CSS**

Append to `style.css`:

```css
.daylink{display:grid;text-decoration:none;color:inherit}
.timeline{display:grid;gap:12px}
.tl-ticks{display:grid;grid-template-columns:74px repeat(6,1fr);gap:4px;font-size:10px;color:var(--faint);font-weight:700}
.tl-row{display:grid;grid-template-columns:74px 1fr auto;align-items:center;gap:10px}
.tl-row>b{font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tl-row>em{font-style:normal;color:var(--faint);font-size:10.5px;white-space:nowrap}
.tl-lane{height:24px;background:var(--surface2);border-radius:99px;position:relative;box-shadow:inset 0 0 0 1px var(--line)}
.tl-bar{position:absolute;top:0;height:100%;background:var(--c);border-radius:99px}
.tl-badge{position:absolute;top:50%;width:30px;height:30px;transform:translate(-50%,-50%);border-radius:50%;background:var(--c);color:#0B0E13;border:3px solid var(--bg);box-shadow:0 0 0 4px color-mix(in srgb,var(--c) 18%,transparent),0 0 22px color-mix(in srgb,var(--c) 55%,transparent);display:grid;place-items:center;font-weight:900;font-size:18px}
.day-score{display:flex;justify-content:space-between;align-items:end}
.day-score b{font-family:Sora,sans-serif;font-size:36px}
.day-score span{font-size:12px;color:var(--muted);font-weight:600}
.empty{color:var(--faint);font-size:13px;line-height:1.5}
```

- [ ] **Step 8: Run tests and manually inspect**

Run:

```bash
npm test
```

Expected: all tests pass.

Manual:
- Open Week, tap a date.
- Open Month, tap a date.
- Verify day detail renders.
- Verify sessions become colored bars and badges.

- [ ] **Step 9: Commit**

```bash
git add app.js style.css
git commit -m "feat: add day detail timeline view"
```

---

### Task 6: Share Preview

**Files:**
- Modify: `app.js`
- Modify: `style.css`

- [ ] **Step 1: Add share preview renderer**

Add below `timelineHtml`:

```js
function shareSummaryHtml(date, data, sessions, score) {
  const totals = PILLARS.map(p => ({
    p,
    mins: data.minutes?.[p.key] || 0,
  })).filter(x => x.mins > 0);
  return `
    <section class="share-card">
      <div class="share-top"><span>Momentum · ${date}</span><b>${score}</b></div>
      ${timelineHtml(sessions, data)}
      <div class="share-totals">
        ${totals.map(({ p, mins }) => `<span style="--c:var(--${p.key})"><i></i>${p.name}: ${fmtHours(mins)}</span>`).join('')}
      </div>
    </section>`;
}
```

- [ ] **Step 2: Add click action**

In the delegated click handler, add:

```js
} else if (a === 'shareday') {
  const date = btn.dataset.date;
  const row = await db.getDay(date);
  const data = row ? { ...emptyDay(), ...row.data } : emptyDay();
  const sessions = await db.getActivitySessions(date);
  const score = row?.score ?? S.dayScore(S.dayPoints(data, targets));
  $('#view').insertAdjacentHTML('beforeend', `<div class="share-wrap">${shareSummaryHtml(date, data, sessions, score)}<button class="btn" data-action="copyshare" data-date="${date}">Copy summary</button></div>`);
} else if (a === 'copyshare') {
  const date = btn.dataset.date;
  const row = await db.getDay(date);
  const data = row ? { ...emptyDay(), ...row.data } : emptyDay();
  const totals = PILLARS.map(p => `${p.name}: ${fmtHours(data.minutes?.[p.key] || 0)}`).join('\\n');
  await navigator.clipboard.writeText(`Momentum ${date}\\nScore: ${row?.score ?? 0}\\n${totals}`);
```

- [ ] **Step 3: Add CSS**

Append:

```css
.share-wrap{margin-top:12px}
.share-card{background:#0B0E13;border:1px solid var(--line);border-radius:18px;padding:18px;margin-bottom:10px}
.share-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}
.share-top span{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--faint);font-weight:800}
.share-top b{font-family:Sora,sans-serif;font-size:34px;color:var(--green)}
.share-totals{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
.share-totals span{display:flex;align-items:center;gap:6px;font-size:11.5px;color:var(--muted);border:1px solid var(--line);border-radius:99px;padding:6px 9px}
.share-totals i{width:7px;height:7px;border-radius:50%;background:var(--c)}
```

- [ ] **Step 4: Manual share test**

Open a day detail and click Share preview.

Expected:
- Preview includes timeline, badges, score, and hour totals.
- Preview does not include win, reflection, or notes.
- Copy summary copies text without notes.

- [ ] **Step 5: Commit**

```bash
git add app.js style.css
git commit -m "feat: add day journey share preview"
```

---

### Task 7: Friends Now UI

**Files:**
- Modify: `app.js`
- Modify: `style.css`

- [ ] **Step 1: Add tag label helper**

Add near `pillarName`:

```js
function tagLabel(pillar, tagId) {
  const p = PILLARS.find(x => x.key === pillar);
  return p?.tags.find(([id]) => id === tagId)?.[1] || tagId;
}
```

- [ ] **Step 2: Add friends renderer**

Add below `renderNavTimer`:

```js
async function friendsNowHtml() {
  const rows = await db.getFriendLiveStatuses();
  const active = rows.filter(r => r.is_tracking);
  if (!active.length) return '';
  return `<section class="card friends-now"><h2>Friends now</h2>
    ${active.map(r => {
      const p = PILLARS.find(x => x.key === r.pillar);
      const tags = (r.tag_ids || []).map(id => tagLabel(r.pillar, id)).join(', ');
      const note = r.shared_note ? ` — ${esc(r.shared_note)}` : '';
      return `<div class="friend-row" style="--c:var(--${p?.key || 'green'})"><i></i><b>${esc(r.profiles?.display_name || 'Friend')}</b><span>${p?.name || r.pillar}${tags ? ` · ${esc(tags)}` : ''}${note}</span></div>`;
    }).join('')}</section>`;
}
```

- [ ] **Step 3: Include friends in Today**

In `renderToday`, before setting `#view.innerHTML`, get:

```js
const friendsHtml = await friendsNowHtml();
```

Insert `${friendsHtml}` after mission or hero:

```js
${missionHtml}
${friendsHtml}
<section class="hero">
```

- [ ] **Step 4: Add CSS**

Append:

```css
.friends-now{padding-bottom:10px}
.friend-row{display:grid;grid-template-columns:10px auto 1fr;align-items:center;gap:9px;padding:8px 0;border-bottom:1px dashed var(--line);font-size:13px}
.friend-row:last-child{border-bottom:0}
.friend-row i{width:9px;height:9px;border-radius:50%;background:var(--c);box-shadow:0 0 12px color-mix(in srgb,var(--c) 55%,transparent)}
.friend-row b{font-weight:700}
.friend-row span{color:var(--muted);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
```

- [ ] **Step 5: Manual privacy test**

Using two accepted test users:
- User B starts Skill + Code with share note off.
- User A sees `B · Skill & Income · Code`.
- User B toggles share note on.
- User A sees the note.
- User A never sees B's hours, start time, score, timeline, win, or reflection.

- [ ] **Step 6: Commit**

```bash
git add app.js style.css
git commit -m "feat: show minimal friend live status"
```

---

### Task 8: Settings/Profile Basics

**Files:**
- Modify: `app.js`
- Modify: `db.js`

- [ ] **Step 1: Add display name state**

In `app.js` module state:

```js
let profile = null;              // {display_name} | null
```

In `db.js`, add:

```js
export async function getProfile() {
  const userId = await requireUserId();
  const { data, error } = await sb.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) throw error;
  return data;
}
```

- [ ] **Step 2: Load profile on boot**

In `boot()` after session exists:

```js
profile = await db.getProfile();
if (!profile) {
  await db.upsertProfile(session.user.email?.split('@')[0] || 'Momentum User');
  profile = await db.getProfile();
}
```

- [ ] **Step 3: Add profile field in Settings**

In `renderSettings`, add above Daily targets:

```js
<section class="card"><h2>Profile</h2>
  <div class="set-row"><label>Display name</label>
    <input type="text" id="display-name" value="${esc(profile?.display_name || '')}" placeholder="Your name"></div>
</section>
```

In change handler:

```js
} else if (t.id === 'display-name') {
  await db.upsertProfile(t.value.trim() || 'Momentum User');
  profile = await db.getProfile();
```

- [ ] **Step 4: Run tests and manual settings check**

Run:

```bash
npm test
```

Expected: all tests pass.

Manual:
- Change display name.
- Confirm `profiles.display_name` updates.
- Friend live status uses the new display name.

- [ ] **Step 5: Commit**

```bash
git add app.js db.js
git commit -m "feat: add profile display name"
```

---

### Task 9: Final Verification Pass

**Files:**
- Modify only if fixes are needed.

- [ ] **Step 1: Run unit tests**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 2: Manual single-user flow**

Checklist:

```text
Sign in
Start Skill timer
Select Code tag
Type note
Toggle Share note with friends on/off
Stop timer after at least one minute
Open Week
Tap today
Confirm timeline bar exists
Confirm check badge appears if target was reached
Confirm manual minute edit changes summary but not timeline
Edit old-day win/note/reflection
Open share preview
Confirm share preview excludes private notes
Export JSON backup
```

- [ ] **Step 3: Manual two-user privacy flow**

Checklist:

```text
Create user A and user B
Insert accepted friendship between A and B
User B starts timer with tag and share note off
User A sees only display name + pillar + tag
User B turns share note on
User A sees shared note
User A cannot query B days
User A cannot query B activity_sessions
User A cannot update B live_status
Remove accepted friendship
User A no longer sees B live_status
```

- [ ] **Step 4: Check repository status**

Run:

```bash
git status --short
```

Expected: clean, or only intentional fix files remain.

- [ ] **Step 5: Commit final fixes if any**

If fixes were needed:

```bash
git add app.js db.js score.js timeline.js style.css setup.sql tests
git commit -m "fix: polish day journey timeline behavior"
```

If no fixes were needed, do not create an empty commit.
