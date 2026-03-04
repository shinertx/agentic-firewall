import { Request, Response, NextFunction } from 'express';

/**
 * Auth middleware — PUBLIC or LOCAL mode.
 *
 * In PUBLIC mode (default for deployed proxy), the proxy allows external traffic
 * but REQUIRES agents to send their own provider API keys in the headers.
 *
 * In LOCAL mode (if PUBLIC_MODE=false), it only allows localhost requests.
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

    const isPublicMode = process.env.PUBLIC_MODE !== 'false' && process.env.PUBLIC_MODE !== '0';

    if (!isPublicMode) {
        // LOCAL-FIRST: Reject requests from non-localhost origins
        const clientIp = req.ip || req.socket.remoteAddress || '';
        const isLocalhost = clientIp === '127.0.0.1' ||
            clientIp === '::1' ||
            clientIp === '::ffff:127.0.0.1' ||
            clientIp === 'localhost' ||
            clientIp.startsWith('172.'); // Allow docker bridge if strictly local but proxied

        if (!isLocalhost) {
            console.log(`[AUTH] Rejected non-localhost ${req.method} from ${clientIp}`);
            return res.status(403).json({
                error: {
                    type: 'localhost_only',
                    message: 'Agentic Firewall runs locally. Requests must come from localhost. Run: npx agentic-firewall setup',
                }
            });
        }
    }

    // Check for API key in standard headers (Required for PUBLIC mode to prevent open proxies)
    const hasAnthropicKey = !!req.headers['x-api-key'];
    const hasAuthHeader = !!req.headers['authorization'];
    const hasGoogleKey = !!req.headers['x-goog-api-key'];

    if (!hasAnthropicKey && !hasAuthHeader && !hasGoogleKey) {
        console.log(`[AUTH] 🚫 Rejected unauthenticated ${req.method} from ${req.ip}`);
        return res.status(401).json({
            error: {
                type: 'authentication_error',
                message: 'Agentic Firewall: No API key provided. Include your provider API key via Authorization, x-api-key, or x-goog-api-key header. ' +
                    'If running locally, run: npx vibe-billing setup'
            }
        });
    }

    // Optional local token validation (if LOCAL_TOKEN env var is configured)
    const localToken = process.env.LOCAL_TOKEN;
    if (localToken) {
        const requestToken = req.headers['x-firewall-token'] as string;
        if (requestToken !== localToken) {
            console.log(`[AUTH] Invalid local token from ${req.ip}`);
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
