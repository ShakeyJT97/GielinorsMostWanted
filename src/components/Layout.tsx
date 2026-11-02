import { useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useEventPhase, useSettings, useUnseenReviews } from '../lib/queries';
import { timeLeft } from '../lib/format';
import { TavernLauncher } from './tavern/TavernLauncher';
import { OnlineNow } from './OnlineNow';
import { ReviewAlerts, usePendingCount } from './ReviewAlerts';

const linkCls = ({ isActive }: { isActive: boolean }) =>
  `rounded px-3 py-1.5 font-sc font-bold transition ${isActive ? 'bg-parchment-100 text-ink' : 'text-parchment-100 hover:bg-white/10'}`;

export function Layout() {
  const { session, profile, isAdmin, signOut } = useAuth();
  const settings = useSettings().data;
  const [open, setOpen] = useState(false);
  const unseen = useUnseenReviews(session?.user.id).data ?? 0;
  const { phase } = useEventPhase();
  const pending = usePendingCount().data ?? 0;

  const links = (
    <>
      <NavLink to="/" end className={linkCls} onClick={() => setOpen(false)}>Board</NavLink>
      <NavLink to="/tavern" className={linkCls} onClick={() => setOpen(false)}>Tavern</NavLink>
      <NavLink to="/leaderboard" className={linkCls} onClick={() => setOpen(false)}>Leaderboard</NavLink>
      {phase === 'ended' && <NavLink to="/results" className={linkCls} onClick={() => setOpen(false)}>Results</NavLink>}
      <NavLink to="/archive" className={linkCls} onClick={() => setOpen(false)}>Archive</NavLink>
      <NavLink to="/how-it-works" className={linkCls} onClick={() => setOpen(false)}>How it works</NavLink>
      {session && (
        <NavLink to="/me" className={linkCls} onClick={() => setOpen(false)}>
          My bounties
          {unseen > 0 && (
            <span className="ml-1.5 inline-grid h-5 min-w-5 place-items-center rounded-full bg-wax-pvm px-1.5 align-[1px] font-serif text-xs text-parchment-50"
              title={`${unseen} claim${unseen === 1 ? '' : 's'} reviewed since you last looked`}>
              {unseen}<span className="sr-only"> newly reviewed</span>
            </span>
          )}
        </NavLink>
      )}
      {isAdmin && (
        <NavLink to="/admin" className={linkCls} onClick={() => setOpen(false)}>
          Admin
          {pending > 0 && (
            <span className="ml-1.5 inline-grid h-5 min-w-5 place-items-center rounded-full bg-brass px-1.5 align-[1px] font-serif text-xs font-bold text-ink"
              title={`${pending} claim${pending === 1 ? '' : 's'} waiting for review`}>
              {pending}<span className="sr-only"> claims waiting for review</span>
            </span>
          )}
        </NavLink>
      )}
    </>
  );

  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-parchment-100 focus:px-3 focus:py-2 focus:text-ink">
        Skip to content
      </a>
      <header className="relative z-30 border-b border-black/40 bg-oak-900/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-2 px-4 py-3 sm:gap-4">
          <Link to="/" className="mr-auto leading-tight">
            <span className="block font-display text-lg text-brass sm:text-xl">{settings?.event_name ?? "Gielinor's Most Wanted"}</span>
            <span className="block text-xs text-parchment-200/80">A {settings?.clan_name ?? 'UwU Girls'} clan event</span>
          </Link>
          <nav className="hidden items-center gap-0.5 xl:flex" aria-label="Main">{links}</nav>
          <OnlineNow onNavigate={() => setOpen(false)} />
          <div className="hidden items-center gap-2 xl:flex">
            {session ? (
              <>
                <span className="text-sm text-parchment-200">{profile?.rs_name ?? 'New hunter'}</span>
                <button className="btn btn-sm border border-parchment-200/40 text-parchment-100 hover:bg-white/10" onClick={signOut}>Sign out</button>
              </>
            ) : (
              <Link to="/login" className="btn btn-sm btn-brass">Join or sign in</Link>
            )}
          </div>
          <button className="btn btn-sm relative border border-parchment-200/40 text-parchment-100 xl:hidden" aria-expanded={open} aria-controls="mobile-nav" onClick={() => setOpen(!open)}>
            Menu
            {isAdmin && pending > 0 && (
              <span className="absolute -right-2 -top-2 grid h-5 min-w-5 place-items-center rounded-full bg-brass px-1 font-serif text-xs font-bold text-ink">
                {pending}<span className="sr-only"> claims waiting for review</span>
              </span>
            )}
          </button>
        </div>
        {open && (
          <nav id="mobile-nav" className="flex flex-col gap-1 border-t border-black/40 px-4 py-3 xl:hidden" aria-label="Main">
            {links}
            {session
              ? <button className="btn btn-sm mt-2 border border-parchment-200/40 text-parchment-100" onClick={signOut}>Sign out</button>
              : <Link to="/login" className="btn btn-sm btn-brass mt-2" onClick={() => setOpen(false)}>Join or sign in</Link>}
          </nav>
        )}
        {settings?.is_paused && (
          <p className="bg-wax-pvm px-4 py-1.5 text-center text-sm text-parchment-50">The event is paused. New claims are closed for now.</p>
        )}
      </header>

      <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-3 py-6 sm:px-4 sm:py-8">
        <Outlet />
      </main>

      <footer className="mx-auto w-full max-w-7xl px-4 pb-24 text-center text-sm text-parchment-200/70">
        {settings && <p>Event {new Date() < new Date(settings.starts_at) ? 'starts soon' : timeLeft(settings.ends_at)}</p>}
        <p className="mt-1">A fan-made clan event. RuneScape is a trademark of Jagex Ltd; this site is not affiliated with Jagex.</p>
      </footer>
      <TavernLauncher />
      <ReviewAlerts />
    </div>
  );
}
