import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Activity, Download, Globe, Package, Route, Shield, Wallet, Zap } from 'lucide-react';
import { animate, useMotionValue, useTransform } from 'framer-motion';

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');
const browserOrigin = typeof window !== 'undefined' ? trimTrailingSlash(window.location.origin) : '';
const localProxyOrigin = 'http://127.0.0.1:4000';
const defaultInstanceApiBase = import.meta.env.DEV ? localProxyOrigin : browserOrigin || localProxyOrigin;
const instanceApiBase = trimTrailingSlash(import.meta.env.VITE_INSTANCE_API_BASE_URL || defaultInstanceApiBase);
const communityApiBase = trimTrailingSlash(import.meta.env.VITE_COMMUNITY_API_BASE_URL || instanceApiBase);
const displayFont = "'Space Grotesk', sans-serif";

type FeedActivity = {
  time?: string;
  model?: string;
  tokens?: number;
  status?: string;
};

function AnimatedCounter({ target, prefix = '', suffix = '', decimals = 0 }: { target: number; prefix?: string; suffix?: string; decimals?: number }) {
  const count = useMotionValue(0);
  const rounded = useTransform(count, (v: number) =>
    `${prefix}${v.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${suffix}`
  );
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const controls = animate(count, target, { duration: 1.1, ease: 'easeOut' });
    return controls.stop;
  }, [count, target]);

  useEffect(() => {
    const unsub = rounded.on('change', (v: string) => {
      if (ref.current) ref.current.textContent = v;
    });
    return unsub;
  }, [rounded]);

  return <span ref={ref}>{prefix}0{suffix}</span>;
}

function App() {
  const [stats, setStats] = useState({
    savedTokens: 0,
    savedMoney: 0,
    blockedLoops: 0,
    totalRequests: 0,
    smartRouteDowngrades: 0,
    recentActivity: [] as FeedActivity[],
  });
  const [communityInstalls, setCommunityInstalls] = useState(0);
  const [communitySavings, setCommunitySavings] = useState(0);
  const [npmStats, setNpmStats] = useState({ weekly: 0, monthly: 0 });
  const [installSources, setInstallSources] = useState<Record<string, Record<string, number>> | null>(null);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch(`${instanceApiBase}/api/stats`);
        if (res.ok) {
          const data = await res.json();
          setStats((prev) => ({ ...prev, ...data }));
        }
      } catch {}
    };
    fetchStats();
    const interval = setInterval(fetchStats, 2500);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const fetchInstallData = async () => {
      try {
        const breakdownRes = await fetch(`${communityApiBase}/api/install-breakdown`);
        if (breakdownRes.ok) {
          const data = await breakdownRes.json();
          setCommunityInstalls(data.uniqueInstalls || 0);
          setInstallSources({
            Platform: data.platformBreakdown || {},
            Architecture: data.archBreakdown || {},
            Version: data.versionBreakdown || {},
          });
        }
      } catch {}
      try {
        const npmRes = await fetch(`${communityApiBase}/api/npm-stats`);
        if (npmRes.ok) {
          const data = await npmRes.json();
          setNpmStats({ weekly: data.weekly || 0, monthly: data.monthly || 0 });
        }
      } catch {}
      try {
        const statsRes = await fetch(`${communityApiBase}/api/stats`);
        if (statsRes.ok) {
          const data = await statsRes.json();
          setCommunitySavings(Math.round(data.savedMoney || 0));
        }
      } catch {}
    };

    fetchInstallData();
    const interval = setInterval(fetchInstallData, 30000);
    return () => clearInterval(interval);
  }, []);

  const instanceCards = [
    { title: 'Saved', value: stats.savedMoney < 1 ? `$${stats.savedMoney.toFixed(4)}` : `$${stats.savedMoney.toFixed(2)}`, note: 'Local instance counter', icon: <Wallet className="h-4 w-4 text-emerald-300" /> },
    { title: 'Requests', value: stats.totalRequests.toLocaleString(), note: 'Protected by this proxy', icon: <Shield className="h-4 w-4 text-sky-300" /> },
    { title: 'Loops', value: stats.blockedLoops.toLocaleString(), note: 'Hard stops issued', icon: <Activity className="h-4 w-4 text-rose-300" /> },
    { title: 'Routes', value: (stats.smartRouteDowngrades || 0).toLocaleString(), note: 'Downgrades / failovers', icon: <Route className="h-4 w-4 text-amber-300" /> },
  ];

  const substrateCards = [
    { title: 'Unique installs', value: <AnimatedCounter target={communityInstalls} />, note: 'CLI telemetry', icon: <Download className="h-4 w-4 text-sky-300" /> },
    { title: 'npm weekly', value: <AnimatedCounter target={npmStats.weekly} />, note: npmStats.monthly > 0 ? `${npmStats.monthly.toLocaleString()} monthly` : 'Registry signal', icon: <Package className="h-4 w-4 text-violet-300" /> },
    { title: 'Community saved', value: <AnimatedCounter target={communitySavings} prefix="$" />, note: 'Existing public counter', icon: <Zap className="h-4 w-4 text-emerald-300" /> },
    { title: 'Backend', value: <span className="text-base text-[#177a52]">{instanceApiBase}</span>, note: 'Current instance target', icon: <Globe className="h-4 w-4 text-amber-300" /> },
  ];

  return (
    <div className="min-h-screen bg-transparent px-4 py-5 text-[#111512] sm:px-6">
      <div className="mx-auto max-w-7xl space-y-4">
        <section className="rounded-[22px] border border-[rgba(17,21,18,0.12)] bg-[rgba(255,252,247,0.8)] p-5 shadow-[0_18px_60px_rgba(42,41,36,0.08)] backdrop-blur">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-xl bg-[#121916] font-bold text-[#f7f3ea]">VB</div>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#7a867f]">Staging</div>
                <h1 style={{ fontFamily: displayFont }} className="text-3xl font-bold tracking-[-0.05em]">Vibe Billing</h1>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 text-sm text-[#4f5b54]">
              <div className="rounded-xl border border-[rgba(17,21,18,0.12)] bg-white px-3 py-2">Local review</div>
              <div className="rounded-xl border border-[rgba(23,122,82,0.16)] bg-[rgba(23,122,82,0.08)] px-3 py-2 text-[#177a52]">Live data</div>
            </div>
          </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <Panel title="Current state" description="Instance counters and recent activity.">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {instanceCards.map((card) => (
                <MetricCard key={card.title} {...card} />
              ))}
            </div>
          </Panel>

          <Panel title="Commands" description="Common commands.">
            <div className="space-y-3">
              <CommandBlock title="Scan local waste" hint="First value" command="npx vibe-billing scan" />
              <CommandBlock title="Attach the proxy" hint="Setup" command="npx vibe-billing setup" />
              <CommandBlock title="Check runtime status" hint="Status" command="npx vibe-billing status" />
              <CommandBlock title="Print the receipt" hint="After a run" command="npx vibe-billing receipt" />
            </div>
          </Panel>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.15fr_1.25fr]">
          <Panel title="Distribution" description="Install and usage counters.">
            <div className="grid gap-3 md:grid-cols-2">
              {substrateCards.map((card) => (
                <MetricCard key={card.title} {...card} />
              ))}
            </div>
            {installSources && (
              <div className="mt-4 grid gap-3 lg:grid-cols-3">
                {Object.entries(installSources).map(([title, data]) => (
                  <BreakdownCard key={title} title={title} data={data} />
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Live proof" description="Recent protected traffic.">
            <div className="overflow-x-auto rounded-[18px] border border-[rgba(17,21,18,0.12)]">
              <table className="w-full border-collapse bg-white text-left text-sm text-[#4f5b54]">
                <thead className="bg-[#faf6ee] text-[11px] uppercase tracking-[0.16em] text-[#7a867f]">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Time</th>
                    <th className="px-4 py-3 font-semibold">Model / Action</th>
                    <th className="px-4 py-3 font-semibold">Tokens</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.recentActivity.map((activity, i) => (
                    <FeedRow key={i} {...activity} />
                  ))}
                  {stats.recentActivity.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-4 py-10 text-center text-[#7a867f]">Waiting for agent traffic...</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Panel({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="rounded-[24px] border border-[rgba(17,21,18,0.12)] bg-[rgba(255,252,247,0.8)] p-5 shadow-[0_18px_60px_rgba(42,41,36,0.08)] backdrop-blur">
      <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
        <h2 style={{ fontFamily: displayFont }} className="text-[1.15rem] font-bold tracking-[-0.04em]">{title}</h2>
        <p className="max-w-2xl text-sm leading-6 text-[#7a867f]">{description}</p>
      </div>
      {children}
    </section>
  );
}

function MetricCard({ title, value, note, icon }: { title: string; value: ReactNode; note: string; icon: ReactNode }) {
  return (
    <div className="rounded-[18px] border border-[rgba(17,21,18,0.12)] bg-white p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-[#4f5b54]">{icon}{title}</div>
      <div style={{ fontFamily: displayFont }} className="mt-3 text-[1.8rem] font-bold tracking-[-0.05em] text-[#111512]">{value}</div>
      <div className="mt-2 text-sm text-[#7a867f]">{note}</div>
    </div>
  );
}

function CommandBlock({ title, hint, command }: { title: string; hint: string; command: string }) {
  return (
    <div className="rounded-[18px] border border-[rgba(17,21,18,0.12)] bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <strong className="text-sm text-[#111512]">{title}</strong>
        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#7a867f]">{hint}</span>
      </div>
      <code className="block overflow-x-auto rounded-[14px] border border-[rgba(17,21,18,0.1)] bg-[#121916] px-4 py-3 text-sm text-[#f2f7f4]">$ {command}</code>
    </div>
  );
}

function BreakdownCard({ title, data }: { title: string; data: Record<string, number> }) {
  const rows = Object.entries(data).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const max = Math.max(...rows.map(([, value]) => value), 1);
  return (
    <div className="rounded-[18px] border border-[rgba(17,21,18,0.12)] bg-white p-4">
      <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#7a867f]">{title}</div>
      <div className="space-y-3">
        {rows.map(([label, value]) => (
          <div key={label}>
            <div className="mb-1 flex items-center justify-between gap-3 text-sm text-[#4f5b54]">
              <span className="truncate">{label}</span>
              <span className="font-mono text-[#111512]">{value.toLocaleString()}</span>
            </div>
            <div className="h-2 rounded-full bg-[#f1ece3]">
              <div className="h-2 rounded-full bg-gradient-to-r from-[#177a52] to-[#2c66d0]" style={{ width: `${Math.max((value / max) * 100, 8)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FeedRow({ time, model, tokens, status }: FeedActivity) {
  const tone =
    status?.includes('Loop') || status?.includes('Blocked') || status?.includes('Budget')
      ? 'border-[#a33a49]/20 bg-[#a33a49]/10 text-[#a33a49]'
      : status?.includes('Compressed') || status?.includes('Cache')
        ? 'border-[#177a52]/20 bg-[#177a52]/10 text-[#177a52]'
        : status?.includes('Failover') || status?.includes('429') || status?.includes('Shadow')
          ? 'border-[#9a5b14]/20 bg-[#9a5b14]/10 text-[#9a5b14]'
          : 'border-[#2c66d0]/16 bg-[#2c66d0]/10 text-[#2c66d0]';

  return (
    <tr className="border-b border-[rgba(17,21,18,0.08)] last:border-0 hover:bg-[#fbf8f2]">
      <td className="px-4 py-3 font-mono whitespace-nowrap">{time || '-'}</td>
      <td className="px-4 py-3 font-medium text-[#111512] whitespace-nowrap">{model || '-'}</td>
      <td className="px-4 py-3 font-mono whitespace-nowrap">{tokens ?? '-'}</td>
      <td className="px-4 py-3 whitespace-nowrap"><span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${tone}`}>{status || 'Proxied'}</span></td>
    </tr>
  );
}

export default App;
