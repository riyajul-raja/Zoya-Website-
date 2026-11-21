import crypto from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import {
  serverGetDocumentById,
  serverSetDocumentById,
  serverDeleteDocumentById,
  serverRunTransaction,
} from './firebase';

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_JWKS_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/certs';
const VALID_GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

export const USER_SESSION_COOKIE_NAME = 'zoya_user_session';
export const OAUTH_TX_COOKIE_NAME = 'zoya_oauth_tx';

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
const OAUTH_TX_TTL_SECONDS = 60 * 10; // 10 minutes
const CLOCK_SKEW_SECONDS = 30;

export class UserAuthConfigError extends Error {
  public readonly status = 503;
  public readonly code = 'OAUTH_NOT_CONFIGURED';

  constructor(message: string) {
    super(message);
    this.name = 'UserAuthConfigError';
  }
}

export class UserAuthStorageError extends Error {
  public readonly status = 503;
  public readonly code = 'STORAGE_UNAVAILABLE';

  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'UserAuthStorageError';
  }
}

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUriOverride: string | null;
  sessionSecret: string;
}

export interface ZoyaUserRecord {
  id: string; // Immutable Google `sub`
  googleSub: string;
  email: string;
  emailVerified: boolean;
  name: string;
  picture: string | null;
  provider: 'google';
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string;
}

export interface ZoyaUserSessionRecord {
  sessionIdHash: string;
  userSub: string;
  email: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
  revoked: boolean;
  userAgentHash: string | null;
}

export interface OAuthTransactionPayload {
  state: string;
  nonce: string;
  codeVerifier: string;
  redirectUri: string;
  mode: 'redirect' | 'popup';
  createdAt: number;
  exp: number;
}

export interface VerifiedGoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
  picture: string | null;
}

export interface JwkKey {
  kty: string;
  kid?: string;
  alg?: string;
  use?: string;
  n?: string;
  e?: string;
  [key: string]: unknown;
}

interface JwksCache {
  keys: JwkKey[];
  expiresAt: number;
}

let cachedGoogleJwks: JwksCache | null = null;
let customJwksProviderForTests: (() => Promise<JwkKey[]>) | null = null;

export function setGoogleJwksProviderForTests(provider: (() => Promise<JwkKey[]>) | null): void {
  customJwksProviderForTests = provider;
  cachedGoogleJwks = null;
}

/**
 * Checks whether Google OAuth and session signing environment variables are configured.
 * Never logs or returns secret values.
 */
export function getGoogleOAuthConfigStatus(): {
  configured: boolean;
  missing: string[];
} {
  const missing: string[] = [];
  const clientId = (process.env.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || '').trim();
  const sessionSecret = (process.env.SESSION_SECRET || '').trim();

  if (!clientId) missing.push('GOOGLE_CLIENT_ID');
  if (!clientSecret) missing.push('GOOGLE_CLIENT_SECRET');
  if (!sessionSecret || Buffer.byteLength(sessionSecret, 'utf-8') < 32) {
    missing.push('SESSION_SECRET');
  }

  return {
    configured: missing.length === 0,
    missing,
  };
}

export function getGoogleOAuthConfig(): GoogleOAuthConfig {
  const status = getGoogleOAuthConfigStatus();
  if (!status.configured) {
    throw new UserAuthConfigError(
      'Google sign-in is not yet configured on the server. Required environment variables must be set by the site administrator.'
    );
  }

  const redirectUriOverride = (process.env.GOOGLE_REDIRECT_URI || '').trim() || null;

  return {
    clientId: (process.env.GOOGLE_CLIENT_ID || '').trim(),
    clientSecret: (process.env.GOOGLE_CLIENT_SECRET || '').trim(),
    redirectUriOverride,
    sessionSecret: (process.env.SESSION_SECRET || '').trim(),
  };
}

function getSessionSecretOrNull(): string | null {
  const raw = (process.env.SESSION_SECRET || '').trim();
  if (!raw || Buffer.byteLength(raw, 'utf-8') < 32) {
    return null;
  }
  return raw;
}

function deriveAesKey(secret: string, purpose: string): Buffer {
  return crypto.createHash('sha256').update(`zoya_auth_v1:${purpose}:${secret}`).digest();
}

function deriveHmacKey(secret: string, purpose: string): Buffer {
  return crypto.createHash('sha256').update(`zoya_hmac_v1:${purpose}:${secret}`).digest();
}

export function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf-8');
  const bufB = Buffer.from(b, 'utf-8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Generates PKCE verifier & S256 challenge, CSRF state, and OIDC nonce.
 */
export function generateOAuthSecurityParams(): {
  state: string;
  nonce: string;
  codeVerifier: string;
  codeChallenge: string;
} {
  const state = crypto.randomBytes(32).toString('base64url');
  const nonce = crypto.randomBytes(32).toString('base64url');
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');

  return { state, nonce, codeVerifier, codeChallenge };
}

/**
 * Encrypts and authenticates an OAuth transaction payload (state, nonce, PKCE verifier)
 * using AES-256-GCM so it can be stored safely in an HttpOnly cookie on serverless platforms.
 */
export function sealOAuthTransaction(
  payload: OAuthTransactionPayload,
  sessionSecret: string
): string {
  const key = deriveAesKey(sessionSecret, 'oauth_tx');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from('zoya_oauth_tx_v1', 'utf-8'));

  const plaintext = JSON.stringify(payload);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString('base64url')}.${authTag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

export function unsealOAuthTransaction(
  sealed: string | null | undefined,
  sessionSecret: string
): OAuthTransactionPayload | null {
  if (!sealed || typeof sealed !== 'string') return null;
  const parts = sealed.split('.');
  if (parts.length !== 3) return null;

  try {
    const iv = Buffer.from(parts[0], 'base64url');
    const authTag = Buffer.from(parts[1], 'base64url');
    const ciphertext = Buffer.from(parts[2], 'base64url');
    if (iv.length !== 12 || authTag.length !== 16 || ciphertext.length === 0) {
      return null;
    }

    const key = deriveAesKey(sessionSecret, 'oauth_tx');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.from('zoya_oauth_tx_v1', 'utf-8'));
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf-8');
    const parsed = JSON.parse(decrypted) as OAuthTransactionPayload;

    if (
      !parsed ||
      typeof parsed.state !== 'string' ||
      typeof parsed.nonce !== 'string' ||
      typeof parsed.codeVerifier !== 'string' ||
      typeof parsed.redirectUri !== 'string' ||
      typeof parsed.exp !== 'number'
    ) {
      return null;
    }

    if (parsed.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

/**
 * Resolves the canonical request origin (scheme + host) safely from incoming headers.
 */
export function resolveRequestOrigin(req: IncomingMessage): string {
  const forwardedProto = req.headers['x-forwarded-proto'];
  const rawProto = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
  const forwardedHost = req.headers['x-forwarded-host'];
  const rawHost = Array.isArray(forwardedHost)
    ? forwardedHost[0]
    : forwardedHost || req.headers.host || '';

  const host = String(rawHost).split(',')[0].trim();
  const isLocalHost =
    host.startsWith('localhost') ||
    host.startsWith('127.0.0.1') ||
    host.startsWith('[::1]');

  const proto = rawProto
    ? String(rawProto).split(',')[0].trim()
    : isLocalHost
      ? 'http'
      : 'https';

  if (host) {
    return `${proto}://${host}`;
  }

  return (process.env.PUBLIC_SITE_URL || 'https://zoyalive.vercel.app').replace(/\/+$/, '');
}

export function isHttpsRequest(req: IncomingMessage): boolean {
  return resolveRequestOrigin(req).startsWith('https://');
}

export function isEmbeddedPreviewHost(req: IncomingMessage): boolean {
  const origin = resolveRequestOrigin(req).toLowerCase();
  return origin.includes('.run.app');
}

export function resolveGoogleRedirectUri(req: IncomingMessage, override: string | null): string {
  if (override) {
    return override;
  }
  const origin = resolveRequestOrigin(req);
  return `${origin}/api/auth/google/callback`;
}

/**
 * Parses cookies from request headers cleanly.
 */
export function parseCookies(
  reqHeaders: Record<string, string | string[] | undefined>
): Record<string, string> {
  const result: Record<string, string> = {};
  const rawCookie = reqHeaders['cookie'] || reqHeaders['Cookie'];
  const headerList = Array.isArray(rawCookie)
    ? rawCookie
    : typeof rawCookie === 'string'
      ? [rawCookie]
      : [];

  for (const header of headerList) {
    for (const part of header.split(';')) {
      const idx = part.indexOf('=');
      if (idx <= 0) continue;
      const name = part.slice(0, idx).trim();
      const value = part.slice(idx + 1).trim();
      if (name) {
        result[name] = value;
      }
    }
  }
  return result;
}

export function appendSetCookieHeader(res: ServerResponse, cookieValue: string): void {
  const existing = res.getHeader('Set-Cookie');
  if (!existing) {
    res.setHeader('Set-Cookie', cookieValue);
  } else if (Array.isArray(existing)) {
    res.setHeader('Set-Cookie', [...existing, cookieValue]);
  } else {
    res.setHeader('Set-Cookie', [String(existing), cookieValue]);
  }
}

function buildCookieString(
  name: string,
  value: string,
  options: {
    maxAge: number;
    secure: boolean;
    sameSite: 'Lax' | 'None' | 'Strict';
    path?: string;
  }
): string {
  const parts = [
    `${name}=${value}`,
    `Path=${options.path || '/'}`,
    'HttpOnly',
    `SameSite=${options.sameSite}`,
    `Max-Age=${options.maxAge}`,
  ];
  if (options.secure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

export function setOAuthTxCookie(
  req: IncomingMessage,
  res: ServerResponse,
  sealedValue: string,
  mode: 'redirect' | 'popup'
): void {
  const secure = isHttpsRequest(req);
  const sameSite: 'Lax' | 'None' =
    secure && (mode === 'popup' || isEmbeddedPreviewHost(req)) ? 'None' : 'Lax';
  appendSetCookieHeader(
    res,
    buildCookieString(OAUTH_TX_COOKIE_NAME, sealedValue, {
      maxAge: OAUTH_TX_TTL_SECONDS,
      secure,
      sameSite,
    })
  );
}

export function clearOAuthTxCookie(req: IncomingMessage, res: ServerResponse): void {
  const secure = isHttpsRequest(req);
  const sameSite: 'Lax' | 'None' = secure && isEmbeddedPreviewHost(req) ? 'None' : 'Lax';
  appendSetCookieHeader(
    res,
    buildCookieString(OAUTH_TX_COOKIE_NAME, '', {
      maxAge: 0,
      secure,
      sameSite,
    })
  );
}

export function signSessionCookieValue(sessionId: string, sessionSecret: string): string {
  const sig = crypto
    .createHmac('sha256', deriveHmacKey(sessionSecret, 'session_cookie'))
    .update(sessionId)
    .digest('base64url');
  return `${sessionId}.${sig}`;
}

export function verifySignedSessionCookieValue(
  rawCookie: string | null | undefined,
  sessionSecret: string
): string | null {
  if (!rawCookie || typeof rawCookie !== 'string') return null;
  const parts = rawCookie.split('.');
  if (parts.length !== 2) return null;

  const [sessionId, sig] = parts;
  if (!sessionId || !sig || sessionId.length < 32 || sessionId.length > 128) {
    return null;
  }

  const expectedSig = crypto
    .createHmac('sha256', deriveHmacKey(sessionSecret, 'session_cookie'))
    .update(sessionId)
    .digest('base64url');

  if (!timingSafeStringEqual(sig, expectedSig)) {
    return null;
  }

  return sessionId;
}

export function hashSessionId(sessionId: string): string {
  return crypto.createHash('sha256').update(`zoya_session_v1:${sessionId}`).digest('hex');
}

export function setUserSessionCookie(
  req: IncomingMessage,
  res: ServerResponse,
  signedValue: string
): void {
  const secure = isHttpsRequest(req);
  const sameSite: 'Lax' | 'None' = secure && isEmbeddedPreviewHost(req) ? 'None' : 'Lax';
  appendSetCookieHeader(
    res,
    buildCookieString(USER_SESSION_COOKIE_NAME, signedValue, {
      maxAge: SESSION_TTL_SECONDS,
      secure,
      sameSite,
    })
  );
}

export function clearUserSessionCookie(req: IncomingMessage, res: ServerResponse): void {
  const secure = isHttpsRequest(req);
  const sameSite: 'Lax' | 'None' = secure && isEmbeddedPreviewHost(req) ? 'None' : 'Lax';
  appendSetCookieHeader(
    res,
    buildCookieString(USER_SESSION_COOKIE_NAME, '', {
      maxAge: 0,
      secure,
      sameSite,
    })
  );
}

/**
 * Strict same-origin CSRF check for cookie-authenticated state-changing endpoints (e.g., POST /api/auth/logout).
 */
export function verifySameOriginRequest(req: IncomingMessage): boolean {
  const expectedOrigin = resolveRequestOrigin(req);
  const originHeader = typeof req.headers.origin === 'string' ? req.headers.origin.trim() : '';
  const refererHeader = typeof req.headers.referer === 'string' ? req.headers.referer.trim() : '';

  if (originHeader) {
    return originHeader.replace(/\/+$/, '') === expectedOrigin.replace(/\/+$/, '');
  }
  if (refererHeader) {
    try {
      const refOrigin = new URL(refererHeader).origin;
      return refOrigin.replace(/\/+$/, '') === expectedOrigin.replace(/\/+$/, '');
    } catch {
      return false;
    }
  }

  // Reject cross-site browser requests that omit both Origin and Referer when Fetch Metadata says cross-site
  const secFetchSite = typeof req.headers['sec-fetch-site'] === 'string'
    ? req.headers['sec-fetch-site'].toLowerCase()
    : '';
  if (secFetchSite === 'cross-site') {
    return false;
  }

  return true;
}

/**
 * Applies strict security & caching headers for authenticated user/account endpoints.
 * Never sets wildcard CORS on cookie-authenticated routes.
 */
export function applyAuthSecurityHeaders(req: IncomingMessage, res: ServerResponse): void {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Vary', 'Origin, Cookie');

  const expectedOrigin = resolveRequestOrigin(req);
  const reqOrigin = typeof req.headers.origin === 'string' ? req.headers.origin.trim() : '';
  if (reqOrigin && reqOrigin.replace(/\/+$/, '') === expectedOrigin.replace(/\/+$/, '')) {
    res.setHeader('Access-Control-Allow-Origin', reqOrigin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
  }
}

/**
 * Builds the official Google OAuth 2.0 authorization URL with PKCE, state, and nonce.
 */
export function createGoogleAuthorizationStart(
  req: IncomingMessage,
  mode: 'redirect' | 'popup'
): {
  authorizationUrl: string;
  sealedTxCookie: string;
} {
  const config = getGoogleOAuthConfig();
  const redirectUri = resolveGoogleRedirectUri(req, config.redirectUriOverride);
  const { state, nonce, codeVerifier, codeChallenge } = generateOAuthSecurityParams();
  const nowSec = Math.floor(Date.now() / 1000);

  const txPayload: OAuthTransactionPayload = {
    state,
    nonce,
    codeVerifier,
    redirectUri,
    mode,
    createdAt: nowSec,
    exp: nowSec + OAUTH_TX_TTL_SECONDS,
  };

  const sealedTxCookie = sealOAuthTransaction(txPayload, config.sessionSecret);

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });

  return {
    authorizationUrl: `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`,
    sealedTxCookie,
  };
}

/**
 * Fetches Google's official JWKS keys with Cache-Control respect and force-refresh on key rotation.
 */
async function fetchGoogleJwks(forceRefresh = false): Promise<JwkKey[]> {
  if (customJwksProviderForTests) {
    return customJwksProviderForTests();
  }

  const now = Date.now();
  if (!forceRefresh && cachedGoogleJwks && cachedGoogleJwks.expiresAt > now) {
    return cachedGoogleJwks.keys;
  }

  const response = await fetch(GOOGLE_JWKS_ENDPOINT, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Google OIDC public keys (HTTP ${response.status}).`);
  }

  const body = (await response.json()) as { keys?: JwkKey[] };
  if (!body || !Array.isArray(body.keys) || body.keys.length === 0) {
    throw new Error('Google JWKS response did not contain valid public keys.');
  }

  let maxAgeSec = 3600;
  const cacheControl = response.headers.get('cache-control') || '';
  const match = cacheControl.match(/max-age=(\d+)/i);
  if (match) {
    const parsed = Number(match[1]);
    if (Number.isFinite(parsed) && parsed > 60) {
      maxAgeSec = Math.min(parsed, 86400);
    }
  }

  cachedGoogleJwks = {
    keys: body.keys,
    expiresAt: now + maxAgeSec * 1000,
  };

  return body.keys;
}

/**
 * Cryptographically verifies a Google OIDC ID token:
 * 1. Header alg === RS256 and valid kid
 * 2. RSA-SHA256 signature against Google's official JWKS
 * 3. iss in ['https://accounts.google.com', 'accounts.google.com']
 * 4. aud === expectedClientId
 * 5. exp in the future (with minimal skew tolerance)
 * 6. nonce strictly matches expectedNonce
 * 7. Valid immutable Google `sub` and verified email
 */
export async function verifyGoogleIdToken(
  idToken: string,
  expectedClientId: string,
  expectedNonce: string
): Promise<VerifiedGoogleIdentity> {
  if (!idToken || typeof idToken !== 'string') {
    throw new Error('Missing Google ID token.');
  }

  const parts = idToken.split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed Google ID token.');
  }

  const [headerB64, payloadB64, signatureB64] = parts;

  let header: { alg?: string; kid?: string; typ?: string };
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf-8'));
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8'));
  } catch {
    throw new Error('Failed to decode Google ID token.');
  }

  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid.trim()) {
    throw new Error('Unsupported or missing Google ID token signing algorithm/key ID.');
  }

  let keys = await fetchGoogleJwks(false);
  let matchingKey = keys.find((k) => k.kid === header.kid && k.kty === 'RSA');

  if (!matchingKey) {
    // Handle Google key rotation by forcing one JWKS refresh
    keys = await fetchGoogleJwks(true);
    matchingKey = keys.find((k) => k.kid === header.kid && k.kty === 'RSA');
  }

  if (!matchingKey) {
    throw new Error('No matching Google signing key found for ID token.');
  }

  const publicKey = crypto.createPublicKey({
    key: matchingKey as crypto.JsonWebKey,
    format: 'jwk',
  });

  const signingInput = Buffer.from(`${headerB64}.${payloadB64}`, 'utf-8');
  const signature = Buffer.from(signatureB64, 'base64url');
  const isSignatureValid = crypto.verify('RSA-SHA256', signingInput, publicKey, signature);

  if (!isSignatureValid) {
    throw new Error('Google ID token signature verification failed.');
  }

  const iss = typeof payload.iss === 'string' ? payload.iss : '';
  if (!VALID_GOOGLE_ISSUERS.has(iss)) {
    throw new Error('Google ID token issuer is invalid.');
  }

  const aud = payload.aud;
  const audValid =
    typeof aud === 'string'
      ? aud === expectedClientId
      : Array.isArray(aud) && aud.includes(expectedClientId);
  if (!audValid) {
    throw new Error('Google ID token audience mismatch.');
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const exp = typeof payload.exp === 'number' ? payload.exp : 0;
  if (!exp || exp + CLOCK_SKEW_SECONDS < nowSec) {
    throw new Error('Google ID token has expired.');
  }

  const nbf = typeof payload.nbf === 'number' ? payload.nbf : null;
  if (nbf !== null && nbf - CLOCK_SKEW_SECONDS > nowSec) {
    throw new Error('Google ID token is not yet valid.');
  }

  const tokenNonce = typeof payload.nonce === 'string' ? payload.nonce : '';
  if (!tokenNonce || !expectedNonce || !timingSafeStringEqual(tokenNonce, expectedNonce)) {
    throw new Error('Google ID token nonce mismatch.');
  }

  const sub = typeof payload.sub === 'string' ? payload.sub.trim() : '';
  if (!sub || !/^[a-zA-Z0-9._-]{4,128}$/.test(sub)) {
    throw new Error('Google ID token missing valid account subject identifier.');
  }

  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  if (!email || !email.includes('@')) {
    throw new Error('Google ID token missing valid email address.');
  }

  const emailVerified = payload.email_verified === true;
  if (!emailVerified) {
    throw new Error('Google account email is not verified.');
  }

  const rawName = typeof payload.name === 'string' ? payload.name.trim() : '';
  const name = rawName.slice(0, 120) || email.split('@')[0];

  const rawPicture = typeof payload.picture === 'string' ? payload.picture.trim() : '';
  const picture =
    rawPicture && /^https:\/\/[a-zA-Z0-9.-]+\//.test(rawPicture)
      ? rawPicture.slice(0, 500)
      : null;

  return {
    sub,
    email,
    emailVerified,
    name,
    picture,
  };
}

/**
 * Exchanges the Google authorization code + PKCE verifier server-side using GOOGLE_CLIENT_SECRET.
 */
export async function exchangeGoogleAuthorizationCode(params: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
}): Promise<{ idToken: string }> {
  const formBody = new URLSearchParams({
    code: params.code,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    redirect_uri: params.redirectUri,
    grant_type: 'authorization_code',
    code_verifier: params.codeVerifier,
  });

  const tokenRes = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: formBody.toString(),
  });

  const tokenData = (await tokenRes.json().catch(() => ({}))) as {
    id_token?: string;
    error?: string;
    error_description?: string;
  };

  if (!tokenRes.ok || !tokenData.id_token) {
    throw new Error(
      tokenData.error_description || tokenData.error || 'Google token exchange failed.'
    );
  }

  return { idToken: tokenData.id_token };
}

/**
 * Upserts the verified Google user uniquely by immutable Google `sub` in Firestore `users/{sub}`.
 * Prevents duplicate accounts for the same Google identity and preserves original `createdAt`.
 */
export async function upsertGoogleUser(identity: VerifiedGoogleIdentity): Promise<ZoyaUserRecord> {
  try {
    const nowIso = new Date().toISOString();

    return await serverRunTransaction(async (tx) => {
      const existingSnap = await tx.get('users', identity.sub);
      const existingData = existingSnap.exists ? existingSnap.data : undefined;

      const userRecord: ZoyaUserRecord = {
        id: identity.sub,
        googleSub: identity.sub,
        email: identity.email,
        emailVerified: identity.emailVerified,
        name: identity.name,
        picture: identity.picture,
        provider: 'google',
        createdAt:
          existingData && typeof existingData.createdAt === 'string'
            ? existingData.createdAt
            : nowIso,
        updatedAt: nowIso,
        lastLoginAt: nowIso,
      };

      tx.set('users', identity.sub, userRecord);
      return userRecord;
    });
  } catch (err) {
    throw new UserAuthStorageError(
      'Account database (Cloud Firestore) is unavailable. Could not save user account.',
      err
    );
  }
}

/**
 * Creates a server-managed user session stored in Firestore `user_sessions/{sessionIdHash}`
 * and returns the signed HttpOnly cookie value.
 */
export async function createUserSession(
  user: ZoyaUserRecord,
  req: IncomingMessage,
  sessionSecret: string
): Promise<{ signedCookie: string; session: ZoyaUserSessionRecord }> {
  const sessionId = crypto.randomBytes(32).toString('base64url');
  const sessionIdHash = hashSessionId(sessionId);
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const expiresAtIso = new Date(now + SESSION_TTL_SECONDS * 1000).toISOString();

  const rawUa = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : '';
  const userAgentHash = rawUa
    ? crypto.createHash('sha256').update(rawUa).digest('hex').slice(0, 32)
    : null;

  const sessionRecord: ZoyaUserSessionRecord = {
    sessionIdHash,
    userSub: user.googleSub,
    email: user.email,
    createdAt: nowIso,
    expiresAt: expiresAtIso,
    lastSeenAt: nowIso,
    revoked: false,
    userAgentHash,
  };

  try {
    await serverSetDocumentById('user_sessions', sessionIdHash, sessionRecord);
  } catch (err) {
    throw new UserAuthStorageError(
      'Session database (Cloud Firestore) is unavailable. Could not create user session.',
      err
    );
  }

  return {
    signedCookie: signSessionCookieValue(sessionId, sessionSecret),
    session: sessionRecord,
  };
}

/**
 * Validates the incoming request's `zoya_user_session` HttpOnly cookie against
 * the server-managed `user_sessions` and `users` collections in Firestore.
 */
export async function getAuthenticatedUserFromRequest(req: IncomingMessage): Promise<{
  authenticated: boolean;
  user: ZoyaUserRecord | null;
  sessionIdHash: string | null;
  hadCookie: boolean;
  storageUnavailable?: boolean;
}> {
  const cookies = parseCookies(req.headers);
  const rawCookie = cookies[USER_SESSION_COOKIE_NAME];
  if (!rawCookie) {
    return { authenticated: false, user: null, sessionIdHash: null, hadCookie: false };
  }

  const sessionSecret = getSessionSecretOrNull();
  if (!sessionSecret) {
    return { authenticated: false, user: null, sessionIdHash: null, hadCookie: true };
  }

  const sessionId = verifySignedSessionCookieValue(rawCookie, sessionSecret);
  if (!sessionId) {
    return { authenticated: false, user: null, sessionIdHash: null, hadCookie: true };
  }

  const sessionIdHash = hashSessionId(sessionId);

  try {
    const sessionSnap = await serverGetDocumentById('user_sessions', sessionIdHash);
    if (!sessionSnap.exists || !sessionSnap.data) {
      return { authenticated: false, user: null, sessionIdHash: null, hadCookie: true };
    }

    const sessionData = sessionSnap.data as Partial<ZoyaUserSessionRecord>;
    if (sessionData.revoked === true || !sessionData.userSub || !sessionData.expiresAt) {
      return { authenticated: false, user: null, sessionIdHash: null, hadCookie: true };
    }

    const expiresMs = Date.parse(sessionData.expiresAt);
    if (!Number.isFinite(expiresMs) || expiresMs <= Date.now()) {
      // Best-effort cleanup of expired session document
      serverDeleteDocumentById('user_sessions', sessionIdHash).catch(() => {});
      return { authenticated: false, user: null, sessionIdHash: null, hadCookie: true };
    }

    const userSnap = await serverGetDocumentById('users', sessionData.userSub);
    if (!userSnap.exists || !userSnap.data) {
      return { authenticated: false, user: null, sessionIdHash: null, hadCookie: true };
    }

    const rawUser = userSnap.data;
    const user: ZoyaUserRecord = {
      id: String(rawUser.id || sessionData.userSub),
      googleSub: String(rawUser.googleSub || sessionData.userSub),
      email: String(rawUser.email || ''),
      emailVerified: rawUser.emailVerified === true,
      name: String(rawUser.name || ''),
      picture: typeof rawUser.picture === 'string' ? rawUser.picture : null,
      provider: 'google',
      createdAt: String(rawUser.createdAt || ''),
      updatedAt: String(rawUser.updatedAt || ''),
      lastLoginAt: String(rawUser.lastLoginAt || ''),
    };

    return {
      authenticated: true,
      user,
      sessionIdHash,
      hadCookie: true,
    };
  } catch {
    return {
      authenticated: false,
      user: null,
      sessionIdHash: null,
      hadCookie: true,
      storageUnavailable: true,
    };
  }
}

/**
 * Invalidates the active server-managed session in Firestore and clears the cookie.
 */
export async function invalidateUserSessionFromRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<{ invalidated: boolean }> {
  const cookies = parseCookies(req.headers);
  const rawCookie = cookies[USER_SESSION_COOKIE_NAME];
  const sessionSecret = getSessionSecretOrNull();

  clearUserSessionCookie(req, res);

  if (!rawCookie || !sessionSecret) {
    return { invalidated: false };
  }

  const sessionId = verifySignedSessionCookieValue(rawCookie, sessionSecret);
  if (!sessionId) {
    return { invalidated: false };
  }

  const sessionIdHash = hashSessionId(sessionId);
  try {
    await serverDeleteDocumentById('user_sessions', sessionIdHash);
    return { invalidated: true };
  } catch {
    return { invalidated: false };
  }
}

/**
 * Renders a minimal, safe HTML bridge for popup OAuth callback completion.
 * Strictly posts only to window.location.origin (never '*') and uses fixed safe strings.
 */
export function buildPopupCallbackHtml(options: {
  success: boolean;
  errorCode?: string;
}): string {
  const safeError = options.errorCode ? options.errorCode.replace(/[^a-z0-9_]/gi, '') : '';
  const fallbackUrl = options.success
    ? '/account'
    : `/?auth_error=${encodeURIComponent(safeError || 'auth_failed')}`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="robots" content="noindex, nofollow" />
  <title>Zoyalive Sign-In</title>
</head>
<body style="background:#0d0a14;color:#f4f4f5;font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;">
  <p style="font-size:14px;opacity:0.85;">${options.success ? 'Sign-in complete. Returning to Zoyalive...' : 'Unable to complete sign-in. Returning to Zoyalive...'}</p>
  <script>
    (function () {
      try {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(
            {
              type: 'ZOYA_AUTH_COMPLETE',
              success: ${options.success ? 'true' : 'false'},
              errorCode: ${JSON.stringify(safeError)}
            },
            window.location.origin
          );
          window.close();
          return;
        }
      } catch (e) {}
      window.location.replace(${JSON.stringify(fallbackUrl)});
    })();
  </script>
</body>
</html>`;
}
