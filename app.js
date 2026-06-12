// App bootstrap, routing, rendering. Views are template strings rendered into
// #view; interactions use event delegation via data-action attributes.

import * as S from './score.js';
import * as db from './db.js';

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
let timer = null;               // {pillar, started_at} | null
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

function fmtLongDate(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

// ---- error banner: failures are shown, retriable, and rethrown — never swallowed ----
let lastFailed = null;
function showError(e) { $('#errmsg').textContent = e.message || String(e); $('#err').classList.remove('hidden'); console.error(e); }
function hideError() { $('#err').classList.add('hidden'); }
$('#retry').addEventListener('click', () => { if (lastFailed) lastFailed(); });

// ---- saving today's row ----
let saveDebounce = null;
function queueSave() { clearTimeout(saveDebounce); saveDebounce = setTimeout(saveToday, 800); }
async function saveToday() {
  day.points = S.dayPoints(day, targets);
  try { await db.saveDay(today, day, S.dayScore(day.points)); hideError(); }
  catch (e) { lastFailed = saveToday; showError(e); throw e; }
}

// ---- boot ----
async function boot() {
  const session = await db.getSession();
  if (!session) { $('#login').classList.remove('hidden'); $('#view').innerHTML = ''; return; }
  targets = await db.getState('targets', { ...S.DEFAULT_TARGETS });
  mission = await db.getState('mission', null);
  timer = await db.getState('timer', null);
  await loadToday();
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
function route() { return location.hash.replace('#', '') || 'today'; }
async function render() {
  const r = route();
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('on', a.getAttribute('href') === '#' + r));
  try {
    if (r === 'week') await renderWeek();
    else if (r === 'month') await renderMonth();
    else if (r === 'settings') await renderSettings();
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
  const rows = await db.getDays(S.addDays(monday, -60), dates[6]);
  const byDate = {}; for (const r of rows) byDate[r.date] = r;
  const names = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

  const dots = dates.map((d, i) => {
    const r = byDate[d];
    const cls = r ? S.dayStatus(r.score) : 'off';
    return `<div class="day7"><em>${names[i]}</em>
      <div class="dot ${cls} ${d === today ? 'today' : ''}">${r ? r.score : '·'}</div></div>`;
  }).join('');

  const weekRows = dates.filter(d => byDate[d]).map(d => byDate[d]);
  const avg = weekRows.length ? Math.round(weekRows.reduce((a, r) => a + r.score, 0) / weekRows.length) : 0;
  const greens = weekRows.filter(r => r.score >= 80).length;
  const scoreByDate = {}; for (const r of rows) scoreByDate[r.date] = r.score;
  const stk = S.streak(scoreByDate, today);

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
      <div class="stat3"><b>🔥 ${stk}</b><span>STREAK</span></div>
    </div>
    <section class="card"><h2>Hours by pillar</h2>${bars}</section>
    <section class="card"><h2>Insight</h2><div class="insight">✨<p>${insight}</p></div></section>
    ${timer ? trackNowHtml() : ''}`;
  renderNavTimer();
}

async function renderMonth() { $('#view').innerHTML = '<p class="loading">Month</p>'; }
async function renderSettings() { $('#view').innerHTML = '<p class="loading">Settings</p>'; }
async function toggleTimer(pillar) {
  if (timer && timer.pillar === pillar) { await stopTimer(); await render(); return; }
  if (timer) await stopTimer(); // switching pillars: bank the old one first
  timer = { pillar, started_at: new Date().toISOString() };
  await db.setState('timer', timer);
  await render();
}

async function stopTimer() {
  if (!timer) return;
  const t = timer; timer = null;
  await db.setState('timer', null);
  const mins = S.elapsedMinutes(t.started_at, Date.now());
  if (mins <= 0) return; // under a minute: nothing to bank
  const startDate = S.toDateStr(new Date(Date.parse(t.started_at)));
  if (startDate === today) {
    day.minutes[t.pillar] = (day.minutes[t.pillar] || 0) + mins;
    await saveToday();
  } else {
    // timer crossed midnight: credit the day it was started (spec §4)
    try {
      const row = await db.getDay(startDate);
      const d = row ? { ...emptyDay(), ...row.data } : emptyDay();
      d.minutes[t.pillar] = (d.minutes[t.pillar] || 0) + mins;
      d.points = S.dayPoints(d, targets);
      await db.saveDay(startDate, d, S.dayScore(d.points));
    } catch (e) { showError(e); throw e; }
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

async function renderToday() {
  const rows = await db.getDays(S.addDays(today, -60), S.prevDate(today));
  const scoreByDate = {}, pointsByDate = {};
  for (const r of rows) { scoreByDate[r.date] = r.score; pointsByDate[r.date] = r.data.points || {}; }

  const points = S.dayPoints(day, targets);
  const score = S.dayScore(points);
  const status = S.dayStatus(score);
  scoreByDate[today] = score;
  const stk = S.streak(scoreByDate, today);
  const best = S.bestStreak(scoreByDate);
  const alert = S.balanceAlert(pointsByDate, S.prevDate(today));
  const monthScores = rows.filter(r => r.date.slice(0, 7) === today.slice(0, 7)).map(r => r.score).concat(score);
  const monthAvg = Math.round(monthScores.reduce((a, b) => a + b, 0) / monthScores.length);
  const statusLabel = { green: 'Green Day', yellow: 'Yellow Day', red: 'Red Day' }[status];

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
      <div class="streak">🔥 ${stk} <small>DAYS</small></div>
    </div>
    ${missionHtml}
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

// ---- per-second tick: live clocks + midnight rollover ----
function tick() {
  const now = S.toDateStr(new Date());
  if (now !== today) { today = now; loadToday().then(render); return; }
  if (timer) {
    const txt = S.fmtElapsed(timer.started_at, Date.now());
    document.querySelectorAll('[data-elapsed]').forEach(el => { el.textContent = txt; });
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
      await saveToday(); await render();
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
    } else if (a === 'timer') {
      await toggleTimer(btn.dataset.pillar);
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
    }
  } catch (e) { showError(e); throw e; }
});

document.body.addEventListener('input', ev => {
  const t = ev.target;
  if (t.id === 'winput') { day.win = t.value; queueSave(); }
  else if (t.dataset.note !== undefined) { day.notes[t.dataset.note] = t.value; queueSave(); }
  else if (t.dataset.reflect !== undefined) { day.reflect[t.dataset.reflect] = t.value; queueSave(); }
  else if (t.id === 'm-progress') { $('#m-pct').textContent = t.value + '%'; }
});

// after a text field loses focus, re-render so points/score refresh (not while typing)
document.body.addEventListener('change', ev => {
  const t = ev.target;
  if (t.id === 'winput' || t.dataset.note !== undefined || t.dataset.reflect !== undefined) render();
});

boot();
