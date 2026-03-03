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

app.get('/api/stats', (req: Request, res: Response) => {
    res.json(globalStats);
});

// CLI registration telemetry
const registrations: any[] = [];
app.post('/api/register', express.json(), (req: Request, res: Response) => {
    const ping = { ...req.body, ip: req.ip, receivedAt: new Date().toISOString() };
    registrations.push(ping);
    console.log(`[REGISTER] 📥 Setup complete from ${req.ip} — ${ping.platform}/${ping.arch} node ${ping.node} v${ping.version}`);
    res.json({ ok: true, totalRegistrations: registrations.length });
});

app.get('/api/registrations', requireAdmin, (req: Request, res: Response) => {
    res.json({ total: registrations.length, registrations });
});

// Per-user stats API
import { getUserStats, getAggregateStats, exportUserData, importUserData } from './budgetGovernor';
import { getNoProgressStats } from './noProgress';
import { renderLandingPage } from './pages/landing';
import { renderDashboard } from './pages/dashboard';
import { getAllSessions, getSessionStats, getUserSessions, exportSessionData, importSessionData, expireStaleSessions } from './sessionTracker';
import { getQueueStats } from './requestQueue';
import { getCacheStats } from './responseCache';
import { getCompressionStats } from './promptCompressor';

// Load persisted user data on startup
import fs from 'fs';
const USERS_FILE = path.join(__dirname, '..', 'users.json');
const SESSIONS_FILE = path.join(__dirname, '..', 'sessions.json');
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

// Persist user + session data every 30 seconds (non-blocking async write)
setInterval(async () => {
    try {
        await fs.promises.writeFile(USERS_FILE, JSON.stringify(exportUserData(), null, 2));
    } catch (err) {
        console.error('[USERS] ⚠️ Failed to write users.json:', err);
    }
    try {
        await fs.promises.writeFile(SESSIONS_FILE, JSON.stringify(exportSessionData(), null, 2));
    } catch (err) {
        console.error('[SESSIONS] ⚠️ Failed to write sessions.json:', err);
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
    res.json({ ...agg, ...np, ...globalStats, queue: queueStats, cache: cacheStats, compression: compressionStats });
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
if (keyValidation.valid.length > 0) {
    console.log(`[FIREWALL LOCAL] Provider keys loaded: ${keyValidation.valid.join(', ')}`);
}
if (keyValidation.missing.length > 0) {
    console.warn(`[FIREWALL LOCAL] No keys for: ${keyValidation.missing.join(', ')} — run: npx agentic-firewall setup`);
}

// LOCAL-FIRST: Bind to 127.0.0.1 only — reject external connections at the network level
const BIND_HOST = process.env.BIND_HOST || '127.0.0.1';
const server = app.listen(Number(PORT), BIND_HOST, () => {
    console.log(`[FIREWALL LOCAL] Agentic Firewall running at http://${BIND_HOST}:${PORT} (local-first mode)`);
    console.log(`[FIREWALL LOCAL] API keys never leave this machine.`);
});

// Explicitly unbounding timeouts for massive Agent LLM evaluations (30 minutes)
server.keepAliveTimeout = 1000 * 60 * 30;
server.headersTimeout = 1000 * 60 * 31;
server.timeout = 1000 * 60 * 30;
