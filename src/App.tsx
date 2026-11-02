import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Loading, Sheet } from './components/ui';
import { useAuth } from './lib/auth';
import { supabaseConfigured } from './lib/supabase';
import BoardPage from './pages/BoardPage';
import ContractPage from './pages/ContractPage';
import LoginPage from './pages/LoginPage';
import { WelcomePage } from './pages/AccountPages';
import ProfilePage from './pages/ProfilePage';
import LeaderboardPage from './pages/LeaderboardPage';
import ArchivePage from './pages/ArchivePage';
import HunterPage from './pages/HunterPage';
import AdminLayout from './pages/admin/AdminLayout';
import ReviewQueue from './pages/admin/ReviewQueue';
import AddClaim from './pages/admin/AddClaim';
import HowItWorksPage from './pages/HowItWorksPage';
import BoardControls from './pages/admin/BoardControls';
import { ContractEditor, ContractsList } from './pages/admin/ContractsAdmin';
import PlayersAdmin from './pages/admin/PlayersAdmin';
import { AuditLog, EventAdmin } from './pages/admin/EventAdmin';

/** Signed-in players without a display name are sent to pick one first. */
function NameGate({ children }: { children: React.ReactNode }) {
  const { ready, session, profile } = useAuth();
  const { pathname } = useLocation();
  if (!ready) return <Loading />;
  if (session && profile && !profile.rs_name && pathname !== '/welcome') {
    return <Navigate to="/welcome" replace />;
  }
  return <>{children}</>;
}

export default function App() {
  if (!supabaseConfigured) {
    return (
      <div className="mx-auto max-w-xl p-6">
        <Sheet>
          <h1 className="font-display text-2xl">Almost there</h1>
          <p className="mt-2">Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to your environment (see the README), then reload.</p>
        </Sheet>
      </div>
    );
  }
  return (
    <NameGate>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<BoardPage />} />
          <Route path="contracts/:id" element={<ContractPage />} />
          <Route path="leaderboard" element={<LeaderboardPage />} />
          <Route path="archive" element={<ArchivePage />} />
          <Route path="how-it-works" element={<HowItWorksPage />} />
          <Route path="hunters/:name" element={<HunterPage />} />
          <Route path="me" element={<ProfilePage />} />
          <Route path="login" element={<LoginPage />} />
          <Route path="welcome" element={<WelcomePage />} />
          <Route path="admin" element={<AdminLayout />}>
            <Route index element={<ReviewQueue />} />
            <Route path="add-claim" element={<AddClaim />} />
            <Route path="board" element={<BoardControls />} />
            <Route path="contracts" element={<ContractsList />} />
            <Route path="contracts/:id" element={<ContractEditor />} />
            <Route path="players" element={<PlayersAdmin />} />
            <Route path="event" element={<EventAdmin />} />
            <Route path="audit" element={<AuditLog />} />
          </Route>
          <Route path="*" element={<Sheet className="mx-auto max-w-md"><h1 className="font-display text-2xl">Nothing posted here</h1><p className="mt-2"><a href="/">Back to the board</a></p></Sheet>} />
        </Route>
      </Routes>
    </NameGate>
  );
}
