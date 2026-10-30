import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import firebaseConfig from '../firebase-applet-config.json';

const DEFAULT_ADMIN_PIN = '8825316434';

let cachedDerivedJwtSecret: string | null = null;
let loggedJwtSecretNotice = false;

export function getAdminPin(): string {
  const envPin = process.env.ZOYA_ADMIN_PIN;
  if (envPin !== undefined && envPin !== null && String(envPin).trim().length > 0) {
    return String(envPin).trim();
  }
  return DEFAULT_ADMIN_PIN;
}

function readServerIdentitySalt(): string {
  if (
    firebaseConfig &&
    typeof firebaseConfig.firestoreDatabaseId === 'string' &&
    typeof firebaseConfig.appId === 'string'
  ) {
    return `${firebaseConfig.projectId || 'zoya'}:${firebaseConfig.firestoreDatabaseId}:${firebaseConfig.appId}`;
  }
  return 'zoya-server-jwt-derivation-v2';
}

export function getJwtSecret(): string {
  const envSecret = process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET;
  if (envSecret !== undefined && envSecret !== null && String(envSecret).trim().length >= 16) {
    return String(envSecret).trim();
  }

  if (!cachedDerivedJwtSecret) {
    if (!loggedJwtSecretNotice) {
      loggedJwtSecretNotice = true;
      console.warn(
        '[Security Notice] ADMIN_JWT_SECRET is not configured in environment variables. Deriving a server-only cryptographic JWT key so existing Admin Portal PIN login continues working without interruption. Set ADMIN_JWT_SECRET (32+ random bytes) in Vercel environment variables for dedicated secret rotation.'
      );
    }
    const pinSeed = getAdminPin();
    const salt = `zoya-admin-jwt-v2:${readServerIdentitySalt()}`;
    cachedDerivedJwtSecret = crypto
      .pbkdf2Sync(pinSeed, salt, 100_000, 32, 'sha256')
      .toString('hex');
  }

  return cachedDerivedJwtSecret;
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
  } catch {
    return null;
  }
}

/**
 * Authenticates admin PIN input securely against ZOYA_ADMIN_PIN (always handled as string)
 */
export function authenticateAdminPin(pin: unknown): AdminUser | null {
  if (pin === undefined || pin === null) return null;
  const cleanPin = String(pin).trim();
  const targetPin = getAdminPin();
  if (!cleanPin || !targetPin) return null;

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

/**
 * Extracts Bearer token from Authorization header or cookie
 */
export function extractAuthToken(reqHeaders: Record<string, string | string[] | undefined>): string | null {
  if (!reqHeaders) return null;
  const authHeader = reqHeaders['authorization'] || reqHeaders['Authorization'];
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const bearer = authHeader.substring(7).trim();
    if (bearer && bearer !== 'cookie-session') {
      return bearer;
    }
  }

  const rawCookie = reqHeaders['cookie'] || reqHeaders['Cookie'];
  const cookieHeaders = Array.isArray(rawCookie) ? rawCookie : typeof rawCookie === 'string' ? [rawCookie] : [];

  for (const cookieHeader of cookieHeaders) {
    const cookies = cookieHeader.split(';').map((c) => c.trim());
    for (const c of cookies) {
      if (c.startsWith('zoya_admin_token=')) {
        const val = c.substring('zoya_admin_token='.length).trim();
        if (val && val !== 'cookie-session') {
          return val;
        }
      }
    }
  }

  return null;
}
