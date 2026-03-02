import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { handleProxyRequest } from './proxyHandler';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
// Parse JSON bodies (up to 50mb for large agent contexts)
import { globalStats } from './stats';
app.use(express.json({ limit: '50mb' }));

app.get('/api/stats', (req: Request, res: Response) => {
    res.json(globalStats);
});

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

app.listen(PORT, () => {
    console.log(`🚀 Agentic Firewall Proxy running at http://localhost:${PORT}`);
});
