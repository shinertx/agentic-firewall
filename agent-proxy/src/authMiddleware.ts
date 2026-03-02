import { Request, Response, NextFunction } from 'express';

/**
 * Auth middleware — rejects requests that carry no API key.
 * Agents MUST send their real API key (Anthropic or OpenAI) via the
 * standard headers. The proxy forwards this key upstream unchanged.
 *
 * This prevents random internet scanners from routing traffic through
 * the proxy using YOUR provider API keys.
 *
 * Allowlisted routes: /api/stats (dashboard), /health
 */
const OPEN_ROUTES = ['/api/stats', '/health'];

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
    // Allow dashboard and health endpoints without auth
    if (OPEN_ROUTES.some(route => req.path.startsWith(route))) {
        return next();
    }

    // Allow GET/HEAD/OPTIONS without auth (model listings, CORS preflight)
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        return next();
    }

    // Check for API key in standard headers
    const hasAnthropicKey = !!req.headers['x-api-key'];
    const hasAuthHeader = !!req.headers['authorization'];

    if (!hasAnthropicKey && !hasAuthHeader) {
        console.log(`[AUTH] 🚫 Rejected unauthenticated ${req.method} from ${req.ip}`);
        return res.status(401).json({
            error: {
                type: 'authentication_error',
                message: 'Agentic Firewall: No API key provided. Include your provider API key via Authorization or x-api-key header.'
            }
        });
    }

    next();
}
