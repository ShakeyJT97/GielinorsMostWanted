import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { ChatPanel, readSeen, useChat, writeSeen } from './Chat';

/**
 * The floating Tavern button on every page (except the Tavern page itself).
 * Opens a chat window over the page; full screen on phones. Shows a count of unread messages.
 */
export function TavernLauncher() {
  const { pathname } = useLocation();
  if (pathname === '/tavern') return null;
  return <Launcher />;
}

function Launcher() {
  const { session } = useAuth();
  const chat = useChat();
  const [open, setOpen] = useState(() => {
    try { return sessionStorage.getItem('gmw-tavern-open') === '1'; } catch { return false; }
  });
  const [seen, setSeen] = useState(readSeen);

  useEffect(() => {
    try { sessionStorage.setItem('gmw-tavern-open', open ? '1' : '0'); } catch { /* not saved */ }
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Lock page scroll behind the full-screen chat on phones
  useEffect(() => {
    if (!open || window.matchMedia('(min-width: 640px)').matches) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const unread = useMemo(
    () => chat.messages.filter((m) => m.id > seen && m.player_id !== session?.user.id).length,
    [chat.messages, seen, session],
  );

  function markSeen(id: number) {
    writeSeen(id);
    setSeen((s) => Math.max(s, id));
  }

  return (
    <>
      {!open && (
        <button onClick={() => setOpen(true)}
          className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full bg-oak-900 py-2.5 pl-3 pr-4 font-sc font-bold text-parchment-100 shadow-[0_6px_18px_rgba(0,0,0,.6)] ring-2 ring-brass/70 transition hover:bg-oak-800 sm:bottom-6 sm:right-6"
          aria-label={unread ? `Open the Tavern chat, ${unread} unread` : 'Open the Tavern chat'}>
          <TankardIcon />
          Tavern
          {unread > 0 && (
            <span className="grid h-6 min-w-6 place-items-center rounded-full bg-wax-pvm px-1.5 font-serif text-sm text-parchment-50">
              {unread > 60 ? '60+' : unread}
            </span>
          )}
        </button>
      )}

      {open && (
        <section role="dialog" aria-label="The Tavern chat"
          className="sheet fixed inset-0 z-40 flex flex-col !rounded-none sm:inset-auto sm:bottom-6 sm:right-6 sm:h-[34rem] sm:max-h-[calc(100vh-6rem)] sm:w-[23rem] sm:!rounded-md sm:shadow-[0_18px_40px_rgba(0,0,0,.65)]">
          <header className="flex items-center gap-2 border-b-2 border-double border-ink/25 bg-oak-900 px-4 py-2.5 text-parchment-100">
            <TankardIcon />
            <h2 className="mr-auto font-display text-lg leading-none text-brass">The Tavern</h2>
            <Link to="/tavern" onClick={() => setOpen(false)} className="text-sm text-parchment-200 underline underline-offset-2">Full page</Link>
            <button onClick={() => setOpen(false)} className="btn btn-sm border border-parchment-200/40 text-parchment-100" aria-label="Close the Tavern chat">Close</button>
          </header>
          <ChatPanel chat={chat} heightClass="absolute inset-0" compact autoFocus onSeen={markSeen} />
        </section>
      )}
    </>
  );
}

function TankardIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 8h10v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z" />
      <path d="M15 10h2a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-2" />
      <path d="M5 8c0-2 1.5-3 3-3 .6-1.2 1.8-2 3.2-2 1.9 0 3.3 1.3 3.6 3 .2.6.2 1.3.2 2" />
      <path d="M8.5 11v7M11.5 11v7" />
    </svg>
  );
}
