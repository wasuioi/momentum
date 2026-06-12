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

// view stubs — replaced one by one in Tasks 11, 13, 14, 15
async function renderToday() { $('#view').innerHTML = '<p class="loading">Today</p>'; }
async function renderWeek() { $('#view').innerHTML = '<p class="loading">Week</p>'; }
async function renderMonth() { $('#view').innerHTML = '<p class="loading">Month</p>'; }
async function renderSettings() { $('#view').innerHTML = '<p class="loading">Settings</p>'; }
async function toggleTimer() {} // implemented in Task 12

// ---- per-second tick: live clocks + midnight rollover ----
function tick() {
  const now = S.toDateStr(new Date());
  if (now !== today) { today = now; loadToday().then(render); return; }
  if (timer) {
    const txt = S.fmtElapsed(timer.started_at, Date.now());
    document.querySelectorAll('[data-elapsed]').forEach(el => { el.textContent = txt; });
  }
}

boot();
