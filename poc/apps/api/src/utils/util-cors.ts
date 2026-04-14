import { cors } from 'hono/cors';

export function configureCors(
  allowMethods = ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
) {
  return cors({
    origin: (origin, c) => {
      if (isValidCorsOrigin(origin, c.env?.ALLOWED_CORS_ORIGINS)) {
        return origin;
      }

      return null;
    },
    allowMethods,
    allowHeaders: ['Content-Type', 'mcp-session-id', 'x-pd-mcp-chat-id', 'mcp-protocol-version'],
    exposeHeaders: ['Mcp-Session-Id'],
  });
}

function isValidCorsOrigin(origin: string, allowedOrigins?: string): boolean {
  try {
    const url = new URL(origin);
    const hostname = url.hostname.toLowerCase();

    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return true;
    }

    const allowedHosts =
      allowedOrigins
        ?.split(',')
        .map((h) => h.trim().toLowerCase())
        .filter((h) => h.length > 0) || [];

    return allowedHosts.some((allowedHost) => {
      return hostname === allowedHost || hostname.endsWith('.' + allowedHost);
    });
  } catch {
    return false;
  }
}
