import assert from 'node:assert/strict';
import crypto from 'node:crypto';
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

    console.log('\nALL 10 STAGE 1 & STAGE 2 SECURITY & ACCOUNT TESTS PASSED!');
  } finally {
    setGoogleJwksProviderForTests(null);
    setServerFirestoreTestAdapter(null);
    clearLicenseInMemoryCache();
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
