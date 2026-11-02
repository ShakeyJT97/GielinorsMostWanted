import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured = Boolean(url && anonKey);

export const supabase = createClient(url ?? 'http://localhost', anonKey ?? 'missing', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export const EVIDENCE_BUCKET = 'evidence';

/** Supabase/Postgres errors carry the message raised by our SQL functions. */
export function errorMessage(err: unknown): string {
  if (!err) return 'Something went wrong';
  if (typeof err === 'string') return err;
  const e = err as { message?: string; error_description?: string };
  return e.message ?? e.error_description ?? 'Something went wrong';
}

/** Throw on a Supabase error so React Query sees it. */
export function must<T>(res: { data: T; error: unknown }): T {
  if (res.error) throw new Error(errorMessage(res.error));
  return res.data;
}

/**
 * A throwaway client that never stores a session. Admins use it to create an account for a
 * Discord-only player without signing themselves out of their own session.
 */
export function isolatedClient() {
  return createClient(url ?? 'http://localhost', anonKey ?? 'missing', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'gmw-admin-create' },
  });
}
