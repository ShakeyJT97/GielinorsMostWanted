import { NavLink, Navigate, Outlet } from 'react-router-dom';
import { Loading } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { usePendingCount } from '../../components/ReviewAlerts';

const tab = ({ isActive }: { isActive: boolean }) =>
  `whitespace-nowrap rounded-t px-3 py-2 font-sc font-bold ${isActive ? 'bg-parchment-100 text-ink' : 'text-parchment-100 hover:bg-white/10'}`;

export default function AdminLayout() {
  const { ready, session, isAdmin } = useAuth();
  const pending = usePendingCount();

  if (!ready) return <Loading />;
  if (!session) return <Navigate to="/login" replace />;
  if (!isAdmin) return <p className="text-center text-parchment-100">This area is for event admins.</p>;

  return (
    <div>
      <nav className="flex gap-1 overflow-x-auto border-b-2 border-parchment-100/70" aria-label="Admin">
        <NavLink to="/admin" end className={tab}>
          Review
          {pending.data ? <span className="ml-1.5 inline-grid h-5 min-w-5 place-items-center rounded-full bg-wax-pvm px-1.5 font-serif text-xs text-parchment-50">{pending.data}</span> : null}
        </NavLink>
        <NavLink to="/admin/add-claim" className={tab}>Add claim</NavLink>
        <NavLink to="/admin/board" className={tab}>Board</NavLink>
        <NavLink to="/admin/contracts" className={tab}>Contracts</NavLink>
        <NavLink to="/admin/players" className={tab}>Players</NavLink>
        <NavLink to="/admin/event" className={tab}>Event</NavLink>
        <NavLink to="/admin/audit" className={tab}>Audit log</NavLink>
      </nav>
      <div className="sheet rounded-t-none p-4 sm:p-6">
        <Outlet />
      </div>
    </div>
  );
}
