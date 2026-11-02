import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, must } from './supabase';
import type { Profile } from './types';

interface AuthState {
  session: Session | null;
  ready: boolean;
  profile: Profile | null;
  isAdmin: boolean;
  refreshProfile: () => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const qc = useQueryClient();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      qc.invalidateQueries();
    });
    return () => data.subscription.unsubscribe();
  }, [qc]);

  const uid = session?.user.id;
  const profileQ = useQuery({
    queryKey: ['profile', uid],
    enabled: !!uid,
    queryFn: async () => must(await supabase.from('profiles').select('*').eq('id', uid!).single()) as Profile,
  });

  const profile = uid ? profileQ.data ?? null : null;
  const value: AuthState = {
    session,
    ready: ready && (!uid || !profileQ.isLoading),
    profile,
    isAdmin: profile?.role === 'admin' && !profile.is_banned,
    refreshProfile: () => qc.invalidateQueries({ queryKey: ['profile', uid] }),
    signOut: async () => {
      await supabase.auth.signOut();
      qc.clear();
    },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
