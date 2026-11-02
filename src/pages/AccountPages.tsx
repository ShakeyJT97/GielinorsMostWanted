import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Notice, Sheet } from '../components/ui';
import { useAuth } from '../lib/auth';
import { errorMessage, supabase } from '../lib/supabase';

/** First sign-in: pick the RuneScape display name shown on the board. */
export function WelcomePage() {
  const { session, profile, refreshProfile } = useAuth();
  const [name, setName] = useState(profile?.rs_name ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  if (!session) return <Navigate to="/login" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const { error } = await supabase.rpc('set_display_name', { p_name: name });
    setBusy(false);
    if (error) { setError(errorMessage(error)); return; }
    refreshProfile();
    nav('/');
  }

  return (
    <Sheet className="mx-auto max-w-md">
      <h1 className="font-display text-3xl text-ink">{profile?.rs_name ? 'Change your name' : 'Who goes there?'}</h1>
      <p className="mt-2">Enter your RuneScape name exactly as it appears in game. Admins check it against your screenshots. You'll use this name to sign in.</p>
      <form onSubmit={onSubmit} className="mt-5 space-y-4">
        <div>
          <label className="label" htmlFor="rsname">RuneScape display name</label>
          <input id="rsname" className="field" required maxLength={12} value={name} onChange={(e) => setName(e.target.value)} autoComplete="nickname" />
          <p className="hint">Up to 12 letters, numbers, spaces, hyphens or underscores.</p>
        </div>
        {error && <Notice tone="error">{error}</Notice>}
        <button className="btn btn-wax w-full" disabled={busy}>Save name</button>
      </form>
    </Sheet>
  );
}
