import { Request, Response, NextFunction } from 'express';

/**
 * Auth middleware — LOCAL-FIRST mode.
 *
 * In local mode, the proxy runs on the user's machine (localhost:4000).
 * API keys are read from env vars, NOT from request headers.
 *
 * This middleware:
 * 1. Rejects requests from non-localhost origins (403)
 * 2. Optionally validates a local token (if LOCAL_TOKEN env var is set)
 * 3. Allows dashboard/health endpoints without restriction
 *
 * This replaces the old remote-mode middleware that required agents
 * to send provider API keys in request headers.
 */
const OPEN_ROUTES = ['/api/stats', '/health', '/api/aggregate'];

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
    // Allow dashboard and health endpoints without auth
    if (OPEN_ROUTES.some(route => req.path.startsWith(route))) {
        return next();
    }

    // Allow GET/HEAD/OPTIONS without auth (model listings, CORS preflight, dashboard)
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        return next();
    }

    // LOCAL-FIRST: Reject requests from non-localhost origins
    const clientIp = req.ip || req.socket.remoteAddress || '';
    const isLocalhost = clientIp === '127.0.0.1' ||
                        clientIp === '::1' ||
                        clientIp === '::ffff:127.0.0.1' ||
                        clientIp === 'localhost';

    if (!isLocalhost) {
        console.log(`[AUTH] Rejected non-localhost ${req.method} from ${clientIp}`);
        return res.status(403).json({
            error: {
                type: 'localhost_only',
                message: 'Agentic Firewall runs locally. Requests must come from localhost. Run: npx agentic-firewall setup',
            }
        });
    }

    // Optional local token validation (if LOCAL_TOKEN env var is configured)
    const localToken = process.env.LOCAL_TOKEN;
    if (localToken) {
        const requestToken = req.headers['x-firewall-token'] as string;
        if (requestToken !== localToken) {
            console.log(`[AUTH] Invalid local token from ${clientIp}`);
            return res.status(401).json({
                error: {
                    type: 'authentication_error',
                    message: 'Invalid local token. Set x-firewall-token header to match LOCAL_TOKEN env var.',
                }
            });
        }
    }

    next();
}
