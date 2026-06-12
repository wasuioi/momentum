// Supabase access layer. Every function throws on error — callers decide
// how to surface it (error banner). Never swallow.

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export async function getSession() {
  const { data, error } = await sb.auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function signIn(email, password) {
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signOut() {
  const { error } = await sb.auth.signOut();
  if (error) throw error;
}

export async function getDay(date) {
  const { data, error } = await sb.from('days').select('*').eq('date', date).maybeSingle();
  if (error) throw error;
  return data; // row or null
}

export async function getDays(from, to) {
  const { data, error } = await sb.from('days')
    .select('*').gte('date', from).lte('date', to).order('date');
  if (error) throw error;
  return data;
}

export async function saveDay(date, dayData, score) {
  const { error } = await sb.from('days')
    .upsert({ date, data: dayData, score, updated_at: new Date().toISOString() });
  if (error) throw error;
}

export async function getState(key, fallback) {
  const { data, error } = await sb.from('app_state').select('value').eq('key', key).maybeSingle();
  if (error) throw error;
  return data && data.value !== null ? data.value : fallback;
}

export async function setState(key, value) {
  const { error } = await sb.from('app_state').upsert({ key, value });
  if (error) throw error;
}

export async function getAllForExport() {
  const days = await getDays('2000-01-01', '2999-12-31');
  const { data: app_state, error } = await sb.from('app_state').select('*');
  if (error) throw error;
  return { exported_at: new Date().toISOString(), days, app_state };
}
