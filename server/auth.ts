import crypto from 'crypto';
import type { IncomingMessage } from 'http';

export class AdminAuthConfigurationError extends Error {
  public readonly status = 500;
  public readonly code = 'ADMIN_AUTH_NOT_CONFIGURED';

  constructor(message: string) {
    super(message);
    this.name = 'AdminAuthConfigurationError';
  }
}

export function getAdminPin(): string {
  const envPin = process.env.ZOYA_ADMIN_PIN;
  const cleanPin = envPin !== undefined && envPin !== null ? String(envPin).trim() : '';
  if (!cleanPin) {
    throw new AdminAuthConfigurationError(
      'Admin authentication is not configured on the server: ZOYA_ADMIN_PIN environment variable is required.'
    );
  }
  return cleanPin;
}

export function getJwtSecret(): string {
  const envSecret = process.env.ADMIN_JWT_SECRET;
  const cleanSecret =
    envSecret !== undefined && envSecret !== null ? String(envSecret).trim() : '';

  if (
    !cleanSecret ||
    Buffer.byteLength(cleanSecret, 'utf-8') < 16 ||
    cleanSecret.startsWith('CHANGE_ME')
  ) {
    throw new AdminAuthConfigurationError(
      'Admin JWT signing is not configured on the server: ADMIN_JWT_SECRET environment variable (minimum 16 bytes, 32+ recommended) is required.'
    );
  }

  return cleanSecret;
}

export interface AdminUser {
  email: string;
  role: 'admin';
  name: string;
}

/**
 * Creates a signed stateless token: base64(header).base64(payload).signature
 */
export function createToken(user: AdminUser): string {
  const jwtSecret = getJwtSecret();
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      email: user.email,
      role: user.role,
      name: user.name,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 2, // 2-hour session expiration
    })
  ).toString('base64url');

  const signature = crypto
    .createHmac('sha256', jwtSecret)
    .update(`${header}.${payload}`)
    .digest('base64url');

  return `${header}.${payload}.${signature}`;
}

/**
 * Verifies a token and returns the admin payload if valid.
 * Propagates AdminAuthConfigurationError if ADMIN_JWT_SECRET is missing or invalid.
 */
export function verifyToken(token: string | null | undefined): AdminUser | null {
  if (!token) return null;

  const jwtSecret = getJwtSecret();

  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [header, payload, signature] = parts;
    const expectedSignature = crypto
      .createHmac('sha256', jwtSecret)
      .update(`${header}.${payload}`)
      .digest('base64url');

    const sigBuf = Buffer.from(signature, 'utf-8');
    const expectedBuf = Buffer.from(expectedSignature, 'utf-8');
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      return null;
    }

    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
    if (!decoded.exp || decoded.exp < Math.floor(Date.now() / 1000)) {
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
    if (err instanceof AdminAuthConfigurationError) {
      throw err;
    }
    return null;
  }
}

/**
 * Authenticates admin PIN input securely against ZOYA_ADMIN_PIN (always handled as string)
 */
export function authenticateAdminPin(pin: unknown): AdminUser | null {
  if (pin === undefined || pin === null) return null;
  const targetPin = getAdminPin();
  const cleanPin = String(pin).trim();
  if (!cleanPin) return null;

  const cleanBuf = Buffer.from(cleanPin, 'utf-8');
  const targetBuf = Buffer.from(targetPin, 'utf-8');

  if (cleanBuf.length === targetBuf.length && crypto.timingSafeEqual(cleanBuf, targetBuf)) {
    return {
      email: 'admin@zoya.ai',
      role: 'admin',
      name: 'Riyajul (Administrator)',
    };
  }

  return null;
}

/**
 * Legacy credential fallback (only active if ADMIN_PASSWORD is explicitly configured in environment, or if PIN is passed as password)
 */
export function authenticateAdmin(email: string, password: string): AdminUser | null {
  const pinMatch = authenticateAdminPin(password);
  if (pinMatch) {
    return pinMatch;
  }

  const targetPassword = (process.env.ADMIN_PASSWORD || '').trim();
  if (!targetPassword || !password) {
    return null;
  }

  const passBuf = Buffer.from(password, 'utf-8');
  const targetBuf = Buffer.from(targetPassword, 'utf-8');
  if (passBuf.length === targetBuf.length && crypto.timingSafeEqual(passBuf, targetBuf)) {
    return {
      email: email?.trim().toLowerCase() || 'riyajulansari113b@gmail.com',
      role: 'admin',
      name: 'Riyajul (Administrator)',
    };
  }

  return null;
}

export interface ExtractedAuthToken {
  token: string | null;
  source: 'bearer' | 'cookie' | null;
}

/**
 * Extracts Bearer token from Authorization header or zoya_admin_token cookie
 * and identifies which source supplied the verified token.
 */
export function extractAuthTokenDetails(
  reqHeaders: IncomingMessage['headers'] | Record<string, string | string[] | undefined>
): ExtractedAuthToken {
  if (!reqHeaders) return { token: null, source: null };

  let bearerCandidate: string | null = null;
  const authHeader = reqHeaders['authorization'] || reqHeaders['Authorization'];
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const bearer = authHeader.substring(7).trim();
    if (bearer && bearer !== 'cookie-session') {
      bearerCandidate = bearer;
      if (verifyToken(bearerCandidate)) {
        return { token: bearerCandidate, source: 'bearer' };
      }
    }
  }

  let cookieCandidate: string | null = null;
  const rawCookie = reqHeaders['cookie'] || reqHeaders['Cookie'];
  const cookieHeaders = Array.isArray(rawCookie) ? rawCookie : typeof rawCookie === 'string' ? [rawCookie] : [];

  for (const cookieHeader of cookieHeaders) {
    const cookies = cookieHeader.split(';').map((c) => c.trim());
    for (const c of cookies) {
      if (c.startsWith('zoya_admin_token=')) {
        const val = c.substring('zoya_admin_token='.length).trim();
        if (val && val !== 'cookie-session') {
          cookieCandidate = val;
          if (verifyToken(cookieCandidate)) {
            return { token: cookieCandidate, source: 'cookie' };
          }
        }
      }
    }
  }

  if (bearerCandidate) {
    return { token: bearerCandidate, source: 'bearer' };
  }
  if (cookieCandidate) {
    return { token: cookieCandidate, source: 'cookie' };
  }
  return { token: null, source: null };
}

/**
 * Extracts Bearer token from Authorization header or cookie.
 * If both a Bearer header and a zoya_admin_token cookie are present, and the Bearer
 * header is expired/invalid while the cookie token is valid, falls back to the valid cookie token.
 */
export function extractAuthToken(
  reqHeaders: IncomingMessage['headers'] | Record<string, string | string[] | undefined>
): string | null {
  return extractAuthTokenDetails(reqHeaders).token;
}
