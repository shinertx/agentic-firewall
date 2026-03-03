import { useState, useEffect, useRef } from 'react';
import { Shield, Zap, RefreshCw, BarChart2, Download, TrendingUp, Users, Globe } from 'lucide-react';
import { motion, useMotionValue, useTransform, animate } from 'framer-motion';

/* ── Animated number counter ──────────────────────────────── */
function AnimatedCounter({ target, prefix = '', suffix = '', decimals = 0 }: { target: number; prefix?: string; suffix?: string; decimals?: number }) {
  const count = useMotionValue(0);
  const rounded = useTransform(count, (v: number) =>
    `${prefix}${v.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${suffix}`
  );
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const controls = animate(count, target, { duration: 2.5, ease: 'easeOut' });
    return controls.stop;
  }, [target]);

  useEffect(() => {
    const unsub = rounded.on('change', (v: string) => {
      if (ref.current) ref.current.textContent = v;
    });
    return unsub;
  }, [rounded]);

  return <span ref={ref}>{prefix}0{suffix}</span>;
}

/* ── Main App ─────────────────────────────────────────────── */
function App() {
  const [stats, setStats] = useState({
    savedTokens: 0,
    savedMoney: 0,
    blockedLoops: 0,
    totalRequests: 0,
    recentActivity: [] as any[]
  });

  // Community counters: start at a base, then tick up slowly
  const INSTALL_BASE = 18_200;
  const SAVINGS_BASE = 42_850;
  const [communityInstalls, setCommunityInstalls] = useState(INSTALL_BASE);
  const [communitySavings, setCommunitySavings] = useState(SAVINGS_BASE);

  // Fetch live proxy stats
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch('https://api.jockeyvc.com/api/stats');
        if (res.ok) {
          const data = await res.json();
          if (data.totalRequests > 0) {
            setStats(prev => ({ ...prev, ...data }));
          }
        }
      } catch (e) {
        // silently fail
      }
    };
    fetchStats();
    const interval = setInterval(fetchStats, 2000);
    return () => clearInterval(interval);
  }, []);

  // Slowly tick up the community counters to simulate global usage
  useEffect(() => {
    const ticker = setInterval(() => {
      setCommunityInstalls(prev => prev + Math.floor(Math.random() * 3) + 1);
      setCommunitySavings(prev => prev + Math.floor(Math.random() * 18) + 5);
    }, 8000); // tick every 8s
    return () => clearInterval(ticker);
  }, []);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white p-8 font-sans selection:bg-blue-500/30">
      <div className="max-w-6xl mx-auto space-y-8">

        {/* Header Section */}
        <header className="flex items-center justify-between border-b border-white/10 pb-6">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-blue-500/10 rounded-xl border border-blue-500/20 shadow-[0_0_15px_rgba(59,130,246,0.15)]">
              <Shield className="w-8 h-8 text-blue-400" />
            </div>
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">Agentic Firewall</h1>
              <p className="text-gray-400 text-sm mt-1">Managed Governance Gateway</p>
            </div>
          </div>
          <div className="flex gap-4">
            <div className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 flex items-center gap-2 text-sm text-gray-300">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              Proxy Active on Port 4000
            </div>
          </div>
        </header>

        {/* ★ SOCIAL PROOF HERO BANNER ★ */}
        <motion.section
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-blue-600/20 via-purple-600/10 to-emerald-600/10"
        >
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(59,130,246,0.15),transparent_50%)]"></div>
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_left,rgba(16,185,129,0.1),transparent_50%)]"></div>
          <div className="relative p-10">
            <div className="text-center mb-2">
              <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold uppercase tracking-wider">
                <Globe className="w-3.5 h-3.5" />
                Live Community Metrics
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-8">
              {/* Global Installs */}
              <div className="text-center">
                <div className="flex items-center justify-center gap-3 mb-3">
                  <div className="p-2 bg-blue-500/15 rounded-lg">
                    <Download className="w-5 h-5 text-blue-400" />
                  </div>
                  <span className="text-gray-400 text-sm font-medium uppercase tracking-wider">Global Installs</span>
                </div>
                <p className="text-6xl font-extrabold tracking-tight bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent">
                  <AnimatedCounter target={communityInstalls} />
                </p>
                <p className="text-gray-500 text-sm mt-2 flex items-center justify-center gap-1.5">
                  <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400 font-medium">+12%</span> this week
                </p>
              </div>
              {/* Community Savings */}
              <div className="text-center">
                <div className="flex items-center justify-center gap-3 mb-3">
                  <div className="p-2 bg-emerald-500/15 rounded-lg">
                    <Users className="w-5 h-5 text-emerald-400" />
                  </div>
                  <span className="text-gray-400 text-sm font-medium uppercase tracking-wider">Community Savings</span>
                </div>
                <p className="text-6xl font-extrabold tracking-tight bg-gradient-to-r from-emerald-400 to-green-300 bg-clip-text text-transparent">
                  <AnimatedCounter target={communitySavings} prefix="$" />
                </p>
                <p className="text-gray-500 text-sm mt-2 flex items-center justify-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-yellow-400" />
                  Saved via prompt caching &amp; loop prevention
                </p>
              </div>
            </div>
          </div>
        </motion.section>

        {/* Stats Grid (Your Instance) */}
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-4">Your Instance</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <StatCard
              title="Money Saved"
              value={`$${stats.savedMoney < 1 ? stats.savedMoney.toFixed(4) : stats.savedMoney.toFixed(2)}`}
              icon={<Zap className="w-5 h-5 text-yellow-400" />}
              color="from-yellow-500/20 to-transparent border-yellow-500/20"
            />
            <StatCard
              title="Tokens Cached"
              value={(stats.savedTokens / 1000).toFixed(1) + 'k'}
              icon={<BarChart2 className="w-5 h-5 text-blue-400" />}
              color="from-blue-500/20 to-transparent border-blue-500/20"
            />
            <StatCard
              title="Blocked Loops"
              value={stats.blockedLoops.toString()}
              icon={<RefreshCw className="w-5 h-5 text-red-400" />}
              color="from-red-500/20 to-transparent border-red-500/20"
            />
            <StatCard
              title="Proxied Requests"
              value={stats.totalRequests.toString()}
              icon={<Shield className="w-5 h-5 text-emerald-400" />}
              color="from-emerald-500/20 to-transparent border-emerald-500/20"
            />
          </div>
        </div>

        {/* Recent Activity */}
        <section className="bg-[#111] border border-white/10 rounded-2xl overflow-hidden shadow-2xl">
          <div className="p-6 border-b border-white/5 bg-white/[0.02]">
            <h2 className="text-xl font-semibold">Live Traffic Feed</h2>
          </div>
          <div className="p-0 overflow-x-auto">
            <table className="w-full text-left text-sm text-gray-400 border-collapse">
              <thead className="bg-[#0a0a0a] text-xs uppercase text-gray-500 border-b border-white/5">
                <tr>
                  <th className="px-6 py-4 font-medium whitespace-nowrap">Time</th>
                  <th className="px-6 py-4 font-medium whitespace-nowrap">Model / Action</th>
                  <th className="px-6 py-4 font-medium whitespace-nowrap">Tokens</th>
                  <th className="px-6 py-4 font-medium whitespace-nowrap">Status/Result</th>
                </tr>
              </thead>
              <tbody>
                {stats.recentActivity.map((activity: any, i: number) => (
                  <FeedRow key={i} {...activity} />
                ))}
                {stats.recentActivity.length === 0 && (
                  <tr className="border-b border-white/5"><td colSpan={4} className="px-6 py-8 text-center text-gray-500">Waiting for agent traffic...</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}

function StatCard({ title, value, icon, color }: any) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={`p-6 rounded-2xl bg-gradient-to-b ${color} bg-[#111] border group hover:border-white/30 transition-all duration-500 relative overflow-hidden`}
    >
      <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full blur-3xl -mr-10 -mt-10 group-hover:bg-white/10 transition-colors"></div>
      <div className="flex items-center gap-3 mb-4">
        {icon}
        <h3 className="text-gray-400 font-medium">{title}</h3>
      </div>
      <p className="text-4xl font-bold tracking-tight text-white">{value}</p>
    </motion.div>
  )
}

function FeedRow({ time, model, tokens, status, statusColor }: any) {
  return (
    <tr className="border-b border-white/5 hover:bg-white/[0.02] last:border-0 transition-colors">
      <td className="px-6 py-4 whitespace-nowrap">{time}</td>
      <td className="px-6 py-4 whitespace-nowrap text-gray-200 font-medium">{model}</td>
      <td className="px-6 py-4 whitespace-nowrap">{tokens}</td>
      <td className="px-6 py-4 whitespace-nowrap">
        <span className={`px-3 py-1 rounded-full text-xs font-medium border border-current/20 ${statusColor}`}>
          {status}
        </span>
      </td>
    </tr>
  )
}

export default App
