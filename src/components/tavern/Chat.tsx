import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { Notice } from '../ui';
import { useAuth } from '../../lib/auth';
import { errorMessage, supabase } from '../../lib/supabase';
import { ago, fmtDateTime } from '../../lib/format';
import { REACTIONS, type ChatMessage, type PinnedMessage } from '../../lib/types';

const PAGE = 60;
const MAX = 500;
const SEEN_KEY = 'gmw-tavern-seen';

/** Merge a fresh "latest page" into what we already hold: keep older history, drop deleted messages. */
function merge(current: ChatMessage[], latest: ChatMessage[]): ChatMessage[] {
  if (latest.length === 0) return [];
  const floor = latest[0].id;
  const older = latest.length < PAGE ? [] : current.filter((m) => m.id < floor);
  return [...older, ...latest];
}

export function readSeen(): number {
  try { return Number(localStorage.getItem(SEEN_KEY) ?? 0) || 0; } catch { return 0; }
}
export function writeSeen(id: number) {
  try { if (id > readSeen()) localStorage.setItem(SEEN_KEY, String(id)); } catch { /* not saved */ }
}

/** Live Tavern messages: initial load, realtime updates, a 20s safety poll, and older pages on demand. */
export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pinned, setPinned] = useState<PinnedMessage[]>([]);

  const refresh = useCallback(async () => {
    const [{ data, error }, pins] = await Promise.all([
      supabase.rpc('get_chat', { p_before: null, p_limit: PAGE }),
      supabase.rpc('get_pinned'),
    ]);
    if (!pins.error) setPinned((pins.data ?? []) as PinnedMessage[]);
    if (error) { setError(errorMessage(error)); return; }
    const latest = (data ?? []) as ChatMessage[];
    setMessages((cur) => merge(cur, latest));
    setHasOlder((h) => h || latest.length === PAGE);
    setLoaded(true);
  }, []);

  useEffect(() => {
    refresh();
    const channel = supabase
      .channel(`tavern-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_messages' }, () => refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_reactions' }, () => refresh())
      .subscribe();
    const poll = window.setInterval(refresh, 20_000); // also catches deletions
    return () => { supabase.removeChannel(channel); window.clearInterval(poll); };
  }, [refresh]);

  const loadOlder = useCallback(async () => {
    const first = messages[0]?.id;
    if (!first) return [] as ChatMessage[];
    const { data, error } = await supabase.rpc('get_chat', { p_before: first, p_limit: PAGE });
    if (error) { setError(errorMessage(error)); return []; }
    const older = (data ?? []) as ChatMessage[];
    setMessages((cur) => [...older, ...cur]);
    setHasOlder(older.length === PAGE);
    return older;
  }, [messages]);

  const removeLocal = (id: number) => setMessages((cur) => cur.filter((m) => m.id !== id));

  /** Flip my reaction straight away; the server copy arrives with the next refresh. */
  const reactLocal = (id: number, emoji: string) => setMessages((cur) => cur.map((m) => {
    if (m.id !== id) return m;
    const mine = new Set(m.my_reactions ?? []);
    const counts = { ...(m.reactions ?? {}) };
    if (mine.has(emoji)) { mine.delete(emoji); counts[emoji] = (counts[emoji] ?? 1) - 1; if (counts[emoji] <= 0) delete counts[emoji]; }
    else { mine.add(emoji); counts[emoji] = (counts[emoji] ?? 0) + 1; }
    return { ...m, my_reactions: [...mine], reactions: counts };
  }));

  return { messages, pinned, loaded, hasOlder, error, setError, refresh, loadOlder, removeLocal, reactLocal };
}

export type ChatState = ReturnType<typeof useChat>;

/** The message list and composer, used by the Tavern page and the pop-up. */
export function ChatPanel({ chat, heightClass, compact = false, autoFocus = false, onSeen }: {
  chat: ChatState; heightClass: string; compact?: boolean; autoFocus?: boolean; onSeen?: (newestId: number) => void;
}) {
  const { session, profile, isAdmin } = useAuth();
  const { messages, pinned, loaded, hasOlder, error, setError, refresh, loadOlder, removeLocal, reactLocal } = chat;
  const [picker, setPicker] = useState<number | null>(null);   // message id whose emoji picker is open
  const [allPins, setAllPins] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [below, setBelow] = useState(0);            // new messages arrived while scrolled up
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);
  const lastNewest = useRef(0);

  useEffect(() => { if (autoFocus) inputRef.current?.focus(); }, [autoFocus]);
  useEffect(() => {
    if (picker !== null) listRef.current?.querySelector('[data-picker]')?.scrollIntoView({ block: 'nearest' });
  }, [picker]);

  // Stay pinned to the newest message unless the reader scrolled up; count what arrives meanwhile
  useLayoutEffect(() => {
    const el = listRef.current;
    const newest = messages[messages.length - 1]?.id ?? 0;
    if (el && stick.current) {
      el.scrollTop = el.scrollHeight;
      if (newest) onSeen?.(newest);
    } else if (newest > lastNewest.current && lastNewest.current) {
      setBelow((n) => n + messages.filter((m) => m.id > lastNewest.current).length);
    }
    lastNewest.current = newest;
  }, [messages, onSeen]);

  function onScroll() {
    const el = listRef.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (stick.current) {
      setBelow(0);
      const newest = messages[messages.length - 1]?.id;
      if (newest) onSeen?.(newest);
    }
  }

  async function older() {
    const el = listRef.current;
    const before = el ? el.scrollHeight - el.scrollTop : 0;
    stick.current = false;
    await loadOlder();
    requestAnimationFrame(() => { if (el) el.scrollTop = el.scrollHeight - before; });
  }

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    setSending(true); setError(null); setInfo(null);
    const { error } = await supabase.rpc('post_chat', { p_body: body });
    setSending(false);
    if (error) { setError(errorMessage(error)); return; }
    setText('');
    stick.current = true;
    refresh();
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }

  async function remove(m: ChatMessage) {
    if (!window.confirm(m.player_id === session?.user.id ? 'Delete your message?' : `Delete ${m.rs_name}'s message?`)) return;
    const { error } = await supabase.rpc('delete_chat', { p_id: m.id });
    if (error) setError(errorMessage(error)); else removeLocal(m.id);
  }

  async function mute(m: ChatMessage) {
    if (!window.confirm(`Mute ${m.rs_name}? They can still play, but can't post in the Tavern until you unmute them in Admin → Players.`)) return;
    const { error } = await supabase.rpc('set_player_muted', { p_player: m.player_id, p_muted: true });
    setError(error ? errorMessage(error) : null);
    setInfo(error ? null : `${m.rs_name} is muted. Unmute them in Admin → Players.`);
  }

  async function react(m: ChatMessage, emoji: string) {
    setPicker(null);
    reactLocal(m.id, emoji);
    const { error } = await supabase.rpc('toggle_reaction', { p_message_id: m.id, p_emoji: emoji });
    if (error) { setError(errorMessage(error)); refresh(); }
  }

  async function pin(id: number, on: boolean) {
    const { error } = await supabase.rpc('pin_chat', { p_id: id, p_pinned: on });
    if (error) setError(errorMessage(error)); else refresh();
  }

  const canPost = !!session && !!profile?.rs_name;
  const pad = compact ? 'px-4' : 'px-5 sm:px-6';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {pinned.length > 0 && (
        <div className={`border-b border-ink/20 bg-brass/25 ${pad} py-2 text-sm`} aria-label="Pinned announcements">
          {(allPins ? pinned : pinned.slice(0, 1)).map((p) => (
            <div key={p.id} className="flex items-start gap-2 py-0.5">
              <PinIcon />
              <p className="min-w-0 flex-1 whitespace-pre-wrap break-words">
                <span className="font-sc font-bold">{p.rs_name}: </span>{p.body}
              </p>
              {isAdmin && <button className="shrink-0 text-xs underline" onClick={() => pin(p.id, false)}>Unpin</button>}
            </div>
          ))}
          {pinned.length > 1 && (
            <button className="text-xs underline" onClick={() => setAllPins(!allPins)}>
              {allPins ? 'Show fewer' : `${pinned.length - 1} more pinned`}
            </button>
          )}
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        <div ref={listRef} onScroll={onScroll} className={`${heightClass} overflow-y-auto ${pad} py-3`} aria-live="polite" aria-label="Messages">
          {hasOlder && (
            <div className="mb-3 text-center"><button className="btn btn-sm btn-ghost" onClick={older}>Load earlier messages</button></div>
          )}
          {!loaded ? <p className="py-10 text-center italic text-ink-soft">Pouring the ale…</p>
            : messages.length === 0 ? <p className="py-10 text-center text-ink-soft">The Tavern's quiet. Say something to get it going.</p>
            : (
              <ol className="space-y-3">
                {messages.map((m, i) => {
                  const prev = messages[i - 1];
                  const grouped = prev && prev.player_id === m.player_id && new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < 5 * 60_000;
                  const mine = m.player_id === session?.user.id;
                  const mentioned = !mine && !!profile?.rs_name && m.body.toLowerCase().includes(profile.rs_name.toLowerCase());
                  return (
                    <li key={m.id} className={`group ${grouped ? '-mt-2' : ''} ${mentioned ? '-mx-2 rounded bg-brass/20 px-2' : ''}`}>
                      {!grouped && (
                        <p className="flex flex-wrap items-baseline gap-x-2">
                          <Link to={`/hunters/${encodeURIComponent(m.rs_name)}`} className="font-sc font-bold text-ink">{m.rs_name}</Link>
                          {m.is_admin && <span className="chip bg-wax-pvm/15 !py-0 text-xs text-[#6d1414]">Admin</span>}
                          {m.rank_name && !compact && <span className="text-xs text-ink-soft">{m.rank_name}</span>}
                          <time className="text-xs text-ink-soft" dateTime={m.created_at} title={fmtDateTime(m.created_at)}>{ago(m.created_at)}</time>
                        </p>
                      )}
                      <div className="flex items-start gap-2">
                        <p className={`min-w-0 flex-1 whitespace-pre-wrap break-words ${mine ? 'text-ink' : 'text-ink/90'}`}>
                          {m.pinned && <span className="mr-1 inline-block align-[-2px]" title="Pinned"><PinIcon /></span>}
                          {m.body}
                        </p>
                        {(canPost || isAdmin) && (
                          <span className={`flex shrink-0 items-center gap-2 text-xs transition sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 ${picker === m.id ? '' : 'sm:opacity-0'}`}>
                            {canPost && (
                              <button className="text-base leading-none" onClick={() => setPicker(picker === m.id ? null : m.id)}
                                aria-expanded={picker === m.id} aria-label={`React to ${m.rs_name}'s message`} title="React">☺</button>
                            )}
                            {isAdmin && <button className="underline" onClick={() => pin(m.id, !m.pinned)}>{m.pinned ? 'Unpin' : 'Pin'}</button>}
                            {isAdmin && !mine && <button className="underline" onClick={() => mute(m)}>Mute</button>}
                            {(mine || isAdmin) && <button className="text-wax-pvm underline" onClick={() => remove(m)}>Delete</button>}
                          </span>
                        )}
                      </div>
                      {picker === m.id && (
                        <div className="mt-1 flex flex-wrap gap-1" role="group" aria-label="Pick a reaction"
                          data-picker>
                          {REACTIONS.map((e) => (
                            <button key={e} onClick={() => react(m, e)}
                              className={`rounded-full border px-2 py-0.5 text-base leading-tight transition hover:bg-brass/30 ${m.my_reactions?.includes(e) ? 'border-ink/50 bg-brass/30' : 'border-ink/20 bg-parchment-50/60'}`}>
                              {e}
                            </button>
                          ))}
                        </div>
                      )}
                      {m.reactions && Object.keys(m.reactions).length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {REACTIONS.filter((e) => m.reactions?.[e]).map((e) => {
                            const minePick = m.my_reactions?.includes(e);
                            return (
                              <button key={e} disabled={!canPost} onClick={() => react(m, e)}
                                aria-pressed={minePick} aria-label={`${e} ${m.reactions![e]}${minePick ? ', including you' : ''}`}
                                className={`flex items-center gap-1 rounded-full border px-1.5 py-px text-xs transition disabled:cursor-default ${minePick ? 'border-ink/50 bg-brass/35 font-bold' : 'border-ink/20 bg-parchment-50/50 enabled:hover:bg-brass/20'}`}>
                                <span className="text-sm leading-none">{e}</span>{m.reactions![e]}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
        </div>
        {below > 0 && (
          <button className="btn btn-sm btn-ink absolute bottom-3 left-1/2 -translate-x-1/2 shadow-lg" onClick={() => {
            const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; stick.current = true; setBelow(0);
          }}>{below} new {below === 1 ? 'message' : 'messages'}</button>
        )}
      </div>

      <div className={`border-t-2 border-double border-ink/25 ${pad} py-3`}>
        {error && <div className="mb-2"><Notice tone="error">{error}</Notice></div>}
        {info && <div className="mb-2"><Notice tone="success">{info}</Notice></div>}
        {canPost ? (
          <form onSubmit={send} className="flex items-end gap-2">
            <div className="flex-1">
              <label htmlFor={compact ? 'say-pop' : 'say'} className="sr-only">Your message</label>
              <textarea id={compact ? 'say-pop' : 'say'} ref={inputRef} className="field resize-none" rows={compact ? 1 : 2} maxLength={MAX} value={text}
                placeholder={`Say something, ${profile?.rs_name}…`} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} />
              {!compact && <p className="hint flex justify-between"><span>Enter to send, Shift+Enter for a new line</span><span>{text.length}/{MAX}</span></p>}
            </div>
            <button className={`btn btn-wax ${compact ? '' : 'mb-6'}`} disabled={sending || !text.trim()}>Send</button>
          </form>
        ) : (
          <p className="text-sm"><Link to="/login">Join or sign in</Link> to join the conversation. Anyone can read along.</p>
        )}
      </div>
    </div>
  );
}

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0 text-wax-pvm" fill="currentColor" aria-hidden>
      <path d="M15 3l6 6-2 1-3 3 .5 5-1.5 1.5L11 15l-5 5-1-1 5-5-4.5-4L7 8.5l5 .5 3-3z" />
    </svg>
  );
}
