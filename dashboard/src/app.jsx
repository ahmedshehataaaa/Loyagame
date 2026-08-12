import { useEffect, useState } from 'react';
import {
  LayoutDashboard,
  Users,
  TicketCheck,
  TrendingUp,
  ShieldAlert,
  Moon,
  Sun,
  LogOut,
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs.jsx';
import { Button } from './components/ui/button.jsx';
import { AdminGate } from './components/admin-gate.jsx';
import { Overview } from './components/overview.jsx';
import { Players } from './components/players.jsx';
import { Redemptions } from './components/redemptions.jsx';
import { Engagement } from './components/engagement.jsx';
import { Fraud } from './components/fraud.jsx';
import { useOverview, useEngagement, getAdminKey, clearAdminKey } from './lib/api.js';

/* SINGLE-TENANT ON PURPOSE (ADR 0017). The live game build is McDonald's, and
   no tenant/campaign column exists anywhere in supabase/schema.sql — players,
   runs and wheel_wins are all global. A client switcher here would be a
   control with nothing behind it, so the client name is a constant and every
   "client" field reads McDonald's. Multi-tenancy is a schema change first. */
const CLIENT_NAME = "McDonald's";

function useTheme() {
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem('claimlabs.theme');
    if (saved) return saved === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('claimlabs.theme', dark ? 'dark' : 'light');
  }, [dark]);
  return [dark, setDark];
}

const TABS = [
  { value: 'overview', label: 'Overview', Icon: LayoutDashboard },
  { value: 'players', label: 'Players', Icon: Users },
  { value: 'redemptions', label: 'Redemptions', Icon: TicketCheck },
  { value: 'engagement', label: 'Engagement', Icon: TrendingUp },
  { value: 'fraud', label: 'Flagged', Icon: ShieldAlert },
];

export function App() {
  const [authed, setAuthed] = useState(() => Boolean(getAdminKey()));
  const [dark, setDark] = useTheme();

  // The query cache raises this when any endpoint answers 401 — a rotated or
  // mistyped key sends the operator back to the gate instead of leaving five
  // panels silently erroring.
  useEffect(() => {
    const onUnauthorized = () => setAuthed(false);
    window.addEventListener('claimlabs:unauthorized', onUnauthorized);
    return () => window.removeEventListener('claimlabs:unauthorized', onUnauthorized);
  }, []);

  if (!authed) return <AdminGate onAuthed={() => setAuthed(true)} />;
  return <Dashboard dark={dark} setDark={setDark} onSignOut={() => setAuthed(false)} />;
}

function Dashboard({ dark, setDark, onSignOut }) {
  const overview = useOverview();
  const engagement = useEngagement(30);

  return (
    <div className="min-h-dvh">
      <header className="border-border bg-card/80 sticky top-0 z-10 border-b backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-3">
          <div className="flex items-baseline gap-2">
            <span className="text-brand-red text-sm font-extrabold tracking-tight">ClaimLabs</span>
            <span className="text-subtle-foreground text-sm">Dashboard</span>
            <span className="text-subtle-foreground" aria-hidden="true">
              &mdash;
            </span>
            <span className="text-sm font-bold">{CLIENT_NAME}</span>
          </div>

          <div className="flex items-center gap-2">
            <LiveDot pending={overview.isFetching || engagement.isFetching} />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setDark(!dark)}
              aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
            >
              {dark ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Sign out"
              onClick={() => {
                clearAdminKey();
                onSignOut();
              }}
            >
              <LogOut aria-hidden="true" />
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-6">
        <div className="mb-5">
          <h1 className="text-2xl font-bold tracking-tight">Slice Rush performance</h1>
          <p className="text-muted-foreground text-sm">
            {CLIENT_NAME} &middot; live campaign data, refreshed every 10 seconds.
          </p>
        </div>

        <Tabs defaultValue="overview" className="flex flex-col gap-5">
          <TabsList>
            {TABS.map(({ value, label, Icon }) => (
              <TabsTrigger key={value} value={value}>
                <Icon aria-hidden="true" />
                {label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="overview">
            <Overview
              data={overview.data}
              engagement={engagement.data}
              loading={overview.isPending}
            />
          </TabsContent>
          <TabsContent value="players">
            <Players />
          </TabsContent>
          <TabsContent value="redemptions">
            <Redemptions />
          </TabsContent>
          <TabsContent value="engagement">
            <Engagement data={engagement.data} loading={engagement.isPending} />
          </TabsContent>
          <TabsContent value="fraud">
            <Fraud />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function LiveDot({ pending }) {
  return (
    <span className="text-subtle-foreground mr-1 hidden items-center gap-1.5 text-xs sm:inline-flex">
      <span
        className={`bg-status-good size-1.5 rounded-full ${pending ? 'animate-pulse' : ''}`}
        aria-hidden="true"
      />
      {pending ? 'Updating…' : 'Live'}
    </span>
  );
}
