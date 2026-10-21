import crypto from 'crypto';

const DEFAULT_ADMIN_PIN = '8825316434';
const DEFAULT_JWT_SECRET = 'zoya-secret-jwt-key-release-mgr-2026';

export function getAdminPin(): string {
  return (process.env.ZOYA_ADMIN_PIN || DEFAULT_ADMIN_PIN).trim();
}

export function getJwtSecret(): string {
  return process.env.ADMIN_JWT_SECRET || DEFAULT_JWT_SECRET;
}

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
    .createHmac('sha256', getJwtSecret())
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
      .createHmac('sha256', getJwtSecret())
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
      email: decoded.email || 'admin@zoya.ai',
      role: 'admin',
      name: decoded.name || 'Administrator',
    };
  } catch (err) {
    return null;
  }
}

/**
 * Authenticates admin PIN input securely against ZOYA_ADMIN_PIN
 */
export function authenticateAdminPin(pin: string): AdminUser | null {
  const cleanPin = (pin || '').trim();
  const targetPin = getAdminPin();

  if (cleanPin.length > 0 && cleanPin === targetPin) {
    return {
      email: 'admin@zoya.ai',
      role: 'admin',
      name: 'Riyajul (Administrator)',
    };
  }

  return null;
}

/**
 * Legacy credential fallback
 */
export function authenticateAdmin(email: string, password: string): AdminUser | null {
  const targetPassword = process.env.ADMIN_PASSWORD || 'zoya-admin-2026';
  if ((password && password === targetPassword) || (email && email.toLowerCase() === 'riyajulansari113b@gmail.com' && password === targetPassword)) {
    return {
      email: 'riyajulansari113b@gmail.com',
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

  const rawCookie = reqHeaders['cookie'] || reqHeaders['Cookie'];
  const cookieHeaders = Array.isArray(rawCookie) ? rawCookie : typeof rawCookie === 'string' ? [rawCookie] : [];

  for (const cookieHeader of cookieHeaders) {
    const cookies = cookieHeader.split(';').map((c) => c.trim());
    for (const c of cookies) {
      if (c.startsWith('zoya_admin_token=')) {
        return c.substring('zoya_admin_token='.length);
      }
    }
  }

  return null;
}
