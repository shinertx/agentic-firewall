import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { handleProxyRequest } from './proxyHandler';
import { authMiddleware } from './authMiddleware';
import { validateAllKeys } from './keyVault';
import path from 'path';
import os from 'os';

dotenv.config();

// Also load keys from ~/.firewall/.env if it exists
const firewallEnvPath = path.join(os.homedir(), '.firewall', '.env');
dotenv.config({ path: firewallEnvPath });

import { initAdminCredentials, requireAdminAuth, requireAdminPage, validateCredentials, createSession, destroySession, parseCookies, hasCredentialsConfigured } from './adminAuth';
import { classifyEnvironment } from './environmentDetector';
import { renderAdminLogin } from './pages/adminLogin';
import { renderAdminDashboard } from './pages/admin';
import { buildAdminDashboardData, type AdminDashboardData } from './adminDashboardData';

// Initialize admin credentials from env vars
initAdminCredentials();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
// Parse JSON bodies (up to 50mb for large agent contexts)
import { globalStats } from './stats';
import { decompress } from 'fzstd';

app.use((req, res, next) => {
    const enc = req.headers['content-encoding'];
    if (enc && enc.toLowerCase().includes('zstd')) {
        const chunks: Buffer[] = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => {
            try {
                const buffer = Buffer.concat(chunks);
                const decompressed = decompress(buffer);
                req.body = JSON.parse(new TextDecoder().decode(decompressed));
                delete req.headers['content-encoding'];
                delete req.headers['content-length'];
                (req as any)._body = true; // Tell body-parser it's already parsed
                next();
            } catch (err) {
                console.error('[ZSTD DECOMPRESS ERROR]', err);
                res.status(400).json({ error: { message: 'Agentic Firewall: Failed to decompress zstd payload' } });
            }
        });
        req.on('error', next);
    } else {
        next();
    }
});

app.use(express.json({ limit: '50mb' }));

app.use((err: any, req: Request, res: Response, next: express.NextFunction) => {
    if (err instanceof SyntaxError && (err as any).status === 400 && 'body' in err) {
        console.error('[JSON PARSE ERROR]', err.message);
        return res.status(400).json({ error: { message: 'Agentic Firewall: Invalid JSON payload provided. Failed to parse.' } });
    }
    next(err);
});

// Admin auth middleware — uses imported requireAdminAuth from adminAuth.ts

// Simple per-IP rate limiter for public endpoints (no external deps)
import { RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX } from './config';
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function rateLimitPublic(req: Request, res: Response, next: express.NextFunction) {
    const ip = req.ip || '127.0.0.1';
    const now = Date.now();
    let entry = rateLimitMap.get(ip);
    if (!entry || now >= entry.resetAt) {
        entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
        rateLimitMap.set(ip, entry);
    }
    entry.count++;
    if (entry.count > RATE_LIMIT_MAX) {
        res.status(429).json({ error: { message: 'Rate limit exceeded. Try again in a minute.' } });
        return;
    }
    next();
}

// Cleanup stale rate limit entries every 2 minutes
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimitMap) {
        if (now >= entry.resetAt) rateLimitMap.delete(key);
    }
}, 120_000).unref();

app.get('/api/stats', rateLimitPublic, (req: Request, res: Response) => {
    res.json({
        ...globalStats,
        ...buildLatencySummary(globalStats),
    });
});

// CLI registration telemetry (legacy — kept for backward compat with old CLI versions)
const MAX_REGISTRATIONS = 500;
const registrations: any[] = [];
app.post('/api/register', express.json(), (req: Request, res: Response) => {
    const ping = { ...req.body, ip: req.ip, receivedAt: new Date().toISOString() };
    registrations.push(ping);
    if (registrations.length > MAX_REGISTRATIONS) registrations.splice(0, registrations.length - MAX_REGISTRATIONS);
    console.log(`[REGISTER] 📥 Setup complete from ${req.ip} — ${ping.platform}/${ping.arch} node ${ping.node} v${ping.version}`);
    // Bridge to install tracker so old CLI versions get tracked too
    if (ping.platform) {
        const bridgeEvent = {
            event: ping.event || 'setup_complete',
            command: 'setup',
            machineId: ping.machineId || `legacy-${(req.ip || '127.0.0.1').replace(/[:.]/g, '')}`,
            installId: ping.installId || 'legacy',
            version: ping.version || 'unknown',
            platform: ping.platform,
            arch: ping.arch || 'unknown',
            node: ping.node || 'unknown',
            isFirstRun: true,
            timestamp: ping.timestamp || new Date().toISOString(),
            environment: classifyEnvironment(ping, req.headers['user-agent'] || '') as any,
        };
        recordTelemetryEvent(bridgeEvent);
    }
    res.json({ ok: true, totalRegistrations: registrations.length });
});

app.get('/api/registrations', requireAdminAuth, (req: Request, res: Response) => {
    res.json({ total: registrations.length, registrations });
});

// Telemetry ingestion (new CLI versions use this)
app.post('/api/telemetry', express.json(), (req: Request, res: Response) => {
    const event = req.body;
    if (!event.machineId || !event.event) {
        return res.status(400).json({ error: { message: 'Missing machineId or event' } });
    }
    // Server-side environment classification if client didn't provide one
    if (!event.environment) {
        event.environment = classifyEnvironment(event, req.headers['user-agent'] || '');
    }
    recordTelemetryEvent(event);
    console.log(`[TELEMETRY] ${event.event} from ${event.machineId} — ${event.platform}/${event.arch} v${event.version} [${event.command}] env=${event.environment}`);
    res.json({ ok: true });
});

// Install stats (admin only — full install records)
app.get('/api/installs', requireAdminAuth, (req: Request, res: Response) => {
    res.json(getInstallStats());
});

// Install breakdown (public — aggregated only, no individual records)
app.get('/api/install-breakdown', rateLimitPublic, (req: Request, res: Response) => {
    res.json(getInstallBreakdown());
});

// Public-safe aggregate stats for landing page (no admin auth required)
app.get('/api/public-stats', rateLimitPublic, async (req: Request, res: Response) => {
    const agg = getAggregateStats();
    const uniqueInstalls = getUniqueInstallCount();

    let npmTotal = 0;
    try {
        const npmStats = await getNpmStats();
        npmTotal = npmStats ? npmStats.weekly : 0;
    } catch {
        npmTotal = 0;
    }

    res.json(buildPublicStats(agg, uniqueInstalls, npmTotal, globalStats));
});

// npm download stats (public — cached, querying public npm API)
app.get('/api/npm-stats', rateLimitPublic, async (req: Request, res: Response) => {
    try {
        const stats = await getNpmStats();
        res.json(stats);
    } catch {
        res.status(500).json({ error: { message: 'Failed to fetch npm stats' } });
    }
});

// Per-user stats API
import { getUserStats, getAggregateStats, exportUserData, importUserData, loadUsersFromRedis, saveUsersToRedis } from './budgetGovernor';
import { getNoProgressStats } from './noProgress';
import { renderLandingPage } from './pages/landing';
import { renderDashboard } from './pages/dashboard';
import { getAllSessions, getSessionStats, getUserSessions, exportSessionData, importSessionData, expireStaleSessions, loadSessionsFromRedis, saveSessionsToRedis } from './sessionTracker';
import { getQueueStats } from './requestQueue';
import { getCacheStats } from './responseCache';
import { getCompressionStats } from './promptCompressor';
import { recordTelemetryEvent, getInstallStats, getInstallBreakdown, getNpmStats, getUniqueInstallCount, getDailyInstallTimeline, exportInstallData, importInstallData, loadInstallsFromRedis, saveInstallsToRedis } from './installTracker';
import { isRedisAvailable } from './redis';
import { startTelemetry, flushTelemetry } from './telemetryReporter';
import { buildLatencySummary, buildPublicStats } from './publicStats';

// Load persisted user data on startup
import fs from 'fs';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const INSTALLS_FILE = path.join(DATA_DIR, 'installs.json');
try {
    if (fs.existsSync(USERS_FILE)) {
        const raw = fs.readFileSync(USERS_FILE, 'utf-8');
        importUserData(JSON.parse(raw));
        console.log('[USERS] 📂 Loaded persisted user data');
    }
} catch (err) {
    console.error('[USERS] ⚠️ Failed to load users.json:', err);
}
try {
    if (fs.existsSync(SESSIONS_FILE)) {
        const raw = fs.readFileSync(SESSIONS_FILE, 'utf-8');
        importSessionData(JSON.parse(raw));
        console.log('[SESSIONS] 📂 Loaded persisted session data');
    }
} catch (err) {
    console.error('[SESSIONS] ⚠️ Failed to load sessions.json:', err);
}
try {
    if (fs.existsSync(INSTALLS_FILE)) {
        const raw = fs.readFileSync(INSTALLS_FILE, 'utf-8');
        importInstallData(JSON.parse(raw));
        console.log('[INSTALLS] 📂 Loaded persisted install data');
    }
} catch (err) {
    console.error('[INSTALLS] ⚠️ Failed to load installs.json:', err);
}

// Try loading from Redis after connection is established (overrides file data if Redis has records)
setTimeout(async () => {
    await loadUsersFromRedis();
    await loadSessionsFromRedis();
    await loadInstallsFromRedis();
}, 1500);

// Start opt-in telemetry reporting (only activates when TELEMETRY_ENABLED=true)
startTelemetry(
    () => globalStats,
    () => Object.keys(getQueueStats()),
);

// Persist user + session data every 30 seconds
// When Redis is available, sync to Redis (individual writes already happen per-mutation, this is a safety net).
// When Redis is unavailable, fall back to file persistence.
setInterval(async () => {
    if (isRedisAvailable()) {
        await saveUsersToRedis();
        await saveSessionsToRedis();
        await saveInstallsToRedis();
    } else {
        try {
            await fs.promises.writeFile(USERS_FILE, JSON.stringify(exportUserData(), null, 2));
        } catch (err) {
            console.error('[USERS] Failed to write users.json:', err);
        }
        try {
            await fs.promises.writeFile(SESSIONS_FILE, JSON.stringify(exportSessionData(), null, 2));
        } catch (err) {
            console.error('[SESSIONS] Failed to write sessions.json:', err);
        }
        try {
            await fs.promises.writeFile(INSTALLS_FILE, JSON.stringify(exportInstallData(), null, 2));
        } catch (err) {
            console.error('[INSTALLS] Failed to write installs.json:', err);
        }
    }
}, 30_000);

app.get('/api/user/:userId', requireAdminAuth, (req: Request, res: Response) => {
    const stats = getUserStats(req.params.userId as string);
    if (!stats) return res.status(404).json({ error: 'User not found' });
    res.json(stats);
});

app.get('/api/aggregate', requireAdminAuth, (req: Request, res: Response) => {
    const agg = getAggregateStats();
    const np = getNoProgressStats();
    const queueStats = getQueueStats();
    const cacheStats = getCacheStats();
    const compressionStats = getCompressionStats();
    const avgEstErr = globalStats.estimationSamples > 0
        ? Math.round((globalStats.estimationErrorSum / globalStats.estimationSamples) * 1000) / 10
        : 0;
    // Compute per-model estimation error averages
    const perModelEstErr: Record<string, { avgErrorPct: number; samples: number }> = {};
    for (const [model, data] of Object.entries(globalStats.perModelEstimation)) {
        perModelEstErr[model] = {
            avgErrorPct: data.samples > 0 ? Math.round((data.errorSum / data.samples) * 1000) / 10 : 0,
            samples: data.samples,
        };
    }

    res.json({ ...agg, ...np, ...globalStats, uniqueInstalls: getUniqueInstallCount(), queue: queueStats, cache: cacheStats, compression: compressionStats, avgEstimationErrorPct: avgEstErr, perModelEstimation: perModelEstErr });
});

// Session tracking API
app.get('/api/sessions', requireAdminAuth, (req: Request, res: Response) => {
    res.json(getAllSessions());
});

app.get('/api/sessions/:id', requireAdminAuth, (req: Request, res: Response) => {
    const session = getSessionStats(req.params.id as string);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json(session);
});

app.get('/api/user/:userId/sessions', requireAdminAuth, (req: Request, res: Response) => {
    res.json(getUserSessions(req.params.userId as string));
});

// ─── Admin Dashboard Routes ──────────────────────────────

app.get('/admin/login', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(renderAdminLogin());
});

app.post('/admin/login', express.urlencoded({ extended: false }), (req: Request, res: Response) => {
    const { username, password } = req.body || {};
    if (!username || !password || !validateCredentials(username, password)) {
        res.setHeader('Content-Type', 'text/html');
        res.send(renderAdminLogin('Invalid username or password'));
        return;
    }
    const sessionId = createSession(username);
    res.setHeader('Set-Cookie', `admin_session=${sessionId}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`);
    res.redirect('/admin');
});

app.post('/admin/logout', (req: Request, res: Response) => {
    const cookies = parseCookies(req.headers.cookie);
    const sessionId = cookies['admin_session'];
    if (sessionId) destroySession(sessionId);
    res.setHeader('Set-Cookie', 'admin_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
    res.redirect('/admin/login');
});

async function loadAdminDashboardData(): Promise<AdminDashboardData> {
    const stats = getInstallStats();
    let npmStats = { weekly: 0, monthly: 0 };
    try { npmStats = await getNpmStats(); } catch {}
    const aggregate = getAggregateStats();
    const noProgress = getNoProgressStats();
    const queueStats = getQueueStats();
    const cacheStats = getCacheStats();
    const compressionStats = getCompressionStats();

    return buildAdminDashboardData({
        installStats: stats,
        npmStats,
        dailyTimeline: getDailyInstallTimeline(30),
        aggregate,
        globalStats,
        noProgress,
        queueStats,
        cacheStats,
        compressionStats,
    });
}

app.get('/admin', requireAdminPage, async (req: Request, res: Response) => {
    const data = await loadAdminDashboardData();
    res.setHeader('Content-Type', 'text/html');
    res.send(renderAdminDashboard(data));
});

app.get('/api/admin/stats', requireAdminAuth, async (req: Request, res: Response) => {
    res.json(await loadAdminDashboardData());
});

// Landing page (extracted to src/pages/landing.ts)
app.get('/', async (req: Request, res: Response) => {
    const agg = getAggregateStats();
    const uniqueInstalls = getUniqueInstallCount();
    let npmTotal = 0;
    try {
        const npmStats = await getNpmStats();
        npmTotal = npmStats ? npmStats.weekly : 0;
    } catch {
        npmTotal = 0;
    }

    res.setHeader('Content-Type', 'text/html');
    res.send(renderLandingPage(buildPublicStats(agg, uniqueInstalls, npmTotal, globalStats)));
});

// Per-user dashboard (extracted to src/pages/dashboard.ts)
app.get('/dashboard/:userId', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(renderDashboard(req.params.userId as string));
});

// Public per-user stats API (for dashboard live polling)
app.get('/api/dashboard/:userId', rateLimitPublic, (req: Request, res: Response) => {
    const stats = getUserStats(req.params.userId as string);
    if (!stats) return res.json({ stats: null, sessions: [] });
    const sessions = getUserSessions(req.params.userId as string)
        .sort((a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime());
    res.json({ stats, sessions });
});

// Health endpoint — reports mode and configured providers
app.get('/health', (req: Request, res: Response) => {
    const { valid, missing } = validateAllKeys();
    const isPublicMode = process.env.PUBLIC_MODE !== 'false' && process.env.PUBLIC_MODE !== '0';
    res.json({
        status: 'ok',
        mode: isPublicMode ? 'public' : 'local',
        version: '0.6.0',
        providers: valid.map(v => v.toLowerCase()),
        missingProviders: missing.map(m => m.toLowerCase()),
    });
});

app.use(authMiddleware);

app.use(async (req: Request, res: Response) => {
    try {
        await handleProxyRequest(req, res);
    } catch (error) {
        console.error('[PROXY ERROR]', error);
        if (!res.headersSent) {
            res.status(500).json({ error: { message: 'Internal Server Error in Agentic Firewall Proxy' } });
        }
    }
});

// LOCAL-FIRST: Validate provider keys on startup
const keyValidation = validateAllKeys();
const isPublicMode = process.env.PUBLIC_MODE !== 'false' && process.env.PUBLIC_MODE !== '0';

if (!isPublicMode) {
    if (keyValidation.valid.length > 0) {
        console.log(`[FIREWALL LOCAL] Provider keys loaded: ${keyValidation.valid.join(', ')}`);
    }
    if (keyValidation.missing.length > 0) {
        console.warn(`[FIREWALL LOCAL] No keys for: ${keyValidation.missing.join(', ')} — run: npx vibe-billing setup`);
    }
}

// Bind to 127.0.0.1 by default unless BIND_HOST is overridden
const BIND_HOST = process.env.BIND_HOST || '127.0.0.1';
const server = app.listen(Number(PORT), BIND_HOST, () => {
    if (isPublicMode) {
        console.log(`[FIREWALL PUBLIC] Agentic Firewall running at http://${BIND_HOST}:${PORT} (public remote mode)`);
        console.log(`[FIREWALL PUBLIC] Proxy requires agents to pass their own keys in request headers.`);
    } else {
        console.log(`[FIREWALL LOCAL] Agentic Firewall running at http://${BIND_HOST}:${PORT} (local-first mode)`);
        console.log(`[FIREWALL LOCAL] API keys never leave this machine.`);
    }
});

// Explicitly unbounding timeouts for massive Agent LLM evaluations (30 minutes)
server.keepAliveTimeout = 1000 * 60 * 30;
server.headersTimeout = 1000 * 60 * 31;
server.timeout = 1000 * 60 * 30;

// Flush telemetry on graceful shutdown
process.on('SIGTERM', () => flushTelemetry(globalStats, Object.keys(getQueueStats())));
process.on('SIGINT', () => flushTelemetry(globalStats, Object.keys(getQueueStats())));
