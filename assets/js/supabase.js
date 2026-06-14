// ============================================================
// GASTOS — Supabase Client
// Replace SUPABASE_URL and SUPABASE_ANON_KEY with your values
// from: https://supabase.com/dashboard/project/_/settings/api
// ============================================================

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// 🔧 CONFIGURE THESE VALUES
const SUPABASE_URL  = 'https://tdpabktyawspqzvbyier.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRkcGFia3R5YXdzcHF6dmJ5aWVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzNzE1NzIsImV4cCI6MjA5Njk0NzU3Mn0.SZ9yIpDRbdkbA5l4kUJxnS18Fjn4YzlqBW7TZkiKZoM';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

// ============================================================
// SESSION HELPERS
// ============================================================

/**
 * Get the current authenticated user + profile.
 * Redirects to index.html if not authenticated.
 */
export async function requireAuth() {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session) {
    window.location.href = '/expense-tracker/index.html';
    return null;
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('*, household:households(*)')
    .eq('id', session.user.id)
    .single();

  return { user: session.user, profile };
}

/**
 * Redirect to dashboard if already logged in.
 */
export async function redirectIfAuthed() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) window.location.href = '/expense-tracker/dashboard.html';
}

/**
 * Sign out and redirect to login.
 */
export async function signOut() {
  await supabase.auth.signOut();
  window.location.href = '/expense-tracker/index.html';
}

/**
 * Format a number as Philippine Peso.
 */
export function formatPHP(amount) {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    minimumFractionDigits: 2,
  }).format(amount ?? 0);
}

/**
 * Format a date string as Filipino-style short date.
 */
export function formatDate(dateStr) {
  if (!dateStr) return '—';
  return new Intl.DateTimeFormat('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(dateStr));
}

/**
 * Get current month string YYYY-MM.
 */
export function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Get first and last day of a YYYY-MM month string.
 */
export function monthBounds(monthStr) {
  const [year, month] = monthStr.split('-').map(Number);
  const start = new Date(year, month - 1, 1).toISOString().split('T')[0];
  const end   = new Date(year, month, 0).toISOString().split('T')[0];
  return { start, end };
}

/**
 * Get days until a date. Negative = overdue.
 */
export function daysUntil(dateStr) {
  const today = new Date(); today.setHours(0,0,0,0);
  const target = new Date(dateStr); target.setHours(0,0,0,0);
  return Math.round((target - today) / (1000 * 60 * 60 * 24));
}

export { SUPABASE_URL, SUPABASE_ANON_KEY };
