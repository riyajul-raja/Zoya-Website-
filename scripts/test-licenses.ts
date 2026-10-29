import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { initializeApp, deleteApp } from 'firebase/app';
import { getFirestore, collection, getDocs, setDoc, doc } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import { handleApiRequest } from '../server/apiHandler';
import { createToken, AdminUser } from '../server/auth';
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
} from '../server/licenses';
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

async function runTests() {
  console.log('Running Zoya Lifetime License Management & Security Hardening Test Suite...\n');
  const createdLicenseIds: string[] = [];

  const adminUser: AdminUser = {
    email: 'admin@zoya.ai',
    name: 'Riyajul (Administrator)',
    role: 'admin',
  };

  // Pre-test snapshot of existing Firestore records to guarantee zero modification
  const preTestLicenses = await getAllLicenses();
  const protectedIds = new Set(preTestLicenses.map((l) => l.id));
  const preAA8D = preTestLicenses.find((l) => l.keyLastFour === 'AA8D' || l.maskedKey.endsWith('AA8D'));
  const preRC6K = preTestLicenses.find((l) => l.keyLastFour === 'RC6K' || l.maskedKey.endsWith('RC6K'));
  assert.equal(preAA8D, undefined, 'Pre-check: Deleted audit-test record ending AA8D must not exist in Firestore');
  assert.ok(preRC6K, 'Pre-check: Existing license record ending RC6K must exist in Firestore');
  const preRC6KJson = JSON.stringify(preRC6K);
  console.log(
    `Pre-test Firestore snapshot: ${preTestLicenses.length} existing record(s) preserved (${preRC6K.maskedKey} [${preRC6K.status}]).\n`
  );

  try {
    resetRateLimits();
    setSimulatedStorageFailureForTesting(false);

    // ---------------------------------------------------------
    // 1. ADMIN PIN LOGIN PRESERVATION & UNAUTHORIZED REJECTION
    // ---------------------------------------------------------
    console.log('Test 1: Existing Admin Portal PIN login preservation & unauthorized access rejection...');

    const pinLoginSuccess = await invokeHandler({
      method: 'POST',
      url: '/api/admin/login',
      body: { pin: '8825316434' },
    });
    assert.equal(pinLoginSuccess.statusCode, 200, 'Existing Admin PIN must succeed with HTTP 200');
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

    const authList = await invokeHandler({
      method: 'GET',
      url: '/api/admin/licenses',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(authList.statusCode, 200, 'Authenticated admin must receive 200 on GET /api/admin/licenses');
    assert.equal(authList.json?.success, true);
    assert.ok(Array.isArray(authList.json?.licenses), 'Response must include licenses array');
    assert.ok(typeof authList.json?.stats?.total === 'number', 'Response must include overview stats');
    console.log('  ✓ Passed existing PIN login preservation & unauthorized rejection checks.');

    // ---------------------------------------------------------
    // 2. UNIQUE KEY GENERATION & COLLISION HANDLING
    // ---------------------------------------------------------
    console.log('Test 2: Cryptographic key generation, format validation & collision handling...');
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
    // 3. PERSISTENT STORAGE & NO PLAINTEXT KEY STORAGE
    // ---------------------------------------------------------
    console.log('Test 3: Persistent Cloud Firestore storage, SHA-256 hashing, and zero plaintext key storage...');
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

    const persisted = await getLicenseById(createdLic.id);
    assert.ok(persisted, 'License must be retrievable from persistent Cloud Firestore storage');
    assert.equal(JSON.stringify(persisted).includes(plaintextPaidKey), false, 'Serialized persistent record must NEVER contain plaintext key');
    assert.equal(persisted?.linkedDevice, null, 'Unactivated license must have linkedDevice = null');
    assert.equal(persisted?.lastSeenAt, null, 'Unactivated license must have lastSeenAt = null');
    assert.equal(persisted?.activatedAt, null, 'Unactivated license must have activatedAt = null');
    console.log('  ✓ Passed persistent Cloud Firestore storage and zero plaintext exposure checks.');

    // ---------------------------------------------------------
    // 4. PENDING-PAYMENT REJECTION RULE
    // ---------------------------------------------------------
    console.log('Test 4: Unverified paid license (even with transaction ID) stays Pending Payment & fails validation...');
    assert.equal(
      createdLic.status,
      'pending_payment',
      'Paid license with transaction ID must still start in pending_payment status'
    );
    assert.equal(createdLic.paymentVerified, false, 'paymentVerified must be false before manual admin verification');

    const pendingValidation = await invokeHandler({
      method: 'POST',
      url: '/api/licenses/validate',
      body: {
        licenseKey: plaintextPaidKey,
      },
    });
    assert.equal(pendingValidation.statusCode, 403, 'Pending-payment license must be rejected with HTTP 403');
    assert.equal(pendingValidation.json?.valid, false);
    assert.equal(pendingValidation.json?.status, 'pending_payment');
    assert.equal(pendingValidation.json?.code, 'PAYMENT_UNVERIFIED');
    console.log('  ✓ Passed pending-payment rejection check.');

    // ---------------------------------------------------------
    // 5. DIRECT SINGLE-CLICK PAYMENT VERIFICATION & ACTIVATION (NO MODAL)
    // ---------------------------------------------------------
    console.log('Test 5: Direct single-click "Verify Payment & Activate License" without extra confirmation modal...');
    const licenseManagerSource = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/admin/LicenseManager.tsx'),
      'utf-8'
    );
    assert.equal(
      licenseManagerSource.includes('Manual Payment Verification'),
      false,
      'Extra Manual Payment Verification modal/form must be removed from LicenseManager.tsx'
    );
    assert.equal(
      licenseManagerSource.includes('Verified Transaction / Payment Reference'),
      false,
      'Verified Transaction / Payment Reference modal input must be removed'
    );
    assert.equal(
      licenseManagerSource.includes('I have independently checked'),
      false,
      'Second confirmation checkbox must be removed'
    );
    assert.equal(
      licenseManagerSource.includes('Confirm & Activate'),
      false,
      'Confirm & Activate modal submit button must be removed'
    );
    assert.ok(
      licenseManagerSource.includes('handleVerifyAndActivate(selectedLicense)'),
      'Verify Payment & Activate License button must directly invoke handleVerifyAndActivate(selectedLicense)'
    );

    assert.ok(Array.isArray(createdLic.auditLog) && createdLic.auditLog.length === 1, 'Initial paid license must have 1 auditLog entry');
    assert.equal(createdLic.auditLog[0].action, 'created', 'First auditLog entry must be created');

    // Unauthorized activation attempt must be rejected
    const unauthVerifyRes = await invokeHandler({
      method: 'POST',
      url: `/api/admin/licenses/${createdLic.id}`,
      body: {
        action: 'verify_payment',
      },
    });
    assert.equal(unauthVerifyRes.statusCode, 401, 'Unauthenticated verify_payment must return 401');

    // Direct activation reusing the license's existing paymentReference and amount
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
    assert.equal(verifyRes.json?.license?.paymentReference, 'UTR9988776655', 'Existing paymentReference must be reused');
    assert.equal(verifyRes.json?.license?.amount, '999', 'Existing amount must be reused');
    assert.equal(verifyRes.json?.license?.currency, 'INR', 'Existing currency must be reused');
    assert.equal(verifyRes.json?.license?.verifiedBy?.email, adminUser.email);
    assert.ok(verifyRes.json?.license?.verifiedAt, 'verifiedAt timestamp must be recorded');
    assert.ok(verifyRes.json?.license?.activatedAt, 'activatedAt timestamp must be recorded upon activation');
    assert.ok(
      verifyRes.json?.license?.auditLog?.some(
        (e: any) => e.action === 'payment_verified' && typeof e.actor === 'string' && e.actor.includes(adminUser.email)
      ),
      'auditLog must record payment_verified action with admin identity'
    );

    // Duplicate activation must be rejected with HTTP 400
    const duplicateVerifyRes = await invokeHandler({
      method: 'POST',
      url: `/api/admin/licenses/${createdLic.id}`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        action: 'verify_payment',
      },
    });
    assert.equal(duplicateVerifyRes.statusCode, 400, 'Duplicate verify_payment on active license must return 400');

    // Direct activation when paymentReference is missing (null) must succeed without inventing a reference
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
    assert.equal(noRefLic.paymentReference, null, 'License created without paymentReference must have paymentReference = null');
    assert.equal(noRefLic.status, 'pending_payment');

    const noRefVerifyRes = await invokeHandler({
      method: 'POST',
      url: `/api/admin/licenses/${noRefLic.id}`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        action: 'verify_payment',
        paymentReference: noRefLic.paymentReference || undefined,
        amount: noRefLic.amount || undefined,
        currency: noRefLic.currency || undefined,
      },
    });
    assert.equal(noRefVerifyRes.statusCode, 200, 'Activation without paymentReference must succeed without blocking');
    assert.equal(noRefVerifyRes.json?.license?.status, 'active');
    assert.equal(noRefVerifyRes.json?.license?.paymentVerified, true);
    assert.equal(
      noRefVerifyRes.json?.license?.paymentReference,
      null,
      'Backend must NOT invent or fabricate a paymentReference when none exists'
    );
    assert.equal(noRefVerifyRes.json?.license?.amount, '300', 'Existing amount must be preserved');
    assert.ok(noRefVerifyRes.json?.license?.activatedAt, 'activatedAt timestamp must be set');
    assert.ok(
      noRefVerifyRes.json?.license?.auditLog?.some(
        (e: any) => e.action === 'payment_verified' && String(e.details).includes('No payment reference recorded')
      ),
      'auditLog must honestly record verification when no payment reference was recorded'
    );
    console.log('  ✓ Passed direct single-click payment verification & activation checks.');

    // ---------------------------------------------------------
    // 6. VALID, INVALID, COMPLIMENTARY, REVOKED & AUDIT TRAIL
    // ---------------------------------------------------------
    console.log('Test 6: Valid, complimentary, unknown, malformed, revoked license validation & audit history...');

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
    assert.ok(activeValidation.json?.license?.activatedAt, 'activatedAt must be set on first validation');
    assert.ok(activeValidation.json?.license?.lastSeenAt, 'lastSeenAt must be set on validation');
    assert.equal(activeValidation.json?.license?.linkedDevice?.deviceModel, 'Google Pixel 8');

    const firstActivatedAt = activeValidation.json.license.activatedAt;
    const secondValidation = await invokeHandler({
      method: 'POST',
      url: '/api/licenses/validate',
      body: {
        licenseKey: plaintextPaidKey,
      },
    });
    assert.equal(secondValidation.statusCode, 200);
    assert.equal(
      secondValidation.json?.license?.activatedAt,
      firstActivatedAt,
      'Idempotent validation must preserve original activatedAt timestamp'
    );

    // Separate test license for revocation workflow & full audit trail verification
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

    const revokeTestVerifyRes = await invokeHandler({
      method: 'POST',
      url: `/api/admin/licenses/${revokeTestLic.id}`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        action: 'verify_payment',
        paymentReference: 'UTR7777888899',
        amount: '999',
        currency: 'INR',
        verificationNote: 'Verified prior to refund test',
      },
    });
    assert.equal(revokeTestVerifyRes.statusCode, 200);
    assert.equal(revokeTestVerifyRes.json?.license?.status, 'active');

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
      body: {
        licenseKey: revokeTestKey,
      },
    });
    assert.equal(revokedValidation.statusCode, 403, 'Revoked license must fail validation with 403');
    assert.equal(revokedValidation.json?.valid, false);
    assert.equal(revokedValidation.json?.status, 'revoked');
    assert.equal(revokedValidation.json?.code, 'LICENSE_REVOKED');

    // Verify GET /api/admin/licenses/:id returns complete auditLog history (created, payment_verified, revoked)
    const detailRes = await invokeHandler({
      method: 'GET',
      url: `/api/admin/licenses/${revokeTestLic.id}`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(detailRes.statusCode, 200, 'GET /api/admin/licenses/:id must return 200');
    const auditActions = (detailRes.json?.license?.auditLog || []).map((a: any) => a.action);
    assert.deepEqual(
      auditActions,
      ['created', 'payment_verified', 'revoked'],
      'Audit history must record created, payment_verified, and revoked in chronological order'
    );

    const activeDetailRes = await invokeHandler({
      method: 'GET',
      url: `/api/admin/licenses/${createdLic.id}`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(activeDetailRes.statusCode, 200);
    const activeAuditActions = (activeDetailRes.json?.license?.auditLog || []).map((a: any) => a.action);
    assert.deepEqual(
      activeAuditActions,
      ['created', 'payment_verified', 'activated', 'validated'],
      'Active validated license audit history must record created, payment_verified, activated, and validated'
    );

    const compMissingReason = await invokeHandler({
      method: 'POST',
      url: '/api/admin/licenses',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        customerName: 'Reviewer User',
        customerEmail: 'reviewer@example.com',
        isComplimentary: true,
        complimentaryReason: '',
      },
    });
    assert.equal(compMissingReason.statusCode, 400, 'Complimentary license without reason must return 400');

    const compUnauth = await invokeHandler({
      method: 'POST',
      url: '/api/admin/licenses',
      body: {
        customerName: 'Unauth Complimentary',
        customerEmail: 'unauth@example.com',
        isComplimentary: true,
        complimentaryReason: 'Attempt without admin auth',
      },
    });
    assert.equal(compUnauth.statusCode, 401, 'Complimentary license without admin auth must return 401');

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
    assert.ok(
      compValid.json.license.auditLog?.some((e: any) => e.action === 'complimentary_issued'),
      'Complimentary license must record complimentary_issued in auditLog'
    );

    const compValidation = await invokeHandler({
      method: 'POST',
      url: '/api/licenses/validate',
      body: {
        licenseKey: compValid.json.generatedKey,
      },
    });
    assert.equal(compValidation.statusCode, 200, 'Complimentary license must validate immediately');
    assert.equal(compValidation.json?.license?.linkedDevice, null, 'Validation without deviceInfo must keep linkedDevice null');

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
    assert.equal(unknownRes.statusCode, 404);
    assert.equal(unknownRes.json?.code, 'UNKNOWN_KEY');
    console.log('  ✓ Passed valid, complimentary, unknown, malformed, revoked, and audit trail checks.');

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
    // 8. FIRESTORE SECURITY RULES ENFORCEMENT (NO PUBLIC ACCESS)
    // ---------------------------------------------------------
    console.log('Test 8: Direct unauthenticated client SDK access to Cloud Firestore is rejected (PERMISSION_DENIED)...');
    const unauthClientApp = initializeApp(firebaseConfig, 'unauth-attacker-client-test');
    const unauthClientDb = getFirestore(unauthClientApp, firebaseConfig.firestoreDatabaseId);
    try {
      let readBlocked = false;
      try {
        await getDocs(collection(unauthClientDb, 'licenses'));
      } catch (err: any) {
        if (err?.code === 'permission-denied' || String(err?.message).includes('PERMISSION_DENIED')) {
          readBlocked = true;
        }
      }
      assert.equal(readBlocked, true, 'Unauthenticated client read on /licenses must fail with PERMISSION_DENIED');

      let writeBlocked = false;
      try {
        await setDoc(doc(unauthClientDb, 'licenses', 'attacker_doc'), { id: 'attacker_doc' });
      } catch (err: any) {
        if (err?.code === 'permission-denied' || String(err?.message).includes('PERMISSION_DENIED')) {
          writeBlocked = true;
        }
      }
      assert.equal(writeBlocked, true, 'Unauthenticated client write on /licenses must fail with PERMISSION_DENIED');

      let releasesWriteBlocked = false;
      try {
        await setDoc(doc(unauthClientDb, 'releases', 'attacker_rel'), { id: 'attacker_rel' });
      } catch (err: any) {
        if (err?.code === 'permission-denied' || String(err?.message).includes('PERMISSION_DENIED')) {
          releasesWriteBlocked = true;
        }
      }
      assert.equal(releasesWriteBlocked, true, 'Unauthenticated client write on /releases must fail with PERMISSION_DENIED');
    } finally {
      await deleteApp(unauthClientApp);
    }
    console.log('  ✓ Passed Cloud Firestore PERMISSION_DENIED security rules checks.');

    // ---------------------------------------------------------
    // 9. DATABASE FAILURE HANDLING (503 STORAGE_UNAVAILABLE, NO SILENT FALLBACK)
    // ---------------------------------------------------------
    console.log('Test 9: Persistent database failure returns HTTP 503 STORAGE_UNAVAILABLE without false success...');
    setSimulatedStorageFailureForTesting(true);
    try {
      const listFail = await invokeHandler({
        method: 'GET',
        url: '/api/admin/licenses',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.equal(listFail.statusCode, 503, 'GET /api/admin/licenses must return 503 when Firestore fails');
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
      assert.equal(createFail.statusCode, 503, 'POST /api/admin/licenses must return 503 when Firestore fails');
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
      assert.equal(verifyFail.statusCode, 503, 'Verify payment must return 503 when Firestore fails');
      assert.equal(verifyFail.json?.success, false);

      const validateFail = await invokeHandler({
        method: 'POST',
        url: '/api/licenses/validate',
        body: {
          licenseKey: compValid.json.generatedKey,
        },
      });
      assert.equal(validateFail.statusCode, 503, 'POST /api/licenses/validate must return 503 when Firestore fails');
      assert.equal(validateFail.json?.valid, false);
      assert.equal(validateFail.json?.code, 'STORAGE_UNAVAILABLE');
    } finally {
      setSimulatedStorageFailureForTesting(false);
    }
    console.log('  ✓ Passed HTTP 503 database failure handling checks.');

    // ---------------------------------------------------------
    // 10. REGRESSION CHECK ON RELEASES & NOTIFICATIONS
    // ---------------------------------------------------------
    console.log('Test 10: Regression check on Release Management & Notification endpoints...');
    const latestRelRes = await invokeHandler({
      method: 'GET',
      url: '/api/releases/latest',
    });
    assert.equal(latestRelRes.statusCode, 200, 'GET /api/releases/latest must return 200');

    const adminRelRes = await invokeHandler({
      method: 'GET',
      url: '/api/admin/releases',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(adminRelRes.statusCode, 200, 'GET /api/admin/releases must return 200 for authenticated admin');
    assert.equal(adminRelRes.json?.success, true);

    const notifyValidationRes = await invokeHandler({
      method: 'POST',
      url: '/api/admin/notify',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { title: '', message: '' },
    });
    assert.equal(notifyValidationRes.statusCode, 400, 'POST /api/admin/notify with empty fields must return 400');
    console.log('  ✓ Passed Release Management & Notification regression checks.');
  } finally {
    setSimulatedStorageFailureForTesting(false);
    for (const id of createdLicenseIds) {
      if (!protectedIds.has(id)) {
        await deleteLicenseRecord(id);
      }
    }
    resetRateLimits();
  }

  // ---------------------------------------------------------
  // 11. POST-TEST VERIFICATION OF EXISTING RECORD (RC6K)
  // ---------------------------------------------------------
  console.log('Test 11: Verifying existing Firestore record (RC6K) remains 100% untouched...');
  const postTestLicenses = await getAllLicenses();
  assert.equal(
    postTestLicenses.length,
    preTestLicenses.length,
    'Total number of licenses in Firestore after test cleanup must exactly match pre-test count'
  );
  const postAA8D = postTestLicenses.find((l) => l.keyLastFour === 'AA8D' || l.maskedKey.endsWith('AA8D'));
  const postRC6K = postTestLicenses.find((l) => l.keyLastFour === 'RC6K' || l.maskedKey.endsWith('RC6K'));
  assert.equal(postAA8D, undefined, 'Deleted audit-test record ending AA8D must remain absent');
  assert.ok(postRC6K, 'Existing customer record ending RC6K must still exist');
  assert.equal(JSON.stringify(postRC6K), preRC6KJson, 'Existing record ending RC6K must be byte-for-byte unchanged');
  console.log(`  ✓ Verified ${postRC6K.maskedKey} (${postRC6K.status}) is completely unchanged.`);

  console.log('\nALL 11 LICENSE MANAGEMENT & SECURITY HARDENING TEST SUITES PASSED SUCCESSFULLY!');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});

