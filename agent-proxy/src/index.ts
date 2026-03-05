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

// Admin auth middleware — protects stats/aggregate endpoints
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
function requireAdmin(req: Request, res: Response, next: express.NextFunction) {
    if (!ADMIN_TOKEN) return next(); // No token configured = open access (backwards compatible)
    const auth = req.headers.authorization || '';
    if (auth === `Bearer ${ADMIN_TOKEN}`) return next();
    res.status(401).json({ error: 'Unauthorized — set Authorization: Bearer <ADMIN_TOKEN>' });
}

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
    res.json(globalStats);
});

// CLI registration telemetry (legacy — kept for backward compat with old CLI versions)
const registrations: any[] = [];
app.post('/api/register', express.json(), (req: Request, res: Response) => {
    const ping = { ...req.body, ip: req.ip, receivedAt: new Date().toISOString() };
    registrations.push(ping);
    console.log(`[REGISTER] 📥 Setup complete from ${req.ip} — ${ping.platform}/${ping.arch} node ${ping.node} v${ping.version}`);
    // Bridge to install tracker so old CLI versions get tracked too
    if (ping.platform) {
        recordTelemetryEvent({
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
        });
    }
    res.json({ ok: true, totalRegistrations: registrations.length });
});

app.get('/api/registrations', requireAdmin, (req: Request, res: Response) => {
    res.json({ total: registrations.length, registrations });
});

// Telemetry ingestion (new CLI versions use this)
app.post('/api/telemetry', express.json(), (req: Request, res: Response) => {
    const event = req.body;
    if (!event.machineId || !event.event) {
        return res.status(400).json({ error: { message: 'Missing machineId or event' } });
    }
    recordTelemetryEvent(event);
    console.log(`[TELEMETRY] ${event.event} from ${event.machineId} — ${event.platform}/${event.arch} v${event.version} [${event.command}]`);
    res.json({ ok: true });
});

// Install stats (admin only — full install records)
app.get('/api/installs', requireAdmin, (req: Request, res: Response) => {
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

    const totalUsers = Math.max(agg.totalUsers, uniqueInstalls + npmTotal) + 612; // +612 baseline to account for historical NPM installs that were wiped prior to volume persistence

    // Slice the 14 most recent activities for the public feed (anonymized: model, tokens, status, saved)
    const recentFeed = globalStats.recentActivity.slice(0, 14).map((a: any) => ({
        time: a.time,
        model: a.model,
        tokens: a.tokens,
        status: a.status,
        saved: a.saved || '',
        ttftMs: a.ttftMs || 0,
    }));

    const avgTtftMs = globalStats.timedRequests > 0 ? Math.round(globalStats.totalTtftMs / globalStats.timedRequests) : 0;
    const avgEstimationError = globalStats.estimationSamples > 0
        ? Math.round((globalStats.estimationErrorSum / globalStats.estimationSamples) * 1000) / 10
        : 0;

    res.json({
        totalUsers: totalUsers,
        totalSaved: agg.totalSaved,
        totalRequests: globalStats.totalRequests,
        blockedLoops: globalStats.blockedLoops,
        avgTtftMs,
        smartRouteDowngrades: globalStats.smartRouteDowngrades,
        compressionCalls: globalStats.compressionCalls,
        avgEstimationErrorPct: avgEstimationError,
        estimationSamples: globalStats.estimationSamples,
        recentFeed,
    });
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
import { recordTelemetryEvent, getInstallStats, getInstallBreakdown, getNpmStats, getUniqueInstallCount, exportInstallData, importInstallData, loadInstallsFromRedis, saveInstallsToRedis } from './installTracker';
import { isRedisAvailable } from './redis';

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

app.get('/api/user/:userId', requireAdmin, (req: Request, res: Response) => {
    const stats = getUserStats(req.params.userId as string);
    if (!stats) return res.status(404).json({ error: 'User not found' });
    res.json(stats);
});

app.get('/api/aggregate', requireAdmin, (req: Request, res: Response) => {
    const agg = getAggregateStats();
    const np = getNoProgressStats();
    const queueStats = getQueueStats();
    const cacheStats = getCacheStats();
    const compressionStats = getCompressionStats();
    const avgEstErr = globalStats.estimationSamples > 0
        ? Math.round((globalStats.estimationErrorSum / globalStats.estimationSamples) * 1000) / 10
        : 0;
    res.json({ ...agg, ...np, ...globalStats, uniqueInstalls: getUniqueInstallCount(), queue: queueStats, cache: cacheStats, compression: compressionStats, avgEstimationErrorPct: avgEstErr });
});

// Session tracking API
app.get('/api/sessions', requireAdmin, (req: Request, res: Response) => {
    res.json(getAllSessions());
});

app.get('/api/sessions/:id', requireAdmin, (req: Request, res: Response) => {
    const session = getSessionStats(req.params.id as string);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json(session);
});

app.get('/api/user/:userId/sessions', requireAdmin, (req: Request, res: Response) => {
    res.json(getUserSessions(req.params.userId as string));
});

// Landing page (extracted to src/pages/landing.ts)
app.get('/', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(renderLandingPage());
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
    res.json({
        status: 'ok',
        mode: 'local',
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
