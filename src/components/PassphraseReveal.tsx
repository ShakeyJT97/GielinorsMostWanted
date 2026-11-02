import { useState } from 'react';

/** Shows a passphrase once, with a copy button. */
export function PassphraseReveal({ passphrase, label }: { passphrase: string; label: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(passphrase); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* select instead */ }
  }
  return (
    <div className="rounded border-2 border-dashed border-ink/40 bg-parchment-50/80 p-3">
      <p className="text-sm text-ink-soft">{label}</p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <input aria-label={label} readOnly value={passphrase} onFocus={(e) => e.target.select()}
          className="min-w-0 flex-1 bg-transparent font-sc text-lg font-bold text-ink focus:outline-none" />
        <button type="button" className="btn btn-sm btn-ink" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
    </div>
  );
}
