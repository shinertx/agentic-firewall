import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { handleProxyRequest } from './proxyHandler';
import { authMiddleware } from './authMiddleware';

dotenv.config();

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

app.get('/api/stats', requireAdmin, (req: Request, res: Response) => {
    res.json(globalStats);
});

// Per-user stats API
import { getUserStats, getAggregateStats, exportUserData, importUserData } from './budgetGovernor';
import { getNoProgressStats } from './noProgress';
import { renderLandingPage } from './pages/landing';
import { renderDashboard } from './pages/dashboard';

// Load persisted user data on startup
import fs from 'fs';
import path from 'path';
const USERS_FILE = path.join(__dirname, '..', 'users.json');
try {
    if (fs.existsSync(USERS_FILE)) {
        const raw = fs.readFileSync(USERS_FILE, 'utf-8');
        importUserData(JSON.parse(raw));
        console.log('[USERS] 📂 Loaded persisted user data');
    }
} catch (err) {
    console.error('[USERS] ⚠️ Failed to load users.json:', err);
}

// Persist user data every 30 seconds (alongside stats.json)
setInterval(() => {
    try {
        fs.writeFileSync(USERS_FILE, JSON.stringify(exportUserData(), null, 2));
    } catch (err) {
        console.error('[USERS] ⚠️ Failed to write users.json:', err);
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
    res.json({ ...agg, ...np, ...globalStats });
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

const server = app.listen(PORT, () => {
    console.log(`🚀 Agentic Firewall Proxy running at http://localhost:${PORT}`);
});

// Explicitly unbounding timeouts for massive Agent LLM evaluations (30 minutes)
server.keepAliveTimeout = 1000 * 60 * 30;
server.headersTimeout = 1000 * 60 * 31;
server.timeout = 1000 * 60 * 30;
