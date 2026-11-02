import { useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Notice, Sheet } from '../components/ui';
import { useAuth } from '../lib/auth';
import { errorMessage, supabase } from '../lib/supabase';
import { generatePassphrase, newLoginEmail, normalisePassphrase } from '../lib/passphrase';

type Mode = 'signin' | 'join';

export default function LoginPage() {
  const { session } = useAuth();
  const [mode, setMode] = useState<Mode>('signin');
  if (session) return <Navigate to="/" replace />;

  return (
    <Sheet className="mx-auto max-w-md">
      <div className="mb-5 grid grid-cols-2 gap-1 rounded bg-ink/10 p-1" role="tablist" aria-label="Sign in or join">
        {(['signin', 'join'] as const).map((m) => (
          <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
            className={`rounded px-3 py-1.5 font-sc font-bold ${mode === m ? 'bg-parchment-50 shadow' : 'text-ink-soft hover:text-ink'}`}>
            {m === 'signin' ? 'Sign in' : 'Join the hunt'}
          </button>
        ))}
      </div>
      {mode === 'signin' ? <SignIn onJoin={() => setMode('join')} /> : <Join />}
      <p className="mt-6 border-t border-ink/20 pt-4 text-sm text-ink-soft">
        No email, Discord or RuneScape password needed. The site only knows your RuneScape name.
        Just looking? <Link to="/">Browse the board</Link> without an account.
      </p>
    </Sheet>
  );
}

function SignIn({ onJoin }: { onJoin: () => void }) {
  const [name, setName] = useState('');
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const { data: email, error: lookupErr } = await supabase.rpc('login_email_for', { p_name: name });
      if (lookupErr) throw lookupErr;
      if (!email) { setError('No hunter is registered with that name. Check the spelling, or join the hunt.'); return; }
      const { error } = await supabase.auth.signInWithPassword({ email: email as string, password: normalisePassphrase(pass) });
      if (error) {
        setError(/invalid login credentials/i.test(error.message)
          ? 'That passphrase doesn\'t match. Check it against the copy you saved, or ask an event admin to reset it.'
          : errorMessage(error));
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <h1 className="font-display text-3xl text-ink">Welcome back</h1>
      <div>
        <label className="label" htmlFor="si-name">RuneScape name</label>
        <input id="si-name" name="username" className="field" required maxLength={12} autoComplete="username"
          value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <label className="label" htmlFor="si-pass">Passphrase</label>
        <input id="si-pass" name="password" className="field" type="password" required autoComplete="current-password"
          placeholder="e.g. ember-goblin-lantern-harbour-42" value={pass} onChange={(e) => setPass(e.target.value)} />
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <button className="btn btn-wax w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      <p className="text-sm">
        New here? <button type="button" className="underline" onClick={onJoin}>Join the hunt</button>.
        Lost your passphrase? Ask an event admin to reset it.
      </p>
    </form>
  );
}

function Join() {
  const needsCode = useQuery({
    queryKey: ['signup-needs-code'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('signup_needs_code');
      if (error) throw error;
      return Boolean(data);
    },
  });
  const [step, setStep] = useState<'details' | 'passphrase'>('details');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [pass, setPass] = useState(generatePassphrase);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function checkDetails(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const { data, error } = await supabase.rpc('check_signup', { p_name: name, p_code: code || null });
    setBusy(false);
    if (error) { setError(errorMessage(error)); return; }
    if (data) { setError(data as string); return; }
    setStep('passphrase');
  }

  async function copy() {
    try { await navigator.clipboard.writeText(pass); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* user can select it */ }
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const { data, error } = await supabase.auth.signUp({
      email: newLoginEmail(),
      password: pass,
      options: { data: { rs_name: name.trim(), join_code: code.trim() || null } },
    });
    setBusy(false);
    if (error) {
      // The database rejects the sign-up if the name was taken in the meantime or the code changed
      const again = await supabase.rpc('check_signup', { p_name: name, p_code: code || null });
      setError((again.data as string | null) ?? errorMessage(error));
      return;
    }
    if (!data.session) {
      setError('Your account was made, but the site couldn\'t sign you in. An admin needs to turn off "Confirm email" in Supabase (see the README).');
    }
    // On success the auth listener signs them in and this page redirects to the board
  }

  if (step === 'details') {
    return (
      <form onSubmit={checkDetails} className="space-y-4">
        <h1 className="font-display text-3xl text-ink">Join the hunt</h1>
        <div>
          <label className="label" htmlFor="j-name">RuneScape name</label>
          <input id="j-name" className="field" required maxLength={12} autoComplete="nickname"
            value={name} onChange={(e) => setName(e.target.value)} />
          <p className="hint">Exactly as it appears in game. Admins check it against your screenshots.</p>
        </div>
        {needsCode.data && (
          <div>
            <label className="label" htmlFor="j-code">Clan join code</label>
            <input id="j-code" className="field" required autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} />
            <p className="hint">Ask in clan chat or Discord.</p>
          </div>
        )}
        {error && <Notice tone="error">{error}</Notice>}
        <button className="btn btn-wax w-full" disabled={busy}>Continue</button>
      </form>
    );
  }

  return (
    <form onSubmit={create} className="space-y-4">
      <h1 className="font-display text-3xl text-ink">Your passphrase</h1>
      <p>This is how you'll sign in as <strong className="font-sc">{name.trim()}</strong>. Save it somewhere safe: a password manager, a note on your phone, or paper.</p>

      {/* Hidden username lets password managers save the pair */}
      <input type="text" name="username" autoComplete="username" value={name.trim()} readOnly hidden />
      <div className="rounded border-2 border-dashed border-ink/40 bg-parchment-50/80 p-4 text-center">
        <input aria-label="Your passphrase" name="password" autoComplete="new-password" readOnly value={pass}
          onFocus={(e) => e.target.select()}
          className="w-full bg-transparent text-center font-sc text-xl font-bold tracking-wide text-ink focus:outline-none" />
        <div className="mt-3 flex justify-center gap-2">
          <button type="button" className="btn btn-sm btn-ink" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setPass(generatePassphrase()); setSaved(false); }}>Give me another</button>
        </div>
      </div>
      <p className="text-sm text-ink-soft">There's no email to recover it with. If you lose it, an event admin can give you a new one.</p>

      <label className="flex items-start gap-2">
        <input type="checkbox" className="mt-1 h-4 w-4 accent-[#8e1f1f]" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        <span>I've saved my passphrase</span>
      </label>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex gap-2">
        <button type="button" className="btn btn-ghost" onClick={() => { setStep('details'); setError(null); }}>Back</button>
        <button className="btn btn-wax flex-1" disabled={!saved || busy}>{busy ? 'Creating account…' : 'Create account'}</button>
      </div>
    </form>
  );
}
