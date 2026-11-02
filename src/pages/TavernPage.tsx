import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { Notice, Sheet } from '../components/ui';
import { activityText } from '../components/board/BoardExtras';
import { useAuth } from '../lib/auth';
import { useActivity } from '../lib/queries';
import { errorMessage, supabase } from '../lib/supabase';
import { ago, fmtDateTime } from '../lib/format';
import type { ChatMessage } from '../lib/types';
import { HunterLink } from './HunterPage';

const PAGE = 60;
const MAX = 500;

/** Merge a fresh "latest page" into what we already hold: keep older history, drop deleted messages. */
function merge(current: ChatMessage[], latest: ChatMessage[]): ChatMessage[] {
  if (latest.length === 0) return [];
  const floor = latest[0].id;
  const older = latest.length < PAGE ? [] : current.filter((m) => m.id < floor);
  return [...older, ...latest];
}

export default function TavernPage() {
  const { session, profile, isAdmin } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [unseen, setUnseen] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);           // keep scrolled to the newest message
  const lastId = useRef(0);
  const activity = useActivity(20).data ?? [];

  const refresh = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_chat', { p_before: null, p_limit: PAGE });
    if (error) { setError(errorMessage(error)); return; }
    const latest = (data ?? []) as ChatMessage[];
    setMessages((cur) => merge(cur, latest));
    setHasOlder((h) => h || latest.length === PAGE);
    setLoaded(true);
    const newest = latest[latest.length - 1]?.id ?? 0;
    if (lastId.current && newest > lastId.current && !stick.current) setUnseen((n) => n + latest.filter((m) => m.id > lastId.current).length);
    lastId.current = Math.max(lastId.current, newest);
  }, []);

  useEffect(() => {
    refresh();
    const channel = supabase
      .channel('tavern')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_messages' }, () => refresh())
      .subscribe();
    const poll = window.setInterval(refresh, 20_000); // also catches deletions
    return () => { supabase.removeChannel(channel); window.clearInterval(poll); };
  }, [refresh]);

  // Stay pinned to the bottom when new messages arrive, unless the reader scrolled up
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  function onScroll() {
    const el = listRef.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (stick.current) setUnseen(0);
  }

  async function loadOlder() {
    const first = messages[0]?.id;
    if (!first) return;
    const el = listRef.current;
    const before = el ? el.scrollHeight - el.scrollTop : 0;
    const { data, error } = await supabase.rpc('get_chat', { p_before: first, p_limit: PAGE });
    if (error) { setError(errorMessage(error)); return; }
    const older = (data ?? []) as ChatMessage[];
    stick.current = false;
    setMessages((cur) => [...older, ...cur]);
    setHasOlder(older.length === PAGE);
    requestAnimationFrame(() => { if (el) el.scrollTop = el.scrollHeight - before; });
  }

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    setSending(true); setError(null);
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
    if (error) setError(errorMessage(error)); else setMessages((cur) => cur.filter((x) => x.id !== m.id));
  }

  async function mute(m: ChatMessage) {
    if (!window.confirm(`Mute ${m.rs_name}? They can still play, but can't post in the Tavern until you unmute them in Players.`)) return;
    const { error } = await supabase.rpc('set_player_muted', { p_player: m.player_id, p_muted: true });
    setError(error ? errorMessage(error) : null);
    setInfo(error ? null : `${m.rs_name} is muted. Unmute them in Admin → Players.`);
  }

  const canPost = !!session && !!profile?.rs_name;

  return (
    <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[1fr_20rem]">
      <Sheet className="flex flex-col !p-0">
        <header className="border-b-2 border-double border-ink/25 px-5 pb-3 pt-5 sm:px-6">
          <h1 className="font-display text-3xl text-ink">The Tavern</h1>
          <p className="text-ink-soft">Brag, plot, and trash-talk your rivals. Keep it fun: no slurs, nothing personal. Admins can delete messages and mute.</p>
        </header>

        <div ref={listRef} onScroll={onScroll} className="relative h-[60vh] min-h-[22rem] overflow-y-auto px-5 py-3 sm:px-6" aria-live="polite" aria-label="Messages">
          {hasOlder && (
            <div className="mb-3 text-center"><button className="btn btn-sm btn-ghost" onClick={loadOlder}>Load earlier messages</button></div>
          )}
          {!loaded ? <p className="py-10 text-center italic text-ink-soft">Pouring the ale…</p>
            : messages.length === 0 ? <p className="py-10 text-center text-ink-soft">The Tavern's quiet. Say something to get it going.</p>
            : (
              <ol className="space-y-3">
                {messages.map((m, i) => {
                  const prev = messages[i - 1];
                  const grouped = prev && prev.player_id === m.player_id && new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < 5 * 60_000;
                  const mine = m.player_id === session?.user.id;
                  return (
                    <li key={m.id} className={`group ${grouped ? '-mt-2' : ''}`}>
                      {!grouped && (
                        <p className="flex flex-wrap items-baseline gap-x-2">
                          <HunterLink name={m.rs_name} className="font-sc font-bold text-ink" />
                          {m.is_admin && <span className="chip bg-wax-pvm/15 !py-0 text-xs text-[#6d1414]">Admin</span>}
                          {m.rank_name && <span className="text-xs text-ink-soft">{m.rank_name}</span>}
                          <time className="text-xs text-ink-soft" dateTime={m.created_at} title={fmtDateTime(m.created_at)}>{ago(m.created_at)}</time>
                        </p>
                      )}
                      <div className="flex items-start gap-2">
                        <p className={`min-w-0 flex-1 whitespace-pre-wrap break-words ${mine ? 'text-ink' : 'text-ink/90'}`}>{m.body}</p>
                        {(mine || isAdmin) && (
                          <span className="flex shrink-0 gap-2 text-xs transition sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                            {isAdmin && !mine && <button className="underline" onClick={() => mute(m)}>Mute</button>}
                            <button className="text-wax-pvm underline" onClick={() => remove(m)}>Delete</button>
                          </span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
        </div>
        {unseen > 0 && (
          <button className="btn btn-sm btn-ink mx-auto -mt-12 mb-4 shadow-lg" onClick={() => {
            const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; stick.current = true; setUnseen(0);
          }}>{unseen} new {unseen === 1 ? 'message' : 'messages'}</button>
        )}

        <div className="border-t-2 border-double border-ink/25 px-5 py-4 sm:px-6">
          {error && <div className="mb-3"><Notice tone="error">{error}</Notice></div>}
          {info && <div className="mb-3"><Notice tone="success">{info}</Notice></div>}
          {canPost ? (
            <form onSubmit={send} className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="flex-1">
                <label htmlFor="say" className="sr-only">Your message</label>
                <textarea id="say" className="field resize-none" rows={2} maxLength={MAX} value={text}
                  placeholder={`Say something, ${profile?.rs_name}…`} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} />
                <p className="hint flex justify-between"><span>Enter to send, Shift+Enter for a new line</span><span>{text.length}/{MAX}</span></p>
              </div>
              <button className="btn btn-wax sm:mb-6" disabled={sending || !text.trim()}>Send</button>
            </form>
          ) : (
            <p><Link to="/login">Join or sign in</Link> to join the conversation. Anyone can read along.</p>
          )}
        </div>
      </Sheet>

      <aside>
        <Sheet className="!p-5">
          <h2 className="font-display text-2xl text-ink">Town crier</h2>
          <p className="text-sm text-ink-soft">Latest from the board</p>
          {activity.length === 0 ? <p className="mt-3 text-ink-soft">Nothing yet. The first approved claim will be announced here.</p> : (
            <ol className="mt-3 space-y-2.5 text-sm">
              {activity.map((a, i) => (
                <li key={`${a.at}-${i}`} className="border-b border-ink/10 pb-2 last:border-0">
                  <p>{activityText(a)}</p>
                  <p className="text-xs text-ink-soft">{ago(a.at)}</p>
                </li>
              ))}
            </ol>
          )}
        </Sheet>
      </aside>
    </div>
  );
}
