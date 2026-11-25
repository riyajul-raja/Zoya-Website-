import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  TARGET_FIREBASE_PROJECT_ID,
  TARGET_FIRESTORE_DATABASE_ID,
  TARGET_FIRESTORE_REGION,
  getAdminFirestore,
  getActiveServerFirestoreAdapter,
  setServerFirestoreTestAdapter,
  extractBinaryBuffer,
  type ServerFirestoreAdapter,
} from '../server/firebase';
import { handleApiRequest } from '../server/apiHandler';
import { AdminUser, getJwtSecret } from '../server/auth';
import {
  generateCryptographicLicenseKey,
  isValidLicenseKeyFormat,
  hashLicenseKey,
  maskLicenseKey,
  createLifetimeLicense,
  getLicenseById,
  getAllLicenses,
  deleteLicenseRecord,
  setSimulatedStorageFailureForTesting,
  setUseInMemoryStoreForTesting,
  clearLicenseInMemoryCache,
  isValidDeviceId,
  generateSignedEntitlementToken,
  verifySignedEntitlementToken,
  saveLicenseRecord,
  encryptLicenseKey,
  decryptLicenseKey,
  revealLicenseKeyByAdmin,
  LicenseEncryptionConfigurationError,
  type LicenseRecord,
} from '../server/licenses';
import {
  setLicenseFcmSenderForTesting,
  type LicenseFcmTransportPayload,
} from '../server/fcm';
import {
  ENTITLEMENT_ISSUER,
  ENTITLEMENT_AUDIENCE,
  ENTITLEMENT_ALGORITHM,
  ENTITLEMENT_GRACE_TTL_SECONDS,
  getEntitlementPublicJwks,
  signEs256EntitlementToken,
  verifyEs256EntitlementToken,
} from '../server/entitlementSigning';
import {
  APK_CHUNK_SIZE,
  saveRelease,
  getAllReleases,
  getPublishedReleases,
  getLatestPublishedRelease,
  getReleaseById,
  deleteRelease,
  storeApkBuffer,
  verifyStoredChunks,
  hasApkBinary,
  getApkBuffer,
  clearReleasesInMemoryCache,
  type ReleaseMetadata,
} from '../server/storage';
import {
  DEFAULT_PRODUCTION_SITE_URL,
  getPublicSiteOrigin,
  buildReleaseNotificationContent,
  registerFcmDeviceToken,
  getFcmStatus,
  sendReleasePushNotification,
} from '../server/fcm';
import { resetRateLimits } from '../server/rateLimit';

interface MockResponseResult {
  statusCode: number;
  headers: Record<string, string>;
  bodyText: string;
  json: any;
}

async function invokeHandler(options: {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  explicitRoute?: string;
}): Promise<MockResponseResult> {
  const headers: Record<string, string> = {};
  if (options.headers) {
    for (const [k, v] of Object.entries(options.headers)) {
      headers[k.toLowerCase()] = v;
    }
  }

  const req = {
    method: options.method,
    url: options.url,
    headers,
    body: options.body,
    readableEnded: true,
    socket: { remoteAddress: headers['x-forwarded-for'] || '127.0.0.1' },
  } as unknown as IncomingMessage;

  const resHeaders: Record<string, string> = {};
  let statusCode = 200;
  let bodyText = '';
  let writableEnded = false;

  const res = {
    get statusCode() {
      return statusCode;
    },
    set statusCode(val: number) {
      statusCode = val;
    },
    get writableEnded() {
      return writableEnded;
    },
    get headersSent() {
      return writableEnded;
    },
    setHeader(name: string, value: string) {
      resHeaders[name.toLowerCase()] = String(value);
    },
    end(chunk?: string | Buffer) {
      writableEnded = true;
      if (chunk !== undefined && chunk !== null) {
        bodyText = Buffer.isBuffer(chunk) ? chunk.toString('utf-8') : String(chunk);
      }
    },
  } as unknown as ServerResponse;

  await handleApiRequest(req, res, options.explicitRoute);

  let json: any = null;
  try {
    json = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    json = null;
  }

  return {
    statusCode,
    headers: resHeaders,
    bodyText,
    json,
  };
}

/**
 * Creates a clean, empty ServerFirestoreAdapter representing the canonical
 * `zoya-updates/(default)` Cloud Firestore database in `asia-south2` (Delhi).
 * Includes full support for atomic runTransaction simulation.
 */
function createZoyaUpdatesTestAdapter(): {
  adapter: ServerFirestoreAdapter;
  collections: Map<string, Map<string, Record<string, any>>>;
  metrics: {
    setDocumentCalls: number;
    transactionCalls: number;
    txSetCalls: number;
    queryCalls: number;
  };
} {
  const collections = new Map<string, Map<string, Record<string, any>>>();
  const metrics = {
    setDocumentCalls: 0,
    transactionCalls: 0,
    txSetCalls: 0,
    queryCalls: 0,
  };
  const getColMap = (col: string) => {
    let m = collections.get(col);
    if (!m) {
      m = new Map();
      collections.set(col, m);
    }
    return m;
  };

  const adapter: ServerFirestoreAdapter = {
    backendType: 'firebase-admin',
    projectId: TARGET_FIREBASE_PROJECT_ID,
    databaseId: TARGET_FIRESTORE_DATABASE_ID,
    async getCollectionDocs(collectionName: string) {
      const col = getColMap(collectionName);
      return Array.from(col.entries()).map(([id, data]) => ({ id, data: { ...data } }));
    },
    async getDocumentById(collectionName: string, docId: string) {
      const col = getColMap(collectionName);
      const data = col.get(docId);
      return { exists: Boolean(data), id: docId, data: data ? { ...data } : undefined };
    },
    async queryDocumentsEq(collectionName: string, field: string, value: unknown, maxResults = 1) {
      metrics.queryCalls += 1;
      const col = getColMap(collectionName);
      const matches: Array<{ id: string; data: Record<string, any> }> = [];
      for (const [id, data] of col.entries()) {
        if (data[field] === value) {
          matches.push({ id, data: { ...data } });
          if (matches.length >= maxResults) break;
        }
      }
      return matches;
    },
    async setDocumentById(
      collectionName: string,
      docId: string,
      data: Record<string, any>,
      options?: { merge?: boolean }
    ) {
      metrics.setDocumentCalls += 1;
      const col = getColMap(collectionName);
      const cleanData: Record<string, any> = {};
      for (const [k, v] of Object.entries(data)) {
        if (v !== undefined) {
          cleanData[k] = Buffer.isBuffer(v) ? Buffer.from(v) : v;
        }
      }
      if (options?.merge && col.has(docId)) {
        col.set(docId, { ...col.get(docId), ...cleanData });
      } else {
        col.set(docId, cleanData);
      }
    },
    async deleteDocumentById(collectionName: string, docId: string) {
      const col = getColMap(collectionName);
      col.delete(docId);
    },
    async runTransaction<T>(updateFunction: (transaction: any) => Promise<T>): Promise<T> {
      metrics.transactionCalls += 1;
      // In-memory atomic transaction simulation
      const tx = {
        async get(collectionName: string, docId: string) {
          const col = getColMap(collectionName);
          const data = col.get(docId);
          return { exists: Boolean(data), id: docId, data: data ? { ...data } : undefined };
        },
        async queryDocumentsEq(collectionName: string, field: string, value: unknown, maxResults = 1) {
          metrics.queryCalls += 1;
          const col = getColMap(collectionName);
          const matches: Array<{ id: string; data: Record<string, any> }> = [];
          for (const [id, data] of col.entries()) {
            if (data[field] === value) {
              matches.push({ id, data: { ...data } });
              if (matches.length >= maxResults) break;
            }
          }
          return matches;
        },
        set(collectionName: string, docId: string, data: Record<string, any>, options?: { merge?: boolean }) {
          metrics.txSetCalls += 1;
          const col = getColMap(collectionName);
          const cleanData: Record<string, any> = {};
          for (const [k, v] of Object.entries(data)) {
            if (v !== undefined) {
              cleanData[k] = Buffer.isBuffer(v) ? Buffer.from(v) : v;
            }
          }
          if (options?.merge && col.has(docId)) {
            col.set(docId, { ...col.get(docId), ...cleanData });
          } else {
            col.set(docId, cleanData);
          }
        },
        delete(collectionName: string, docId: string) {
          const col = getColMap(collectionName);
          col.delete(docId);
        },
      };
      return await updateFunction(tx);
    },
  };

  return { adapter, collections, metrics };
}

async function runTests() {
  console.log('Running Zoya Website — Clean One-Phone Lifetime License & Firebase Test Suite...\n');

  const adminUser: AdminUser = {
    email: 'admin@zoya.ai',
    name: 'Riyajul (Administrator)',
    role: 'admin',
  };

  const createdLicenseIds: string[] = [];
  const { adapter: zoyaUpdatesAdapter, metrics: firestoreMetrics } = createZoyaUpdatesTestAdapter();
  const TEST_ADMIN_PIN = 'test-pin-739184';
  const TEST_ADMIN_JWT_SECRET = crypto.randomBytes(32).toString('hex');
  const testPrimaryEcPair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const TEST_ES256_PRIVATE_KEY_PEM = testPrimaryEcPair.privateKey
    .export({ type: 'pkcs8', format: 'pem' })
    .toString();
  const TEST_ES256_KEY_ID = 'zoya-es256-test-primary';
  const origAdminEnv = {
    ZOYA_ADMIN_PIN: process.env.ZOYA_ADMIN_PIN,
    ADMIN_JWT_SECRET: process.env.ADMIN_JWT_SECRET,
    LICENSE_KEY_ENCRYPTION_SECRET: process.env.LICENSE_KEY_ENCRYPTION_SECRET,
    ENTITLEMENT_ES256_PRIVATE_KEY: process.env.ENTITLEMENT_ES256_PRIVATE_KEY,
    ENTITLEMENT_ES256_KEY_ID: process.env.ENTITLEMENT_ES256_KEY_ID,
    ENTITLEMENT_ES256_ADDITIONAL_PUBLIC_JWKS: process.env.ENTITLEMENT_ES256_ADDITIONAL_PUBLIC_JWKS,
  };
  process.env.ENTITLEMENT_ES256_PRIVATE_KEY = TEST_ES256_PRIVATE_KEY_PEM;
  process.env.ENTITLEMENT_ES256_KEY_ID = TEST_ES256_KEY_ID;
  delete process.env.ENTITLEMENT_ES256_ADDITIONAL_PUBLIC_JWKS;

  try {
    // ---------------------------------------------------------
    // 1. CANONICAL TARGET CONFIGURATION & NO SILENT FALLBACK TO OLD DB
    // ---------------------------------------------------------
    console.log('Test 1: Canonical target ("zoya-updates/(default)", asia-south2) & zero fallback...');
    assert.equal(TARGET_FIREBASE_PROJECT_ID, 'zoya-updates', 'Canonical project ID must be zoya-updates');
    assert.equal(TARGET_FIRESTORE_DATABASE_ID, '(default)', 'Canonical database ID must be (default)');
    assert.equal(TARGET_FIRESTORE_REGION, 'asia-south2', 'Canonical region must be asia-south2 (Delhi)');

    const firebaseSource = fs.readFileSync(path.resolve(process.cwd(), 'server/firebase.ts'), 'utf-8');
    assert.equal(
      firebaseSource.includes('RC6K'),
      false,
      'server/firebase.ts must NOT contain any RC6K-based cutover condition'
    );
    assert.equal(
      firebaseSource.includes('legacy-client'),
      false,
      'server/firebase.ts must NOT contain legacy-client fallback'
    );

    const liveAdmin = getAdminFirestore();
    if (!liveAdmin) {
      setServerFirestoreTestAdapter(null);
      setUseInMemoryStoreForTesting(false);
      clearLicenseInMemoryCache();

      let adapterThrew = false;
      try {
        await getActiveServerFirestoreAdapter();
      } catch (err: any) {
        adapterThrew = true;
        assert.equal(err?.code, 'STORAGE_UNAVAILABLE');
      }
      assert.equal(
        adapterThrew,
        true,
        'getActiveServerFirestoreAdapter() must fail with STORAGE_UNAVAILABLE when credentials are missing'
      );

      const unconfiguredValidate = await invokeHandler({
        method: 'POST',
        url: '/api/licenses/validate',
        body: {
          licenseKey: generateCryptographicLicenseKey(),
          deviceInfo: { deviceId: 'android_device_preflight_001', deviceModel: 'Phone' },
        },
      });
      assert.equal(
        unconfiguredValidate.statusCode,
        503,
        'POST /api/licenses/validate must return 503 when zoya-updates/(default) is unavailable'
      );
      assert.equal(
        unconfiguredValidate.json?.code,
        'STORAGE_UNAVAILABLE',
        'Must return STORAGE_UNAVAILABLE (never UNKNOWN_KEY) when database is unavailable'
      );
    }

    setUseInMemoryStoreForTesting(false);
    setSimulatedStorageFailureForTesting(false);
    setServerFirestoreTestAdapter(zoyaUpdatesAdapter);
    clearLicenseInMemoryCache();
    clearReleasesInMemoryCache();
    resetRateLimits();
    console.log('  ✓ Passed canonical zoya-updates/(default) routing & zero-fallback checks.');

    // ---------------------------------------------------------
    // 2. ADMIN PORTAL PIN ON EVERY OPEN, FAIL-CLOSED CONFIG, COOKIE/CORS/CSRF & UNAUTHORIZED REJECTION
    // ---------------------------------------------------------
    console.log('Test 2: Admin Portal fail-closed config, env-based PIN login, Secure cookie, CORS/CSRF & logout checks...');

    // 2a. Fail closed when ZOYA_ADMIN_PIN is missing
    delete process.env.ZOYA_ADMIN_PIN;
    delete process.env.ADMIN_JWT_SECRET;
    const missingPinLogin = await invokeHandler({
      method: 'POST',
      url: '/api/admin/login',
      body: { pin: TEST_ADMIN_PIN },
    });
    assert.equal(missingPinLogin.statusCode, 500, 'Missing ZOYA_ADMIN_PIN must fail closed with 500');
    assert.equal(missingPinLogin.json?.code, 'ADMIN_AUTH_NOT_CONFIGURED');

    // 2b. Fail closed when ADMIN_JWT_SECRET is missing or too short
    process.env.ZOYA_ADMIN_PIN = TEST_ADMIN_PIN;
    process.env.ADMIN_JWT_SECRET = 'short_secret';
    const invalidJwtSecretLogin = await invokeHandler({
      method: 'POST',
      url: '/api/admin/login',
      body: { pin: TEST_ADMIN_PIN },
    });
    assert.equal(invalidJwtSecretLogin.statusCode, 500, 'Short/invalid ADMIN_JWT_SECRET must fail closed with 500');
    assert.equal(invalidJwtSecretLogin.json?.code, 'ADMIN_AUTH_NOT_CONFIGURED');

    // 2c. Configure valid environment secrets and verify login + Secure HttpOnly SameSite=Strict cookie + same-origin CORS
    process.env.ADMIN_JWT_SECRET = TEST_ADMIN_JWT_SECRET;
    const pinLoginSuccess = await invokeHandler({
      method: 'POST',
      url: '/api/admin/login',
      headers: {
        host: 'zoyalive.vercel.app',
        'x-forwarded-proto': 'https',
        origin: 'https://zoyalive.vercel.app',
      },
      body: { pin: TEST_ADMIN_PIN },
    });
    assert.equal(pinLoginSuccess.statusCode, 200, 'Configured Admin PIN must succeed with HTTP 200');
    assert.equal(pinLoginSuccess.json?.success, true);
    assert.ok(typeof pinLoginSuccess.json?.token === 'string' && pinLoginSuccess.json.token.length > 20);
    assert.ok(
      typeof pinLoginSuccess.headers['set-cookie'] === 'string' &&
        pinLoginSuccess.headers['set-cookie'].includes('HttpOnly') &&
        pinLoginSuccess.headers['set-cookie'].includes('SameSite=Strict') &&
        pinLoginSuccess.headers['set-cookie'].includes('Secure'),
      'Login on HTTPS must set HttpOnly, SameSite=Strict, Secure cookie'
    );
    assert.equal(
      pinLoginSuccess.headers['access-control-allow-origin'],
      'https://zoyalive.vercel.app',
      'Admin API CORS must reflect only the legitimate website origin'
    );
    const adminToken: string = pinLoginSuccess.json.token;
    const adminCookiePair = pinLoginSuccess.headers['set-cookie'].split(';')[0];

    // Untrusted cross-origin request must NEVER receive wildcard or reflected CORS header
    const untrustedCorsSession = await invokeHandler({
      method: 'GET',
      url: '/api/admin/session',
      headers: {
        host: 'zoyalive.vercel.app',
        'x-forwarded-proto': 'https',
        origin: 'https://evil-attacker.example',
      },
    });
    assert.equal(
      untrustedCorsSession.headers['access-control-allow-origin'],
      undefined,
      'Admin API must NOT return Access-Control-Allow-Origin for untrusted origins'
    );

    const sessionCheck = await invokeHandler({
      method: 'GET',
      url: '/api/admin/session',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(sessionCheck.statusCode, 200);
    assert.equal(sessionCheck.json?.authenticated, true);

    // Cookie-authenticated Admin mutation from cross-origin must be blocked by CSRF check
    const csrfBlockedMutation = await invokeHandler({
      method: 'POST',
      url: '/api/admin/licenses',
      headers: {
        host: 'zoyalive.vercel.app',
        'x-forwarded-proto': 'https',
        origin: 'https://evil-attacker.example',
        cookie: adminCookiePair,
      },
      body: { customerName: 'CSRF Attacker', customerEmail: 'csrf@evil.example' },
    });
    assert.equal(csrfBlockedMutation.statusCode, 403, 'Cross-origin cookie-authenticated admin mutation must fail with 403');
    assert.equal(csrfBlockedMutation.json?.code, 'CSRF_ORIGIN_MISMATCH');

    // Cross-origin logout must also be blocked by CSRF check
    const csrfBlockedLogout = await invokeHandler({
      method: 'POST',
      url: '/api/admin/logout',
      headers: {
        host: 'zoyalive.vercel.app',
        'x-forwarded-proto': 'https',
        origin: 'https://evil-attacker.example',
        cookie: adminCookiePair,
      },
    });
    assert.equal(csrfBlockedLogout.statusCode, 403, 'Cross-origin logout must fail with 403 CSRF_ORIGIN_MISMATCH');

    // Verify invalid PIN rejection
    const wrongPinLogin = await invokeHandler({
      method: 'POST',
      url: '/api/admin/login',
      body: { pin: '0000000000' },
    });
    assert.equal(wrongPinLogin.statusCode, 401, 'Invalid PIN must return 401');

    // Verify session invalidation on same-origin logout (PIN required on every open)
    const logoutRes = await invokeHandler({
      method: 'POST',
      url: '/api/admin/logout',
      headers: {
        host: 'zoyalive.vercel.app',
        'x-forwarded-proto': 'https',
        origin: 'https://zoyalive.vercel.app',
        Authorization: `Bearer ${adminToken}`,
      },
    });
    assert.equal(logoutRes.statusCode, 200);
    assert.ok(
      typeof logoutRes.headers['set-cookie'] === 'string' &&
        logoutRes.headers['set-cookie'].includes('Max-Age=0') &&
        logoutRes.headers['set-cookie'].includes('Secure'),
      'Logout must invalidate Secure session cookie'
    );

    // Old admin session cannot automatically reopen the portal without PIN
    const postLogoutSession = await invokeHandler({
      method: 'GET',
      url: '/api/admin/session',
    });
    assert.equal(postLogoutSession.statusCode, 200);
    assert.equal(postLogoutSession.json?.authenticated, false, 'Session must be unauthenticated after logout');

    // Verify expired session rejection
    const expiredHeader = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const expiredPayload = Buffer.from(
      JSON.stringify({
        email: 'admin@zoya.ai',
        role: 'admin',
        name: 'Riyajul',
        iat: Math.floor(Date.now() / 1000) - 7200,
        exp: Math.floor(Date.now() / 1000) - 3600, // Expired 1 hour ago
      })
    ).toString('base64url');
    const expiredSig = crypto
      .createHmac('sha256', getJwtSecret())
      .update(`${expiredHeader}.${expiredPayload}`)
      .digest('base64url');
    const expiredToken = `${expiredHeader}.${expiredPayload}.${expiredSig}`;

    const expiredCall = await invokeHandler({
      method: 'GET',
      url: '/api/admin/licenses',
      headers: { Authorization: `Bearer ${expiredToken}` },
    });
    assert.equal(expiredCall.statusCode, 401, 'Expired session must return 401 to drop user back to PIN screen');

    // Verify direct admin API access without authentication is rejected across multiple endpoints
    const unauthLicenses = await invokeHandler({ method: 'GET', url: '/api/admin/licenses' });
    assert.equal(unauthLicenses.statusCode, 401, 'GET /api/admin/licenses without token must return 401');

    const unauthCreateLicense = await invokeHandler({
      method: 'POST',
      url: '/api/admin/licenses',
      body: { customerName: 'Test Unauth', customerEmail: 'unauth@test.com' },
    });
    assert.equal(unauthCreateLicense.statusCode, 401, 'POST /api/admin/licenses without token must return 401');

    const unauthReleases = await invokeHandler({ method: 'GET', url: '/api/admin/releases' });
    assert.equal(unauthReleases.statusCode, 401, 'GET /api/admin/releases without token must return 401');

    const unauthUpload = await invokeHandler({ method: 'POST', url: '/api/admin/upload?phase=finalize' });
    assert.equal(unauthUpload.statusCode, 401, 'POST /api/admin/upload without token must return 401');

    const unauthNotify = await invokeHandler({ method: 'POST', url: '/api/admin/notify' });
    assert.equal(unauthNotify.statusCode, 401, 'POST /api/admin/notify without token must return 401');

    console.log('  ✓ Passed Admin PIN login, session invalidation on logout & direct access rejection checks.');

    // ---------------------------------------------------------
    // 3. CRYPTOGRAPHIC KEY GENERATION & FORMAT VALIDATION
    // ---------------------------------------------------------
    console.log('Test 3: Cryptographic key generation, format validation & collision handling...');
    const sampleKeys = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const k = generateCryptographicLicenseKey();
      assert.ok(isValidLicenseKeyFormat(k), `Generated key ${k} must match ZOYA-XXXX-XXXX-XXXX`);
      sampleKeys.add(k);
    }
    assert.equal(sampleKeys.size, 50, '50 generated keys must all be unique');
    console.log('  ✓ Passed cryptographic key format and collision handling checks.');

    // ---------------------------------------------------------
    // 4. NEW SIMPLE LICENSE GENERATION & ZERO PAYMENT FIELDS
    // ---------------------------------------------------------
    console.log('Test 4: Generating a new lifetime license (starts Unactivated, zero payment fields)...');

    // 4a. Missing encryption secret failure (fails closed)
    delete process.env.LICENSE_KEY_ENCRYPTION_SECRET;
    const missingSecretRes = await invokeHandler({
      method: 'POST',
      url: '/api/admin/licenses',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        customerName: 'Fail Closed Tester',
        customerEmail: 'failclosed@example.com',
        licenseType: 'Lifetime',
      },
    });
    assert.equal(missingSecretRes.statusCode, 500, 'Missing LICENSE_KEY_ENCRYPTION_SECRET must fail closed with 500');

    // 4b. Invalid secret (< 32 bytes) failure (fails closed)
    process.env.LICENSE_KEY_ENCRYPTION_SECRET = 'short_secret_under_32_bytes';
    const shortSecretRes = await invokeHandler({
      method: 'POST',
      url: '/api/admin/licenses',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        customerName: 'Short Secret Tester',
        customerEmail: 'shortsecret@example.com',
        licenseType: 'Lifetime',
      },
    });
    assert.equal(shortSecretRes.statusCode, 500, 'Secret shorter than 32 bytes must fail closed with 500');

    // 4c. Set explicitly configured 32+ byte cryptographically random encryption secret
    process.env.LICENSE_KEY_ENCRYPTION_SECRET = 'TEST_DEDICATED_AES256_GCM_ENCRYPTION_SECRET_32_CHARS_MINIMUM_OK';

    const createRes = await invokeHandler({
      method: 'POST',
      url: '/api/admin/licenses',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        customerName: 'Aarav Sharma',
        customerEmail: 'aarav.sharma@example.com',
        licenseType: 'Lifetime',
      },
    });
    assert.equal(createRes.statusCode, 201, 'POST /api/admin/licenses must return 201');
    const plaintextKey: string = createRes.json.generatedKey;
    const createdLic = createRes.json.license;
    createdLicenseIds.push(createdLic.id);

    assert.ok(isValidLicenseKeyFormat(plaintextKey), 'Returned generatedKey must match ZOYA-XXXX-XXXX-XXXX');
    assert.equal(createdLic.status, 'unactivated', 'Initial status of generated key MUST be unactivated');
    assert.equal(createdLic.keyHash, hashLicenseKey(plaintextKey), 'Stored keyHash must match SHA-256 hash');
    assert.equal(createdLic.maskedKey, maskLicenseKey(plaintextKey).maskedKey, 'Masked key must match format');
    assert.equal(createdLic.linkedDevice, null, 'Newly generated license must have no bound device');
    assert.equal(createdLic.activatedAt, null, 'Newly generated license must have null activatedAt');

    // Confirm completely zero payment fields
    assert.equal((createdLic as any).paymentReference, undefined, 'Must not contain paymentReference');
    assert.equal((createdLic as any).amount, undefined, 'Must not contain amount');
    assert.equal((createdLic as any).currency, undefined, 'Must not contain currency');
    assert.equal((createdLic as any).paymentVerified, undefined, 'Must not contain paymentVerified');
    assert.equal((createdLic as any).isComplimentary, undefined, 'Must not contain isComplimentary');
    assert.equal((createdLic as any).licenseKey, undefined, 'Stored license object must not contain plaintext key');

    // Confirm persisted in database
    clearLicenseInMemoryCache();
    const persisted = await getLicenseById(createdLic.id);
    assert.ok(persisted, 'License must be retrievable from Firestore');
    assert.equal(persisted?.status, 'unactivated');
    assert.equal(JSON.stringify(persisted).includes(plaintextKey), false, 'Record must NEVER contain plaintext key');
    console.log('  ✓ Passed simple lifetime license generation, unactivated state & zero payment fields.');

    // ---------------------------------------------------------
    // 5. ONE-PHONE LIFETIME ACTIVATION FLOW & DEVICE BINDING
    // ---------------------------------------------------------
    console.log('Test 5: One-phone lifetime activation flow, device binding, and mismatch rejection...');

    // 5a. Reject invalid / forged / empty device IDs
    assert.equal(isValidDeviceId(''), false);
    assert.equal(isValidDeviceId('unknown'), false);
    assert.equal(isValidDeviceId('00000000'), false);
    assert.equal(isValidDeviceId('short'), false);
    assert.equal(isValidDeviceId('   valid_len_but_spaces   '), false);
    assert.equal(isValidDeviceId('android_pixel_8_pro_hw_uuid'), true);

    const badDeviceValidation = await invokeHandler({
      method: 'POST',
      url: '/api/licenses/validate',
      body: {
        licenseKey: plaintextKey,
        deviceInfo: {
          deviceId: 'unknown',
          deviceModel: 'Phone',
        },
      },
    });
    assert.equal(badDeviceValidation.statusCode, 400, 'Invalid device ID must return HTTP 400');
    assert.equal(badDeviceValidation.json?.code, 'INVALID_DEVICE_INFO');

    // 5b. First activation from Phone A binds the license permanently
    const phoneADeviceId = 'android_pixel8_hardware_uuid_001';
    const phoneAModel = 'Google Pixel 8 Pro';

    const firstActivationRes = await invokeHandler({
      method: 'POST',
      url: '/api/licenses/activate',
      body: {
        licenseKey: plaintextKey,
        deviceInfo: {
          deviceId: phoneADeviceId,
          deviceModel: phoneAModel,
          androidVersion: 'Android 14',
          appVersion: '2.5.0',
        },
      },
    });
    assert.equal(firstActivationRes.statusCode, 200, 'First activation on phone must succeed with 200');
    assert.equal(firstActivationRes.json?.valid, true);
    assert.equal(firstActivationRes.json?.code, 'LICENSE_VALID');
    assert.equal(firstActivationRes.json?.status, 'active');
    assert.ok(firstActivationRes.json?.license?.activatedAt);
    assert.equal(firstActivationRes.json?.license?.linkedDevice?.deviceId, phoneADeviceId);
    assert.equal(firstActivationRes.json?.license?.linkedDevice?.deviceModel, phoneAModel);

    // Verify ES256 signed entitlement token contains embedded device ID and strict header/claims
    const phoneAToken = firstActivationRes.json?.entitlementToken;
    assert.ok(typeof phoneAToken === 'string', 'Activation must return ES256 entitlement token');
    const verifiedTokenPayload = verifySignedEntitlementToken(phoneAToken, hashLicenseKey(plaintextKey), phoneADeviceId);
    assert.equal(verifiedTokenPayload.valid, true, 'Entitlement token must verify with bound deviceId');
    assert.equal(verifiedTokenPayload.header?.alg, ENTITLEMENT_ALGORITHM);
    assert.equal(verifiedTokenPayload.header?.typ, 'JWT');
    assert.equal(verifiedTokenPayload.header?.kid, TEST_ES256_KEY_ID);
    assert.equal(verifiedTokenPayload.payload?.deviceId, phoneADeviceId);
    assert.equal(verifiedTokenPayload.payload?.iss, ENTITLEMENT_ISSUER);
    assert.equal(verifiedTokenPayload.payload?.aud, ENTITLEMENT_AUDIENCE);
    assert.equal(verifiedTokenPayload.payload?.status, 'active');

    // Verify token fails verification if deviceId is wrong
    const mismatchedTokenCheck = verifySignedEntitlementToken(phoneAToken, hashLicenseKey(plaintextKey), 'different_device_id');
    assert.equal(mismatchedTokenCheck.valid, false, 'Entitlement token must reject device ID mismatch');

    // 5c. Same Phone A reactivates / validates idempotently
    const samePhoneValidation = await invokeHandler({
      method: 'POST',
      url: '/api/licenses/validate',
      body: {
        licenseKey: plaintextKey,
        deviceInfo: {
          deviceId: phoneADeviceId,
          deviceModel: phoneAModel,
        },
      },
    });
    assert.equal(samePhoneValidation.statusCode, 200, 'Same phone validation must succeed');
    assert.equal(samePhoneValidation.json?.valid, true);
    assert.equal(samePhoneValidation.json?.activatedAt, firstActivationRes.json.activatedAt, 'Idempotent activation preserves activatedAt');

    // 5d. Different Phone B attempts to use or activate the same license key -> REJECTED
    const phoneBDeviceId = 'android_samsung_galaxy_s24_uuid_002';
    const phoneBModel = 'Samsung Galaxy S24 Ultra';

    const differentPhoneValidation = await invokeHandler({
      method: 'POST',
      url: '/api/licenses/validate',
      body: {
        licenseKey: plaintextKey,
        deviceInfo: {
          deviceId: phoneBDeviceId,
          deviceModel: phoneBModel,
        },
      },
    });
    assert.equal(
      differentPhoneValidation.statusCode,
      403,
      'Validation from different phone must be rejected with HTTP 403'
    );
    assert.equal(differentPhoneValidation.json?.valid, false);
    assert.equal(differentPhoneValidation.json?.code, 'DEVICE_MISMATCH');
    assert.ok(
      differentPhoneValidation.json?.error?.includes('bound to another phone'),
      'Must explain license is bound to another phone'
    );

    // 5e. Simulate two simultaneous activation attempts on a freshly unactivated license
    const freshSimultaneousKey = generateCryptographicLicenseKey();
    const simCreate = await createLifetimeLicense(
      {
        customerName: 'Simultaneous Test',
        customerEmail: 'sim@example.com',
        licenseType: 'Lifetime',
      },
      adminUser,
      () => freshSimultaneousKey
    );
    assert.equal(simCreate.success, true);
    if (simCreate.success) {
      createdLicenseIds.push(simCreate.license.id);
    }

    const [simAttempt1, simAttempt2] = await Promise.all([
      invokeHandler({
        method: 'POST',
        url: '/api/licenses/validate',
        body: {
          licenseKey: freshSimultaneousKey,
          deviceInfo: { deviceId: 'phone_concurrent_alpha_01', deviceModel: 'Phone Alpha' },
        },
      }),
      invokeHandler({
        method: 'POST',
        url: '/api/licenses/validate',
        body: {
          licenseKey: freshSimultaneousKey,
          deviceInfo: { deviceId: 'phone_concurrent_beta_02', deviceModel: 'Phone Beta' },
        },
      }),
    ]);

    const successfulAttempts = [simAttempt1, simAttempt2].filter((r) => r.statusCode === 200);
    const rejectedAttempts = [simAttempt1, simAttempt2].filter((r) => r.statusCode === 403);
    assert.equal(successfulAttempts.length, 1, 'Exactly one concurrent attempt must succeed');
    assert.equal(rejectedAttempts.length, 1, 'The competing concurrent attempt must receive HTTP 403 DEVICE_MISMATCH');
    assert.equal(rejectedAttempts[0].json?.code, 'DEVICE_MISMATCH');
    console.log('  ✓ Passed one-phone binding, idempotent same-phone validation, mismatch rejection & concurrency checks.');

    // ---------------------------------------------------------
    // 6. ADMIN DEVICE REBIND, REVOCATION & AUDIT HISTORY
    // ---------------------------------------------------------
    console.log('Test 6: Admin-authorized device rebind, license revocation & audit history...');

    // Verify admin-side manual activation action is removed (customer activates via POST /api/licenses/validate)
    const removedAdminActivateRes = await invokeHandler({
      method: 'POST',
      url: `/api/admin/licenses/${createdLic.id}`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        action: 'activate',
        deviceModel: 'Manual Admin Phone',
        deviceId: 'manual_admin_device_001',
      },
    });
    assert.equal(
      removedAdminActivateRes.statusCode,
      400,
      'Admin manual activation action must be rejected with HTTP 400 (customers activate via Zoya Android)'
    );

    // 6a. Admin Rebind Device
    // Currently plaintextKey is bound to Phone A. Admin rebinds it with explicit reason.
    const rebindRes = await invokeHandler({
      method: 'POST',
      url: `/api/admin/licenses/${createdLic.id}`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        action: 'rebind',
        reason: 'Customer upgraded to a replacement phone',
      },
    });
    assert.equal(rebindRes.statusCode, 200, 'Admin device rebind must succeed with HTTP 200');
    assert.equal(rebindRes.json?.license?.status, 'unactivated');
    assert.equal(rebindRes.json?.license?.linkedDevice, null, 'Bound device must be cleared');

    // Now Phone B can successfully activate the unactivated license!
    const phoneBNewActivation = await invokeHandler({
      method: 'POST',
      url: '/api/licenses/validate',
      body: {
        licenseKey: plaintextKey,
        deviceInfo: {
          deviceId: phoneBDeviceId,
          deviceModel: phoneBModel,
        },
      },
    });
    assert.equal(phoneBNewActivation.statusCode, 200, 'New phone must now successfully activate after admin rebind');
    assert.equal(phoneBNewActivation.json?.license?.linkedDevice?.deviceId, phoneBDeviceId);

    // Old Phone A is now rejected because it's bound to Phone B
    const phoneAOldValidation = await invokeHandler({
      method: 'POST',
      url: '/api/licenses/validate',
      body: {
        licenseKey: plaintextKey,
        deviceInfo: {
          deviceId: phoneADeviceId,
          deviceModel: phoneAModel,
        },
      },
    });
    assert.equal(phoneAOldValidation.statusCode, 403, 'Old Phone A must now receive DEVICE_MISMATCH');
    assert.equal(phoneAOldValidation.json?.code, 'DEVICE_MISMATCH');

    // 6b. Admin Revocation
    const revokeRes = await invokeHandler({
      method: 'POST',
      url: `/api/admin/licenses/${createdLic.id}`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        action: 'revoke',
        reason: 'Customer requested cancellation',
      },
    });
    assert.equal(revokeRes.statusCode, 200, 'Revoke action must succeed with 200');
    assert.equal(revokeRes.json?.license?.status, 'revoked');

    const revokedAttempt = await invokeHandler({
      method: 'POST',
      url: '/api/licenses/validate',
      body: {
        licenseKey: plaintextKey,
        deviceInfo: {
          deviceId: phoneBDeviceId,
          deviceModel: phoneBModel,
        },
      },
    });
    assert.equal(revokedAttempt.statusCode, 403, 'Revoked license must return 403');
    assert.equal(revokedAttempt.json?.code, 'LICENSE_REVOKED');

    // Check full audit log history
    const detailRes = await invokeHandler({
      method: 'GET',
      url: `/api/admin/licenses/${createdLic.id}`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(detailRes.statusCode, 200);
    const auditActions = (detailRes.json?.license?.auditLog || []).map((a: any) => a.action);
    assert.ok(auditActions.includes('created'), 'Audit log must record created');
    assert.ok(auditActions.includes('activated'), 'Audit log must record activated');
    assert.ok(auditActions.includes('device_rebound'), 'Audit log must record device_rebound');
    assert.ok(auditActions.includes('revoked'), 'Audit log must record revoked');

    // 6c. Unknown & Malformed Keys
    const malformedKeyRes = await invokeHandler({
      method: 'POST',
      url: '/api/licenses/validate',
      body: { licenseKey: 'BAD-KEY-1234' },
    });
    assert.equal(malformedKeyRes.statusCode, 400);
    assert.equal(malformedKeyRes.json?.code, 'MALFORMED_KEY');

    const unknownKey = generateCryptographicLicenseKey();
    const unknownKeyRes = await invokeHandler({
      method: 'POST',
      url: '/api/licenses/validate',
      body: {
        licenseKey: unknownKey,
        deviceInfo: { deviceId: 'device_unknown_test_001', deviceModel: 'Phone' },
      },
    });
    assert.equal(unknownKeyRes.statusCode, 404, 'Unknown key must return 404 UNKNOWN_KEY');
    assert.equal(unknownKeyRes.json?.code, 'UNKNOWN_KEY');
    console.log('  ✓ Passed admin device rebind, revocation, audit trail & key error checks.');

    // ---------------------------------------------------------
    // 7. RATE LIMITING & SECURITY CHECKS
    // ---------------------------------------------------------
    console.log('Test 7: Rate limiting checks on public endpoints...');
    resetRateLimits();
    let lastValidateStatus = 0;
    for (let i = 0; i < 21; i++) {
      const valAttempt = await invokeHandler({
        method: 'POST',
        url: '/api/licenses/validate',
        headers: { 'x-forwarded-for': '198.51.100.99' },
        body: { licenseKey: unknownKey },
      });
      lastValidateStatus = valAttempt.statusCode;
    }
    assert.equal(lastValidateStatus, 429, '21st validation attempt from same IP must return HTTP 429');
    resetRateLimits();
    console.log('  ✓ Passed rate limiting checks.');

    // ---------------------------------------------------------
    // 8. FIRESTORE CLIENT RULES LOCKED DOWN
    // ---------------------------------------------------------
    console.log('Test 8: Verifying Firestore client rules maintain strict server identity check...');
    const rulesSource = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf-8');
    assert.ok(
      rulesSource.includes('match /licenses/{licenseId}') && rulesSource.includes('isAuthenticatedServer()'),
      'firestore.rules must keep /licenses locked down to privileged server identity'
    );
    console.log('  ✓ Passed Firestore client rules lockdown check.');

    // ---------------------------------------------------------
    // 9. FIRESTORE OUTAGE HANDLING (503 STORAGE_UNAVAILABLE, NEVER 404 UNKNOWN_KEY) & 30-DAY OFFLINE GRACE
    // ---------------------------------------------------------
    console.log('Test 9: Firestore outage handling (503 STORAGE_UNAVAILABLE) & bound 30-day offline grace...');
    // Create an active license to generate an entitlement token before simulating an outage
    const offlineTestKey = generateCryptographicLicenseKey();
    const offlineLicRes = await createLifetimeLicense(
      { customerName: 'Offline Test User', customerEmail: 'offline@example.com' },
      adminUser,
      () => offlineTestKey
    );
    assert.equal(offlineLicRes.success, true);
    if (offlineLicRes.success) {
      createdLicenseIds.push(offlineLicRes.license.id);
    }

    const offlineDeviceId = 'android_offline_device_uuid_009';
    const offlineActivationRes = await invokeHandler({
      method: 'POST',
      url: '/api/licenses/validate',
      body: {
        licenseKey: offlineTestKey,
        deviceInfo: { deviceId: offlineDeviceId, deviceModel: 'Offline Phone' },
      },
    });
    assert.equal(offlineActivationRes.statusCode, 200);
    const validOfflineToken = offlineActivationRes.json?.entitlementToken;
    assert.ok(validOfflineToken);

    // Simulate Firestore outage
    setSimulatedStorageFailureForTesting(true);
    clearLicenseInMemoryCache();

    try {
      // 1. Admin listing fails with 503
      const listFail = await invokeHandler({
        method: 'GET',
        url: '/api/admin/licenses',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.equal(listFail.statusCode, 503);
      assert.equal(listFail.json?.code, 'STORAGE_UNAVAILABLE');

      // 2. Unactivated key cannot be activated during outage -> 503 STORAGE_UNAVAILABLE
      const unactivatedFail = await invokeHandler({
        method: 'POST',
        url: '/api/licenses/validate',
        body: {
          licenseKey: generateCryptographicLicenseKey(),
          deviceInfo: { deviceId: 'phone_during_outage_01', deviceModel: 'Phone' },
        },
      });
      assert.equal(unactivatedFail.statusCode, 503);
      assert.equal(unactivatedFail.json?.code, 'STORAGE_UNAVAILABLE');
      assert.notEqual(unactivatedFail.json?.code, 'UNKNOWN_KEY', 'Must NEVER return UNKNOWN_KEY on database error');

      // 3. Previously activated phone with valid entitlement token passes with 30-day offline grace
      const offlineGracePass = await invokeHandler({
        method: 'POST',
        url: '/api/licenses/validate',
        body: {
          licenseKey: offlineTestKey,
          entitlementToken: validOfflineToken,
          deviceInfo: { deviceId: offlineDeviceId, deviceModel: 'Offline Phone' },
        },
      });
      assert.equal(offlineGracePass.statusCode, 200, 'Valid token on bound phone must succeed during outage');
      assert.equal(offlineGracePass.json?.valid, true);
      assert.equal(offlineGracePass.json?.isOfflineGrace, true);

      // 4. Different phone attempting to use offline grace token is REJECTED with 503
      const offlineMismatchedPhone = await invokeHandler({
        method: 'POST',
        url: '/api/licenses/validate',
        body: {
          licenseKey: offlineTestKey,
          entitlementToken: validOfflineToken,
          deviceInfo: { deviceId: 'different_phone_during_outage', deviceModel: 'Intruder Phone' },
        },
      });
      assert.equal(offlineMismatchedPhone.statusCode, 403, 'Token cannot bypass device binding during outage');
      assert.equal(offlineMismatchedPhone.json?.code, 'DEVICE_MISMATCH');

      // 5. Forged token during outage is REJECTED
      const forgedOffline = await invokeHandler({
        method: 'POST',
        url: '/api/licenses/validate',
        body: {
          licenseKey: offlineTestKey,
          entitlementToken: 'forged.signature.token',
          deviceInfo: { deviceId: offlineDeviceId, deviceModel: 'Offline Phone' },
        },
      });
      assert.equal(forgedOffline.statusCode, 503);
      assert.equal(forgedOffline.json?.code, 'STORAGE_UNAVAILABLE');
    } finally {
      setSimulatedStorageFailureForTesting(false);
    }
    console.log('  ✓ Passed 503 STORAGE_UNAVAILABLE outage handling & 30-day offline grace checks.');

    // ---------------------------------------------------------
    // 10. RELEASES, APK BINARY CHUNKS & FCM PRESERVATION
    // ---------------------------------------------------------
    console.log('Test 10: Verifying Releases, multi-chunk APK storage & FCM functionality...');
    const syntheticApkSize = APK_CHUNK_SIZE + 32768;
    const syntheticApkBuffer = Buffer.alloc(syntheticApkSize);
    syntheticApkBuffer[0] = 0x50;
    syntheticApkBuffer[1] = 0x4b;
    syntheticApkBuffer[2] = 0x03;
    syntheticApkBuffer[3] = 0x04;
    crypto.randomFillSync(syntheticApkBuffer, 4);

    const storedApk = await storeApkBuffer(syntheticApkBuffer, 'zoya-test-release.apk');
    assert.equal(storedApk.chunkCount, 2);

    const testReleaseId = `rel_test_${Date.now()}`;
    const testRelease: ReleaseMetadata = {
      id: testReleaseId,
      versionName: '2.5.0',
      versionCode: 250,
      applicationId: 'com.riyajul.zoya',
      fileName: 'zoya-test-release.apk',
      fileSize: storedApk.fileSize,
      fileSizeFormatted: storedApk.fileSizeFormatted,
      sha256: storedApk.sha256,
      storageKey: storedApk.storageKey,
      storagePath: storedApk.storagePath,
      chunkCount: storedApk.chunkCount,
      binaryVerified: true,
      downloadUrl: `/api/releases/download?id=${testReleaseId}`,
      releaseDate: '2026-10-30',
      releaseNotes: 'Preserved release testing',
      minAndroidVersion: 'Android 8.0 (API 26)+',
      minSdkVersion: 26,
      targetSdkVersion: 34,
      targetAndroidVersion: 'Android 14 (API 34)',
      isPublished: true,
      publishedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await saveRelease(testRelease);
    const fetchedRel = await getReleaseById(testReleaseId);
    assert.ok(fetchedRel);
    assert.equal(fetchedRel?.versionName, '2.5.0');

    // Verify canonical production domain https://zoyalive.vercel.app and generated release links
    assert.equal(
      DEFAULT_PRODUCTION_SITE_URL,
      'https://zoyalive.vercel.app',
      'DEFAULT_PRODUCTION_SITE_URL must be https://zoyalive.vercel.app'
    );
    assert.equal(
      getPublicSiteOrigin(),
      'https://zoyalive.vercel.app',
      'getPublicSiteOrigin() must return https://zoyalive.vercel.app'
    );
    const notifContent = buildReleaseNotificationContent(testRelease);
    assert.equal(
      notifContent.data.downloadUrl,
      `https://zoyalive.vercel.app/api/releases/download?id=${testReleaseId}`,
      'Generated FCM downloadUrl must use https://zoyalive.vercel.app without duplicate slashes'
    );
    assert.equal(
      notifContent.data.manifestUrl,
      'https://zoyalive.vercel.app/api/releases/manifest',
      'Generated FCM manifestUrl must use https://zoyalive.vercel.app'
    );

    await deleteRelease(testReleaseId);

    const fakeFcmToken = 'fcm_test_device_token_' + crypto.randomBytes(16).toString('hex');
    const regRes = await invokeHandler({
      method: 'POST',
      url: '/api/devices/register',
      body: {
        token: fakeFcmToken,
        platform: 'android',
        applicationId: 'com.riyajul.zoya',
        appVersion: '2.5.0',
        versionCode: 250,
      },
    });
    assert.equal(regRes.statusCode, 200);
    assert.equal(regRes.json?.success, true);
    console.log('  ✓ Passed Releases, APK binary chunks & FCM preservation checks.');

    // ---------------------------------------------------------
    // 11. PERMANENT LICENSE KEY VISIBILITY & AES-256-GCM AUTHENTICATED ENCRYPTION
    // ---------------------------------------------------------
    console.log('Test 11: Permanent license key visibility, AES-256-GCM encryption & admin reveal...');

    // 11a. Generate license via admin endpoint and verify AES-256-GCM encrypted storage
    const genRes = await invokeHandler({
      method: 'POST',
      url: '/api/admin/licenses',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        customerName: 'Permanent Visibility Tester',
        customerEmail: 'visibility@zoyatest.internal',
      },
    });
    assert.equal(genRes.statusCode, 201);
    assert.equal(genRes.json?.success, true);
    const visibilityLicenseId: string = genRes.json.license.id;
    const originalGeneratedKey: string = genRes.json.generatedKey;
    createdLicenseIds.push(visibilityLicenseId);

    // Verify raw storage document in Firestore (no plaintext key, encryptedKey present)
    const storedDoc = await zoyaUpdatesAdapter.getDocumentById('licenses', visibilityLicenseId);
    assert.ok(storedDoc.exists && storedDoc.data);
    assert.equal(typeof storedDoc.data.encryptedKey, 'string');
    assert.ok(storedDoc.data.encryptedKey.length > 30);
    const encParts = storedDoc.data.encryptedKey.split(':');
    assert.equal(encParts.length, 3, 'encryptedKey must be in format ivHex:authTagHex:ciphertextHex');
    assert.equal(encParts[0].length, 24, '12-byte IV in hex must be 24 chars');
    assert.equal(encParts[1].length, 32, '16-byte authTag in hex must be 32 chars');
    // Ensure plaintext key fields are NEVER stored in Firestore
    assert.equal(storedDoc.data.licenseKey, undefined);
    assert.equal(storedDoc.data.plaintextKey, undefined);
    assert.equal(storedDoc.data.rawKey, undefined);

    // 11b. Admin key reveal via dedicated GET endpoint
    const revealGetRes = await invokeHandler({
      method: 'GET',
      url: `/api/admin/licenses/${visibilityLicenseId}/key`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(revealGetRes.statusCode, 200);
    assert.equal(revealGetRes.json?.success, true);
    assert.equal(revealGetRes.json?.licenseKey, originalGeneratedKey);

    // 11c. Admin key reveal via POST /key and action: 'reveal'
    const revealPostRes = await invokeHandler({
      method: 'POST',
      url: `/api/admin/licenses/${visibilityLicenseId}/key`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(revealPostRes.statusCode, 200);
    assert.equal(revealPostRes.json?.licenseKey, originalGeneratedKey);

    const revealActionRes = await invokeHandler({
      method: 'POST',
      url: `/api/admin/licenses/${visibilityLicenseId}`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { action: 'reveal' },
    });
    assert.equal(revealActionRes.statusCode, 200);
    assert.equal(revealActionRes.json?.licenseKey, originalGeneratedKey);

    // 11d. Simulating a fresh admin login & page reload: clear all in-memory caches and obtain a fresh login token
    clearLicenseInMemoryCache();
    const freshLoginRes = await invokeHandler({
      method: 'POST',
      url: '/api/admin/login',
      body: { pin: TEST_ADMIN_PIN },
    });
    assert.equal(freshLoginRes.statusCode, 200);
    const freshAdminToken: string = freshLoginRes.json.token;

    const freshSessionReveal = await invokeHandler({
      method: 'POST',
      url: `/api/admin/licenses/${visibilityLicenseId}`,
      headers: { Authorization: `Bearer ${freshAdminToken}` },
      body: { action: 'reveal' },
    });
    assert.equal(freshSessionReveal.statusCode, 200);
    assert.equal(
      freshSessionReveal.json?.licenseKey,
      originalGeneratedKey,
      'Admin must be able to retrieve the original key after a fresh admin login'
    );
    assert.notEqual(
      freshSessionReveal.json?.licenseKey,
      'ZOYA-XXXX-XXXX-XXXX',
      'Revealed/copied key must never be the masked placeholder'
    );

    // Verify LicenseManager.tsx copy logic never falls back to copying ZOYA-XXXX-XXXX-XXXX
    const licenseManagerSource = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/admin/LicenseManager.tsx'),
      'utf-8'
    );
    assert.equal(
      licenseManagerSource.includes("fullKey || 'ZOYA-XXXX-XXXX-XXXX'"),
      false,
      'handleCopyRowKey must NEVER fall back to copying the masked placeholder ZOYA-XXXX-XXXX-XXXX'
    );
    assert.equal(
      licenseManagerSource.includes("if (trimmed === 'ZOYA-XXXX-XXXX-XXXX' || trimmed.includes('•'))"),
      true,
      'LicenseManager must explicitly reject masked placeholders before revealing or copying'
    );

    // 11e. Missing encryption secret during reveal fails closed without modifying records
    const savedValidSecret = process.env.LICENSE_KEY_ENCRYPTION_SECRET;
    delete process.env.LICENSE_KEY_ENCRYPTION_SECRET;
    const missingSecretReveal = await invokeHandler({
      method: 'POST',
      url: `/api/admin/licenses/${visibilityLicenseId}`,
      headers: { Authorization: `Bearer ${freshAdminToken}` },
      body: { action: 'reveal' },
    });
    assert.equal(missingSecretReveal.statusCode, 500, 'Missing secret during reveal must fail closed with 500');
    assert.equal(missingSecretReveal.json?.code, 'CONFIGURATION_ERROR');

    // 11f. Wrong encryption secret produces a clear controlled error without modifying records
    process.env.LICENSE_KEY_ENCRYPTION_SECRET = 'WRONG_AES256_GCM_ENCRYPTION_SECRET_32_BYTES_MISMATCH_TEST';
    const wrongSecretReveal = await invokeHandler({
      method: 'POST',
      url: `/api/admin/licenses/${visibilityLicenseId}`,
      headers: { Authorization: `Bearer ${freshAdminToken}` },
      body: { action: 'reveal' },
    });
    assert.equal(wrongSecretReveal.statusCode, 500, 'Wrong encryption secret must return 500 DECRYPTION_FAILED');
    assert.equal(wrongSecretReveal.json?.code, 'DECRYPTION_FAILED');
    assert.ok(
      typeof wrongSecretReveal.json?.error === 'string' &&
        wrongSecretReveal.json.error.includes('authentication tag verification failed'),
      'Wrong encryption secret must report controlled AES-256-GCM authentication tag failure'
    );

    // Verify record in Firestore was NOT modified, overwritten, or deleted by failed decryption
    const docAfterWrongSecret = await zoyaUpdatesAdapter.getDocumentById('licenses', visibilityLicenseId);
    assert.equal(
      docAfterWrongSecret.data?.encryptedKey,
      storedDoc.data.encryptedKey,
      'Failed decryption must never modify or overwrite existing encryptedKey'
    );

    // 11g. Restoring valid encryption secret decrypts previously encrypted record cleanly
    process.env.LICENSE_KEY_ENCRYPTION_SECRET = savedValidSecret;
    const restoredSecretReveal = await invokeHandler({
      method: 'POST',
      url: `/api/admin/licenses/${visibilityLicenseId}`,
      headers: { Authorization: `Bearer ${freshAdminToken}` },
      body: { action: 'reveal' },
    });
    assert.equal(restoredSecretReveal.statusCode, 200);
    assert.equal(
      restoredSecretReveal.json?.licenseKey,
      originalGeneratedKey,
      'Valid encryption secret must decrypt previously encrypted records'
    );

    // 11h. Unauthorized callers must be rejected
    const unauthReveal = await invokeHandler({
      method: 'GET',
      url: `/api/admin/licenses/${visibilityLicenseId}/key`,
    });
    assert.equal(unauthReveal.statusCode, 401, 'Reveal endpoint must reject unauthenticated callers');

    const invalidTokenReveal = await invokeHandler({
      method: 'GET',
      url: `/api/admin/licenses/${visibilityLicenseId}/key`,
      headers: { Authorization: 'Bearer forged.invalid.token' },
    });
    assert.equal(invalidTokenReveal.statusCode, 401, 'Reveal endpoint must reject invalid tokens');

    // 11i. Tamper detection: modifying auth tag or ciphertext must fail decryption
    const tamperedPayload = `${encParts[0]}:${encParts[1]}:${encParts[2].slice(0, -2)}ff`;
    const tamperedLicId = `lic_tamper_${Date.now()}`;
    createdLicenseIds.push(tamperedLicId);
    const tamperedRecord: LicenseRecord = {
      ...genRes.json.license,
      id: tamperedLicId,
      encryptedKey: tamperedPayload,
    };
    await saveLicenseRecord(tamperedRecord);
    clearLicenseInMemoryCache();

    const tamperedReveal = await invokeHandler({
      method: 'GET',
      url: `/api/admin/licenses/${tamperedLicId}/key`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(tamperedReveal.statusCode, 500);
    assert.equal(tamperedReveal.json?.code, 'DECRYPTION_FAILED');

    // 11j. Legacy license (SHA-256 only, encryptedKey missing) must return 404 KEY_NOT_RECOVERABLE
    const legacyLicId = `lic_legacy_${Date.now()}`;
    createdLicenseIds.push(legacyLicId);
    const legacyRecord: LicenseRecord = {
      ...genRes.json.license,
      id: legacyLicId,
      encryptedKey: null,
    };
    await saveLicenseRecord(legacyRecord);
    clearLicenseInMemoryCache();

    const legacyReveal = await invokeHandler({
      method: 'GET',
      url: `/api/admin/licenses/${legacyLicId}/key`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(legacyReveal.statusCode, 404);
    assert.equal(legacyReveal.json?.code, 'KEY_NOT_RECOVERABLE');

    // 11k. Validation on Android phone still succeeds with SHA-256
    const androidVal = await invokeHandler({
      method: 'POST',
      url: '/api/licenses/validate',
      body: {
        licenseKey: originalGeneratedKey,
        deviceInfo: {
          deviceId: 'android_perm_vis_device_001',
          deviceModel: 'Google Pixel 8 Pro',
          androidVersion: 'Android 14',
          appVersion: '2.5.0',
        },
      },
    });
    assert.equal(androidVal.statusCode, 200);
    assert.equal(androidVal.json?.code, 'LICENSE_VALID');
    assert.equal(androidVal.json?.status, 'active');
    console.log('  ✓ Passed permanent visibility, AES-256-GCM authenticated encryption & admin reveal checks.');

    // ---------------------------------------------------------
    // 12. STAGE 2 — FAST ACTIVE (/api/licenses/activate) & SEPARATE READ-ONLY VERIFICATION (/api/licenses/verify)
    // ---------------------------------------------------------
    console.log('Test 12: Stage 2 Fast Active (/api/licenses/activate), Read-Only Verify (/api/licenses/verify) & Vercel routing...');
    resetRateLimits();

    const s2Key = generateCryptographicLicenseKey();
    const s2CreateRes = await invokeHandler({
      method: 'POST',
      url: '/api/admin/licenses',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        customerName: 'Stage 2 Fast Active Customer',
        customerEmail: 'stage2@zoyatest.internal',
      },
    });
    assert.equal(s2CreateRes.statusCode, 201);
    const s2LicenseId: string = s2CreateRes.json.license.id;
    const s2PlaintextKey: string = s2CreateRes.json.generatedKey;
    createdLicenseIds.push(s2LicenseId);
    assert.ok(s2PlaintextKey && s2Key !== s2PlaintextKey);

    const s2DeviceA = {
      deviceId: 'android_stage2_primary_pixel_001',
      deviceModel: 'Google Pixel 9',
      androidVersion: 'Android 15',
      appVersion: '2.6.0',
    };
    const s2DeviceB = {
      deviceId: 'android_stage2_intruder_galaxy_002',
      deviceModel: 'Samsung Galaxy S25',
      androidVersion: 'Android 15',
      appVersion: '2.6.0',
    };

    // 12a. Read-only verify BEFORE activation rejects unactivated license WITHOUT activating or writing
    const metricsBeforeUnactVerify = { ...firestoreMetrics };
    const unactivatedVerifyRes = await invokeHandler({
      method: 'POST',
      url: '/api/licenses/verify',
      body: {
        licenseKey: s2PlaintextKey,
        deviceInfo: s2DeviceA,
        // Adversarial client-supplied status/valid fields must be completely ignored
        status: 'active',
        valid: true,
        activated: true,
      },
    });
    assert.equal(unactivatedVerifyRes.statusCode, 403, 'Verify before activation must reject with HTTP 403');
    assert.equal(unactivatedVerifyRes.json?.valid, false);
    assert.equal(unactivatedVerifyRes.json?.status, 'unactivated');
    assert.equal(unactivatedVerifyRes.json?.code, 'LICENSE_NOT_ACTIVATED');
    assert.equal(
      firestoreMetrics.transactionCalls,
      metricsBeforeUnactVerify.transactionCalls,
      'Verify on unactivated license must NOT run Firestore transactions'
    );
    assert.equal(
      firestoreMetrics.setDocumentCalls,
      metricsBeforeUnactVerify.setDocumentCalls,
      'Verify on unactivated license must NOT perform Firestore writes'
    );
    const docAfterUnactVerify = await zoyaUpdatesAdapter.getDocumentById('licenses', s2LicenseId);
    assert.equal(docAfterUnactVerify.data?.status, 'unactivated', 'License must remain unactivated');
    assert.equal(docAfterUnactVerify.data?.linkedDevice, null, 'License must remain unbound');

    // 12b. Initial Fast Active (/api/licenses/activate) atomically binds license to Device A
    const metricsBeforeFirstAct = { ...firestoreMetrics };
    const firstFastActiveRes = await invokeHandler({
      method: 'POST',
      url: '/api/licenses/activate',
      body: {
        licenseKey: s2PlaintextKey,
        deviceInfo: s2DeviceA,
      },
    });
    assert.equal(firstFastActiveRes.statusCode, 200);
    assert.equal(firstFastActiveRes.json?.valid, true);
    assert.equal(firstFastActiveRes.json?.status, 'active');
    assert.equal(firstFastActiveRes.json?.code, 'LICENSE_VALID');
    assert.ok(typeof firstFastActiveRes.json?.entitlementToken === 'string');
    assert.equal(firstFastActiveRes.json?.license?.linkedDevice?.deviceId, s2DeviceA.deviceId);
    assert.equal(
      firestoreMetrics.transactionCalls - metricsBeforeFirstAct.transactionCalls,
      1,
      'First Fast Active must execute exactly 1 atomic transaction'
    );
    assert.equal(
      firestoreMetrics.txSetCalls - metricsBeforeFirstAct.txSetCalls,
      1,
      'First Fast Active must write device binding cleanly'
    );

    const docAfterFirstAct = await zoyaUpdatesAdapter.getDocumentById('licenses', s2LicenseId);
    const initialValidationCount = docAfterFirstAct.data?.validationCount;
    const initialLastSeenAt = docAfterFirstAct.data?.lastSeenAt;
    const initialAuditLength = docAfterFirstAct.data?.auditLog?.length;
    assert.equal(initialValidationCount, 1);

    // 12c. Repeated Fast Active on SAME device (even after in-memory cache reset) skips unnecessary writes/transactions
    clearLicenseInMemoryCache();
    const metricsBeforeRepeatAct = { ...firestoreMetrics };
    const repeatFastActiveRes = await invokeHandler({
      method: 'POST',
      url: '/api/licenses/activate',
      body: {
        licenseKey: s2PlaintextKey,
        deviceInfo: s2DeviceA,
      },
    });
    assert.equal(repeatFastActiveRes.statusCode, 200);
    assert.equal(repeatFastActiveRes.json?.valid, true);
    assert.equal(repeatFastActiveRes.json?.code, 'LICENSE_VALID');
    assert.ok(typeof repeatFastActiveRes.json?.entitlementToken === 'string');
    assert.equal(
      firestoreMetrics.transactionCalls,
      metricsBeforeRepeatAct.transactionCalls,
      'Repeated Fast Active on same device must NOT run unnecessary transactions'
    );
    assert.equal(
      firestoreMetrics.txSetCalls,
      metricsBeforeRepeatAct.txSetCalls,
      'Repeated Fast Active on same device must NOT perform transaction writes'
    );
    assert.equal(
      firestoreMetrics.setDocumentCalls,
      metricsBeforeRepeatAct.setDocumentCalls,
      'Repeated Fast Active on same device must NOT perform document writes'
    );
    assert.ok(
      firestoreMetrics.queryCalls > metricsBeforeRepeatAct.queryCalls,
      'Repeated Fast Active must read directly from persistent Firestore storage (bypassing in-memory cache)'
    );

    // 12d. Fast Active from DIFFERENT device rejects with 403 DEVICE_MISMATCH and zero writes
    const metricsBeforeMismatchAct = { ...firestoreMetrics };
    const mismatchFastActiveRes = await invokeHandler({
      method: 'POST',
      url: '/api/licenses/activate',
      body: {
        licenseKey: s2PlaintextKey,
        deviceInfo: s2DeviceB,
      },
    });
    assert.equal(mismatchFastActiveRes.statusCode, 403);
    assert.equal(mismatchFastActiveRes.json?.valid, false);
    assert.equal(mismatchFastActiveRes.json?.code, 'DEVICE_MISMATCH');
    assert.equal(firestoreMetrics.transactionCalls, metricsBeforeMismatchAct.transactionCalls);
    assert.equal(firestoreMetrics.txSetCalls, metricsBeforeMismatchAct.txSetCalls);

    // 12e. Separate Read-Only Verify succeeds on bound Device A with ZERO writes and unchanged record state
    clearLicenseInMemoryCache();
    const metricsBeforeVerifyOk = { ...firestoreMetrics };
    const verifyOkRes = await invokeHandler({
      method: 'POST',
      url: '/api/licenses/verify',
      body: {
        licenseKey: s2PlaintextKey,
        deviceInfo: s2DeviceA,
      },
    });
    assert.equal(verifyOkRes.statusCode, 200);
    assert.equal(verifyOkRes.json?.valid, true);
    assert.equal(verifyOkRes.json?.status, 'active');
    assert.equal(verifyOkRes.json?.code, 'LICENSE_VALID');
    assert.equal(verifyOkRes.json?.license?.id, s2LicenseId);
    assert.equal(verifyOkRes.json?.license?.linkedDevice?.deviceId, s2DeviceA.deviceId);
    // Security: Verify response never leaks sensitive fields
    assert.equal(verifyOkRes.json?.license?.encryptedKey, undefined);
    assert.equal(verifyOkRes.json?.license?.keyHash, undefined);
    assert.equal(JSON.stringify(verifyOkRes.json).includes(s2PlaintextKey), false);
    assert.equal(
      firestoreMetrics.transactionCalls,
      metricsBeforeVerifyOk.transactionCalls,
      '/api/licenses/verify must NOT run Firestore transactions'
    );
    assert.equal(
      firestoreMetrics.setDocumentCalls,
      metricsBeforeVerifyOk.setDocumentCalls,
      '/api/licenses/verify must NOT write to Firestore'
    );
    assert.equal(
      firestoreMetrics.txSetCalls,
      metricsBeforeVerifyOk.txSetCalls,
      '/api/licenses/verify must NOT mutate records in transactions'
    );
    assert.ok(
      firestoreMetrics.queryCalls > metricsBeforeVerifyOk.queryCalls,
      '/api/licenses/verify must read directly from persistent Firestore storage'
    );

    const docAfterVerifyOk = await zoyaUpdatesAdapter.getDocumentById('licenses', s2LicenseId);
    assert.equal(docAfterVerifyOk.data?.validationCount, initialValidationCount, 'Verify must not increment validationCount');
    assert.equal(docAfterVerifyOk.data?.lastSeenAt, initialLastSeenAt, 'Verify must not mutate lastSeenAt');
    assert.equal(docAfterVerifyOk.data?.auditLog?.length, initialAuditLength, 'Verify must not append auditLog entries');

    // 12f. Read-Only Verify rejects mismatched device, unknown key, and malformed key
    const verifyMismatchRes = await invokeHandler({
      method: 'POST',
      url: '/api/licenses/verify',
      body: { licenseKey: s2PlaintextKey, deviceInfo: s2DeviceB },
    });
    assert.equal(verifyMismatchRes.statusCode, 403);
    assert.equal(verifyMismatchRes.json?.code, 'DEVICE_MISMATCH');

    const verifyUnknownRes = await invokeHandler({
      method: 'POST',
      url: '/api/licenses/verify',
      body: { licenseKey: generateCryptographicLicenseKey(), deviceInfo: s2DeviceA },
    });
    assert.equal(verifyUnknownRes.statusCode, 404);
    assert.equal(verifyUnknownRes.json?.code, 'UNKNOWN_KEY');

    const verifyMalformedRes = await invokeHandler({
      method: 'POST',
      url: '/api/licenses/verify',
      body: { licenseKey: 'INVALID-FORMAT', deviceInfo: s2DeviceA },
    });
    assert.equal(verifyMalformedRes.statusCode, 400);
    assert.equal(verifyMalformedRes.json?.code, 'MALFORMED_KEY');

    // 12g. Verify outage fails closed with 503 STORAGE_UNAVAILABLE
    setSimulatedStorageFailureForTesting(true);
    const verifyOutageRes = await invokeHandler({
      method: 'POST',
      url: '/api/licenses/verify',
      body: { licenseKey: s2PlaintextKey, deviceInfo: s2DeviceA },
    });
    setSimulatedStorageFailureForTesting(false);
    assert.equal(verifyOutageRes.statusCode, 503);
    assert.equal(verifyOutageRes.json?.code, 'STORAGE_UNAVAILABLE');

    // 12h. Vercel rewrite routing check (/api/devices/register?__route=...) + vercel.json assertions
    const vercelConfig = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'vercel.json'), 'utf-8'));
    const rewrites = vercelConfig.rewrites as Array<{ source: string; destination: string }>;
    assert.ok(
      rewrites.some(
        (r) =>
          r.source === '/api/licenses/activate' &&
          r.destination === '/api/devices/register?__route=/api/licenses/activate'
      ),
      'vercel.json must rewrite /api/licenses/activate'
    );
    assert.ok(
      rewrites.some(
        (r) =>
          r.source === '/api/licenses/verify' &&
          r.destination === '/api/devices/register?__route=/api/licenses/verify'
      ),
      'vercel.json must rewrite /api/licenses/verify'
    );

    const rewrittenActivateRes = await invokeHandler({
      method: 'POST',
      url: '/api/devices/register?__route=/api/licenses/activate',
      body: { licenseKey: s2PlaintextKey, deviceInfo: s2DeviceA },
    });
    assert.equal(rewrittenActivateRes.statusCode, 200);
    assert.equal(rewrittenActivateRes.json?.code, 'LICENSE_VALID');

    const rewrittenVerifyRes = await invokeHandler({
      method: 'POST',
      url: '/api/devices/register?__route=/api/licenses/verify',
      body: { licenseKey: s2PlaintextKey, deviceInfo: s2DeviceA },
    });
    assert.equal(rewrittenVerifyRes.statusCode, 200);
    assert.equal(rewrittenVerifyRes.json?.code, 'LICENSE_VALID');

    // 12i. Revocation is immediately reflected on both /api/licenses/verify and /api/licenses/activate
    // (even without clearing in-memory cache in another handler call)
    const s2RevokeRes = await invokeHandler({
      method: 'POST',
      url: `/api/admin/licenses/${s2LicenseId}`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { action: 'revoke', reason: 'Stage 2 revocation persistence check' },
    });
    assert.equal(s2RevokeRes.statusCode, 200);

    const verifyRevokedRes = await invokeHandler({
      method: 'POST',
      url: '/api/licenses/verify',
      body: { licenseKey: s2PlaintextKey, deviceInfo: s2DeviceA },
    });
    assert.equal(verifyRevokedRes.statusCode, 403);
    assert.equal(verifyRevokedRes.json?.code, 'LICENSE_REVOKED');

    const activateRevokedRes = await invokeHandler({
      method: 'POST',
      url: '/api/licenses/activate',
      body: { licenseKey: s2PlaintextKey, deviceInfo: s2DeviceA },
    });
    assert.equal(activateRevokedRes.statusCode, 403);
    assert.equal(activateRevokedRes.json?.code, 'LICENSE_REVOKED');

    // 12j. Backward compatibility: POST /api/licenses/validate retains existing contract
    const s2CompatKey = generateCryptographicLicenseKey();
    const compatCreateRes = await invokeHandler({
      method: 'POST',
      url: '/api/admin/licenses',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { customerName: 'Compat Validate Tester', customerEmail: 'compat@zoyatest.internal' },
    });
    assert.equal(compatCreateRes.statusCode, 201);
    const compatKey: string = compatCreateRes.json.generatedKey;
    createdLicenseIds.push(compatCreateRes.json.license.id);
    assert.ok(s2CompatKey !== compatKey);

    const compatValidate1 = await invokeHandler({
      method: 'POST',
      url: '/api/licenses/validate',
      body: { licenseKey: compatKey, deviceInfo: s2DeviceA },
    });
    assert.equal(compatValidate1.statusCode, 200);
    assert.equal(compatValidate1.json?.code, 'LICENSE_VALID');
    assert.ok(typeof compatValidate1.json?.entitlementToken === 'string');

    const compatValidate2 = await invokeHandler({
      method: 'POST',
      url: '/api/licenses/validate',
      body: { licenseKey: compatKey, deviceInfo: s2DeviceA },
    });
    assert.equal(compatValidate2.statusCode, 200);
    const compatDoc = await zoyaUpdatesAdapter.getDocumentById('licenses', compatCreateRes.json.license.id);
    assert.equal(compatDoc.data?.validationCount, 2, 'Legacy /api/licenses/validate keeps existing validationCount increment');

    console.log('  ✓ Passed Stage 2 Fast Active, Read-Only Verify, cache bypass & Vercel rewrite checks.');

    // ---------------------------------------------------------
    // 13. LICENSE LOGOUT / DEVICE UNBIND (ADMIN TRANSACTION, COOLDOWN BYPASS, PREVIOUS-DEVICE GUARD & CONCURRENCY)
    // ---------------------------------------------------------
    console.log('Test 13: License Logout / Device Unbind (Admin transaction, previous-device restriction, cooldown bypass & concurrency)...');
    resetRateLimits();

    const unbindCreateRes = await invokeHandler({
      method: 'POST',
      url: '/api/admin/licenses',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        customerName: 'Unbind Security Tester',
        customerEmail: 'unbind-tester@zoyatest.internal',
      },
    });
    assert.equal(unbindCreateRes.statusCode, 201);
    const unbindLicId: string = unbindCreateRes.json.license.id;
    const unbindLicKey: string = unbindCreateRes.json.generatedKey;
    createdLicenseIds.push(unbindLicId);
    assert.equal(unbindCreateRes.json.license.bindingVersion, 1);
    assert.equal(unbindCreateRes.json.license.unbindCount, 0);
    assert.equal(unbindCreateRes.json.license.lastUnboundAt, null);

    // 13a. Already-unactivated license cannot be unbound
    const unbindBeforeActiveRes = await invokeHandler({
      method: 'POST',
      url: `/api/admin/licenses/${unbindLicId}`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { action: 'unbind', reason: 'Should fail on unactivated license' },
    });
    assert.equal(unbindBeforeActiveRes.statusCode, 400);
    assert.equal(unbindBeforeActiveRes.json?.code, 'LICENSE_NOT_BOUND');

    const deviceOld = {
      deviceId: 'android_unbind_old_device_001',
      deviceModel: 'OnePlus 11',
      androidVersion: 'Android 14',
      appVersion: '2.6.0',
    };
    const deviceNew = {
      deviceId: 'android_unbind_new_device_002',
      deviceModel: 'Google Pixel 9 Pro',
      androidVersion: 'Android 15',
      appVersion: '2.6.0',
    };

    // Activate on deviceOld
    const oldActivateRes = await invokeHandler({
      method: 'POST',
      url: '/api/licenses/activate',
      body: { licenseKey: unbindLicKey, deviceInfo: deviceOld },
    });
    assert.equal(oldActivateRes.statusCode, 200);

    // 13b. Admin unbind executes inside an atomic Firestore transaction & preserves ownership/key/history
    const txBeforeAdminUnbind = firestoreMetrics.transactionCalls;
    const adminUnbindRes = await invokeHandler({
      method: 'POST',
      url: `/api/admin/licenses/${unbindLicId}`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { action: 'unbind', reason: 'Customer upgraded phone via support ticket' },
    });
    assert.equal(adminUnbindRes.statusCode, 200);
    assert.equal(
      firestoreMetrics.transactionCalls - txBeforeAdminUnbind,
      1,
      'Admin unbind must execute inside an atomic Firestore transaction'
    );
    assert.equal(adminUnbindRes.json?.license?.status, 'unactivated');
    assert.equal(adminUnbindRes.json?.license?.linkedDevice, null);
    assert.equal(adminUnbindRes.json?.license?.bindingVersion, 2);
    assert.equal(adminUnbindRes.json?.license?.unbindCount, 1);
    assert.ok(adminUnbindRes.json?.license?.lastUnboundAt);
    assert.equal(adminUnbindRes.json?.license?.customerEmail, 'unbind-tester@zoyatest.internal');
    assert.equal(adminUnbindRes.json?.license?.keyHash, hashLicenseKey(unbindLicKey));

    // Already unbound license cannot be unbound a second time
    const doubleAdminUnbindRes = await invokeHandler({
      method: 'POST',
      url: `/api/admin/licenses/${unbindLicId}`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { action: 'rebind', reason: 'Second unbind should be rejected' },
    });
    assert.equal(doubleAdminUnbindRes.statusCode, 400);
    assert.equal(doubleAdminUnbindRes.json?.code, 'LICENSE_NOT_BOUND');

    // 13c. Previous device CANNOT silently reclaim the unbound license on /validate OR /activate
    const oldReclaimValidate = await invokeHandler({
      method: 'POST',
      url: '/api/licenses/validate',
      body: { licenseKey: unbindLicKey, deviceInfo: deviceOld },
    });
    assert.equal(oldReclaimValidate.statusCode, 403, 'Legacy /validate must block previously unbound device from silently reclaiming license');
    assert.equal(oldReclaimValidate.json?.code, 'DEVICE_MISMATCH');

    const oldReclaimActivate = await invokeHandler({
      method: 'POST',
      url: '/api/licenses/activate',
      body: { licenseKey: unbindLicKey, deviceInfo: deviceOld },
    });
    assert.equal(oldReclaimActivate.statusCode, 403, 'Fast Active /activate must block previously unbound device from silently reclaiming license');
    assert.equal(oldReclaimActivate.json?.code, 'DEVICE_MISMATCH');

    const oldVerifyAfterUnbind = await invokeHandler({
      method: 'POST',
      url: '/api/licenses/verify',
      body: { licenseKey: unbindLicKey, deviceInfo: deviceOld },
    });
    assert.equal(oldVerifyAfterUnbind.statusCode, 403);
    assert.equal(oldVerifyAfterUnbind.json?.code, 'LICENSE_NOT_ACTIVATED');

    // 13d. New device CAN activate after unbinding, and passes /verify
    const newDeviceActivateRes = await invokeHandler({
      method: 'POST',
      url: '/api/licenses/activate',
      body: { licenseKey: unbindLicKey, deviceInfo: deviceNew },
    });
    assert.equal(newDeviceActivateRes.statusCode, 200);
    assert.equal(newDeviceActivateRes.json?.license?.linkedDevice?.deviceId, deviceNew.deviceId);

    const newDeviceVerifyRes = await invokeHandler({
      method: 'POST',
      url: '/api/licenses/verify',
      body: { licenseKey: unbindLicKey, deviceInfo: deviceNew },
    });
    assert.equal(newDeviceVerifyRes.statusCode, 200);
    assert.equal(newDeviceVerifyRes.json?.code, 'LICENSE_VALID');

    // 13e. Admin unbind BYPASSES active 24-hour user cooldown
    const docBeforeCooldownTest = await zoyaUpdatesAdapter.getDocumentById('licenses', unbindLicId);
    assert.ok(docBeforeCooldownTest.exists && docBeforeCooldownTest.data);
    await zoyaUpdatesAdapter.setDocumentById('licenses', unbindLicId, {
      ...docBeforeCooldownTest.data,
      lastUserUnboundAt: new Date().toISOString(),
    });
    clearLicenseInMemoryCache();

    const adminBypassCooldownRes = await invokeHandler({
      method: 'POST',
      url: `/api/admin/licenses/${unbindLicId}`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { action: 'rebind', reason: 'Admin support override during 24h user cooldown' },
    });
    assert.equal(adminBypassCooldownRes.statusCode, 200, 'Admin unbind must bypass 24-hour user cooldown');
    assert.equal(adminBypassCooldownRes.json?.license?.bindingVersion, 3);
    assert.equal(adminBypassCooldownRes.json?.license?.unbindCount, 2);

    // 13f. Concurrent activation vs admin unbind safety
    const deviceThird = {
      deviceId: 'android_unbind_concurrent_003',
      deviceModel: 'Nothing Phone 2',
      androidVersion: 'Android 14',
      appVersion: '2.6.0',
    };
    const [concurrentActRes, concurrentUnbindRes] = await Promise.all([
      invokeHandler({
        method: 'POST',
        url: '/api/licenses/activate',
        body: { licenseKey: unbindLicKey, deviceInfo: deviceThird },
      }),
      invokeHandler({
        method: 'POST',
        url: `/api/admin/licenses/${unbindLicId}`,
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { action: 'unbind', reason: 'Concurrent unbind race safety test' },
      }),
    ]);
    assert.equal(concurrentActRes.statusCode, 200, 'Activation must succeed cleanly');
    assert.ok(
      concurrentUnbindRes.statusCode === 200 || concurrentUnbindRes.statusCode === 400,
      'Concurrent unbind must either cleanly unbind post-activation (200) or reject pre-activation (400)'
    );
    const postRaceDoc = await zoyaUpdatesAdapter.getDocumentById('licenses', unbindLicId);
    assert.ok(
      (postRaceDoc.data?.status === 'active' && postRaceDoc.data?.linkedDevice?.deviceId === deviceThird.deviceId) ||
        (postRaceDoc.data?.status === 'unactivated' && postRaceDoc.data?.linkedDevice === null),
      'Firestore record must end in a consistent state after concurrent activation/unbind'
    );

    // 13g. Revoked license cannot be unbound
    const revokeForUnbindRes = await invokeHandler({
      method: 'POST',
      url: `/api/admin/licenses/${unbindLicId}`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { action: 'revoke', reason: 'Revoke before unbind test' },
    });
    assert.equal(revokeForUnbindRes.statusCode, 200);

    const adminUnbindRevokedRes = await invokeHandler({
      method: 'POST',
      url: `/api/admin/licenses/${unbindLicId}`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { action: 'unbind', reason: 'Should fail on revoked license' },
    });
    assert.equal(adminUnbindRevokedRes.statusCode, 400);
    assert.equal(adminUnbindRevokedRes.json?.code, 'LICENSE_REVOKED');

    console.log('  ✓ Passed Admin transactional unbind, cooldown bypass, previous-device protection & concurrency checks.');

    // --------------------------------------------------------
    // TEST 14: FCM-Based License Unbind & Revocation Notifications
    // --------------------------------------------------------
    console.log('Test 14: FCM token registration, Admin unbind/revoke push notifications, failure non-rollback & leakage checks...');
    resetRateLimits();

    const capturedFcmPayloads: LicenseFcmTransportPayload[] = [];
    setLicenseFcmSenderForTesting(async (payload) => {
      capturedFcmPayloads.push(payload);
      return { ok: true, messageId: `projects/zoya-updates/messages/test_${capturedFcmPayloads.length}` };
    });

    // 14a. Verify Vercel rewrite and 8-function serverless limit
    const vercelCfgFcm = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'vercel.json'), 'utf-8'));
    assert.ok(
      (vercelCfgFcm.rewrites as Array<{ source: string; destination: string }>).some(
        (r) =>
          r.source === '/api/licenses/fcm/register' &&
          r.destination === '/api/devices/register?__route=/api/licenses/fcm/register'
      ),
      'vercel.json must rewrite /api/licenses/fcm/register to /api/devices/register'
    );
    const apiDir = path.resolve(process.cwd(), 'api');
    const collectFiles = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        return entry.isDirectory() ? collectFiles(full) : [full];
      });
    assert.equal(collectFiles(apiDir).length, 8, 'Vercel serverless function count under api/ must remain 8');

    // Create a fresh license for FCM tests
    const fcmCreateRes = await invokeHandler({
      method: 'POST',
      url: '/api/admin/licenses',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        customerName: 'FCM Notification Customer',
        customerEmail: 'fcm-customer@example.com',
        licenseType: 'Lifetime',
      },
    });
    assert.equal(fcmCreateRes.statusCode, 201);
    const fcmLicId = fcmCreateRes.json.license.id;
    const fcmLicKey = fcmCreateRes.json.generatedKey;
    createdLicenseIds.push(fcmLicId);

    const fcmPhone1 = {
      deviceId: 'android_fcm_bound_phone_001',
      deviceModel: 'Google Pixel 9 Pro',
      androidVersion: 'Android 15',
      appVersion: '2.7.0',
    };
    const fcmPhone2 = {
      deviceId: 'android_fcm_new_phone_002',
      deviceModel: 'Samsung Galaxy S25 Ultra',
      androidVersion: 'Android 15',
      appVersion: '2.7.0',
    };
    const fcmToken1 = 'fcm_reg_token_phone1_alpha_1234567890_secret';
    const fcmToken1Refreshed = 'fcm_reg_token_phone1_beta_0987654321_secret';
    const fcmToken2 = 'fcm_reg_token_phone2_gamma_5555555555_secret';

    // 14b. Reject unactivated license FCM registration (even if client spoofs status: 'active')
    const regUnactivatedRes = await invokeHandler({
      method: 'POST',
      url: '/api/licenses/fcm/register',
      body: {
        licenseKey: fcmLicKey,
        deviceId: fcmPhone1.deviceId,
        fcmToken: fcmToken1,
        status: 'active',
      },
    });
    assert.equal(regUnactivatedRes.statusCode, 403);
    assert.equal(regUnactivatedRes.json?.code, 'LICENSE_UNACTIVATED');

    // 14c. Reject unknown key, malformed key, invalid deviceId, and invalid FCM token
    const regUnknownKey = await invokeHandler({
      method: 'POST',
      url: '/api/licenses/fcm/register',
      body: {
        licenseKey: 'ZOYA-AAAA-BBBB-CCCC',
        deviceId: fcmPhone1.deviceId,
        fcmToken: fcmToken1,
      },
    });
    assert.equal(regUnknownKey.statusCode, 404);
    assert.equal(regUnknownKey.json?.code, 'UNKNOWN_KEY');

    const regBadToken = await invokeHandler({
      method: 'POST',
      url: '/api/licenses/fcm/register',
      body: {
        licenseKey: fcmLicKey,
        deviceId: fcmPhone1.deviceId,
        fcmToken: 'short',
      },
    });
    assert.equal(regBadToken.statusCode, 400);
    assert.equal(regBadToken.json?.code, 'INVALID_FCM_TOKEN');

    const decodeJwtPayload = (jwt: string): Record<string, any> => {
      const parts = String(jwt || '').split('.');
      assert.equal(parts.length, 3, 'Signed entitlementToken must be a 3-part JWT');
      return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
    };

    // Activate on Phone 1 via Fast Active -> bindingVersion === 1
    const fcmAct1 = await invokeHandler({
      method: 'POST',
      url: '/api/licenses/activate',
      body: { licenseKey: fcmLicKey, deviceInfo: fcmPhone1 },
    });
    assert.equal(fcmAct1.statusCode, 200);
    assert.equal(fcmAct1.json?.license?.bindingVersion, 1, 'Initial activation must return bindingVersion 1');
    const act1TokenPayload = decodeJwtPayload(fcmAct1.json?.entitlementToken);
    assert.equal(act1TokenPayload.iss, ENTITLEMENT_ISSUER, 'Signed entitlementToken must include canonical iss');
    assert.equal(act1TokenPayload.aud, ENTITLEMENT_AUDIENCE, 'Signed entitlementToken must include canonical aud');
    assert.equal(act1TokenPayload.licenseId, fcmLicId, 'Signed entitlementToken must include licenseId');
    assert.equal(act1TokenPayload.bindingVersion, 1, 'Signed entitlementToken must include bindingVersion 1');
    assert.equal(act1TokenPayload.status, 'active', 'Signed entitlementToken must include status active');
    assert.equal(act1TokenPayload.deviceId, fcmPhone1.deviceId, 'Signed entitlementToken must include deviceId');
    assert.ok(typeof act1TokenPayload.maskedKey === 'string' && act1TokenPayload.maskedKey.length > 0);
    assert.equal(act1TokenPayload.exp - act1TokenPayload.iat, ENTITLEMENT_GRACE_TTL_SECONDS);

    // Repeated Fast Active on same phone preserves bindingVersion 1 in both response and token
    const fcmAct1Repeat = await invokeHandler({
      method: 'POST',
      url: '/api/licenses/activate',
      body: { licenseKey: fcmLicKey, deviceInfo: fcmPhone1 },
    });
    assert.equal(fcmAct1Repeat.statusCode, 200);
    assert.equal(fcmAct1Repeat.json?.license?.bindingVersion, 1);
    assert.equal(decodeJwtPayload(fcmAct1Repeat.json?.entitlementToken).bindingVersion, 1);

    // 14d. Reject mismatched device trying to register its FCM token against Phone 1's license
    const regMismatch = await invokeHandler({
      method: 'POST',
      url: '/api/licenses/fcm/register',
      body: {
        licenseKey: fcmLicKey,
        deviceId: fcmPhone2.deviceId,
        fcmToken: fcmToken2,
      },
    });
    assert.equal(regMismatch.statusCode, 403);
    assert.equal(regMismatch.json?.code, 'DEVICE_MISMATCH');

    // 14e. Valid FCM token registration via Vercel rewrite route & token replacement
    const regValid1 = await invokeHandler({
      method: 'POST',
      url: '/api/devices/register?__route=/api/licenses/fcm/register',
      body: {
        licenseKey: fcmLicKey,
        deviceId: fcmPhone1.deviceId,
        fcmToken: fcmToken1,
      },
    });
    assert.equal(regValid1.statusCode, 200);
    assert.equal(regValid1.json?.success, true);
    assert.equal(regValid1.json?.registered, true);
    assert.equal(regValid1.json?.replaced, false);
    assert.equal(JSON.stringify(regValid1.json).includes(fcmToken1), false, 'FCM token must not leak in register response');
    assert.equal(JSON.stringify(regValid1.json).includes(fcmLicKey), false, 'License key must not leak in register response');

    // Token refresh / replacement
    const regReplace1 = await invokeHandler({
      method: 'POST',
      url: '/api/licenses/fcm/register',
      body: {
        licenseKey: fcmLicKey,
        deviceId: fcmPhone1.deviceId,
        fcmToken: fcmToken1Refreshed,
      },
    });
    assert.equal(regReplace1.statusCode, 200);
    assert.equal(regReplace1.json?.replaced, true);

    // Verify stored in Firestore, and NEVER leaked in Admin list/detail or public verify/validate/activate responses
    const storedAfterReg = await zoyaUpdatesAdapter.getDocumentById('licenses', fcmLicId);
    assert.equal(storedAfterReg.data?.deviceFcmToken, fcmToken1Refreshed);

    const adminListCheck = await invokeHandler({
      method: 'GET',
      url: '/api/admin/licenses',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(adminListCheck.statusCode, 200);
    assert.equal(JSON.stringify(adminListCheck.json).includes(fcmToken1Refreshed), false, 'FCM token must not leak in GET /api/admin/licenses');

    const adminDetailCheck = await invokeHandler({
      method: 'GET',
      url: `/api/admin/licenses/${fcmLicId}`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(adminDetailCheck.statusCode, 200);
    assert.equal(JSON.stringify(adminDetailCheck.json).includes(fcmToken1Refreshed), false, 'FCM token must not leak in GET /api/admin/licenses/:id');
    assert.equal((adminDetailCheck.json.license as any).deviceFcmToken, undefined);

    const publicVerifyCheck = await invokeHandler({
      method: 'POST',
      url: '/api/licenses/verify',
      body: { licenseKey: fcmLicKey, deviceInfo: fcmPhone1 },
    });
    assert.equal(publicVerifyCheck.statusCode, 200);
    assert.equal(publicVerifyCheck.json?.license?.bindingVersion, 1, 'Verify response must include authoritative bindingVersion 1');
    assert.equal(JSON.stringify(publicVerifyCheck.json).includes(fcmToken1Refreshed), false, 'FCM token must not leak in POST /api/licenses/verify');

    // 14f. Failed transaction (simulated storage outage) must NOT send any FCM notification
    capturedFcmPayloads.length = 0;
    setSimulatedStorageFailureForTesting(true);
    const failedTxUnbind = await invokeHandler({
      method: 'POST',
      url: `/api/admin/licenses/${fcmLicId}`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { action: 'unbind', reason: 'Should fail during outage' },
    });
    setSimulatedStorageFailureForTesting(false);
    assert.equal(failedTxUnbind.statusCode, 503);
    assert.equal(capturedFcmPayloads.length, 0, 'No FCM notification may be sent when Firestore transaction fails');

    // 14g. Admin unbind captures refreshed token, exact deviceId, and OLD bindingVersion (1), advances Firestore to 2, and generates unique eventId
    const seenEventIds = new Set<string>();
    const adminUnbindFcmRes = await invokeHandler({
      method: 'POST',
      url: `/api/admin/licenses/${fcmLicId}`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { action: 'unbind', reason: 'Customer upgrading to Galaxy S25 Ultra' },
    });
    assert.equal(adminUnbindFcmRes.statusCode, 200);
    assert.equal(adminUnbindFcmRes.json?.license?.status, 'unactivated');
    assert.equal(adminUnbindFcmRes.json?.license?.bindingVersion, 2, 'Firestore bindingVersion must advance to 2 after first unbind');
    assert.equal(JSON.stringify(adminUnbindFcmRes.json).includes(fcmToken1Refreshed), false, 'FCM token must not leak in Admin unbind response');
    assert.equal(capturedFcmPayloads.length, 1, 'Admin unbind must dispatch exactly one device-specific FCM message');
    assert.equal(capturedFcmPayloads[0].token, fcmToken1Refreshed, 'Notification must target the captured old device token');
    assert.equal(capturedFcmPayloads[0].eventType, 'license_unbound');
    assert.equal(capturedFcmPayloads[0].data.event, 'license_unbound');
    assert.equal(capturedFcmPayloads[0].data.type, 'license_unbound');
    assert.equal(capturedFcmPayloads[0].data.action, 'OPEN_LICENSE_ACTIVATION');
    assert.equal(capturedFcmPayloads[0].data.deviceId, fcmPhone1.deviceId, 'FCM event must carry exact captured deviceId');
    assert.equal(capturedFcmPayloads[0].data.bindingVersion, '1', 'FCM unbind event must carry the terminated bindingVersion (1), NOT the newer bindingVersion (2)');
    assert.equal(capturedFcmPayloads[0].data.licenseId, fcmLicId);
    assert.ok(typeof capturedFcmPayloads[0].data.eventId === 'string' && capturedFcmPayloads[0].data.eventId.startsWith('evt_'), 'FCM event must include unique server-generated eventId');
    seenEventIds.add(capturedFcmPayloads[0].data.eventId);
    assert.equal(capturedFcmPayloads[0].data.initiatedBy, 'admin');
    assert.ok(capturedFcmPayloads[0].data.maskedKey && capturedFcmPayloads[0].data.timestamp && capturedFcmPayloads[0].data.title && capturedFcmPayloads[0].data.body);
    assert.equal(JSON.stringify(capturedFcmPayloads[0].data).includes(fcmLicKey), false, 'Plaintext license key must never appear in FCM payload');
    assert.equal(JSON.stringify(capturedFcmPayloads[0].data).includes(fcmToken1Refreshed), false, 'FCM token must never appear in FCM data payload');

    const storedAfterAdminUnbind = await zoyaUpdatesAdapter.getDocumentById('licenses', fcmLicId);
    assert.equal(storedAfterAdminUnbind.data?.deviceFcmToken, null, 'deviceFcmToken must be cleared after unbind');

    // 14h. Re-activate on Phone 2 -> bindingVersion MUST be 2 (never silently reset to 1), register Phone 2 token, simulate FCM failure (UNREGISTERED + stale cleanup) -> NO rollback!
    const fcmAct2 = await invokeHandler({
      method: 'POST',
      url: '/api/licenses/activate',
      body: { licenseKey: fcmLicKey, deviceInfo: fcmPhone2 },
    });
    assert.equal(fcmAct2.statusCode, 200);
    assert.equal(fcmAct2.json?.license?.bindingVersion, 2, 'Reactivation after first unbind must preserve bindingVersion 2');
    assert.equal(decodeJwtPayload(fcmAct2.json?.entitlementToken).bindingVersion, 2, 'Entitlement token for Phone 2 must carry bindingVersion 2');

    const verifyPhone2 = await invokeHandler({
      method: 'POST',
      url: '/api/licenses/verify',
      body: { licenseKey: fcmLicKey, deviceInfo: fcmPhone2 },
    });
    assert.equal(verifyPhone2.statusCode, 200);
    assert.equal(verifyPhone2.json?.license?.bindingVersion, 2, 'Verification for Phone 2 must return bindingVersion 2');

    const regPhone2 = await invokeHandler({
      method: 'POST',
      url: '/api/licenses/fcm/register',
      body: { licenseKey: fcmLicKey, deviceId: fcmPhone2.deviceId, fcmToken: fcmToken2 },
    });
    assert.equal(regPhone2.statusCode, 200);

    // Seed stale mirror entry in /fcm_devices to verify stale token removal on UNREGISTERED
    const staleDocId = crypto.createHash('sha256').update(fcmToken2).digest('hex').substring(0, 40);
    await zoyaUpdatesAdapter.setDocumentById('fcm_devices', staleDocId, { token: fcmToken2 });

    capturedFcmPayloads.length = 0;
    setLicenseFcmSenderForTesting(async (payload) => {
      capturedFcmPayloads.push(payload);
      return { ok: false, errorCode: 'UNREGISTERED', errorMessage: 'Requested entity was not found.' };
    });

    const unbindOnFcmError = await invokeHandler({
      method: 'POST',
      url: `/api/admin/licenses/${fcmLicId}`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { action: 'rebind', reason: 'Testing non-rollback when FCM returns UNREGISTERED' },
    });
    assert.equal(unbindOnFcmError.statusCode, 200, 'Admin unbind must still succeed even if FCM returns UNREGISTERED');
    assert.equal(capturedFcmPayloads.length, 1);
    assert.equal(capturedFcmPayloads[0].data.deviceId, fcmPhone2.deviceId, 'Second unbind event must carry Phone 2 deviceId');
    assert.equal(capturedFcmPayloads[0].data.bindingVersion, '2', 'Second unbind event must carry terminated bindingVersion (2)');
    assert.ok(typeof capturedFcmPayloads[0].data.eventId === 'string' && !seenEventIds.has(capturedFcmPayloads[0].data.eventId), 'Each unbind event must have a strictly unique eventId');
    seenEventIds.add(capturedFcmPayloads[0].data.eventId);
    const staleAfterCleanup = await zoyaUpdatesAdapter.getDocumentById('fcm_devices', staleDocId);
    assert.equal(staleAfterCleanup.exists, false, 'Stale UNREGISTERED token must be removed from /fcm_devices');
    const docAfterFcmErrUnbind = await zoyaUpdatesAdapter.getDocumentById('licenses', fcmLicId);
    assert.equal(docAfterFcmErrUnbind.data?.status, 'unactivated', 'Unbind must NOT roll back on FCM error');
    assert.equal(docAfterFcmErrUnbind.data?.bindingVersion, 3, 'Firestore bindingVersion must advance to 3 after second unbind');

    // 14i. Admin Revoke on active bound device sends distinct `license_revoked` notification with Phone 3 deviceId, bindingVersion 3, unique eventId, and advances Firestore to 4
    const fcmPhone3 = {
      deviceId: 'android_fcm_revoke_phone_003',
      deviceModel: 'OnePlus 13',
      androidVersion: 'Android 15',
      appVersion: '2.7.0',
    };
    const fcmToken3 = 'fcm_reg_token_phone3_delta_9999999999_secret';
    const actPhone3 = await invokeHandler({
      method: 'POST',
      url: '/api/licenses/activate',
      body: { licenseKey: fcmLicKey, deviceInfo: fcmPhone3 },
    });
    assert.equal(actPhone3.statusCode, 200);
    assert.equal(actPhone3.json?.license?.bindingVersion, 3);
    assert.equal(decodeJwtPayload(actPhone3.json?.entitlementToken).bindingVersion, 3);

    const regPhone3 = await invokeHandler({
      method: 'POST',
      url: '/api/licenses/fcm/register',
      body: { licenseKey: fcmLicKey, deviceId: fcmPhone3.deviceId, fcmToken: fcmToken3 },
    });
    assert.equal(regPhone3.statusCode, 200);

    capturedFcmPayloads.length = 0;
    setLicenseFcmSenderForTesting(async (payload) => {
      capturedFcmPayloads.push(payload);
      throw new Error('Simulated FCM network outage');
    });

    const revokeWithFcmOutage = await invokeHandler({
      method: 'POST',
      url: `/api/admin/licenses/${fcmLicId}`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { action: 'revoke', reason: 'Abuse / refund revocation test' },
    });
    assert.equal(revokeWithFcmOutage.statusCode, 200, 'Admin revoke must succeed even if FCM transport throws');
    assert.equal(revokeWithFcmOutage.json?.license?.status, 'revoked');
    assert.equal(revokeWithFcmOutage.json?.license?.bindingVersion, 4, 'Revoke must advance Firestore bindingVersion monotonically to 4');
    assert.equal(JSON.stringify(revokeWithFcmOutage.json).includes(fcmToken3), false, 'FCM token must not leak in Admin revoke response');
    assert.equal(capturedFcmPayloads.length, 1, 'Admin revoke must attempt exactly one device-specific FCM message');
    assert.equal(capturedFcmPayloads[0].token, fcmToken3);
    assert.equal(capturedFcmPayloads[0].eventType, 'license_revoked');
    assert.equal(capturedFcmPayloads[0].data.event, 'license_revoked');
    assert.equal(capturedFcmPayloads[0].data.type, 'license_revoked');
    assert.equal(capturedFcmPayloads[0].data.action, 'SHOW_LICENSE_REVOKED');
    assert.equal(capturedFcmPayloads[0].data.deviceId, fcmPhone3.deviceId, 'Revoke FCM event must carry exact Phone 3 deviceId');
    assert.equal(capturedFcmPayloads[0].data.bindingVersion, '3', 'Revoke FCM event must carry revoked active bindingVersion (3)');
    assert.ok(typeof capturedFcmPayloads[0].data.eventId === 'string' && !seenEventIds.has(capturedFcmPayloads[0].data.eventId), 'Revoke eventId must be strictly unique');
    seenEventIds.add(capturedFcmPayloads[0].data.eventId);
    assert.equal(seenEventIds.size, 3, 'All three unbind/revoke events must have distinct eventIds');
    assert.equal(capturedFcmPayloads[0].data.initiatedBy, 'admin');

    const storedAfterRevoke = await zoyaUpdatesAdapter.getDocumentById('licenses', fcmLicId);
    assert.equal(storedAfterRevoke.data?.status, 'revoked', 'Revocation must stay committed when FCM fails');
    assert.equal(storedAfterRevoke.data?.bindingVersion, 4);
    assert.equal(storedAfterRevoke.data?.deviceFcmToken, null, 'deviceFcmToken must be cleared on revocation');

    // Re-entering revoked key on activate, verify, validate, and fcm/register must ALL fail with 403 LICENSE_REVOKED
    const reactivateRevoked = await invokeHandler({
      method: 'POST',
      url: '/api/licenses/activate',
      body: { licenseKey: fcmLicKey, deviceInfo: fcmPhone3 },
    });
    assert.equal(reactivateRevoked.statusCode, 403);
    assert.equal(reactivateRevoked.json?.code, 'LICENSE_REVOKED');

    const regRevokedFcm = await invokeHandler({
      method: 'POST',
      url: '/api/licenses/fcm/register',
      body: { licenseKey: fcmLicKey, deviceId: fcmPhone3.deviceId, fcmToken: fcmToken3 },
    });
    assert.equal(regRevokedFcm.statusCode, 403);
    assert.equal(regRevokedFcm.json?.code, 'LICENSE_REVOKED');

    // Double-revoke fails transaction -> must NOT send another FCM message
    capturedFcmPayloads.length = 0;
    const doubleRevokeRes = await invokeHandler({
      method: 'POST',
      url: `/api/admin/licenses/${fcmLicId}`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { action: 'revoke', reason: 'Duplicate revoke attempt' },
    });
    assert.equal(doubleRevokeRes.statusCode, 400);
    assert.equal(capturedFcmPayloads.length, 0, 'Failed duplicate revoke must not send FCM notification');

    // 14j. Backward compatibility: unbind & revoke succeed when NO FCM token is registered
    const legacyNoFcmCreate = await invokeHandler({
      method: 'POST',
      url: '/api/admin/licenses',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { customerName: 'No FCM User', customerEmail: 'nofcm@example.com', licenseType: 'Lifetime' },
    });
    assert.equal(legacyNoFcmCreate.statusCode, 201);
    const noFcmId = legacyNoFcmCreate.json.license.id;
    const noFcmKey = legacyNoFcmCreate.json.generatedKey;
    createdLicenseIds.push(noFcmId);

    const noFcmAct = await invokeHandler({
      method: 'POST',
      url: '/api/licenses/activate',
      body: { licenseKey: noFcmKey, deviceInfo: { deviceId: 'android_no_fcm_phone_001', deviceModel: 'Redmi Note 13' } },
    });
    assert.equal(noFcmAct.statusCode, 200);

    capturedFcmPayloads.length = 0;
    const noFcmUnbind = await invokeHandler({
      method: 'POST',
      url: `/api/admin/licenses/${noFcmId}`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { action: 'unbind', reason: 'Legacy license without FCM token' },
    });
    assert.equal(noFcmUnbind.statusCode, 200);
    assert.equal(capturedFcmPayloads.length, 0, 'No FCM message attempted when license has no registered FCM token');

    setLicenseFcmSenderForTesting(null);
    console.log('  ✓ Passed FCM registration, token refresh, Admin unbind/revoke notifications, failure non-rollback & zero-leakage checks.');

    // ---------------------------------------------------------
    // 15. ASYMMETRIC ES256 OFFLINE ENTITLEMENT SIGNING, VERIFICATION & PUBLIC JWKS
    // ---------------------------------------------------------
    console.log('Test 15: ES256 asymmetric entitlement signing, strict claim verification, HMAC rejection, JWKS & rotation...');
    resetRateLimits();

    // 15a. Public JWKS endpoint (direct + Vercel rewrite + method enforcement + zero private fields)
    const jwksMethodErr = await invokeHandler({
      method: 'POST',
      url: '/api/licenses/jwks',
    });
    assert.equal(jwksMethodErr.statusCode, 405, 'POST /api/licenses/jwks must return 405 Method Not Allowed');

    const jwksRes = await invokeHandler({
      method: 'GET',
      url: '/api/licenses/jwks',
    });
    assert.equal(jwksRes.statusCode, 200, 'GET /api/licenses/jwks must return 200');
    assert.ok(
      typeof jwksRes.headers['cache-control'] === 'string' && jwksRes.headers['cache-control'].includes('public'),
      'GET /api/licenses/jwks should include public Cache-Control header'
    );
    assert.ok(Array.isArray(jwksRes.json?.keys) && jwksRes.json.keys.length === 1);
    const publishedKey = jwksRes.json.keys[0];
    assert.deepEqual(
      Object.keys(publishedKey).sort(),
      ['crv', 'kid', 'kty', 'x', 'y'],
      'Published JWK must contain ONLY public EC P-256 fields (kid, kty, crv, x, y) and NO private material'
    );
    assert.equal(publishedKey.kid, TEST_ES256_KEY_ID);
    assert.equal(publishedKey.kty, 'EC');
    assert.equal(publishedKey.crv, 'P-256');
    assert.equal((publishedKey as any).d, undefined, 'Private parameter d must NEVER appear in public JWK');

    const jwksRewriteRes = await invokeHandler({
      method: 'GET',
      url: '/api/devices/register?__route=/api/licenses/jwks',
    });
    assert.equal(jwksRewriteRes.statusCode, 200, 'Vercel rewrite route for /api/licenses/jwks must return 200');
    assert.deepEqual(jwksRewriteRes.json, jwksRes.json);

    // 15b. Fresh license: unactivated check returns NO active token; activation returns ES256 token verifiable with public JWK
    const es256Create = await invokeHandler({
      method: 'POST',
      url: '/api/admin/licenses',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { customerName: 'ES256 Offline User', customerEmail: 'es256@example.com', licenseType: 'Lifetime' },
    });
    assert.equal(es256Create.statusCode, 201);
    const es256LicId = es256Create.json.license.id;
    const es256LicKey = es256Create.json.generatedKey;
    const es256KeyHash = hashLicenseKey(es256LicKey);
    createdLicenseIds.push(es256LicId);

    const es256Phone = {
      deviceId: 'android_es256_pixel9_pro_001',
      deviceModel: 'Google Pixel 9 Pro',
      androidVersion: 'Android 15',
      appVersion: '3.0.0',
    };

    const verifyBeforeAct = await invokeHandler({
      method: 'POST',
      url: '/api/licenses/verify',
      body: { licenseKey: es256LicKey, deviceInfo: es256Phone },
    });
    assert.equal(verifyBeforeAct.statusCode, 403);
    assert.equal(verifyBeforeAct.json?.entitlementToken, undefined, 'Unactivated license must NEVER receive an entitlement token');

    const es256ActRes = await invokeHandler({
      method: 'POST',
      url: '/api/licenses/activate',
      body: { licenseKey: es256LicKey, deviceInfo: es256Phone },
    });
    assert.equal(es256ActRes.statusCode, 200);
    const es256Token: string = es256ActRes.json?.entitlementToken;
    assert.ok(typeof es256Token === 'string' && es256Token.split('.').length === 3);

    // Independently verify JWS using ONLY the public JWK returned by GET /api/licenses/jwks
    const [tokHeaderB64, tokPayloadB64, tokSigB64] = es256Token.split('.');
    const tokHeader = JSON.parse(Buffer.from(tokHeaderB64, 'base64url').toString('utf-8'));
    const tokPayload = JSON.parse(Buffer.from(tokPayloadB64, 'base64url').toString('utf-8'));
    assert.deepEqual(tokHeader, {
      alg: 'ES256',
      typ: 'JWT',
      kid: TEST_ES256_KEY_ID,
    });
    assert.equal(tokPayload.iss, ENTITLEMENT_ISSUER);
    assert.equal(tokPayload.aud, ENTITLEMENT_AUDIENCE);
    assert.equal(tokPayload.licenseId, es256LicId);
    assert.equal(tokPayload.bindingVersion, 1);
    assert.equal(tokPayload.status, 'active');
    assert.equal(tokPayload.deviceId, es256Phone.deviceId);
    assert.equal(tokPayload.maskedKey, es256ActRes.json.license.maskedKey);
    assert.ok(Number.isInteger(tokPayload.iat) && tokPayload.iat > 0);
    assert.equal(tokPayload.exp, tokPayload.iat + ENTITLEMENT_GRACE_TTL_SECONDS);

    const importedPubKey = crypto.createPublicKey({
      key: {
        kty: publishedKey.kty,
        crv: publishedKey.crv,
        x: publishedKey.x,
        y: publishedKey.y,
      },
      format: 'jwk',
    });
    const rawSigBuf = Buffer.from(tokSigB64, 'base64url');
    assert.equal(rawSigBuf.length, 64, 'ES256 compact JWS signature must be 64-byte IEEE P1363 format');
    const offlineVerifyOk = crypto.verify(
      'sha256',
      Buffer.from(`${tokHeaderB64}.${tokPayloadB64}`, 'utf-8'),
      { key: importedPubKey, dsaEncoding: 'ieee-p1363' },
      rawSigBuf
    );
    assert.equal(offlineVerifyOk, true, 'Offline ES256 verification using GET /api/licenses/jwks public key must succeed');

    // Server-side strict verification succeeds with matching expected values
    const serverVerifyOk = verifyEs256EntitlementToken(es256Token, {
      expectedKeyHash: es256KeyHash,
      expectedDeviceId: es256Phone.deviceId,
      expectedLicenseId: es256LicId,
      expectedBindingVersion: 1,
    });
    assert.equal(serverVerifyOk.valid, true);

    // 15c. Negative cryptographic & claim verification tests
    const signCustomJws = (
      headerObj: Record<string, unknown>,
      claimsObj: Record<string, unknown>,
      privateKeyObj: crypto.KeyObject = testPrimaryEcPair.privateKey
    ): string => {
      const h = Buffer.from(JSON.stringify(headerObj), 'utf-8').toString('base64url');
      const p = Buffer.from(JSON.stringify(claimsObj), 'utf-8').toString('base64url');
      const sig = crypto.sign('sha256', Buffer.from(`${h}.${p}`, 'utf-8'), {
        key: privateKeyObj,
        dsaEncoding: 'ieee-p1363',
      });
      return `${h}.${p}.${sig.toString('base64url')}`;
    };

    const nowSec = Math.floor(Date.now() / 1000);
    const validBaseHeader = { alg: 'ES256', typ: 'JWT', kid: TEST_ES256_KEY_ID };
    const validBaseClaims = {
      iss: ENTITLEMENT_ISSUER,
      aud: ENTITLEMENT_AUDIENCE,
      licenseId: es256LicId,
      bindingVersion: 1,
      status: 'active',
      deviceId: es256Phone.deviceId,
      maskedKey: es256ActRes.json.license.maskedKey,
      kh: es256KeyHash,
      act: new Date(nowSec * 1000).toISOString(),
      iat: nowSec,
      exp: nowSec + ENTITLEMENT_GRACE_TTL_SECONDS,
    };

    // Invalid signature (corrupted signature byte)
    const flippedSig = Buffer.from(rawSigBuf);
    flippedSig[0] ^= 0xff;
    const badSigToken = `${tokHeaderB64}.${tokPayloadB64}.${flippedSig.toString('base64url')}`;
    assert.equal(verifyEs256EntitlementToken(badSigToken).valid, false, 'Invalid signature must be rejected');

    // Modified payload with original signature
    const tamperedPayloadB64 = Buffer.from(
      JSON.stringify({ ...tokPayload, bindingVersion: 999 }),
      'utf-8'
    ).toString('base64url');
    const tamperedPayloadToken = `${tokHeaderB64}.${tamperedPayloadB64}.${tokSigB64}`;
    assert.equal(verifyEs256EntitlementToken(tamperedPayloadToken).valid, false, 'Modified payload must be rejected');

    // Wrong iss
    const wrongIssToken = signCustomJws(validBaseHeader, { ...validBaseClaims, iss: 'https://evil.example.com' });
    assert.equal(verifyEs256EntitlementToken(wrongIssToken).valid, false, 'Wrong iss must be rejected');

    // Wrong aud
    const wrongAudToken = signCustomJws(validBaseHeader, { ...validBaseClaims, aud: 'com.other.app' });
    assert.equal(verifyEs256EntitlementToken(wrongAudToken).valid, false, 'Wrong aud must be rejected');

    // Wrong status
    const wrongStatusToken = signCustomJws(validBaseHeader, { ...validBaseClaims, status: 'revoked' });
    assert.equal(verifyEs256EntitlementToken(wrongStatusToken).valid, false, 'Non-active status must be rejected');

    // Wrong deviceId
    assert.equal(
      verifyEs256EntitlementToken(es256Token, { expectedDeviceId: 'android_other_device_999' }).valid,
      false,
      'Wrong deviceId must be rejected'
    );

    // Wrong licenseId
    assert.equal(
      verifyEs256EntitlementToken(es256Token, { expectedLicenseId: 'lic_other_id_999' }).valid,
      false,
      'Wrong licenseId must be rejected'
    );

    // Invalid bindingVersion (wrong expected version, 0, non-integer)
    assert.equal(
      verifyEs256EntitlementToken(es256Token, { expectedBindingVersion: 2 }).valid,
      false,
      'Superseded bindingVersion must be rejected'
    );
    const zeroBvToken = signCustomJws(validBaseHeader, { ...validBaseClaims, bindingVersion: 0 });
    assert.equal(verifyEs256EntitlementToken(zeroBvToken).valid, false, 'bindingVersion 0 must be rejected');
    const floatBvToken = signCustomJws(validBaseHeader, { ...validBaseClaims, bindingVersion: 1.5 });
    assert.equal(verifyEs256EntitlementToken(floatBvToken).valid, false, 'Non-integer bindingVersion must be rejected');

    // Expired token
    const expiredEs256Token = signCustomJws(validBaseHeader, {
      ...validBaseClaims,
      iat: nowSec - 7200,
      exp: nowSec - 10,
    });
    assert.equal(verifyEs256EntitlementToken(expiredEs256Token).valid, false, 'Expired token must be rejected');

    // Unknown kid
    const unknownKidToken = signCustomJws({ alg: 'ES256', typ: 'JWT', kid: 'zoya-es256-unknown-999' }, validBaseClaims);
    assert.equal(verifyEs256EntitlementToken(unknownKidToken).valid, false, 'Unknown kid must be rejected');

    // Algorithm substitution (alg: none)
    const algNoneHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT', kid: TEST_ES256_KEY_ID })).toString('base64url');
    const algNonePayload = Buffer.from(JSON.stringify(validBaseClaims)).toString('base64url');
    assert.equal(
      verifyEs256EntitlementToken(`${algNoneHeader}.${algNonePayload}.fake`).valid,
      false,
      'alg=none token must be rejected'
    );

    // HMAC (HS256) token strictly rejected — directly AND during offline grace outage
    const hmacHeader = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: TEST_ES256_KEY_ID })).toString('base64url');
    const hmacBody = Buffer.from(JSON.stringify(validBaseClaims)).toString('base64url');
    const hmacSig = crypto
      .createHmac('sha256', getJwtSecret())
      .update(`${hmacHeader}.${hmacBody}`)
      .digest('base64url');
    const hmacToken = `${hmacHeader}.${hmacBody}.${hmacSig}`;
    assert.equal(
      verifySignedEntitlementToken(hmacToken, es256KeyHash, es256Phone.deviceId).valid,
      false,
      'HMAC (HS256) token must NEVER be accepted as an ES256 verified token'
    );

    setSimulatedStorageFailureForTesting(true);
    const offlineGraceWithHmac = await invokeHandler({
      method: 'POST',
      url: '/api/licenses/activate',
      body: {
        licenseKey: es256LicKey,
        entitlementToken: hmacToken,
        deviceInfo: es256Phone,
      },
    });
    assert.equal(offlineGraceWithHmac.statusCode, 503, 'Offline grace must reject HMAC token during storage outage');
    assert.equal(offlineGraceWithHmac.json?.valid, false);

    const offlineGraceWithEs256 = await invokeHandler({
      method: 'POST',
      url: '/api/licenses/activate',
      body: {
        licenseKey: es256LicKey,
        entitlementToken: es256Token,
        deviceInfo: es256Phone,
      },
    });
    setSimulatedStorageFailureForTesting(false);
    assert.equal(offlineGraceWithEs256.statusCode, 200, 'Offline grace must accept valid ES256 token on bound device');
    assert.equal(offlineGraceWithEs256.json?.isOfflineGrace, true);
    assert.equal(offlineGraceWithEs256.json?.license?.id, es256LicId);
    assert.equal(offlineGraceWithEs256.json?.license?.bindingVersion, 1);

    // 15d. Key rotation: active key rotates to Key 2 while Key 1 stays in ENTITLEMENT_ES256_ADDITIONAL_PUBLIC_JWKS
    const rotatedEcPair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const rotatedPrivatePem = rotatedEcPair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const prevKeyWithAccidentalPrivateField = { ...publishedKey, d: 'SHOULD_NEVER_BE_EXPOSED' };
    process.env.ENTITLEMENT_ES256_PRIVATE_KEY = rotatedPrivatePem;
    process.env.ENTITLEMENT_ES256_KEY_ID = 'zoya-es256-test-rotated';
    process.env.ENTITLEMENT_ES256_ADDITIONAL_PUBLIC_JWKS = JSON.stringify([prevKeyWithAccidentalPrivateField]);

    const rotatedJwks = getEntitlementPublicJwks();
    assert.equal(rotatedJwks.keys.length, 2, 'Rotated JWKS must include both active and retired public keys');
    for (const k of rotatedJwks.keys) {
      assert.deepEqual(Object.keys(k).sort(), ['crv', 'kid', 'kty', 'x', 'y'], 'Rotated JWKs must never leak private fields');
    }
    assert.equal(
      verifyEs256EntitlementToken(es256Token, { expectedKeyHash: es256KeyHash, expectedDeviceId: es256Phone.deviceId }).valid,
      true,
      'Previously issued token signed with retired kid must remain verifiable during rotation'
    );
    const newlySignedRotatedToken = signEs256EntitlementToken({
      licenseId: es256LicId,
      keyHash: es256KeyHash,
      maskedKey: es256ActRes.json.license.maskedKey,
      activatedAt: new Date().toISOString(),
      deviceId: es256Phone.deviceId,
      bindingVersion: 1,
    });
    const rotatedVerify = verifyEs256EntitlementToken(newlySignedRotatedToken, {
      expectedKeyHash: es256KeyHash,
      expectedDeviceId: es256Phone.deviceId,
    });
    assert.equal(rotatedVerify.valid, true);
    assert.equal(rotatedVerify.header?.kid, 'zoya-es256-test-rotated');

    // 15e. Fail-closed when ENTITLEMENT_ES256_PRIVATE_KEY is unset (and MUST NOT mutate Firestore)
    const unconfiguredLicCreate = await invokeHandler({
      method: 'POST',
      url: '/api/admin/licenses',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { customerName: 'Fail Closed User', customerEmail: 'failclosed@example.com', licenseType: 'Lifetime' },
    });
    assert.equal(unconfiguredLicCreate.statusCode, 201);
    const unconfId = unconfiguredLicCreate.json.license.id;
    const unconfKey = unconfiguredLicCreate.json.generatedKey;
    createdLicenseIds.push(unconfId);

    delete process.env.ENTITLEMENT_ES256_PRIVATE_KEY;
    delete process.env.ENTITLEMENT_ES256_KEY_ID;
    delete process.env.ENTITLEMENT_ES256_ADDITIONAL_PUBLIC_JWKS;

    const unconfJwksRes = await invokeHandler({ method: 'GET', url: '/api/licenses/jwks' });
    assert.equal(unconfJwksRes.statusCode, 503, 'GET /api/licenses/jwks must fail closed (503) when signing key is unset');
    assert.equal(unconfJwksRes.json?.code, 'ENTITLEMENT_SIGNING_NOT_CONFIGURED');

    const unconfActRes = await invokeHandler({
      method: 'POST',
      url: '/api/licenses/activate',
      body: { licenseKey: unconfKey, deviceInfo: es256Phone },
    });
    assert.equal(unconfActRes.statusCode, 503, 'POST /api/licenses/activate must fail closed (503) when signing key is unset');
    assert.equal(unconfActRes.json?.code, 'ENTITLEMENT_SIGNING_NOT_CONFIGURED');

    const unconfDoc = await zoyaUpdatesAdapter.getDocumentById('licenses', unconfId);
    assert.equal(unconfDoc.data?.status, 'unactivated', 'Failed activation due to missing signing key must NOT mutate Firestore');
    assert.equal(unconfDoc.data?.linkedDevice, null);

    // Restore test primary key before cleanup
    process.env.ENTITLEMENT_ES256_PRIVATE_KEY = TEST_ES256_PRIVATE_KEY_PEM;
    process.env.ENTITLEMENT_ES256_KEY_ID = TEST_ES256_KEY_ID;

    console.log('  ✓ Passed ES256 signing, offline JWK verification, tampering/HMAC rejection, key rotation & fail-closed checks.');
  } finally {
    setLicenseFcmSenderForTesting(null);
    setSimulatedStorageFailureForTesting(false);
    for (const id of createdLicenseIds) {
      try {
        await deleteLicenseRecord(id);
      } catch {
        // Ignore cleanup errors
      }
    }
    setServerFirestoreTestAdapter(null);
    clearLicenseInMemoryCache();
    clearReleasesInMemoryCache();
    resetRateLimits();
    for (const [k, v] of Object.entries(origAdminEnv)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  }

  console.log('\nALL 15 CLEAN ONE-PHONE LIFETIME LICENSE, STAGE 2, DEVICE UNBIND, FCM & ES256 ENTITLEMENT TESTS PASSED SUCCESSFULLY!');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
