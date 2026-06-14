// Supabase access layer. Every function throws on error — callers decide
// how to surface it (error banner). Never swallow.

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.1/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let cachedUserId = null;

sb.auth.onAuthStateChange((_event, session) => {
  cachedUserId = session?.user?.id ?? null;
});

export async function requireUserId() {
  if (cachedUserId) return cachedUserId;
  const session = await getSession();
  if (!session?.user?.id) throw new Error('Not signed in');
  cachedUserId = session.user.id;
  return cachedUserId;
}

export async function getSession() {
  const { data, error } = await sb.auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function signIn(email, password) {
  cachedUserId = null;
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  cachedUserId = data.user?.id ?? data.session?.user?.id ?? null;
}

export async function signOut() {
  cachedUserId = null;
  const { error } = await sb.auth.signOut();
  if (error) throw error;
}

export async function getDay(date) {
  const userId = await requireUserId();
  const { data, error } = await sb.from('days')
    .select('*').eq('user_id', userId).eq('date', date).maybeSingle();
  if (error) throw error;
  return data; // row or null
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
    .upsert(
      { user_id: userId, date, data: dayData, score, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,date' }
    );
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
  const { error } = await sb.from('app_state')
    .upsert({ user_id: userId, key, value }, { onConflict: 'user_id,key' });
  if (error) throw error;
}

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

export async function upsertProfile(displayName) {
  const userId = await requireUserId();
  const { error } = await sb.from('profiles')
    .upsert({ id: userId, display_name: displayName }, { onConflict: 'id' });
  if (error) throw error;
}

async function ensureProfile() {
  const session = await getSession();
  const userId = await requireUserId();
  const fallbackName = session?.user?.email?.split('@')[0]?.trim() || 'Momentum user';
  const displayName = session?.user?.user_metadata?.display_name?.trim() || fallbackName;
  const { error } = await sb.from('profiles')
    .upsert({ id: userId, display_name: displayName }, { onConflict: 'id', ignoreDuplicates: true });
  if (error) throw error;
}

export async function setLiveStatus(status) {
  await ensureProfile();
  const userId = await requireUserId();
  const { error } = await sb.from('live_status').upsert({
    user_id: userId,
    pillar: status.pillar ?? null,
    tag_ids: status.tag_ids ?? [],
    shared_note: status.shared_note ?? '',
    is_tracking: !!status.is_tracking,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });
  if (error) throw error;
}

export async function getFriendLiveStatuses() {
  const userId = await requireUserId();
  const { data, error } = await sb.from('live_status')
    .select('user_id,pillar,tag_ids,shared_note,is_tracking,updated_at,profiles:user_id(display_name)')
    .eq('is_tracking', true)
    .neq('user_id', userId)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return data;
}

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
