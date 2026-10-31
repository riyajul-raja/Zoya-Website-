import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, Plugin } from 'vite';

const PRODUCTION_API_ORIGIN = (
  process.env.PUBLIC_SITE_URL || 'https://zoya-website-eta.vercel.app'
).replace(/\/+$/, '');

function hasLocalFirebaseAdminCredentials(): boolean {
  const rawJson = (process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  const rawKey = (process.env.FIREBASE_PRIVATE_KEY || '').trim();
  return rawJson.length > 0 || rawKey.length > 0;
}

interface ProxyRouteRule {
  method: string;
  pattern: RegExp;
}

// Strict allowlist of Admin Portal endpoints proxied to the live Vercel backend
// when FIREBASE_SERVICE_ACCOUNT_JSON is not configured in the local container.
// Public routes (/api/devices/register, /api/licenses/validate, /api/releases/*)
// and unknown routes are NEVER proxied to avoid unintended production mutations.
const ADMIN_PROXY_ALLOWLIST: ProxyRouteRule[] = [
  // 1. Admin Authentication & Session
  { method: 'POST', pattern: /^\/api\/admin\/login$/ },
  { method: 'GET', pattern: /^\/api\/admin\/session$/ },
  { method: 'POST', pattern: /^\/api\/admin\/logout$/ },

  // 2. Lifetime License Management (Read, Generate, Detail, Decrypt Key, Revoke)
  { method: 'GET', pattern: /^\/api\/admin\/licenses$/ },
  { method: 'POST', pattern: /^\/api\/admin\/licenses$/ },
  { method: 'GET', pattern: /^\/api\/admin\/licenses\/[a-zA-Z0-9_-]+(\/key)?$/ },
  { method: 'POST', pattern: /^\/api\/admin\/licenses\/[a-zA-Z0-9_-]+(\/key)?$/ },
  { method: 'PATCH', pattern: /^\/api\/admin\/licenses\/[a-zA-Z0-9_-]+$/ },

  // 3. APK Release Management & Administrator Notifications
  { method: 'GET', pattern: /^\/api\/admin\/releases$/ },
  { method: 'POST', pattern: /^\/api\/admin\/upload$/ },
  { method: 'POST', pattern: /^\/api\/admin\/publish$/ },
  { method: 'DELETE', pattern: /^\/api\/admin\/releases(\/[a-zA-Z0-9_-]+)?$/ },
  { method: 'POST', pattern: /^\/api\/admin\/notify$/ },
];

function isAllowedAdminProxyRoute(method: string, pathname: string): boolean {
  const normMethod = method.toUpperCase();
  const normPath = pathname.replace(/\/+$/, '') || '/';
  return ADMIN_PROXY_ALLOWLIST.some(
    (rule) => rule.method === normMethod && rule.pattern.test(normPath)
  );
}

function apiDevMiddleware(): Plugin {
  return {
    name: 'api-dev-middleware',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url && req.url.startsWith('/api/')) {
          try {
            const parsedUrl = new URL(req.url, 'http://localhost:3000');
            const pathname = parsedUrl.pathname.replace(/\/+$/, '') || '/';
            const method = (req.method || 'GET').toUpperCase();

            // Proxy to live Vercel backend ONLY if local Firebase Admin credentials
            // are missing AND the requested route is on the strict Admin allowlist.
            if (!hasLocalFirebaseAdminCredentials() && isAllowedAdminProxyRoute(method, pathname)) {
              const targetUrl = `${PRODUCTION_API_ORIGIN}${req.url}`;

              const forwardHeaders: Record<string, string> = {};
              const allowedHeaders = [
                'authorization',
                'cookie',
                'content-type',
                'accept',
                'x-filename',
                'x-requested-with',
              ];
              for (const h of allowedHeaders) {
                const val = req.headers[h];
                if (typeof val === 'string' && val.length > 0) {
                  forwardHeaders[h] = val;
                } else if (Array.isArray(val) && val.length > 0) {
                  forwardHeaders[h] = val.join('; ');
                }
              }

              let bodyBuffer: Buffer | undefined;
              if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
                const chunks: Buffer[] = [];
                for await (const chunk of req) {
                  chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
                }
                if (chunks.length > 0) {
                  bodyBuffer = Buffer.concat(chunks);
                }
              }

              const upstreamRes = await fetch(targetUrl, {
                method,
                headers: forwardHeaders,
                body: bodyBuffer ? new Uint8Array(bodyBuffer) : undefined,
                redirect: 'manual',
              });

              res.statusCode = upstreamRes.status;
              const passThroughHeaders = [
                'content-type',
                'cache-control',
                'content-disposition',
                'set-cookie',
                'x-ratelimit-limit',
                'x-ratelimit-remaining',
                'x-ratelimit-reset',
                'retry-after',
              ];
              for (const h of passThroughHeaders) {
                const val = upstreamRes.headers.get(h);
                if (val) {
                  res.setHeader(h, val);
                }
              }

              const respBuf = Buffer.from(await upstreamRes.arrayBuffer());
              res.end(respBuf);
              return;
            }

            const mod = await server.ssrLoadModule('/server/apiHandler.ts');
            const handled = await mod.handleApiRequest(req, res);
            if (handled) return;
          } catch (err) {
            console.error('Error handling API request:', err);
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Internal Server Error' }));
            return;
          }
        }
        next();
      });
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), apiDevMiddleware()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
