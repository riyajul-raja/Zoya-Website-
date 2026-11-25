import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  setServerFirestoreTestAdapter,
  type ServerFirestoreAdapter,
  type ServerDocSnapshot,
  type ServerFirestoreTransaction,
} from '../server/firebase';
import {
  createLifetimeLicense,
  clearLicenseInMemoryCache,
  revokeLicense,
  setUseInMemoryStoreForTesting,
} from '../server/licenses';
import {
  setGoogleJwksProviderForTests,
  verifyGoogleIdToken,
  upsertGoogleUser,
  createUserSession,
  USER_SESSION_COOKIE_NAME,
  OAUTH_TX_COOKIE_NAME,
  type JwkKey,
} from '../server/userAuth';
import { handleApiRequest } from '../server/apiHandler';
import {
  setLicenseFcmSenderForTesting,
  type LicenseFcmTransportPayload,
} from '../server/fcm';
import { resetRateLimits } from '../server/rateLimit';

// ------------------------------------------------------------
// In-Memory Firestore Test Adapter
// ------------------------------------------------------------
function createInMemoryFirestoreAdapter(): {
  adapter: ServerFirestoreAdapter;
  collections: Map<string, Map<string, Record<string, any>>>;
} {
  const collections = new Map<string, Map<string, Record<string, any>>>();

  const getCol = (name: string) => {
    let col = collections.get(name);
    if (!col) {
      col = new Map();
      collections.set(name, col);
    }
    return col;
  };

  const adapter: ServerFirestoreAdapter = {
    backendType: 'test-mock',
    projectId: 'zoya-updates-test',
    databaseId: '(default)',
    async getCollectionDocs(collectionName) {
      return Array.from(getCol(collectionName).entries()).map(([id, data]) => ({
        id,
        data: structuredClone(data),
      }));
    },
    async getDocumentById(collectionName, docId): Promise<ServerDocSnapshot> {
      const data = getCol(collectionName).get(docId);
      return {
        exists: Boolean(data),
        id: docId,
        data: data ? structuredClone(data) : undefined,
      };
    },
    async queryDocumentsEq(collectionName, field, value, maxResults = 10) {
      const matches: Array<{ id: string; data: Record<string, any> }> = [];
      for (const [id, data] of getCol(collectionName).entries()) {
        if (data[field] === value) {
          matches.push({ id, data: structuredClone(data) });
          if (matches.length >= maxResults) break;
        }
      }
      return matches;
    },
    async setDocumentById(collectionName, docId, data, options) {
      const col = getCol(collectionName);
      if (options?.merge) {
        const prev = col.get(docId) || {};
        col.set(docId, { ...prev, ...structuredClone(data) });
      } else {
        col.set(docId, structuredClone(data));
      }
    },
    async deleteDocumentById(collectionName, docId) {
      getCol(collectionName).delete(docId);
    },
    async runTransaction<T>(fn: (tx: ServerFirestoreTransaction) => Promise<T>) {
      const tx: ServerFirestoreTransaction = {
        async get(collectionName, docId) {
          return adapter.getDocumentById(collectionName, docId);
        },
        set(collectionName, docId, data, options) {
          const col = getCol(collectionName);
          if (options?.merge) {
            const prev = col.get(docId) || {};
            col.set(docId, { ...prev, ...structuredClone(data) });
          } else {
            col.set(docId, structuredClone(data));
          }
        },
      };
      return fn(tx);
    },
  };

  return { adapter, collections };
}

// ------------------------------------------------------------
// Mock HTTP Request/Response Helper
// ------------------------------------------------------------
interface MockResponseResult {
  statusCode: number;
  headers: Record<string, string | string[]>;
  bodyText: string;
  json: any;
  setCookies: string[];
}

async function invokeApi(options: {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
}): Promise<MockResponseResult> {
  const req = new EventEmitter() as any;
  req.method = options.method;
  req.url = options.url;
  req.headers = {
    host: 'zoyalive.vercel.app',
    'x-forwarded-proto': 'https',
    ...(options.headers || {}),
  };
  req.socket = { remoteAddress: '127.0.0.1' };
  if (options.body !== undefined) {
    req.body = options.body;
  } else {
    req.readableEnded = true;
  }

  const headerMap = new Map<string, string | string[]>();
  let bodyText = '';

  const res: any = {
    statusCode: 200,
    writableEnded: false,
    headersSent: false,
    setHeader(name: string, value: string | string[]) {
      headerMap.set(name.toLowerCase(), value);
    },
    getHeader(name: string) {
      return headerMap.get(name.toLowerCase());
    },
    end(chunk?: string | Buffer) {
      if (chunk) {
        bodyText += Buffer.isBuffer(chunk) ? chunk.toString('utf-8') : String(chunk);
      }
      this.writableEnded = true;
      this.headersSent = true;
    },
  };

  await handleApiRequest(req as IncomingMessage, res as ServerResponse);

  const headers: Record<string, string | string[]> = {};
  for (const [k, v] of headerMap.entries()) {
    headers[k] = v;
  }

  const rawSetCookie = headers['set-cookie'];
  const setCookies = Array.isArray(rawSetCookie)
    ? rawSetCookie
    : typeof rawSetCookie === 'string'
      ? [rawSetCookie]
      : [];

  let json: any = null;
  try {
    json = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    json = null;
  }

  return {
    statusCode: res.statusCode,
    headers,
    bodyText,
    json,
    setCookies,
  };
}

function signTestRs256Jwt(
  privateKey: crypto.KeyObject,
  header: Record<string, unknown>,
  payload: Record<string, unknown>
): string {
  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signingInput = Buffer.from(`${headerB64}.${payloadB64}`, 'utf-8');
  const sig = crypto.sign('RSA-SHA256', signingInput, privateKey).toString('base64url');
  return `${headerB64}.${payloadB64}.${sig}`;
}

async function runTests() {
  console.log('Running Stage 1 & 2 Google OAuth, Session & Account Dashboard Security Tests...\n');

  const { adapter, collections } = createInMemoryFirestoreAdapter();
  setServerFirestoreTestAdapter(adapter);
  setUseInMemoryStoreForTesting(false);
  clearLicenseInMemoryCache();

  // Save original env
  const origEnv = {
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI,
    SESSION_SECRET: process.env.SESSION_SECRET,
    LICENSE_KEY_ENCRYPTION_SECRET: process.env.LICENSE_KEY_ENCRYPTION_SECRET,
    ADMIN_JWT_SECRET: process.env.ADMIN_JWT_SECRET,
    ENTITLEMENT_TOKEN_SECRET: process.env.ENTITLEMENT_TOKEN_SECRET,
  };

  try {
    // 1. Fail-closed when OAuth env vars are not configured
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.SESSION_SECRET;

    const unconfiguredStart = await invokeApi({
      method: 'GET',
      url: '/api/auth/google/start?format=json',
    });
    assert.equal(unconfiguredStart.statusCode, 503);
    assert.equal(unconfiguredStart.json.code, 'OAUTH_NOT_CONFIGURED');
    assert.equal(unconfiguredStart.headers['access-control-allow-origin'], undefined);
    console.log('PASS 1: OAuth start fails closed (503 OAUTH_NOT_CONFIGURED) without env vars and no wildcard CORS.');

    // Configure test OAuth & encryption secrets
    process.env.GOOGLE_CLIENT_ID = 'test-google-client-id.apps.googleusercontent.com';
    process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret-value';
    process.env.GOOGLE_REDIRECT_URI = 'https://zoyalive.vercel.app/api/auth/google/callback';
    process.env.SESSION_SECRET = crypto.randomBytes(32).toString('hex');
    process.env.LICENSE_KEY_ENCRYPTION_SECRET = crypto.randomBytes(32).toString('hex');
    process.env.ADMIN_JWT_SECRET = crypto.randomBytes(32).toString('hex');
    process.env.ENTITLEMENT_TOKEN_SECRET = crypto.randomBytes(32).toString('hex');

    // 2. OAuth start generates PKCE, state, nonce and sets HttpOnly Secure cookie
    const startRes = await invokeApi({
      method: 'GET',
      url: '/api/auth/google/start?mode=redirect&format=json',
    });
    assert.equal(startRes.statusCode, 200);
    assert.equal(startRes.json.success, true);
    const authUrl = new URL(startRes.json.authorizationUrl);
    assert.equal(authUrl.origin, 'https://accounts.google.com');
    assert.equal(authUrl.searchParams.get('client_id'), process.env.GOOGLE_CLIENT_ID);
    assert.equal(authUrl.searchParams.get('response_type'), 'code');
    assert.equal(authUrl.searchParams.get('code_challenge_method'), 'S256');
    assert.ok((authUrl.searchParams.get('code_challenge') || '').length >= 32);
    assert.ok((authUrl.searchParams.get('state') || '').length >= 32);
    assert.ok((authUrl.searchParams.get('nonce') || '').length >= 32);
    const txCookie = startRes.setCookies.find((c) => c.startsWith(`${OAUTH_TX_COOKIE_NAME}=`));
    assert.ok(txCookie, 'Expected zoya_oauth_tx Set-Cookie header');
    assert.ok(txCookie.includes('HttpOnly'));
    assert.ok(txCookie.includes('Secure'));
    console.log('PASS 2: OAuth start emits official Google URL with PKCE S256, state, nonce & HttpOnly Secure cookie.');

    // 3. OAuth callback rejects mismatched CSRF state and clears tx cookie
    const txCookiePair = txCookie.split(';')[0];
    const badStateRes = await invokeApi({
      method: 'GET',
      url: '/api/auth/google/callback?code=fake_code&state=tampered_state',
      headers: { cookie: txCookiePair },
    });
    assert.equal(badStateRes.statusCode, 302);
    assert.equal(badStateRes.headers['location'], '/?auth_error=invalid_state');
    assert.ok(
      badStateRes.setCookies.some((c) => c.startsWith(`${OAUTH_TX_COOKIE_NAME}=`) && c.includes('Max-Age=0'))
    );
    console.log('PASS 3: OAuth callback rejects mismatched CSRF state and immediately clears tx cookie.');

    // 4. OAuth callback handles user cancellation safely
    const cancelledRes = await invokeApi({
      method: 'GET',
      url: '/api/auth/google/callback?error=access_denied',
      headers: { cookie: txCookiePair },
    });
    assert.equal(cancelledRes.statusCode, 302);
    assert.equal(cancelledRes.headers['location'], '/?auth_error=access_denied');
    console.log('PASS 4: OAuth callback handles Google access_denied cancellation cleanly.');

    // 5. Cryptographic OIDC ID token verification (RS256 via JWKS)
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = {
      ...(publicKey.export({ format: 'jwk' }) as JwkKey),
      kid: 'test-google-kid-1',
      alg: 'RS256',
      use: 'sig',
    };
    setGoogleJwksProviderForTests(async () => [jwk]);

    const nowSec = Math.floor(Date.now() / 1000);
    const validNonce = 'expected_test_nonce_12345';
    const baseClaims = {
      iss: 'https://accounts.google.com',
      aud: process.env.GOOGLE_CLIENT_ID,
      sub: '108294827162534192837',
      email: 'alice@example.com',
      email_verified: true,
      name: 'Alice Zoya',
      picture: 'https://lh3.googleusercontent.com/a/example-photo',
      nonce: validNonce,
      iat: nowSec - 10,
      exp: nowSec + 3600,
    };

    const validToken = signTestRs256Jwt(privateKey, { alg: 'RS256', kid: 'test-google-kid-1', typ: 'JWT' }, baseClaims);
    const verified = await verifyGoogleIdToken(validToken, process.env.GOOGLE_CLIENT_ID, validNonce);
    assert.equal(verified.sub, baseClaims.sub);
    assert.equal(verified.email, 'alice@example.com');
    assert.equal(verified.emailVerified, true);

    // Reject expired token
    const expiredToken = signTestRs256Jwt(
      privateKey,
      { alg: 'RS256', kid: 'test-google-kid-1' },
      { ...baseClaims, exp: nowSec - 120 }
    );
    await assert.rejects(() => verifyGoogleIdToken(expiredToken, process.env.GOOGLE_CLIENT_ID!, validNonce), /expired/i);

    // Reject wrong audience
    const wrongAudToken = signTestRs256Jwt(
      privateKey,
      { alg: 'RS256', kid: 'test-google-kid-1' },
      { ...baseClaims, aud: 'other-client-id.apps.googleusercontent.com' }
    );
    await assert.rejects(() => verifyGoogleIdToken(wrongAudToken, process.env.GOOGLE_CLIENT_ID!, validNonce), /audience/i);

    // Reject wrong issuer
    const wrongIssToken = signTestRs256Jwt(
      privateKey,
      { alg: 'RS256', kid: 'test-google-kid-1' },
      { ...baseClaims, iss: 'https://evil.example.com' }
    );
    await assert.rejects(() => verifyGoogleIdToken(wrongIssToken, process.env.GOOGLE_CLIENT_ID!, validNonce), /issuer/i);

    // Reject wrong nonce
    await assert.rejects(() => verifyGoogleIdToken(validToken, process.env.GOOGLE_CLIENT_ID!, 'wrong_nonce'), /nonce/i);

    // Reject unverified email
    const unverifiedEmailToken = signTestRs256Jwt(
      privateKey,
      { alg: 'RS256', kid: 'test-google-kid-1' },
      { ...baseClaims, email_verified: false }
    );
    await assert.rejects(
      () => verifyGoogleIdToken(unverifiedEmailToken, process.env.GOOGLE_CLIENT_ID!, validNonce),
      /not verified/i
    );

    // Reject tampered signature
    const tamperedParts = validToken.split('.');
    tamperedParts[2] = tamperedParts[2].slice(0, -4) + 'AAAA';
    await assert.rejects(
      () => verifyGoogleIdToken(tamperedParts.join('.'), process.env.GOOGLE_CLIENT_ID!, validNonce),
      /signature/i
    );
    console.log('PASS 5: OIDC RS256 ID token verification validates signature, iss, aud, exp, nonce & email_verified.');

    // 6. User upsert uniqueness by immutable Google sub
    const userFirst = await upsertGoogleUser(verified);
    await new Promise((r) => setTimeout(r, 15));
    const userSecond = await upsertGoogleUser({ ...verified, name: 'Alice Updated' });
    assert.equal(userSecond.createdAt, userFirst.createdAt);
    assert.equal(userSecond.name, 'Alice Updated');
    assert.equal(collections.get('users')?.size, 1);
    console.log('PASS 6: User persistence enforces unique Google sub with zero duplicates and preserves createdAt.');

    // 7. Create server-managed session & test unauthenticated vs authenticated dashboard access
    const unauthDash = await invokeApi({ method: 'GET', url: '/api/account/dashboard' });
    assert.equal(unauthDash.statusCode, 401);
    assert.equal(unauthDash.json.code, 'UNAUTHENTICATED');

    const fakeReq = { headers: { 'user-agent': 'ZoyaTestRunner/1.0' } } as unknown as IncomingMessage;
    const { signedCookie: aliceCookieVal } = await createUserSession(
      userSecond,
      fakeReq,
      process.env.SESSION_SECRET!
    );
    const aliceCookieHeader = `${USER_SESSION_COOKIE_NAME}=${aliceCookieVal}`;

    // Create licenses for Alice and Bob via admin flow to test strict ownership isolation
    const adminUser = { email: 'admin@zoya.ai', name: 'Admin', role: 'admin' as const };
    const aliceLic = await createLifetimeLicense(
      { customerName: 'Alice Updated', customerEmail: 'alice@example.com', licenseType: 'Lifetime' },
      adminUser
    );
    assert.equal(aliceLic.success, true);

    const bobLic = await createLifetimeLicense(
      { customerName: 'Bob Other', customerEmail: 'bob@example.com', licenseType: 'Lifetime' },
      adminUser
    );
    assert.equal(bobLic.success, true);

    const sessionRes = await invokeApi({
      method: 'GET',
      url: '/api/auth/session',
      headers: { cookie: aliceCookieHeader },
    });
    assert.equal(sessionRes.statusCode, 200);
    assert.equal(sessionRes.json.authenticated, true);
    assert.equal(sessionRes.json.user.id, verified.sub);
    assert.ok(String(sessionRes.headers['cache-control']).includes('no-store'));

    const aliceDash = await invokeApi({
      method: 'GET',
      url: '/api/account/dashboard',
      headers: { cookie: aliceCookieHeader },
    });
    assert.equal(aliceDash.statusCode, 200);
    assert.equal(aliceDash.json.licenseSummary.hasLicense, true);
    assert.equal(aliceDash.json.licenseSummary.license.id, aliceLic.success ? aliceLic.license.id : '');
    assert.equal((aliceDash.json.licenseSummary.license as any).encryptedKey, undefined);
    assert.equal((aliceDash.json.licenseSummary.license as any).keyHash, undefined);
    assert.equal(aliceDash.headers['access-control-allow-origin'], undefined);
    console.log('PASS 7: Protected dashboard blocks unauthenticated requests (401) and returns only authenticated owner data.');

    // 8. Owner can reveal own key, CANNOT reveal another user's license key
    const revealOwn = await invokeApi({
      method: 'POST',
      url: '/api/account/license/reveal',
      headers: {
        cookie: aliceCookieHeader,
        origin: 'https://zoyalive.vercel.app',
      },
      body: { licenseId: aliceLic.success ? aliceLic.license.id : '' },
    });
    assert.equal(revealOwn.statusCode, 200);
    assert.equal(revealOwn.json.licenseKey, aliceLic.success ? aliceLic.generatedKey : '');

    const revealBob = await invokeApi({
      method: 'POST',
      url: '/api/account/license/reveal',
      headers: {
        cookie: aliceCookieHeader,
        origin: 'https://zoyalive.vercel.app',
      },
      body: { licenseId: bobLic.success ? bobLic.license.id : '' },
    });
    assert.equal(revealBob.statusCode, 403);
    assert.equal(revealBob.json.code, 'UNAUTHORIZED');
    console.log('PASS 8: Strict license isolation allows owner key reveal and blocks cross-user access (403).');

    // 9. User with no license sees honest "not_purchased" state
    const charlieUser = await upsertGoogleUser({
      sub: '999888777666555444333',
      email: 'charlie@example.com',
      emailVerified: true,
      name: 'Charlie NoLicense',
      picture: null,
    });
    const { signedCookie: charlieCookieVal } = await createUserSession(
      charlieUser,
      fakeReq,
      process.env.SESSION_SECRET!
    );
    const charlieDash = await invokeApi({
      method: 'GET',
      url: '/api/account/dashboard',
      headers: { cookie: `${USER_SESSION_COOKIE_NAME}=${charlieCookieVal}` },
    });
    assert.equal(charlieDash.statusCode, 200);
    assert.equal(charlieDash.json.licenseSummary.status, 'not_purchased');
    assert.equal(charlieDash.json.licenseSummary.hasLicense, false);
    assert.equal(charlieDash.json.licenseSummary.license, null);
    console.log('PASS 9: Users without a linked license receive clean "not_purchased" status without fabricated keys.');

    // 10. Logout CSRF protection + server-side session invalidation
    const csrfLogout = await invokeApi({
      method: 'POST',
      url: '/api/auth/logout',
      headers: {
        cookie: aliceCookieHeader,
        origin: 'https://evil-attacker.example',
      },
    });
    assert.equal(csrfLogout.statusCode, 403);
    assert.equal(csrfLogout.json.code, 'CSRF_ORIGIN_MISMATCH');

    const realLogout = await invokeApi({
      method: 'POST',
      url: '/api/auth/logout',
      headers: {
        cookie: aliceCookieHeader,
        origin: 'https://zoyalive.vercel.app',
      },
    });
    assert.equal(realLogout.statusCode, 200);
    assert.ok(
      realLogout.setCookies.some((c) => c.startsWith(`${USER_SESSION_COOKIE_NAME}=`) && c.includes('Max-Age=0'))
    );

    // Replaying old session cookie after logout must fail with 401
    const replayDash = await invokeApi({
      method: 'GET',
      url: '/api/account/dashboard',
      headers: { cookie: aliceCookieHeader },
    });
    assert.equal(replayDash.statusCode, 401);
    console.log('PASS 10: Logout enforces same-origin CSRF protection, invalidates Firestore session & blocks cookie replay.');

    // 11. User Dashboard License Logout / Device Unbind (Ownership, 24h Cooldown, CSRF, Unauth, Previous-Device & Vercel Rewrite)
    const { signedCookie: aliceFreshCookieVal } = await createUserSession(
      userSecond,
      fakeReq,
      process.env.SESSION_SECRET!
    );
    const aliceFreshCookie = `${USER_SESSION_COOKIE_NAME}=${aliceFreshCookieVal}`;
    const aliceLicId = aliceLic.success ? aliceLic.license.id : '';
    const aliceLicKey = aliceLic.success ? aliceLic.generatedKey : '';
    const bobLicId = bobLic.success ? bobLic.license.id : '';

    // 11a. Unauthenticated request rejected (401)
    const unauthUnbind = await invokeApi({
      method: 'POST',
      url: '/api/account/license/unbind',
      headers: { origin: 'https://zoyalive.vercel.app' },
      body: { licenseId: aliceLicId },
    });
    assert.equal(unauthUnbind.statusCode, 401);
    assert.equal(unauthUnbind.json.code, 'UNAUTHENTICATED');

    // 11b. Cross-origin CSRF rejected (403)
    const csrfUnbind = await invokeApi({
      method: 'POST',
      url: '/api/account/license/unbind',
      headers: {
        cookie: aliceFreshCookie,
        origin: 'https://evil-attacker.example',
      },
      body: { licenseId: aliceLicId },
    });
    assert.equal(csrfUnbind.statusCode, 403);
    assert.equal(csrfUnbind.json.code, 'CSRF_ORIGIN_MISMATCH');

    // 11c. Unactivated license cannot be unbound (400 LICENSE_NOT_BOUND)
    const unactivatedUnbind = await invokeApi({
      method: 'POST',
      url: '/api/account/license/unbind',
      headers: {
        cookie: aliceFreshCookie,
        origin: 'https://zoyalive.vercel.app',
      },
      body: { licenseId: aliceLicId },
    });
    assert.equal(unactivatedUnbind.statusCode, 400);
    assert.equal(unactivatedUnbind.json.code, 'LICENSE_NOT_BOUND');

    // Activate Alice's license on Phone 1 and Bob's license on Bob's Phone
    const alicePhone1 = {
      deviceId: 'android_alice_phone_one_001',
      deviceModel: 'Google Pixel 8',
      androidVersion: 'Android 14',
      appVersion: '2.6.0',
    };
    const alicePhone2 = {
      deviceId: 'android_alice_phone_two_002',
      deviceModel: 'Samsung Galaxy S25',
      androidVersion: 'Android 15',
      appVersion: '2.6.0',
    };
    const bobPhone = {
      deviceId: 'android_bob_phone_one_009',
      deviceModel: 'OnePlus 12',
      androidVersion: 'Android 14',
      appVersion: '2.6.0',
    };

    const actAlice1 = await invokeApi({
      method: 'POST',
      url: '/api/licenses/activate',
      body: { licenseKey: aliceLicKey, deviceInfo: alicePhone1 },
    });
    assert.equal(actAlice1.statusCode, 200);

    const actBob = await invokeApi({
      method: 'POST',
      url: '/api/licenses/activate',
      body: { licenseKey: bobLic.success ? bobLic.generatedKey : '', deviceInfo: bobPhone },
    });
    assert.equal(actBob.statusCode, 200);

    // 11d. Cross-user unbind rejected (403 UNAUTHORIZED)
    const crossUserUnbind = await invokeApi({
      method: 'POST',
      url: '/api/account/license/unbind',
      headers: {
        cookie: aliceFreshCookie,
        origin: 'https://zoyalive.vercel.app',
      },
      body: { licenseId: bobLicId },
    });
    assert.equal(crossUserUnbind.statusCode, 403);
    assert.equal(crossUserUnbind.json.code, 'UNAUTHORIZED');

    // Confirm Bob's license was NOT altered
    const bobRawDoc = collections.get('licenses')?.get(bobLicId);
    assert.equal(bobRawDoc?.status, 'active');
    assert.equal(bobRawDoc?.linkedDevice?.deviceId, bobPhone.deviceId);

    // 11e. Owner unbind succeeds via Vercel rewrite route, preserves account ownership, hides sensitive fields
    const vercelConfig = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'vercel.json'), 'utf-8'));
    assert.ok(
      (vercelConfig.rewrites as Array<{ source: string; destination: string }>).some(
        (r) =>
          r.source === '/api/account/license/unbind' &&
          r.destination === '/api/auth?__route=/api/account/license/unbind'
      ),
      'vercel.json must rewrite /api/account/license/unbind to /api/auth'
    );

    const ownerUnbind = await invokeApi({
      method: 'POST',
      url: '/api/auth?__route=/api/account/license/unbind',
      headers: {
        cookie: aliceFreshCookie,
        origin: 'https://zoyalive.vercel.app',
      },
      body: { licenseId: aliceLicId },
    });
    assert.equal(ownerUnbind.statusCode, 200);
    assert.equal(ownerUnbind.json.success, true);
    assert.equal(ownerUnbind.json.licenseSummary.status, 'unactivated');
    assert.equal(ownerUnbind.json.licenseSummary.hasLicense, true);
    assert.equal(ownerUnbind.json.licenseSummary.license.linkedDevice, null);
    assert.equal(ownerUnbind.json.licenseSummary.license.canUnbindDevice, false);
    assert.ok(ownerUnbind.json.licenseSummary.license.nextUnbindAvailableAt);
    // Security: no sensitive fields exposed to dashboard
    assert.equal(ownerUnbind.json.licenseSummary.license.keyHash, undefined);
    assert.equal(ownerUnbind.json.licenseSummary.license.encryptedKey, undefined);
    assert.equal(ownerUnbind.json.licenseSummary.license.auditLog, undefined);
    assert.equal(JSON.stringify(ownerUnbind.json).includes(alicePhone1.deviceId), false);
    assert.equal(JSON.stringify(ownerUnbind.json).includes(aliceLicKey), false);

    // Confirm Firestore state: ownership anchored to Google sub, bindingVersion incremented, audit recorded
    const aliceDocAfterUnbind = collections.get('licenses')?.get(aliceLicId);
    assert.equal(aliceDocAfterUnbind?.userSub, userSecond.googleSub);
    assert.equal(aliceDocAfterUnbind?.customerEmail, 'alice@example.com');
    assert.equal(aliceDocAfterUnbind?.bindingVersion, 2);
    assert.equal(aliceDocAfterUnbind?.unbindCount, 1);
    assert.ok(
      (aliceDocAfterUnbind?.auditLog || []).some((e: any) => e.action === 'device_unbound'),
      'Audit log must record device_unbound'
    );

    // 11f. Previous device CANNOT silently reclaim Alice's unbound license; new Phone 2 CAN activate
    const alicePhone1Reclaim = await invokeApi({
      method: 'POST',
      url: '/api/licenses/validate',
      body: { licenseKey: aliceLicKey, deviceInfo: alicePhone1 },
    });
    assert.equal(alicePhone1Reclaim.statusCode, 403);
    assert.equal(alicePhone1Reclaim.json.code, 'DEVICE_MISMATCH');

    const alicePhone2Activate = await invokeApi({
      method: 'POST',
      url: '/api/licenses/activate',
      body: { licenseKey: aliceLicKey, deviceInfo: alicePhone2 },
    });
    assert.equal(alicePhone2Activate.statusCode, 200);
    assert.equal(alicePhone2Activate.json.license.linkedDevice.deviceId, alicePhone2.deviceId);

    // 11g. 24-hour user cooldown is enforced on the server
    const cooldownUnbind = await invokeApi({
      method: 'POST',
      url: '/api/account/license/unbind',
      headers: {
        cookie: aliceFreshCookie,
        origin: 'https://zoyalive.vercel.app',
      },
      body: { licenseId: aliceLicId },
    });
    assert.equal(cooldownUnbind.statusCode, 429);
    assert.equal(cooldownUnbind.json.code, 'UNBIND_COOLDOWN_ACTIVE');
    assert.ok(cooldownUnbind.json.nextUnbindAvailableAt);

    // Confirm dashboard also reflects cooldown accurately
    const dashDuringCooldown = await invokeApi({
      method: 'GET',
      url: '/api/account/dashboard',
      headers: { cookie: aliceFreshCookie },
    });
    assert.equal(dashDuringCooldown.statusCode, 200);
    assert.equal(dashDuringCooldown.json.licenseSummary.license.canUnbindDevice, false);
    assert.ok(dashDuringCooldown.json.licenseSummary.license.nextUnbindAvailableAt);

    // 11h. After 24 hours pass, user can unbind again
    const storedAliceDoc = collections.get('licenses')?.get(aliceLicId);
    assert.ok(storedAliceDoc);
    storedAliceDoc.lastUserUnboundAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    clearLicenseInMemoryCache();

    const postCooldownUnbind = await invokeApi({
      method: 'POST',
      url: '/api/account/license/unbind',
      headers: {
        cookie: aliceFreshCookie,
        origin: 'https://zoyalive.vercel.app',
      },
      body: { licenseId: aliceLicId },
    });
    assert.equal(postCooldownUnbind.statusCode, 200);
    assert.equal(postCooldownUnbind.json.licenseSummary.status, 'unactivated');

    // 11i. Revoked license cannot be unbound by user (403 LICENSE_REVOKED)
    await revokeLicense(aliceLicId, { reason: 'Test revocation before user unbind' }, adminUser);
    const revokedUserUnbind = await invokeApi({
      method: 'POST',
      url: '/api/account/license/unbind',
      headers: {
        cookie: aliceFreshCookie,
        origin: 'https://zoyalive.vercel.app',
      },
      body: { licenseId: aliceLicId },
    });
    assert.equal(revokedUserUnbind.statusCode, 403);
    assert.equal(revokedUserUnbind.json.code, 'LICENSE_REVOKED');

    console.log('PASS 11: User Dashboard device unbind enforces ownership, CSRF, 24h cooldown, previous-device block & safe response shape.');

    // 12. User Dashboard Logout / Unbind FCM Notifications (Post-commit dispatch, non-rollback on FCM failure, zero token leakage)
    resetRateLimits();
    const userFcmPayloads: LicenseFcmTransportPayload[] = [];
    setLicenseFcmSenderForTesting(async (payload) => {
      userFcmPayloads.push(payload);
      return { ok: true, messageId: `projects/zoya-updates/messages/user_unbind_${userFcmPayloads.length}` };
    });

    const userFcmLic = await createLifetimeLicense(
      { customerName: 'Alice Updated', customerEmail: 'alice@example.com', licenseType: 'Lifetime' },
      adminUser
    );
    assert.equal(userFcmLic.success, true);
    const userFcmLicId = userFcmLic.success ? userFcmLic.license.id : '';
    const userFcmLicKey = userFcmLic.success ? userFcmLic.generatedKey : '';

    const aliceFcmPhone1 = {
      deviceId: 'android_alice_fcm_phone_010',
      deviceModel: 'Google Pixel 9',
      androidVersion: 'Android 15',
      appVersion: '2.7.0',
    };
    const aliceFcmPhone2 = {
      deviceId: 'android_alice_fcm_phone_011',
      deviceModel: 'Samsung Galaxy S25',
      androidVersion: 'Android 15',
      appVersion: '2.7.0',
    };
    const aliceFcmToken1 = 'fcm_user_alice_phone1_token_1111222233334444';
    const aliceFcmToken2 = 'fcm_user_alice_phone2_token_5555666677778888';

    // Activate & register FCM token on Alice's Phone 1
    const actUserFcm1 = await invokeApi({
      method: 'POST',
      url: '/api/licenses/activate',
      body: { licenseKey: userFcmLicKey, deviceInfo: aliceFcmPhone1 },
    });
    assert.equal(actUserFcm1.statusCode, 200);

    const regUserFcm1 = await invokeApi({
      method: 'POST',
      url: '/api/licenses/fcm/register',
      body: { licenseKey: userFcmLicKey, deviceId: aliceFcmPhone1.deviceId, fcmToken: aliceFcmToken1 },
    });
    assert.equal(regUserFcm1.statusCode, 200);

    // Confirm dashboard NEVER exposes deviceFcmToken
    const dashWithToken = await invokeApi({
      method: 'GET',
      url: '/api/account/dashboard',
      headers: { cookie: aliceFreshCookie },
    });
    assert.equal(dashWithToken.statusCode, 200);
    assert.equal(JSON.stringify(dashWithToken.json).includes(aliceFcmToken1), false, 'User dashboard must never expose FCM token');

    // Cross-user unbind attempt fails -> NO FCM notification sent
    userFcmPayloads.length = 0;
    const { signedCookie: bobCookieVal } = await createUserSession(
      await upsertGoogleUser({
        sub: 'bob_sub_777888999',
        email: 'bob@example.com',
        emailVerified: true,
        name: 'Bob Other',
        picture: null,
      }),
      fakeReq,
      process.env.SESSION_SECRET!
    );
    const bobCrossAttempt = await invokeApi({
      method: 'POST',
      url: '/api/account/license/unbind',
      headers: {
        cookie: `${USER_SESSION_COOKIE_NAME}=${bobCookieVal}`,
        origin: 'https://zoyalive.vercel.app',
      },
      body: { licenseId: userFcmLicId },
    });
    assert.equal(bobCrossAttempt.statusCode, 403);
    assert.equal(userFcmPayloads.length, 0, 'Failed cross-user unbind must not send FCM notification');

    // Owner unbind succeeds -> commits transaction, clears token, sends device-specific license_unbound notification
    const ownerFcmUnbind = await invokeApi({
      method: 'POST',
      url: '/api/account/license/unbind',
      headers: {
        cookie: aliceFreshCookie,
        origin: 'https://zoyalive.vercel.app',
      },
      body: { licenseId: userFcmLicId },
    });
    assert.equal(ownerFcmUnbind.statusCode, 200);
    assert.equal(JSON.stringify(ownerFcmUnbind.json).includes(aliceFcmToken1), false, 'User unbind response must never expose FCM token');
    assert.equal(userFcmPayloads.length, 1, 'User unbind must dispatch exactly one device-specific FCM message');
    assert.equal(userFcmPayloads[0].token, aliceFcmToken1);
    assert.equal(userFcmPayloads[0].eventType, 'license_unbound');
    assert.equal(userFcmPayloads[0].data.event, 'license_unbound');
    assert.equal(userFcmPayloads[0].data.type, 'license_unbound');
    assert.equal(userFcmPayloads[0].data.action, 'OPEN_LICENSE_ACTIVATION');
    assert.equal(userFcmPayloads[0].data.deviceId, aliceFcmPhone1.deviceId, 'User unbind FCM event must carry exact Phone 1 deviceId');
    assert.equal(userFcmPayloads[0].data.bindingVersion, '1', 'User unbind FCM event must carry terminated bindingVersion (1)');
    assert.ok(typeof userFcmPayloads[0].data.eventId === 'string' && userFcmPayloads[0].data.eventId.startsWith('evt_'));
    const firstUserEventId = userFcmPayloads[0].data.eventId;
    assert.equal(userFcmPayloads[0].data.initiatedBy, 'user');
    assert.equal(JSON.stringify(userFcmPayloads[0].data).includes(userFcmLicKey), false);
    assert.equal(collections.get('licenses')?.get(userFcmLicId)?.deviceFcmToken, null);
    assert.equal(collections.get('licenses')?.get(userFcmLicId)?.bindingVersion, 2);

    // Activate on Phone 2 (bindingVersion 2), register token 2, verify cooldown blocks unbind WITHOUT sending FCM, then expire cooldown & test FCM outage non-rollback
    const actUserFcm2 = await invokeApi({
      method: 'POST',
      url: '/api/licenses/activate',
      body: { licenseKey: userFcmLicKey, deviceInfo: aliceFcmPhone2 },
    });
    assert.equal(actUserFcm2.statusCode, 200);
    assert.equal(actUserFcm2.json?.license?.bindingVersion, 2);

    const regUserFcm2 = await invokeApi({
      method: 'POST',
      url: '/api/licenses/fcm/register',
      body: { licenseKey: userFcmLicKey, deviceId: aliceFcmPhone2.deviceId, fcmToken: aliceFcmToken2 },
    });
    assert.equal(regUserFcm2.statusCode, 200);

    userFcmPayloads.length = 0;
    const cooldownBlocked = await invokeApi({
      method: 'POST',
      url: '/api/account/license/unbind',
      headers: {
        cookie: aliceFreshCookie,
        origin: 'https://zoyalive.vercel.app',
      },
      body: { licenseId: userFcmLicId },
    });
    assert.equal(cooldownBlocked.statusCode, 429);
    assert.equal(userFcmPayloads.length, 0, 'Cooldown-blocked unbind must not send FCM notification');

    // Expire cooldown, simulate FCM throw -> unbind MUST still commit and return 200
    const userFcmDoc = collections.get('licenses')?.get(userFcmLicId);
    assert.ok(userFcmDoc);
    userFcmDoc.lastUserUnboundAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    clearLicenseInMemoryCache();

    setLicenseFcmSenderForTesting(async (payload) => {
      userFcmPayloads.push(payload);
      throw new Error('Simulated FCM outage during user unbind');
    });

    const userUnbindFcmOutage = await invokeApi({
      method: 'POST',
      url: '/api/account/license/unbind',
      headers: {
        cookie: aliceFreshCookie,
        origin: 'https://zoyalive.vercel.app',
      },
      body: { licenseId: userFcmLicId },
    });
    assert.equal(userUnbindFcmOutage.statusCode, 200, 'User unbind must not roll back when FCM fails');
    assert.equal(userFcmPayloads.length, 1);
    assert.equal(userFcmPayloads[0].token, aliceFcmToken2);
    assert.equal(userFcmPayloads[0].data.deviceId, aliceFcmPhone2.deviceId, 'Second user unbind FCM event must carry Phone 2 deviceId');
    assert.equal(userFcmPayloads[0].data.bindingVersion, '2', 'Second user unbind FCM event must carry terminated bindingVersion (2)');
    assert.ok(typeof userFcmPayloads[0].data.eventId === 'string' && userFcmPayloads[0].data.eventId !== firstUserEventId, 'Each user unbind event must have a unique eventId');
    assert.equal(collections.get('licenses')?.get(userFcmLicId)?.status, 'unactivated');
    assert.equal(collections.get('licenses')?.get(userFcmLicId)?.bindingVersion, 3);
    assert.equal(collections.get('licenses')?.get(userFcmLicId)?.deviceFcmToken, null);

    setLicenseFcmSenderForTesting(null);
    console.log('PASS 12: User Dashboard unbind dispatches post-commit FCM notification with deviceId, unique eventId & bindingVersion, preserves non-rollback on FCM failure & leaks no tokens.');

    console.log('\nALL 12 STAGE 1, STAGE 2, DEVICE UNBIND & FCM NOTIFICATION SECURITY & ACCOUNT TESTS PASSED!');
  } finally {
    setLicenseFcmSenderForTesting(null);
    setGoogleJwksProviderForTests(null);
    setServerFirestoreTestAdapter(null);
    clearLicenseInMemoryCache();
    resetRateLimits();
    for (const [k, v] of Object.entries(origEnv)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  }
}

runTests().catch((err) => {
  console.error('\nTEST FAILED:', err);
  process.exit(1);
});
