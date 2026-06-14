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
