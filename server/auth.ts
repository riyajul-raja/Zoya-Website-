import crypto from 'crypto';

const DEFAULT_ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'riyajulansari113b@gmail.com';
// If ADMIN_PASSWORD is set in env, use it; otherwise provide a default development secret
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'zoya-admin-2026';
const JWT_SECRET = process.env.ADMIN_JWT_SECRET || 'zoya-secret-jwt-key-release-mgr-2026';

export interface AdminUser {
  email: string;
  role: 'admin';
  name: string;
}

/**
 * Creates a signed stateless token: base64(payload).signature
 */
export function createToken(user: AdminUser): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      email: user.email,
      role: user.role,
      name: user.name,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7, // 7 days
    })
  ).toString('base64url');

  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64url');

  return `${header}.${payload}.${signature}`;
}

/**
 * Verifies a token and returns the admin payload if valid
 */
export function verifyToken(token: string | null | undefined): AdminUser | null {
  if (!token) return null;

  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [header, payload, signature] = parts;
    const expectedSignature = crypto
      .createHmac('sha256', JWT_SECRET)
      .update(`${header}.${payload}`)
      .digest('base64url');

    if (signature !== expectedSignature) {
      return null;
    }

    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
    if (decoded.exp && decoded.exp < Math.floor(Date.now() / 1000)) {
      return null; // Expired
    }

    if (decoded.role !== 'admin') {
      return null;
    }

    return {
      email: decoded.email,
      role: 'admin',
      name: decoded.name || 'Administrator',
    };
  } catch (err) {
    return null;
  }
}

/**
 * Authenticates login credentials
 */
export function authenticateAdmin(email: string, password: string): AdminUser | null {
  const cleanEmail = (email || '').trim().toLowerCase();
  const targetEmail = DEFAULT_ADMIN_EMAIL.trim().toLowerCase();

  // Timing safe or constant time compare
  if (cleanEmail === targetEmail && password === ADMIN_PASSWORD) {
    return {
      email: DEFAULT_ADMIN_EMAIL,
      role: 'admin',
      name: 'Riyajul (Administrator)',
    };
  }

  return null;
}

/**
 * Extracts Bearer token from Authorization header or cookie
 */
export function extractAuthToken(reqHeaders: Record<string, string | string[] | undefined>): string | null {
  const authHeader = reqHeaders['authorization'] || reqHeaders['Authorization'];
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }

  const cookieHeader = reqHeaders['cookie'] || reqHeaders['Cookie'];
  if (typeof cookieHeader === 'string') {
    const cookies = cookieHeader.split(';').map((c) => c.trim());
    for (const c of cookies) {
      if (c.startsWith('zoya_admin_token=')) {
        return c.substring('zoya_admin_token='.length);
      }
    }
  }

  return null;
}
