// App bootstrap, routing, rendering. Views are template strings rendered into
// #view; interactions use event delegation via data-action attributes.

import * as S from './score.js';
import * as db from './db.js';
import { sessionSegment, checkpointForPillar, totalSessionMinutes } from './timeline.js';
import { syncCurrentDayState, checkpointMessage } from './app-state.js';

const PILLARS = [
  { key: 'skill', name: 'Skill & Income', icon: '💰',
    tags: [['learn', 'Learn'], ['code', 'Code'], ['project', 'Project'], ['research', 'Research'], ['freelance', 'Freelance']] },
  { key: 'uni', name: 'University', icon: '🎓',
    tags: [['class', 'Attend class'], ['review', 'Review'], ['homework', 'Homework'], ['readahead', 'Read ahead']] },
  { key: 'health', name: 'Health', icon: '💪', tags: [] },
  { key: 'fin', name: 'Financial Education', icon: '📚', tags: [] },
  { key: 'eng', name: 'English', icon: '🇬🇧', tags: [] },
  { key: 'mind', name: 'Mindfulness', icon: '🧘',
    tags: [['meditate', 'Meditate'], ['selfreview', 'Self-review'], ['gratitude', 'Gratitude']] },
];

// ---- state ----
let targets = { ...S.DEFAULT_TARGETS };
let mission = null;             // {title, deadline, progress} | null
let profile = null;             // {display_name} | null
let timer = null;               // {pillar, started_at, share_note?: boolean} | null
let recovery = { version: 1, active: null, history: [] };
let recoveryBusy = false; // guards the expiry re-render in tick()
let shareNote = {};             // per-pillar live note sharing for the current tracking context
let today = S.toDateStr(new Date());
let day = emptyDay();           // today's data (spec §5 shape)
let weekOffset = 0;
let monthOffset = 0;

const $ = sel => document.querySelector(sel);
const esc = v => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function emptyDay() {
  return { minutes: {}, tags: {}, sleep_ok: false, notes: {}, win: '', reflect: { wrong: '', tomorrow: '' }, points: {} };
}

function pillarName(key) {
  return key === 'refl' ? 'Reflection' : PILLARS.find(p => p.key === key).name;
}

function tagLabel(pillar, tagId) {
  const p = PILLARS.find(x => x.key === pillar);
  return p?.tags.find(([id]) => id === tagId)?.[1] || tagId;
}

function fmtLongDate(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

// ---- error banner: failures are shown, retriable, and rethrown — never swallowed ----
let lastFailed = null;
function showError(e) { $('#errmsg').textContent = e.message || String(e); $('#err').classList.remove('hidden'); console.error(e); }
function hideError() { $('#err').classList.add('hidden'); }
$('#retry').addEventListener('click', async () => {
  if (!lastFailed) return;
  try { await lastFailed(); hideError(); } catch (e) { showError(e); }
});

// ---- saving today's row ----
let saveDebounce = null;
// saveToday reads module-level `today`/`day`; tick() clears this debounce on rollover on purpose
function queueSave() { clearTimeout(saveDebounce); saveDebounce = setTimeout(saveToday, 800); }
async function saveToday() {
  day.points = S.dayPoints(day, targets);
  try { await db.saveDay(today, day, S.dayScore(day.points)); hideError(); }
  catch (e) { lastFailed = saveToday; showError(e); throw e; }
}

async function saveDayData(date, data) {
  data.points = S.dayPoints(data, targets);
  try { await db.saveDay(date, data, S.dayScore(data.points)); hideError(); }
  catch (e) { lastFailed = () => saveDayData(date, data); showError(e); throw e; }
}

// ---- boot ----
async function boot() {
  const session = await db.getSession();
  if (!session) { $('#login').classList.remove('hidden'); $('#view').innerHTML = ''; return; }
  profile = await db.getProfile();
  if (!profile) {
    await db.upsertProfile('Momentum User');
    profile = await db.getProfile();
  }
  targets = await db.getState('targets', { ...S.DEFAULT_TARGETS });
  mission = await db.getState('mission', null);
  timer = await db.getState('timer', null);
  if (timer?.pillar) shareNote = { ...shareNote, [timer.pillar]: !!timer.share_note };
  recovery = await db.getRecovery();
  await loadToday();
  await syncRecovery(await buildScoreByDate()); // catch banner/modal regardless of landing view
  window.addEventListener('hashchange', render);
  setInterval(tick, 1000);
  await render();
}

async function loadToday() {
  const row = await db.getDay(today);
  day = row ? { ...emptyDay(), ...row.data } : emptyDay();
}

$('#loginform').addEventListener('submit', async ev => {
  ev.preventDefault();
  try { await db.signIn($('#email').value, $('#password').value); location.reload(); }
  catch (e) { $('#loginerr').textContent = e.message; throw e; }
});

// ---- routing ----
function route() {
  const h = location.hash.replace('#', '') || 'today';
  if (h.startsWith('day/')) return { name: 'day', date: h.slice(4) };
  return { name: h };
}
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

function rangeLabel(from, to) {
  const opt = { month: 'short', day: 'numeric' };
  const f = new Date(from + 'T00:00:00'), t = new Date(to + 'T00:00:00');
  return `${f.toLocaleDateString('en-US', opt)} – ${t.toLocaleDateString('en-US', opt)}`;
}

async function renderWeek() {
  const monday = S.startOfWeek(S.addDays(today, weekOffset * 7));
  const dates = Array.from({ length: 7 }, (_, i) => S.addDays(monday, i));
  const rows = await db.getDays(S.addDays(monday, -60), dates[6] > today ? dates[6] : today);
  const byDate = {}; for (const r of rows) byDate[r.date] = r;
  const names = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

  const dots = dates.map((d, i) => {
    const r = byDate[d];
    const cls = r ? S.dayStatus(r.score) : 'off';
    return `<div class="day7"><em>${names[i]}</em>
      <a class="daylink" href="#day/${d}">
        <div class="dot ${cls} ${d === today ? 'today' : ''}">${r ? r.score : '·'}</div>
      </a></div>`;
  }).join('');

  const weekRows = dates.filter(d => byDate[d]).map(d => byDate[d]);
  const avg = weekRows.length ? Math.round(weekRows.reduce((a, r) => a + r.score, 0) / weekRows.length) : 0;
  const greens = weekRows.filter(r => r.score >= 80).length;
  const scoreByDate = {}; for (const r of rows) scoreByDate[r.date] = r.score;
  const forgiven = S.forgivenSet(recovery.history, scoreByDate);
  const stk = S.streak(scoreByDate, today, forgiven);
  const wkMarker = recoveryMarker(scoreByDate, forgiven);

  const hours = PILLARS.map(p => ({
    p, mins: weekRows.reduce((a, r) => a + (r.data.minutes?.[p.key] ?? 0), 0),
  }));
  const maxMins = Math.max(60, ...hours.map(h => h.mins));
  const bars = hours.map(({ p, mins }) => `
    <div class="hb" style="--c:var(--${p.key})"><i>${p.icon}</i>
      <div class="track"><b style="width:${Math.round(mins / maxMins * 100)}%"></b></div>
      <span>${(mins / 60).toFixed(1)} h</span></div>`).join('');

  let insight = 'No data yet this week — press play on a pillar to start.';
  if (weekRows.length) {
    const bestRow = weekRows.reduce((a, r) => (r.score > a.score ? r : a));
    const weakest = hours.reduce((a, h) =>
      (h.mins / (targets[h.p.key] * 7) < a.mins / (targets[a.p.key] * 7) ? h : a));
    insight = `<b>Best day: ${fmtLongDate(bestRow.date).split(',')[0]} (${bestRow.score}).</b>
      ${weakest.p.name} is furthest behind this week — one focused session catches you up.`;
  }

  $('#view').innerHTML = `
    <div class="headrow">
      <div><h1>Weekly Review</h1><p>${rangeLabel(monday, dates[6])}</p></div>
      <div class="navbtns">
        <button data-action="weeknav" data-dir="-1">‹</button>
        <button data-action="weeknav" data-dir="1">›</button>
      </div>
    </div>
    <section class="card"><h2>This week</h2><div class="days7">${dots}</div></section>
    <div class="stats3">
      <div class="stat3"><b>${avg}<small> avg</small></b><span>WEEK SCORE</span></div>
      <div class="stat3"><b>${greens}<small> /${weekRows.length}</small></b><span>GREEN DAYS</span></div>
      <div class="stat3"><b>🔥 ${stk}${wkMarker}</b><span>STREAK</span></div>
    </div>
    <section class="card"><h2>Hours by pillar</h2>${bars}</section>
    <section class="card"><h2>Insight</h2><div class="insight">✨<p>${insight}</p></div></section>
    ${timer ? trackNowHtml() : ''}`;
  renderNavTimer();
}

function monthName(m) {
  return ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'][m];
}

async function renderMonth() {
  const base = new Date(today + 'T00:00:00');
  base.setDate(1);
  base.setMonth(base.getMonth() + monthOffset);
  const y = base.getFullYear(), m = base.getMonth();
  const first = S.toDateStr(new Date(y, m, 1));
  const last = S.toDateStr(new Date(y, m + 1, 0));
  const daysInMonth = new Date(y, m + 1, 0).getDate();

  const trendFrom = S.addDays(today, -60);
  const rows = await db.getDays(first < trendFrom ? first : trendFrom, last > today ? last : today);
  const byDate = {}; for (const r of rows) byDate[r.date] = r;
  const monthRows = rows.filter(r => r.date >= first && r.date <= last);

  const avg = monthRows.length ? Math.round(monthRows.reduce((a, r) => a + r.score, 0) / monthRows.length) : 0;
  const greens = monthRows.filter(r => r.score >= 80).length;
  const scoreByDate = {}; for (const r of monthRows) scoreByDate[r.date] = r.score;
  const best = S.bestStreak(scoreByDate, S.forgivenSet(recovery.history, scoreByDate));

  // life trend — always anchored to today (spec §7)
  const trendRows = {};
  for (const r of rows) trendRows[r.date] = { points: r.data.points || {}, score: r.score };
  const trend = S.lifeTrend(trendRows, today);
  const tRow = (label, v, big = false) => {
    const cls = v === null ? 'flat' : v > 0 ? 'up' : v < 0 ? 'down' : 'flat';
    const txt = v === null ? '—' : `${v >= 0 ? '▲ +' : '▼ −'}${Math.abs(v)}%`;
    return `<div class="t-row ${big ? 'big' : ''}"><span>${label}</span><b class="${cls}">${txt}</b></div>`;
  };
  const trendHtml = tRow('Overall', trend.overall, true)
    + PILLARS.map(p => tRow(`${p.icon} ${p.name}`, trend.pillars[p.key])).join('')
    + tRow('🌱 Reflection', trend.pillars.refl);

  // calendar, Monday-first
  const firstWd = (new Date(y, m, 1).getDay() + 6) % 7;
  let cells = '<em>M</em><em>T</em><em>W</em><em>T</em><em>F</em><em>S</em><em>S</em>'
    + '<div class="c blank"></div>'.repeat(firstWd);
  for (let n = 1; n <= daysInMonth; n++) {
    const d = S.toDateStr(new Date(y, m, n));
    const r = byDate[d];
    let cls = 'c';
    if (d > today) cls += ' future';
    else if (r) {
      const st = S.dayStatus(r.score);
      cls += ' ' + (st === 'green' && r.score >= 90 ? 'green2' : st);
    }
    if (d === today) cls += ' today';
    cells += d <= today
      ? `<a class="${cls}" href="#day/${d}">${n}</a>`
      : `<div class="${cls}">${n}</div>`;
  }

  // score line chart
  const pts = monthRows.map(r => {
    const n = Number(r.date.slice(8));
    const x = Math.round(14 + (n - 1) / Math.max(1, daysInMonth - 1) * 312);
    const yy = Math.round(102 - r.score / 100 * 88);
    return `${x},${yy}`;
  });
  const lastPt = pts.length ? pts[pts.length - 1].split(',') : null;
  const chart = `
    <svg viewBox="0 0 340 110" preserveAspectRatio="none">
      <line class="gl" x1="0" y1="14" x2="340" y2="14"/><text class="glt" x="2" y="11">100</text>
      <line class="gl" x1="0" y1="58" x2="340" y2="58"/><text class="glt" x="2" y="55">50</text>
      <line class="gl" x1="0" y1="102" x2="340" y2="102"/><text class="glt" x="2" y="99">0</text>
      ${pts.length > 1 ? `<polyline points="${pts.join(' ')}" fill="none" stroke="#3DDC84"
        stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
      ${lastPt ? `<circle cx="${lastPt[0]}" cy="${lastPt[1]}" r="4" fill="#3DDC84"/>` : ''}
    </svg>`;

  const totals = PILLARS.map(p => ({
    p, mins: monthRows.reduce((a, r) => a + (r.data.minutes?.[p.key] ?? 0), 0),
  }));
  const maxT = Math.max(60, ...totals.map(t => t.mins));
  const totalsHtml = totals.map(({ p, mins }) => `
    <div class="hb" style="--c:var(--${p.key})"><i>${p.icon}</i>
      <div class="track"><b style="width:${Math.round(mins / maxT * 100)}%"></b></div>
      <span>${(mins / 60).toFixed(1)} h</span></div>`).join('');

  const wins = monthRows.filter(r => r.data.win && r.data.win.trim())
    .map(r => `<div><em>${monthName(m).slice(0, 3)} ${Number(r.date.slice(8))}</em><b>${esc(r.data.win)}</b></div>`)
    .join('') || '<span>No wins recorded yet.</span>';

  $('#view').innerHTML = `
    <div class="headrow">
      <div><h1>${monthName(m)} ${y}</h1><p>Monthly review</p></div>
      <div class="navbtns">
        <button data-action="monthnav" data-dir="-1">‹</button>
        <button data-action="monthnav" data-dir="1">›</button>
      </div>
    </div>
    <div class="stats3">
      <div class="stat3"><b>${avg}</b><span>AVG SCORE</span></div>
      <div class="stat3"><b>${greens}</b><span>GREEN DAYS</span></div>
      <div class="stat3"><b>🔥 ${best}</b><span>BEST STREAK</span></div>
    </div>
    <section class="card"><h2>Life trend — last 30 days vs previous</h2>${trendHtml}</section>
    <section class="card"><h2>Calendar</h2><div class="cal">${cells}</div>
      <div class="legend">
        <span><i style="background:rgba(61,220,132,.35)"></i>Green 80+</span>
        <span><i style="background:rgba(242,201,76,.35)"></i>Yellow 40–79</span>
        <span><i style="background:rgba(248,97,90,.35)"></i>Red &lt;40</span>
      </div></section>
    <section class="card"><h2>Score trend</h2><div class="chart">${chart}</div></section>
    <section class="card"><h2>Totals this month</h2>${totalsHtml}</section>
    <section class="card"><h2>Wins this month</h2><div class="winlist">${wins}</div></section>
    ${timer ? trackNowHtml() : ''}`;
  renderNavTimer();
}

async function renderSettings() {
  const tRows = PILLARS.map(p => `
    <div class="set-row"><label>${p.icon} ${p.name} target (min/day)</label>
      <input type="number" min="1" data-target="${p.key}" value="${targets[p.key]}"></div>`).join('');
  const m = mission || { title: '', deadline: '', progress: 0 };
  $('#view').innerHTML = `
    <div class="headrow"><div><h1>Settings</h1><p>Targets, mission, account</p></div></div>
    <section class="card"><h2>Profile</h2>
      <div class="set-row"><label>Display name</label>
        <input type="text" id="display-name" value="${esc(profile?.display_name || '')}" placeholder="Your name"></div>
    </section>
    <section class="card"><h2>Daily targets</h2>${tRows}</section>
    <section class="card"><h2>Current mission</h2>
      <div class="set-row"><label>Title</label>
        <input type="text" id="m-title" value="${esc(m.title)}" placeholder="e.g. Launch TrueVibe MVP"></div>
      <div class="set-row"><label>Deadline</label>
        <input type="date" id="m-deadline" value="${esc(m.deadline)}"></div>
      <div class="set-row"><label>Progress <b id="m-pct">${m.progress || 0}%</b></label>
        <input type="range" id="m-progress" min="0" max="100" value="${m.progress || 0}"></div>
    </section>
    <section class="card"><h2>Data & account</h2>
      <div class="btnrow">
        <button class="btn" data-action="export">⬇ Export JSON backup</button>
        <button class="btn danger" data-action="logout">Log out</button>
      </div>
    </section>
    ${timer ? trackNowHtml() : ''}`;
  renderNavTimer();
}
let timerBusy = false;
async function toggleTimer(pillar) {
  if (timerBusy) return;
  timerBusy = true;
  try {
    if (timer && timer.pillar === pillar) { await stopTimer(); await render(); return; }
    if (timer) await stopTimer(); // switching pillars: bank the old one first
    timer = { pillar, started_at: new Date().toISOString(), share_note: false };
    shareNote = { ...shareNote, [pillar]: false };
    await db.setState('timer', timer);
    await render();
    await publishLiveStatus();
  } finally { timerBusy = false; }
}

async function stopTimer() {
  if (!timer) return;
  const t = timer;
  // another device may have already stopped/replaced this timer — claim before banking
  const claimed = await db.claimTimer(t);
  timer = null;
  if (!claimed) return;
  const restoreTimer = async () => {
    timer = t;
    await db.setState('timer', t);
    await publishLiveStatus();
  };
  try { await publishLiveStatus(); }
  catch (e) { await restoreTimer(); throw e; }

  const mins = S.elapsedMinutes(t.started_at, Date.now());
  const endedAt = new Date().toISOString();
  if (mins <= 0) return; // under a minute: nothing to bank
  const startDate = S.toDateStr(new Date(Date.parse(t.started_at)));
  let daySaved = false;
  let retrySession = null;
  if (startDate === today) {
    const previousMinutes = day.minutes[t.pillar] || 0;
    const createSession = async () => {
      await db.createActivitySession({
        date: startDate,
        pillar: t.pillar,
        started_at: t.started_at,
        ended_at: endedAt,
        minutes: mins,
        tag_ids: selectedTagsFor(t.pillar),
        note_snapshot: day.notes[t.pillar] || '',
      });
    };
    retrySession = createSession;
    try {
      day.minutes[t.pillar] = previousMinutes + mins;
      await saveToday();
      daySaved = true;
      await createSession();
    } catch (e) {
      if (!daySaved) {
        day.minutes[t.pillar] = previousMinutes;
        await restoreTimer();
      } else {
        lastFailed = retrySession;
      }
      throw e;
    }
  } else {
    // timer crossed midnight: credit the day it was started (spec §4)
    const saveMidnight = async () => {
      const row = await db.getDay(startDate);
      const d = row ? { ...emptyDay(), ...row.data } : emptyDay();
      const createSession = async () => {
        await db.createActivitySession({
          date: startDate,
          pillar: t.pillar,
          started_at: t.started_at,
          ended_at: endedAt,
          minutes: mins,
          tag_ids: d.tags?.[t.pillar] || [],
          note_snapshot: d.notes?.[t.pillar] || day.notes[t.pillar] || '',
        });
      };
      retrySession = createSession;
      d.minutes[t.pillar] = (d.minutes[t.pillar] || 0) + mins;
      d.points = S.dayPoints(d, targets);
      await db.saveDay(startDate, d, S.dayScore(d.points));
      daySaved = true;
      await createSession();
    };
    try { await saveMidnight(); }
    catch (e) {
      if (!daySaved) {
        await restoreTimer();
      } else {
        lastFailed = retrySession;
      }
      if (!lastFailed) lastFailed = saveMidnight;
      throw e;
    }
  }
}

function chipBtn(pillarKey, id, label, on) {
  return `<button class="chip ${on ? 'on' : ''}" data-action="tag" data-pillar="${pillarKey}" data-id="${id}">
    <svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>${label}</button>`;
}

function pillarCard(p, points) {
  const max = S.WEIGHTS[p.key];
  const t = targets[p.key];
  const mins = day.minutes[p.key] || 0;
  const running = !!(timer && timer.pillar === p.key);
  const done = mins >= t;
  const pct = Math.min(100, Math.round(mins / t * 100));
  const chips = p.tags.map(([id, label]) => chipBtn(p.key, id, label, (day.tags[p.key] || []).includes(id))).join('')
    + (p.key === 'health' ? `<button class="chip ${day.sleep_ok ? 'on' : ''}" data-action="sleep">
        <svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>Slept 7h+</button>` : '');
  const sub = `${mins} / ${t} min${running ? ' · tracking…' : done ? ' · done ✦' : ''}`;
  return `
  <article class="pillar ${running ? 'running' : done ? 'done' : ''}" style="--c:var(--${p.key})">
    <div class="p-head">
      <div class="p-ic">${p.icon}</div>
      <div class="p-t"><h3>${p.name}</h3><span>${sub}</span></div>
      <div class="p-pts">${points[p.key]}<small> /${max}</small></div>
    </div>
    ${chips ? `<div class="chips">${chips}</div>` : ''}
    <div class="min">
      <button class="tbtn ${running ? 'stop' : ''}" data-action="timer" data-pillar="${p.key}">
        ${running ? '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>'
                  : '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>'}
      </button>
      <div class="bar"><i style="width:${pct}%"></i></div>
      ${running
        ? `<span class="mlabel"><span class="live"><i></i><span data-elapsed>00:00</span></span> · ${mins}/${t}</span>`
        : `<button class="mlabel" data-action="editmin" data-pillar="${p.key}" title="Tap to edit minutes">${mins}/${t}</button>`}
    </div>
    <input class="note" data-note="${p.key}" placeholder="What did you do? (optional)" value="${esc(day.notes[p.key])}">
    ${running ? `<label class="share-note"><input type="checkbox" data-action="sharenote" data-pillar="${p.key}" ${shareNote[p.key] ? 'checked' : ''}> Share note with friends</label>` : ''}
  </article>`;
}

function daysLeftText(deadline) {
  if (!deadline) return '';
  const diff = Math.ceil((new Date(deadline + 'T00:00:00') - new Date(today + 'T00:00:00')) / 86400000);
  return diff >= 0 ? ` · ${diff} days left` : ' · overdue';
}

function trackNowHtml() {
  const p = PILLARS.find(x => x.key === timer.pillar);
  return `<button class="tracknow" style="--c:var(--${p.key})" data-action="timer" data-pillar="${p.key}">
    <span class="live"><i></i><span data-elapsed>00:00</span></span> ${p.icon} ${p.name} <em>· tap to stop</em>
  </button>`;
}

function renderNavTimer() {
  const el = $('#navtimer');
  if (!timer) { el.innerHTML = ''; return; }
  const p = PILLARS.find(x => x.key === timer.pillar);
  el.innerHTML = `<button class="navtimer-card" style="--c:var(--${p.key})" data-action="timer" data-pillar="${p.key}">
    <span class="live"><i></i><span data-elapsed>00:00</span></span>
    <b>${p.icon} ${p.name}</b><span>TRACKING · CLICK TO STOP</span></button>`;
}

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

async function friendsNowHtml() {
  const rows = await db.getFriendLiveStatuses();
  const active = rows.filter(r => r.is_tracking);
  if (!active.length) return '';
  return `<section class="card friends-now"><h2>Friends now</h2>
    ${active.map(r => {
      const p = PILLARS.find(x => x.key === r.pillar);
      const tags = (r.tag_ids || []).map(id => tagLabel(r.pillar, id)).join(', ');
      const note = r.shared_note ? ` - ${esc(r.shared_note)}` : '';
      return `<div class="friend-row" style="--c:var(--${p?.key || 'green'})"><i></i><b>${esc(r.profiles?.display_name || 'Friend')}</b><span>${esc(p?.name || r.pillar)}${tags ? ` · ${esc(tags)}` : ''}${note}</span></div>`;
    }).join('')}</section>`;
}

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

async function renderToday() {
  const rows = await db.getDays(S.addDays(today, -60), S.prevDate(today));
  const scoreByDate = {}, pointsByDate = {};
  for (const r of rows) { scoreByDate[r.date] = r.score; pointsByDate[r.date] = r.data.points || {}; }

  const points = S.dayPoints(day, targets);
  const score = S.dayScore(points);
  const status = S.dayStatus(score);
  scoreByDate[today] = score;
  await syncRecovery(scoreByDate);
  const forgiven = S.forgivenSet(recovery.history, scoreByDate);
  const stk = S.streak(scoreByDate, today, forgiven);
  const best = S.bestStreak(scoreByDate, forgiven);
  const marker = recoveryMarker(scoreByDate, forgiven);
  const alert = S.balanceAlert(pointsByDate, S.prevDate(today));
  const monthScores = rows.filter(r => r.date.slice(0, 7) === today.slice(0, 7)).map(r => r.score).concat(score);
  const monthAvg = Math.round(monthScores.reduce((a, b) => a + b, 0) / monthScores.length);
  const statusLabel = { green: 'Green Day', yellow: 'Yellow Day', red: 'Red Day' }[status];
  const friendsHtml = await friendsNowHtml();

  const missionHtml = mission && mission.title ? `
    <section class="mission">
      <div class="m-top"><span class="m-label">🎯 CURRENT MISSION</span>
        <span class="m-deadline">${esc(mission.deadline)}${daysLeftText(mission.deadline)}</span></div>
      <h2>${esc(mission.title)}</h2>
      <div class="m-bar"><i style="width:${mission.progress || 0}%"></i></div>
      <div class="m-foot"><span>Progress</span><b>${mission.progress || 0}%</b></div>
    </section>` : '';

  $('#view').innerHTML = `
    <div class="headrow">
      <div><h1>Today</h1><p>${fmtLongDate(today)}</p></div>
      <div class="streak">🔥 ${stk}${marker} <small>DAYS</small></div>
    </div>
    ${missionHtml}
    ${friendsHtml}
    <section class="hero">
      <div class="ringwrap">
        <div class="ring" style="--p:${score};--rc:var(--${status})"></div>
        <div><div class="rn">${score}</div><div class="rs">/ 100</div></div>
      </div>
      <div class="hero-r">
        <span class="pill ${status}"><i></i>${statusLabel}</span>
        <span class="stat-line">Month average <b>${monthAvg}</b></span>
        <span class="stat-line">Best streak <b>${best} days</b></span>
      </div>
    </section>
    <section class="win">🏆
      <div><label>BIGGEST WIN TODAY</label>
        <input id="winput" placeholder="What are you most proud of today?" value="${esc(day.win)}"></div>
    </section>
    ${recovery.active ? recoveryBannerHtml(recovery.active) : ''}
    ${alert ? `<div class="alert">⚠️ ${pillarName(alert.pillar)} below target — ${alert.days} days in a row</div>` : ''}
    <div class="pillars">
      ${PILLARS.map(p => pillarCard(p, points)).join('')}
      <article class="pillar refl" style="--c:var(--refl)">
        <div class="p-head">
          <div class="p-ic">🌱</div>
          <div class="p-t"><h3>Reflection</h3><span>2 questions before bed</span></div>
          <div class="p-pts">${points.refl}<small> /5</small></div>
        </div>
        <div class="refl-qs">
          <div><label>What went wrong?</label>
            <textarea data-reflect="wrong" rows="2">${esc(day.reflect.wrong)}</textarea></div>
          <div><label>One thing for tomorrow?</label>
            <textarea data-reflect="tomorrow" rows="2">${esc(day.reflect.tomorrow)}</textarea></div>
        </div>
      </article>
    </div>
    ${timer ? trackNowHtml() : ''}`;
  renderNavTimer();
}

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
      ? `<button class="tl-badge" style="left:${checkpoint.left}%;--c:var(--${p.key})" title="${checkpointMessage(checkpoint.time)}" data-action="checkpoint" data-checkpoint="${checkpoint.time}">✓</button>`
      : '';
    const manual = Math.max(0, (dayData.minutes?.[p.key] || 0) - totalSessionMinutes(laneSessions));
    return `<div class="tl-row"><b style="color:var(--${p.key})">${p.icon} ${p.name}</b><div class="tl-lane">${bars}${badge}</div>${manual ? `<em>+${manual}m manual</em>` : ''}</div>`;
  }).join('');
  return `<div class="timeline">${tickHtml}${rows}</div>`;
}

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

async function renderDayDetail(date) {
  const row = await db.getDay(date);
  const data = row ? { ...emptyDay(), ...row.data } : emptyDay();
  const sessions = await db.getActivitySessions(date);
  const points = S.dayPoints(data, targets);
  const score = row?.score ?? S.dayScore(points);
  const status = S.dayStatus(score);
  const totalMins = Object.values(data.minutes || {}).reduce((a, b) => a + (Number(b) || 0), 0);
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
    </section>
    ${timer ? trackNowHtml() : ''}`;
  renderNavTimer();
}

// ---- per-second tick: live clocks + midnight rollover ----
function tick() {
  const now = S.toDateStr(new Date());
  if (now !== today) {
    clearTimeout(saveDebounce); // a pending save must not fire into the new day's row
    today = now;
    loadToday().then(render).catch(e => { showError(e); console.error(e); });
    return;
  }
  if (timer) {
    const txt = S.fmtElapsed(timer.started_at, Date.now());
    document.querySelectorAll('[data-elapsed]').forEach(el => { el.textContent = txt; });
  }
  document.querySelectorAll('[data-countdown]').forEach(el => {
    el.textContent = S.fmtCountdown(Number(el.dataset.countdown), Date.now());
  });
  // when the window runs out while the user is on Today, re-render to resolve it (failure modal)
  if (route().name === 'today' && !recoveryBusy && recovery.active &&
      Date.now() >= S.recoveryWindowEndMs(recovery.active.broken_date)) {
    recoveryBusy = true;
    render().catch(e => { showError(e); console.error(e); }).finally(() => { recoveryBusy = false; });
  }
}

// ---- events (delegated on body: views are re-rendered, listeners are not) ----

document.body.addEventListener('click', async ev => {
  const btn = ev.target.closest('[data-action]');
  if (!btn) return;
  const a = btn.dataset.action;
  try {
    if (a === 'tag') {
      const { pillar, id } = btn.dataset;
      const arr = day.tags[pillar] || (day.tags[pillar] = []);
      const i = arr.indexOf(id);
      i >= 0 ? arr.splice(i, 1) : arr.push(id);
      await saveToday();
      if (timer?.pillar === pillar) await publishLiveStatus();
      await render();
    } else if (a === 'sleep') {
      day.sleep_ok = !day.sleep_ok;
      await saveToday(); await render();
    } else if (a === 'editmin') {
      const p = btn.dataset.pillar;
      const v = prompt(`Minutes for ${pillarName(p)} today:`, day.minutes[p] || 0);
      if (v === null) return;
      const n = parseInt(v, 10);
      if (Number.isNaN(n) || n < 0) return;
      day.minutes[p] = n;
      await saveToday(); await render();
    } else if (a === 'sharenote') {
      const p = btn.dataset.pillar;
      shareNote[p] = !shareNote[p];
      if (timer?.pillar === p) {
        timer = { ...timer, share_note: !!shareNote[p] };
        await db.setState('timer', timer);
        await publishLiveStatus();
      }
      await render();
    } else if (a === 'timer') {
      await toggleTimer(btn.dataset.pillar);
    } else if (a === 'checkpoint') {
      alert(checkpointMessage(btn.dataset.checkpoint));
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
      const totals = PILLARS.map(p => `${p.name}: ${fmtHours(data.minutes?.[p.key] || 0)}`).join('\n');
      await navigator.clipboard.writeText(`Momentum ${date}\nScore: ${row?.score ?? 0}\n${totals}`);
    } else if (a === 'weeknav') {
      weekOffset += Number(btn.dataset.dir); await render();
    } else if (a === 'monthnav') {
      monthOffset += Number(btn.dataset.dir); await render();
    } else if (a === 'export') {
      const dump = await db.getAllForExport();
      const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `momentum-backup-${today}.json`;
      link.click();
      URL.revokeObjectURL(link.href);
    } else if (a === 'logout') {
      await db.signOut(); location.reload();
    } else if (a === 'closemodal') {
      $('#modal').classList.add('hidden');
    }
  } catch (e) { showError(e); throw e; }
});

document.body.addEventListener('input', ev => {
  const t = ev.target;
  if (t.id === 'winput') { day.win = t.value; queueSave(); }
  else if (t.dataset.note !== undefined) {
    day.notes[t.dataset.note] = t.value; queueSave();
    if (timer?.pillar === t.dataset.note && shareNote[t.dataset.note]) {
      publishLiveStatus().catch(e => { showError(e); console.error(e); });
    }
  }
  else if (t.dataset.reflect !== undefined) { day.reflect[t.dataset.reflect] = t.value; queueSave(); }
  else if (t.id === 'm-progress') { $('#m-pct').textContent = t.value + '%'; }
});

// after a text field loses focus, re-render so points/score refresh (not while typing)
document.body.addEventListener('change', async ev => {
  const t = ev.target;
  try {
    if (t.id === 'detail-win' || t.dataset.detailNote !== undefined || t.dataset.detailReflect !== undefined) {
      const date = t.dataset.detailDate;
      const row = await db.getDay(date);
      const data = row ? { ...emptyDay(), ...row.data } : emptyDay();
      if (t.id === 'detail-win') data.win = t.value;
      else if (t.dataset.detailNote !== undefined) data.notes[t.dataset.detailNote] = t.value;
      else data.reflect[t.dataset.detailReflect] = t.value;
      await saveDayData(date, data);
      day = syncCurrentDayState(today, day, date, data);
    } else if (t.id === 'display-name') {
      await db.upsertProfile(t.value.trim() || 'Momentum User');
      profile = await db.getProfile();
    } else if (t.id === 'winput' || t.dataset.note !== undefined || t.dataset.reflect !== undefined) {
      await render();
    } else if (t.dataset.target !== undefined) {
      const n = parseInt(t.value, 10);
      if (Number.isNaN(n) || n < 1) { t.value = targets[t.dataset.target]; return; }
      targets[t.dataset.target] = n;
      await db.setState('targets', targets);
      await saveToday(); // re-score today against the new target
    } else if (['m-title', 'm-deadline', 'm-progress'].includes(t.id)) {
      mission = {
        title: $('#m-title').value.trim(),
        deadline: $('#m-deadline').value,
        progress: Number($('#m-progress').value),
      };
      await db.setState('mission', mission);
    }
  } catch (e) { showError(e); throw e; }
});

boot().catch(e => { showError(e); console.error('boot failed', e); });
