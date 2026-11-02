const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

export const fmtDateTime = (iso: string | null | undefined) => (iso ? dateFmt.format(new Date(iso)) : '—');
export const fmtDay = (iso: string | null | undefined) => (iso ? dayFmt.format(new Date(iso)) : '—');

export function timeLeft(endIso: string, now = Date.now()): string {
  const ms = new Date(endIso).getTime() - now;
  if (ms <= 0) return 'ended';
  const h = Math.floor(ms / 3_600_000);
  const d = Math.floor(h / 24);
  if (d >= 1) return `${d} day${d === 1 ? '' : 's'} ${h % 24} h left`;
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h} h ${m} min left`;
}

/** Convert an ISO timestamp to the value a datetime-local input expects (local time). */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const fromLocalInput = (v: string) => new Date(v).toISOString();

/** "3 min ago", "2 h ago", "yesterday", or a date. */
export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  if (s < 172_800) return 'yesterday';
  return fmtDay(iso);
}

export function duration(seconds: number): string {
  const d = Math.floor(seconds / 86_400), h = Math.floor((seconds % 86_400) / 3600), m = Math.floor((seconds % 3600) / 60);
  if (d) return `${d} day${d === 1 ? '' : 's'} ${h} h`;
  if (h) return `${h} h ${m} min`;
  return `${Math.max(1, m)} min`;
}
