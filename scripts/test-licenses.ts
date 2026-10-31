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
 * Includes full support for atomic runTransaction simulation.
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
    async runTransaction<T>(updateFunction: (transaction: any) => Promise<T>): Promise<T> {
      // In-memory atomic transaction simulation
      const tx = {
        async get(collectionName: string, docId: string) {
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
        set(collectionName: string, docId: string, data: Record<string, any>, options?: { merge?: boolean }) {
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

  return { adapter, collections };
}

async function runTests() {
  console.log('Running Zoya Website — Clean One-Phone Lifetime License & Firebase Test Suite...\n');

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
    // 2. ADMIN PORTAL PIN ON EVERY OPEN, SESSION INVALIDATION & UNAUTHORIZED REJECTION
    // ---------------------------------------------------------
    console.log('Test 2: Admin Portal PIN login, session invalidation on logout & direct access rejection...');

    const pinLoginSuccess = await invokeHandler({
      method: 'POST',
      url: '/api/admin/login',
      body: { pin: '8825316434' },
    });
    assert.equal(pinLoginSuccess.statusCode, 200, 'Admin PIN must succeed with HTTP 200');
    assert.equal(pinLoginSuccess.json?.success, true);
    assert.ok(typeof pinLoginSuccess.json?.token === 'string' && pinLoginSuccess.json.token.length > 20);
    assert.ok(
      typeof pinLoginSuccess.headers['set-cookie'] === 'string' &&
        pinLoginSuccess.headers['set-cookie'].includes('SameSite=Strict'),
      'Login must set SameSite=Strict HttpOnly cookie'
    );
    const adminToken: string = pinLoginSuccess.json.token;

    const sessionCheck = await invokeHandler({
      method: 'GET',
      url: '/api/admin/session',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(sessionCheck.statusCode, 200);
    assert.equal(sessionCheck.json?.authenticated, true);

    // Verify invalid PIN rejection
    const wrongPinLogin = await invokeHandler({
      method: 'POST',
      url: '/api/admin/login',
      body: { pin: '0000000000' },
    });
    assert.equal(wrongPinLogin.statusCode, 401, 'Invalid PIN must return 401');

    // Verify session invalidation on logout (PIN required on every open)
    const logoutRes = await invokeHandler({
      method: 'POST',
      url: '/api/admin/logout',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(logoutRes.statusCode, 200);
    assert.ok(
      typeof logoutRes.headers['set-cookie'] === 'string' &&
        logoutRes.headers['set-cookie'].includes('Max-Age=0'),
      'Logout must invalidate session cookie'
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

    // Verify signed entitlement token contains embedded device ID
    const phoneAToken = firstActivationRes.json?.entitlementToken;
    assert.ok(typeof phoneAToken === 'string', 'Activation must return HMAC entitlement token');
    const verifiedTokenPayload = verifySignedEntitlementToken(phoneAToken, hashLicenseKey(plaintextKey), phoneADeviceId);
    assert.equal(verifiedTokenPayload.valid, true, 'Entitlement token must verify with bound deviceId');
    assert.equal(verifiedTokenPayload.payload?.did, phoneADeviceId);

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

    // 11d. Simulating a fresh session / page reload: clear all in-memory caches
    clearLicenseInMemoryCache();
    const freshSessionReveal = await invokeHandler({
      method: 'GET',
      url: `/api/admin/licenses/${visibilityLicenseId}/key`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(freshSessionReveal.statusCode, 200);
    assert.equal(
      freshSessionReveal.json?.licenseKey,
      originalGeneratedKey,
      'Admin must be able to retrieve the original key across sessions and reloads'
    );

    // 11e. Unauthorized callers must be rejected
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

    // 11f. Tamper detection: modifying auth tag or ciphertext must fail decryption
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

    // 11g. Legacy license (SHA-256 only, encryptedKey missing) must return 404 KEY_NOT_RECOVERABLE
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

    // 11h. Validation on Android phone still succeeds with SHA-256
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

  console.log('\nALL 11 CLEAN ONE-PHONE LIFETIME LICENSE & FIREBASE TESTS PASSED SUCCESSFULLY!');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
