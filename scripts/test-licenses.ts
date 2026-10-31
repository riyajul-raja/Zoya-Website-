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
import { AdminUser } from '../server/auth';
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
} from '../server/licenses';
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
 * When live Admin SDK credentials (`FIREBASE_SERVICE_ACCOUNT_JSON`) are present,
 * uses the live Admin SDK; otherwise provides an isolated Admin SDK adapter.
 */
function createZoyaUpdatesTestAdapter(): {
  adapter: ServerFirestoreAdapter;
  collections: Map<string, Map<string, Record<string, any>>>;
} {
  const collections = new Map<string, Map<string, Record<string, any>>>();
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
  };

  return { adapter, collections };
}

async function runTests() {
  console.log('Running Zoya Website — Canonical "zoya-updates/(default)" Firebase Admin SDK Test Suite...\n');

  const adminUser: AdminUser = {
    email: 'admin@zoya.ai',
    name: 'Riyajul (Administrator)',
    role: 'admin',
  };

  const createdLicenseIds: string[] = [];
  const { adapter: zoyaUpdatesAdapter, collections: zoyaCollections } = createZoyaUpdatesTestAdapter();

  try {
    // ---------------------------------------------------------
    // 1. CANONICAL TARGET CONFIGURATION & NO SILENT FALLBACK TO OLD DB
    // ---------------------------------------------------------
    console.log('Test 1: Canonical target ("zoya-updates/(default)", asia-south2) & no fallback to old database...');
    assert.equal(TARGET_FIREBASE_PROJECT_ID, 'zoya-updates', 'Canonical project ID must be zoya-updates');
    assert.equal(TARGET_FIRESTORE_DATABASE_ID, '(default)', 'Canonical database ID must be (default)');
    assert.equal(TARGET_FIRESTORE_REGION, 'asia-south2', 'Canonical region must be asia-south2 (Delhi)');

    // Verify that server/firebase.ts has no RC6K cutover logic and no fallback to legacy database
    const firebaseSource = fs.readFileSync(path.resolve(process.cwd(), 'server/firebase.ts'), 'utf-8');
    assert.equal(
      firebaseSource.includes('RC6K'),
      false,
      'server/firebase.ts must NOT contain any RC6K-based cutover condition'
    );
    assert.equal(
      firebaseSource.includes('isZoyaUpdatesCutoverReady'),
      false,
      'server/firebase.ts must NOT contain isZoyaUpdatesCutoverReady'
    );
    assert.equal(
      firebaseSource.includes('legacy-client'),
      false,
      'server/firebase.ts must NOT contain legacy-client fallback'
    );

    // Verify that when Admin SDK credentials are absent and no test adapter is set,
    // getActiveServerFirestoreAdapter throws STORAGE_UNAVAILABLE (never falling back to old DB)
    // and license validation returns 503 STORAGE_UNAVAILABLE (never 404 UNKNOWN_KEY).
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
        'getActiveServerFirestoreAdapter() must fail with STORAGE_UNAVAILABLE when FIREBASE_SERVICE_ACCOUNT_JSON is missing rather than falling back to old database'
      );

      const unconfiguredValidate = await invokeHandler({
        method: 'POST',
        url: '/api/licenses/validate',
        body: { licenseKey: generateCryptographicLicenseKey() },
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

    // Activate the zoya-updates/(default) adapter for the test suite
    setUseInMemoryStoreForTesting(false);
    setSimulatedStorageFailureForTesting(false);
    if (!liveAdmin) {
      setServerFirestoreTestAdapter(zoyaUpdatesAdapter);
    }
    clearLicenseInMemoryCache();
    clearReleasesInMemoryCache();
    resetRateLimits();
    console.log('  ✓ Passed canonical zoya-updates/(default) routing, RC6K removal & zero-fallback checks.');

    // ---------------------------------------------------------
    // 2. ADMIN PIN LOGIN PRESERVATION & UNAUTHORIZED REJECTION
    // ---------------------------------------------------------
    console.log('Test 2: Admin Portal PIN login preservation, cookie fallback & unauthorized access rejection...');

    const pinLoginSuccess = await invokeHandler({
      method: 'POST',
      url: '/api/admin/login',
      body: { pin: '8825316434' },
    });
    assert.equal(pinLoginSuccess.statusCode, 200, 'Admin PIN must succeed with HTTP 200');
    assert.equal(pinLoginSuccess.json?.success, true);
    assert.ok(typeof pinLoginSuccess.json?.token === 'string' && pinLoginSuccess.json.token.length > 20);
    const adminToken: string = pinLoginSuccess.json.token;

    const sessionCheck = await invokeHandler({
      method: 'GET',
      url: '/api/admin/session',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(sessionCheck.statusCode, 200);
    assert.equal(sessionCheck.json?.authenticated, true);
    assert.equal(sessionCheck.json?.token, adminToken);

    const cookieSessionCheck = await invokeHandler({
      method: 'GET',
      url: '/api/admin/session',
      headers: {
        Authorization: 'Bearer cookie-session',
        Cookie: `zoya_admin_token=${adminToken}`,
      },
    });
    assert.equal(cookieSessionCheck.statusCode, 200);
    assert.equal(cookieSessionCheck.json?.authenticated, true);
    assert.equal(cookieSessionCheck.json?.token, adminToken);

    const cookieAuthList = await invokeHandler({
      method: 'GET',
      url: '/api/admin/licenses',
      headers: {
        Authorization: 'Bearer cookie-session',
        Cookie: `zoya_admin_token=${adminToken}`,
      },
    });
    assert.equal(cookieAuthList.statusCode, 200);
    assert.equal(cookieAuthList.json?.success, true);
    assert.ok(Array.isArray(cookieAuthList.json?.licenses));

    const wrongPinLogin = await invokeHandler({
      method: 'POST',
      url: '/api/admin/login',
      body: { pin: '0000000000' },
    });
    assert.equal(wrongPinLogin.statusCode, 401, 'Invalid PIN must return 401');

    const unauthList = await invokeHandler({
      method: 'GET',
      url: '/api/admin/licenses',
    });
    assert.equal(unauthList.statusCode, 401, 'GET /api/admin/licenses without token must return 401');

    const badTokenCreate = await invokeHandler({
      method: 'POST',
      url: '/api/admin/licenses',
      headers: { Authorization: 'Bearer invalid.jwt.token' },
      body: { customerName: 'Test User', customerEmail: 'test@example.com' },
    });
    assert.equal(badTokenCreate.statusCode, 401, 'POST /api/admin/licenses with invalid token must return 401');

    const expiredTokenHeader = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const expiredPayload = Buffer.from(
      JSON.stringify({
        email: adminUser.email,
        role: adminUser.role,
        name: adminUser.name,
        iat: Math.floor(Date.now() / 1000) - 10000,
        exp: Math.floor(Date.now() / 1000) - 5000,
      })
    ).toString('base64url');
    const expiredToken = `${expiredTokenHeader}.${expiredPayload}.expiredsignature`;
    const expiredTokenCheck = await invokeHandler({
      method: 'GET',
      url: '/api/admin/licenses',
      headers: { Authorization: `Bearer ${expiredToken}` },
    });
    assert.equal(expiredTokenCheck.statusCode, 401, 'Expired admin token must return 401');
    console.log('  ✓ Passed Admin PIN login, cookie fallback & unauthorized rejection checks.');

    // ---------------------------------------------------------
    // 3. UNIQUE KEY GENERATION & COLLISION HANDLING ON FRESH DB
    // ---------------------------------------------------------
    console.log('Test 3: Cryptographic key generation, format validation & collision handling...');
    const sampleKeys = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const k = generateCryptographicLicenseKey();
      assert.ok(isValidLicenseKeyFormat(k), `Generated key ${k} must match ZOYA-XXXX-XXXX-XXXX`);
      sampleKeys.add(k);
    }
    assert.equal(sampleKeys.size, 50, '50 generated keys must all be unique');

    const fixedKey1 = generateCryptographicLicenseKey();
    const fixedKey2 = generateCryptographicLicenseKey();
    const firstCreated = await createLifetimeLicense(
      {
        customerName: 'Collision Test One',
        customerEmail: 'collision1@example.com',
        licenseType: 'Lifetime',
      },
      adminUser,
      () => fixedKey1
    );
    assert.equal(firstCreated.success, true);
    if (firstCreated.success) {
      createdLicenseIds.push(firstCreated.license.id);
    }

    let callCount = 0;
    const secondCreated = await createLifetimeLicense(
      {
        customerName: 'Collision Test Two',
        customerEmail: 'collision2@example.com',
        licenseType: 'Lifetime',
      },
      adminUser,
      () => {
        callCount += 1;
        return callCount === 1 ? fixedKey1 : fixedKey2;
      }
    );
    assert.equal(secondCreated.success, true, 'Collision on first key candidate must automatically retry and succeed');
    assert.equal(callCount, 2, 'Generator must have been called twice due to collision');
    if (secondCreated.success) {
      createdLicenseIds.push(secondCreated.license.id);
      assert.equal(secondCreated.generatedKey, fixedKey2);
    }
    console.log('  ✓ Passed cryptographic key format and collision handling checks.');

    // ---------------------------------------------------------
    // 4. NEW LICENSE GENERATION, PERSISTENCE & ZERO PLAINTEXT STORAGE
    // ---------------------------------------------------------
    console.log('Test 4: Generating and persisting a new license in zoya-updates/(default) with SHA-256 hashing...');
    const createRes = await invokeHandler({
      method: 'POST',
      url: '/api/admin/licenses',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        customerName: 'Priya Verma',
        customerEmail: 'priya.verma@example.com',
        licenseType: 'Lifetime',
        paymentReference: 'UTR9988776655',
        amount: '999',
        currency: 'INR',
      },
    });
    assert.equal(createRes.statusCode, 201, 'POST /api/admin/licenses must return 201');
    const plaintextPaidKey: string = createRes.json.generatedKey;
    const createdLic = createRes.json.license;
    createdLicenseIds.push(createdLic.id);

    assert.ok(isValidLicenseKeyFormat(plaintextPaidKey), 'Returned generatedKey must be valid');
    assert.equal(createdLic.keyHash, hashLicenseKey(plaintextPaidKey), 'Stored keyHash must match SHA-256 hash');
    assert.equal(createdLic.maskedKey, maskLicenseKey(plaintextPaidKey).maskedKey, 'Masked key must match ZOYA-••••-••••-XXXX');
    assert.equal((createdLic as any).licenseKey, undefined, 'Stored license object must not contain plaintext key');

    clearLicenseInMemoryCache();
    const persisted = await getLicenseById(createdLic.id);
    assert.ok(persisted, 'License must be retrievable from zoya-updates/(default)');
    assert.equal(JSON.stringify(persisted).includes(plaintextPaidKey), false, 'Serialized record must NEVER contain plaintext key');
    assert.equal(persisted?.linkedDevice, null);
    assert.equal(persisted?.lastSeenAt, null);
    assert.equal(persisted?.activatedAt, null);
    console.log('  ✓ Passed new license generation, persistence, and zero plaintext exposure checks.');

    // ---------------------------------------------------------
    // 5. PENDING-PAYMENT REJECTION & SINGLE-CLICK PAYMENT VERIFICATION
    // ---------------------------------------------------------
    console.log('Test 5: Pending-payment rejection & single-click payment verification/activation...');
    assert.equal(createdLic.status, 'pending_payment');
    assert.equal(createdLic.paymentVerified, false);

    const pendingValidation = await invokeHandler({
      method: 'POST',
      url: '/api/licenses/validate',
      body: { licenseKey: plaintextPaidKey },
    });
    assert.equal(pendingValidation.statusCode, 403, 'Pending-payment license must be rejected with HTTP 403');
    assert.equal(pendingValidation.json?.valid, false);
    assert.equal(pendingValidation.json?.status, 'pending_payment');
    assert.equal(pendingValidation.json?.code, 'PAYMENT_UNVERIFIED');

    const licenseManagerSource = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/admin/LicenseManager.tsx'),
      'utf-8'
    );
    assert.ok(
      licenseManagerSource.includes('handleVerifyAndActivate(selectedLicense)'),
      'LicenseManager UI must preserve direct handleVerifyAndActivate(selectedLicense) button'
    );

    const unauthVerifyRes = await invokeHandler({
      method: 'POST',
      url: `/api/admin/licenses/${createdLic.id}`,
      body: { action: 'verify_payment' },
    });
    assert.equal(unauthVerifyRes.statusCode, 401, 'Unauthenticated verify_payment must return 401');

    const verifyRes = await invokeHandler({
      method: 'POST',
      url: `/api/admin/licenses/${createdLic.id}`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        action: 'verify_payment',
        paymentReference: createdLic.paymentReference || undefined,
        amount: createdLic.amount || undefined,
        currency: createdLic.currency || undefined,
      },
    });
    assert.equal(verifyRes.statusCode, 200, 'Direct payment verification & activation must succeed with 200');
    assert.equal(verifyRes.json?.license?.status, 'active');
    assert.equal(verifyRes.json?.license?.paymentVerified, true);
    assert.equal(verifyRes.json?.license?.paymentReference, 'UTR9988776655');
    assert.equal(verifyRes.json?.license?.amount, '999');
    assert.equal(verifyRes.json?.license?.currency, 'INR');
    assert.equal(verifyRes.json?.license?.verifiedBy?.email, adminUser.email);
    assert.ok(verifyRes.json?.license?.verifiedAt);
    assert.ok(verifyRes.json?.license?.activatedAt);

    const duplicateVerifyRes = await invokeHandler({
      method: 'POST',
      url: `/api/admin/licenses/${createdLic.id}`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { action: 'verify_payment' },
    });
    assert.equal(duplicateVerifyRes.statusCode, 400, 'Duplicate verify_payment on active license must return 400');

    // Direct activation when paymentReference is omitted must not fabricate a reference
    const noRefCreateRes = await invokeHandler({
      method: 'POST',
      url: '/api/admin/licenses',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        customerName: 'No Ref Customer',
        customerEmail: 'noref@example.com',
        licenseType: 'Lifetime',
        amount: '300',
        currency: 'INR',
      },
    });
    assert.equal(noRefCreateRes.statusCode, 201);
    const noRefLic = noRefCreateRes.json.license;
    createdLicenseIds.push(noRefLic.id);

    const noRefVerifyRes = await invokeHandler({
      method: 'POST',
      url: `/api/admin/licenses/${noRefLic.id}`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { action: 'verify_payment' },
    });
    assert.equal(noRefVerifyRes.statusCode, 200);
    assert.equal(noRefVerifyRes.json?.license?.status, 'active');
    assert.equal(noRefVerifyRes.json?.license?.paymentReference, null);
    console.log('  ✓ Passed pending-payment rejection & single-click payment verification checks.');

    // ---------------------------------------------------------
    // 6. LICENSE VALIDATION, REVOCATION & AUDIT TRAIL ON NEW DB
    // ---------------------------------------------------------
    console.log('Test 6: Validating new licenses, complimentary issuance, revocation & audit history...');
    const activeValidation = await invokeHandler({
      method: 'POST',
      url: '/api/licenses/validate',
      body: {
        licenseKey: plaintextPaidKey,
        deviceInfo: {
          deviceId: 'android_pixel8_01',
          deviceModel: 'Google Pixel 8',
          androidVersion: 'Android 14 (API 34)',
          appVersion: '2.1.0',
        },
      },
    });
    assert.equal(activeValidation.statusCode, 200, 'Verified active license must validate with HTTP 200');
    assert.equal(activeValidation.json?.valid, true);
    assert.equal(activeValidation.json?.code, 'LICENSE_VALID');
    assert.equal(activeValidation.json?.license?.linkedDevice?.deviceModel, 'Google Pixel 8');

    const firstActivatedAt = activeValidation.json.license.activatedAt;
    const secondValidation = await invokeHandler({
      method: 'POST',
      url: '/api/licenses/validate',
      body: { licenseKey: plaintextPaidKey },
    });
    assert.equal(secondValidation.statusCode, 200);
    assert.equal(
      secondValidation.json?.license?.activatedAt,
      firstActivatedAt,
      'Idempotent validation must preserve original activatedAt timestamp'
    );

    // Revocation workflow
    const separateRevokeCreateRes = await invokeHandler({
      method: 'POST',
      url: '/api/admin/licenses',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        customerName: 'Revoke Test Customer',
        customerEmail: 'revoke.test@example.com',
        licenseType: 'Lifetime',
        paymentReference: 'UTR7777888899',
        amount: '999',
        currency: 'INR',
      },
    });
    assert.equal(separateRevokeCreateRes.statusCode, 201);
    const revokeTestKey: string = separateRevokeCreateRes.json.generatedKey;
    const revokeTestLic = separateRevokeCreateRes.json.license;
    createdLicenseIds.push(revokeTestLic.id);

    await invokeHandler({
      method: 'POST',
      url: `/api/admin/licenses/${revokeTestLic.id}`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        action: 'verify_payment',
        paymentReference: 'UTR7777888899',
        amount: '999',
        currency: 'INR',
      },
    });

    const revokeRes = await invokeHandler({
      method: 'POST',
      url: `/api/admin/licenses/${revokeTestLic.id}`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        action: 'revoke',
        reason: 'Customer requested refund',
      },
    });
    assert.equal(revokeRes.statusCode, 200, 'Revoke action must return 200');
    assert.equal(revokeRes.json?.license?.status, 'revoked');
    assert.equal(revokeRes.json?.license?.revokeReason, 'Customer requested refund');

    const revokedValidation = await invokeHandler({
      method: 'POST',
      url: '/api/licenses/validate',
      body: { licenseKey: revokeTestKey },
    });
    assert.equal(revokedValidation.statusCode, 403, 'Revoked license must fail validation with 403');
    assert.equal(revokedValidation.json?.valid, false);
    assert.equal(revokedValidation.json?.status, 'revoked');
    assert.equal(revokedValidation.json?.code, 'LICENSE_REVOKED');

    const detailRes = await invokeHandler({
      method: 'GET',
      url: `/api/admin/licenses/${revokeTestLic.id}`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(detailRes.statusCode, 200);
    const auditActions = (detailRes.json?.license?.auditLog || []).map((a: any) => a.action);
    assert.deepEqual(auditActions, ['created', 'payment_verified', 'revoked']);

    // Complimentary license issuance & validation
    const compValid = await invokeHandler({
      method: 'POST',
      url: '/api/admin/licenses',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        customerName: 'Reviewer User',
        customerEmail: 'reviewer@example.com',
        isComplimentary: true,
        complimentaryReason: 'Official Android reviewer device',
      },
    });
    assert.equal(compValid.statusCode, 201);
    createdLicenseIds.push(compValid.json.license.id);
    assert.equal(compValid.json.license.status, 'active');

    const compValidation = await invokeHandler({
      method: 'POST',
      url: '/api/licenses/validate',
      body: { licenseKey: compValid.json.generatedKey },
    });
    assert.equal(compValidation.statusCode, 200, 'Complimentary license must validate immediately');
    assert.ok(typeof compValidation.json?.entitlementToken === 'string', 'Validation must issue signed entitlement token');
    const savedSignedToken = compValidation.json.entitlementToken;

    const malformedRes = await invokeHandler({
      method: 'POST',
      url: '/api/licenses/validate',
      body: { licenseKey: 'INVALID-KEY-123' },
    });
    assert.equal(malformedRes.statusCode, 400);
    assert.equal(malformedRes.json?.code, 'MALFORMED_KEY');

    const unknownKey = generateCryptographicLicenseKey();
    const unknownRes = await invokeHandler({
      method: 'POST',
      url: '/api/licenses/validate',
      body: { licenseKey: unknownKey },
    });
    assert.equal(unknownRes.statusCode, 404, 'Unknown valid-format key must return 404 when database is healthy');
    assert.equal(unknownRes.json?.code, 'UNKNOWN_KEY');
    console.log('  ✓ Passed new license validation, complimentary issuance, revocation & audit trail checks.');

    // ---------------------------------------------------------
    // 7. INPUT VALIDATION & RATE LIMITING
    // ---------------------------------------------------------
    console.log('Test 7: Input validation & rate limiting on login and public validation endpoints...');
    const invalidEmailRes = await invokeHandler({
      method: 'POST',
      url: '/api/admin/licenses',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        customerName: 'Bad Email User',
        customerEmail: 'not-an-email',
      },
    });
    assert.equal(invalidEmailRes.statusCode, 400, 'Invalid email must be rejected with 400');

    resetRateLimits();
    let lastLoginStatus = 0;
    for (let i = 0; i < 11; i++) {
      const loginAttempt = await invokeHandler({
        method: 'POST',
        url: '/api/admin/login',
        headers: { 'x-forwarded-for': '203.0.113.55' },
        body: { pin: '000000' },
      });
      lastLoginStatus = loginAttempt.statusCode;
    }
    assert.equal(lastLoginStatus, 429, '11th rapid login attempt from same IP must return HTTP 429');

    resetRateLimits();
    let lastValidateStatus = 0;
    for (let i = 0; i < 21; i++) {
      const valAttempt = await invokeHandler({
        method: 'POST',
        url: '/api/licenses/validate',
        headers: { 'x-forwarded-for': '198.51.100.77' },
        body: { licenseKey: unknownKey },
      });
      lastValidateStatus = valAttempt.statusCode;
    }
    assert.equal(lastValidateStatus, 429, '21st rapid license validation from same IP must return HTTP 429');
    resetRateLimits();
    console.log('  ✓ Passed input validation and rate limiting checks.');

    // ---------------------------------------------------------
    // 8. FIRESTORE CLIENT RULES LOCKED DOWN ON ZOYA-UPDATES/(DEFAULT)
    // ---------------------------------------------------------
    console.log('Test 8: Verifying Firestore client rules on zoya-updates/(default) deny unauthenticated access...');
    const rulesSource = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf-8');
    assert.ok(
      rulesSource.includes('match /licenses/{licenseId}') && rulesSource.includes('isAuthenticatedServer()'),
      'firestore.rules must keep /licenses locked down to privileged server identity'
    );

    try {
      const zoyaUpdatesRes = await fetch(
        'https://firestore.googleapis.com/v1/projects/zoya-updates/databases/(default)/documents/licenses?pageSize=1'
      );
      assert.equal(
        zoyaUpdatesRes.status,
        403,
        'Unauthenticated client read on zoya-updates/(default)/licenses must return 403 PERMISSION_DENIED'
      );
    } catch (netErr) {
      console.log('  (Network check note):', netErr);
    }
    console.log('  ✓ Passed zoya-updates/(default) client lockdown checks.');

    // ---------------------------------------------------------
    // 9. FIRESTORE OUTAGE HANDLING (503 STORAGE_UNAVAILABLE, NEVER 404 UNKNOWN_KEY)
    // ---------------------------------------------------------
    console.log('Test 9: Firestore outage returns HTTP 503 STORAGE_UNAVAILABLE (never 404 UNKNOWN_KEY)...');
    setSimulatedStorageFailureForTesting(true);
    clearLicenseInMemoryCache();
    try {
      const listFail = await invokeHandler({
        method: 'GET',
        url: '/api/admin/licenses',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.equal(listFail.statusCode, 503, 'GET /api/admin/licenses must return 503 when Firestore is unavailable');
      assert.equal(listFail.json?.code, 'STORAGE_UNAVAILABLE');

      const createFail = await invokeHandler({
        method: 'POST',
        url: '/api/admin/licenses',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: {
          customerName: 'Outage User',
          customerEmail: 'outage@example.com',
        },
      });
      assert.equal(createFail.statusCode, 503, 'POST /api/admin/licenses must return 503 when Firestore is unavailable');
      assert.equal(createFail.json?.success, false);
      assert.equal(createFail.json?.generatedKey, undefined, 'Must never issue a license key if Firestore write fails');

      const verifyFail = await invokeHandler({
        method: 'POST',
        url: `/api/admin/licenses/${createdLic.id}`,
        headers: { Authorization: `Bearer ${adminToken}` },
        body: {
          action: 'verify_payment',
          paymentReference: 'UTR12345',
        },
      });
      assert.equal(verifyFail.statusCode, 503, 'Verify payment must return 503 when Firestore is unavailable');
      assert.equal(verifyFail.json?.success, false);

      // First-time validation without signed entitlement token during outage must return 503 STORAGE_UNAVAILABLE (never 404 UNKNOWN_KEY)
      const validateFail = await invokeHandler({
        method: 'POST',
        url: '/api/licenses/validate',
        body: { licenseKey: generateCryptographicLicenseKey() },
      });
      assert.equal(validateFail.statusCode, 503, 'Validation during Firestore outage must return 503');
      assert.equal(validateFail.json?.valid, false);
      assert.equal(validateFail.json?.code, 'STORAGE_UNAVAILABLE');
      assert.notEqual(validateFail.json?.code, 'UNKNOWN_KEY', 'Must never return UNKNOWN_KEY on storage errors');

      // Previously verified activation submitting valid signed entitlement token during outage must pass with 30-day offline grace
      const graceValidation = await invokeHandler({
        method: 'POST',
        url: '/api/licenses/validate',
        body: {
          licenseKey: compValid.json.generatedKey,
          entitlementToken: savedSignedToken,
        },
      });
      assert.equal(graceValidation.statusCode, 200, 'Valid signed entitlement token must pass during outage');
      assert.equal(graceValidation.json?.valid, true);
      assert.equal(graceValidation.json?.isOfflineGrace, true);

      // Forged token during outage must be rejected with 503 STORAGE_UNAVAILABLE
      const forgedValidation = await invokeHandler({
        method: 'POST',
        url: '/api/licenses/validate',
        body: {
          licenseKey: compValid.json.generatedKey,
          entitlementToken: 'forged.signature.token',
        },
      });
      assert.equal(forgedValidation.statusCode, 503, 'Forged entitlement token during outage must be rejected with 503');
      assert.equal(forgedValidation.json?.valid, false);
      assert.equal(forgedValidation.json?.code, 'STORAGE_UNAVAILABLE');
    } finally {
      setSimulatedStorageFailureForTesting(false);
    }

    const restoredValidation = await invokeHandler({
      method: 'POST',
      url: '/api/licenses/validate',
      body: {
        licenseKey: compValid.json.generatedKey,
        entitlementToken: savedSignedToken,
      },
    });
    assert.equal(restoredValidation.statusCode, 200, 'Revalidation after outage recovery must succeed with HTTP 200');
    assert.equal(restoredValidation.json?.valid, true);
    assert.equal(restoredValidation.json?.isOfflineGrace, undefined);
    console.log('  ✓ Passed HTTP 503 STORAGE_UNAVAILABLE outage handling & signed offline grace token checks.');

    // ---------------------------------------------------------
    // 10. RELEASES, APK BINARY CHUNKS & FCM ON ZOYA-UPDATES/(DEFAULT)
    // ---------------------------------------------------------
    console.log('Test 10: Testing Releases, multi-chunk APK storage/reconstruction & FCM on zoya-updates/(default)...');

    // 10a. Binary Buffer normalization check (Admin SDK Buffer & Web SDK Bytes compatibility)
    const rawAdminBuffer = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0xaa, 0xbb]);
    const extractedFromBuffer = extractBinaryBuffer(rawAdminBuffer);
    assert.ok(extractedFromBuffer && extractedFromBuffer.equals(rawAdminBuffer));

    const simulatedWebBytes = {
      toUint8Array: () => new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xcc, 0xdd]),
    };
    const extractedFromWebBytes = extractBinaryBuffer(simulatedWebBytes);
    assert.ok(
      extractedFromWebBytes && extractedFromWebBytes.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0xcc, 0xdd]))
    );

    // 10b. Multi-chunk APK upload, verification & reconstruction in `apk_chunks`
    const syntheticApkSize = APK_CHUNK_SIZE + 65536; // 2 chunks (512 KB + 64 KB)
    const syntheticApkBuffer = Buffer.alloc(syntheticApkSize);
    // Write valid ZIP/APK magic header PK\x03\x04
    syntheticApkBuffer[0] = 0x50;
    syntheticApkBuffer[1] = 0x4b;
    syntheticApkBuffer[2] = 0x03;
    syntheticApkBuffer[3] = 0x04;
    crypto.randomFillSync(syntheticApkBuffer, 4);
    const expectedSha256 = crypto.createHash('sha256').update(syntheticApkBuffer).digest('hex');

    const storedApk = await storeApkBuffer(syntheticApkBuffer, 'zoya-test-v3.0.0.apk');
    assert.equal(storedApk.chunkCount, 2, '576 KB APK must be split into 2 chunks in apk_chunks');
    assert.equal(storedApk.fileSize, syntheticApkSize);
    assert.equal(storedApk.sha256, expectedSha256);

    const chunksVerified = await verifyStoredChunks(storedApk.storageKey, storedApk.chunkCount);
    assert.equal(chunksVerified, true, 'verifyStoredChunks must confirm all chunks exist in zoya-updates/(default)');

    // Delete local cached APK file so getApkBuffer is forced to reconstruct from Firestore `apk_chunks`
    const localCachedApk = path.resolve(process.cwd(), '.data', 'apks', storedApk.storageKey);
    if (fs.existsSync(localCachedApk)) {
      fs.unlinkSync(localCachedApk);
    }

    const reconstructedBuffer = await getApkBuffer(
      storedApk.storageKey,
      storedApk.storagePath,
      storedApk.chunkCount
    );
    assert.ok(reconstructedBuffer, 'getApkBuffer must reconstruct APK binary from Firestore apk_chunks');
    assert.equal(reconstructedBuffer.length, syntheticApkSize, 'Reconstructed APK size must match original');
    const reconstructedSha256 = crypto.createHash('sha256').update(reconstructedBuffer).digest('hex');
    assert.equal(reconstructedSha256, expectedSha256, 'Reconstructed APK SHA-256 must match original');

    // 10c. Release metadata creation, querying & deletion in `releases`
    const testReleaseId = `rel_test_${Date.now()}`;
    const testRelease: ReleaseMetadata = {
      id: testReleaseId,
      versionName: '3.0.0',
      versionCode: 300,
      applicationId: 'com.riyajul.zoya',
      fileName: 'zoya-test-v3.0.0.apk',
      fileSize: storedApk.fileSize,
      fileSizeFormatted: storedApk.fileSizeFormatted,
      sha256: storedApk.sha256,
      storageKey: storedApk.storageKey,
      storagePath: storedApk.storagePath,
      chunkCount: storedApk.chunkCount,
      binaryVerified: true,
      downloadUrl: `/api/releases/download?id=${testReleaseId}`,
      releaseDate: '2026-10-30',
      releaseNotes: 'Connected to zoya-updates/(default)',
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
    assert.ok(fetchedRel, 'Saved release must be retrievable by ID from zoya-updates/(default)');
    assert.equal(fetchedRel?.versionName, '3.0.0');
    assert.equal(await hasApkBinary(fetchedRel), true, 'hasApkBinary must confirm APK chunks exist');

    const latestPublished = await getLatestPublishedRelease();
    assert.ok(latestPublished, 'getLatestPublishedRelease must return published release');

    // 10d. FCM device registration & notification status on `zoya-updates/(default)`
    const fakeFcmToken = 'fcm_test_device_token_' + crypto.randomBytes(16).toString('hex');
    const regRes = await invokeHandler({
      method: 'POST',
      url: '/api/devices/register',
      body: {
        token: fakeFcmToken,
        platform: 'android',
        applicationId: 'com.riyajul.zoya',
        appVersion: '3.0.0',
        versionCode: 300,
      },
    });
    assert.equal(regRes.statusCode, 200, 'POST /api/devices/register must succeed with HTTP 200');
    assert.equal(regRes.json?.success, true);
    assert.ok(regRes.json?.deviceId);

    const fcmStatus = await getFcmStatus();
    assert.equal(fcmStatus.projectId, 'zoya-updates', 'FCM status projectId must be zoya-updates');
    assert.ok(fcmStatus.registeredDevicesCount >= 1, 'FCM status must count registered devices in fcm_devices');

    const fcmDispatchResult = await sendReleasePushNotification(testRelease);
    assert.equal(fcmDispatchResult.projectId, 'zoya-updates');

    // Clean up test release and chunks
    const deletedRel = await deleteRelease(testReleaseId);
    assert.equal(deletedRel, true, 'deleteRelease must clean up release and its apk_chunks');
    if (regRes.json?.deviceId && !liveAdmin) {
      zoyaCollections.get('fcm_devices')?.delete(regRes.json.deviceId);
    }

    // Verify API endpoints for releases & notifications
    const latestRelApiRes = await invokeHandler({
      method: 'GET',
      url: '/api/releases/latest',
    });
    assert.equal(latestRelApiRes.statusCode, 200);

    const adminRelApiRes = await invokeHandler({
      method: 'GET',
      url: '/api/admin/releases',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(adminRelApiRes.statusCode, 200);
    assert.equal(adminRelApiRes.json?.success, true);

    const notifyValidationRes = await invokeHandler({
      method: 'POST',
      url: '/api/admin/notify',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { title: '', message: '' },
    });
    assert.equal(notifyValidationRes.statusCode, 400, 'POST /api/admin/notify with empty fields must return 400');
    console.log('  ✓ Passed Releases, APK binary chunks & FCM checks on zoya-updates/(default).');
  } finally {
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
  }

  console.log('\nALL 10 ZOYA-UPDATES/(DEFAULT) FIREBASE ADMIN SDK, LICENSE, RELEASE, APK CHUNK & FCM TEST SUITES PASSED!');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
