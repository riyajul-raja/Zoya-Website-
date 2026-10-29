import crypto from 'crypto';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
} from 'firebase/firestore';
import { ensureServerFirestoreAuth } from './firebase';
import type { AdminUser } from './auth';

export class LicenseStorageError extends Error {
  public readonly status = 503;
  public readonly code = 'STORAGE_UNAVAILABLE';

  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'LicenseStorageError';
  }
}

let simulatedStorageFailureForTesting = false;

export function setSimulatedStorageFailureForTesting(shouldFail: boolean): void {
  simulatedStorageFailureForTesting = shouldFail;
}

function assertStorageAvailable(): void {
  if (simulatedStorageFailureForTesting) {
    throw new LicenseStorageError(
      'Persistent license storage (Cloud Firestore) is currently unavailable.'
    );
  }
}

// Unambiguous uppercase alphanumeric alphabet (excludes 0/O, 1/I for readability while remaining A-Z0-9)
export const LICENSE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const LICENSE_KEY_REGEX = /^ZOYA-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

export type LicenseStatus = 'pending_payment' | 'active' | 'revoked';

export type LicenseAuditAction =
  | 'created'
  | 'payment_updated'
  | 'payment_verified'
  | 'complimentary_issued'
  | 'activated'
  | 'validated'
  | 'revoked';

export interface LicenseAuditEntry {
  id: string;
  action: LicenseAuditAction;
  timestamp: string;
  actor: string;
  details: string;
}

export interface LinkedDeviceInfo {
  deviceId?: string | null;
  deviceModel?: string | null;
  androidVersion?: string | null;
  appVersion?: string | null;
  linkedAt: string;
}

export interface LicenseRecord {
  id: string;
  keyHash: string;
  maskedKey: string;
  keyLastFour: string;
  customerName: string;
  customerEmail: string;
  licenseType: 'Lifetime';
  status: LicenseStatus;
  isComplimentary: boolean;
  complimentaryReason: string | null;
  paymentReference: string | null;
  amount: string | null;
  currency: string | null;
  paymentVerified: boolean;
  verifiedBy: { email: string; name: string } | null;
  verifiedAt: string | null;
  createdBy: { email: string; name: string };
  createdAt: string;
  updatedAt: string;
  activatedAt: string | null;
  revokedAt: string | null;
  revokedBy: { email: string; name: string } | null;
  revokeReason: string | null;
  linkedDevice: LinkedDeviceInfo | null;
  lastSeenAt: string | null;
  validationCount: number;
  auditLog: LicenseAuditEntry[];
}

export interface LicenseSummaryStats {
  total: number;
  active: number;
  pendingPayment: number;
  revoked: number;
  complimentary: number;
}

// Simple async mutex to serialize concurrent license writes within a process
let licenseOperationChain: Promise<unknown> = Promise.resolve();
function withLicenseLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = licenseOperationChain.then(fn, fn);
  licenseOperationChain = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

/**
 * Generates a cryptographically secure random license key in the format:
 * ZOYA-XXXX-XXXX-XXXX
 */
export function generateCryptographicLicenseKey(): string {
  const group = () => {
    let chars = '';
    for (let i = 0; i < 4; i++) {
      const idx = crypto.randomInt(0, LICENSE_ALPHABET.length);
      chars += LICENSE_ALPHABET[idx];
    }
    return chars;
  };
  return `ZOYA-${group()}-${group()}-${group()}`;
}

/**
 * Normalizes a license key (trims and uppercases).
 */
export function normalizeLicenseKey(rawKey: unknown): string {
  if (typeof rawKey !== 'string') return '';
  return rawKey.trim().toUpperCase();
}

/**
 * Checks whether a normalized license key matches ZOYA-XXXX-XXXX-XXXX.
 */
export function isValidLicenseKeyFormat(rawKey: unknown): boolean {
  const normalized = normalizeLicenseKey(rawKey);
  return LICENSE_KEY_REGEX.test(normalized);
}

/**
 * Computes a one-way SHA-256 hash of the normalized license key.
 * Plaintext keys are never persisted to storage.
 */
export function hashLicenseKey(rawKey: string): string {
  const normalized = normalizeLicenseKey(rawKey);
  return crypto.createHash('sha256').update(`zoya_license_v1:${normalized}`).digest('hex');
}

/**
 * Produces a masked display key showing only the prefix and final 4 characters:
 * ZOYA-••••-••••-XXXX
 */
export function maskLicenseKey(rawKey: string): { maskedKey: string; keyLastFour: string } {
  const normalized = normalizeLicenseKey(rawKey);
  const parts = normalized.split('-');
  const lastFour = parts.length === 4 && parts[3].length === 4 ? parts[3] : normalized.slice(-4);
  return {
    maskedKey: `ZOYA-••••-••••-${lastFour}`,
    keyLastFour: lastFour,
  };
}

function sanitizeText(raw: unknown, maxLen = 200): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[\x00-\x1F\x7F]/g, ' ')
    .trim()
    .slice(0, maxLen);
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Strips any accidental undefined fields or plaintext key properties before persisting.
 */
function sanitizeRecordForStorage(record: LicenseRecord): LicenseRecord {
  const copy = { ...(record as unknown as Record<string, unknown>) };
  delete copy.licenseKey;
  delete copy.plaintextKey;
  delete copy.rawKey;
  const cleaned = Object.fromEntries(
    Object.entries(copy).filter(([, v]) => v !== undefined)
  ) as unknown as LicenseRecord;
  return cleaned;
}

/**
 * Retrieves all licenses strictly from persistent Cloud Firestore (`licenses` collection).
 * Throws LicenseStorageError (HTTP 503) if Cloud Firestore is unavailable.
 */
export async function getAllLicenses(): Promise<LicenseRecord[]> {
  assertStorageAvailable();

  try {
    const db = await ensureServerFirestoreAuth();
    const snap = await getDocs(collection(db, 'licenses'));
    const all: LicenseRecord[] = [];
    snap.forEach((docSnap) => {
      const data = docSnap.data() as LicenseRecord;
      if (data && data.id && data.keyHash) {
        all.push(sanitizeRecordForStorage(data));
      }
    });
    all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return all;
  } catch (err) {
    if (err instanceof LicenseStorageError) {
      throw err;
    }
    throw new LicenseStorageError(
      'Persistent license storage (Cloud Firestore) is unavailable. Could not retrieve licenses.',
      err
    );
  }
}

/**
 * Retrieves a single license by its ID strictly from Cloud Firestore.
 * Throws LicenseStorageError (HTTP 503) if Cloud Firestore is unavailable.
 */
export async function getLicenseById(id: string): Promise<LicenseRecord | null> {
  const cleanId = sanitizeText(id, 100);
  if (!cleanId) return null;

  assertStorageAvailable();

  try {
    const db = await ensureServerFirestoreAuth();
    const snap = await getDoc(doc(db, 'licenses', cleanId));
    if (snap.exists()) {
      const data = snap.data() as LicenseRecord;
      if (data && data.id) {
        return sanitizeRecordForStorage(data);
      }
    }
    return null;
  } catch (err) {
    if (err instanceof LicenseStorageError) {
      throw err;
    }
    throw new LicenseStorageError(
      'Persistent license storage (Cloud Firestore) is unavailable. Could not read license record.',
      err
    );
  }
}

/**
 * Retrieves a single license by its SHA-256 keyHash strictly from Cloud Firestore.
 */
export async function getLicenseByKeyHash(keyHash: string): Promise<LicenseRecord | null> {
  if (!keyHash) return null;
  const all = await getAllLicenses();
  return all.find((r) => r.keyHash === keyHash) || null;
}

/**
 * Persists a license record strictly to Cloud Firestore (`licenses/{id}`).
 * Guarantees no plaintext license key is ever stored and throws LicenseStorageError (HTTP 503) if Firestore fails.
 */
export async function saveLicenseRecord(record: LicenseRecord): Promise<LicenseRecord> {
  assertStorageAvailable();

  const safeRecord = sanitizeRecordForStorage({
    ...record,
    updatedAt: record.updatedAt || new Date().toISOString(),
  });

  try {
    const db = await ensureServerFirestoreAuth();
    await setDoc(doc(db, 'licenses', safeRecord.id), safeRecord);
    return safeRecord;
  } catch (err) {
    if (err instanceof LicenseStorageError) {
      throw err;
    }
    throw new LicenseStorageError(
      'Persistent license storage (Cloud Firestore) failed to save license record.',
      err
    );
  }
}

/**
 * Deletes a license record by ID strictly from Cloud Firestore (used for test cleanup).
 */
export async function deleteLicenseRecord(id: string): Promise<boolean> {
  const cleanId = sanitizeText(id, 100);
  if (!cleanId) return false;

  assertStorageAvailable();

  try {
    const db = await ensureServerFirestoreAuth();
    await deleteDoc(doc(db, 'licenses', cleanId));
    return true;
  } catch (err) {
    if (err instanceof LicenseStorageError) {
      throw err;
    }
    throw new LicenseStorageError(
      'Persistent license storage (Cloud Firestore) failed to delete license record.',
      err
    );
  }
}

/**
 * Computes summary counts for the License Management overview dashboard.
 */
export function computeLicenseStats(licenses: LicenseRecord[]): LicenseSummaryStats {
  let active = 0;
  let pendingPayment = 0;
  let revoked = 0;
  let complimentary = 0;

  for (const lic of licenses) {
    if (lic.status === 'active') active += 1;
    else if (lic.status === 'pending_payment') pendingPayment += 1;
    else if (lic.status === 'revoked') revoked += 1;

    if (lic.isComplimentary) complimentary += 1;
  }

  return {
    total: licenses.length,
    active,
    pendingPayment,
    revoked,
    complimentary,
  };
}

export interface CreateLicenseInput {
  customerName?: unknown;
  customerEmail?: unknown;
  licenseType?: unknown;
  paymentReference?: unknown;
  amount?: unknown;
  currency?: unknown;
  isComplimentary?: unknown;
  complimentaryReason?: unknown;
}

/**
 * Validates input and generates a new Lifetime license record.
 * - Enforces key uniqueness and handles collisions safely.
 * - Never stores plaintext key; returns `generatedKey` only once in the return value.
 * - Paid licenses ALWAYS start in `pending_payment` status even if a transaction ID is provided.
 * - Complimentary licenses require an explicit `complimentaryReason` and start in `active` status.
 */
export async function createLifetimeLicense(
  input: CreateLicenseInput,
  admin: AdminUser,
  customKeyGenerator?: () => string
): Promise<
  | { success: true; generatedKey: string; license: LicenseRecord }
  | { success: false; status: number; error: string }
> {
  if (!admin || admin.role !== 'admin') {
    return { success: false, status: 401, error: 'Unauthorized administrator session.' };
  }

  if (!input || typeof input !== 'object') {
    return { success: false, status: 400, error: 'Invalid license creation payload.' };
  }

  const customerName = sanitizeText(input.customerName, 120);
  const customerEmail = sanitizeText(input.customerEmail, 160).toLowerCase();
  const licenseTypeRaw =
    input.licenseType !== undefined && input.licenseType !== null
      ? sanitizeText(input.licenseType, 40)
      : 'Lifetime';

  if (!customerName || customerName.length < 2) {
    return {
      success: false,
      status: 400,
      error: 'Customer name is required (minimum 2 characters).',
    };
  }

  if (!customerEmail || !EMAIL_REGEX.test(customerEmail)) {
    return {
      success: false,
      status: 400,
      error: 'A valid customer email address is required.',
    };
  }

  if (licenseTypeRaw !== 'Lifetime') {
    return {
      success: false,
      status: 400,
      error: 'Only Lifetime licenses are supported.',
    };
  }

  const isComplimentary = Boolean(input.isComplimentary === true);
  const complimentaryReason = isComplimentary
    ? sanitizeText(input.complimentaryReason, 300)
    : null;

  if (isComplimentary && (!complimentaryReason || complimentaryReason.length < 3)) {
    return {
      success: false,
      status: 400,
      error: 'A complimentary license requires a recorded reason (minimum 3 characters).',
    };
  }

  const paymentReferenceRaw = sanitizeText(input.paymentReference, 120);
  const paymentReference = paymentReferenceRaw.length > 0 ? paymentReferenceRaw : null;

  let amount: string | null = null;
  if (input.amount !== undefined && input.amount !== null && String(input.amount).trim() !== '') {
    const rawAmount = String(input.amount).trim();
    const numericAmount = Number(rawAmount);
    if (isNaN(numericAmount) || numericAmount < 0 || numericAmount > 1_000_000) {
      return {
        success: false,
        status: 400,
        error: 'Amount must be a valid non-negative number.',
      };
    }
    amount = rawAmount;
  }

  const currencyRaw = sanitizeText(input.currency, 12).toUpperCase();
  const currency = currencyRaw.length > 0 ? currencyRaw : amount ? 'INR' : null;

  return withLicenseLock(async () => {
    try {
      const existingLicenses = await getAllLicenses();
      const existingHashes = new Set(existingLicenses.map((l) => l.keyHash));

      const keyGen = customKeyGenerator || generateCryptographicLicenseKey;
      let rawKey = '';
      let keyHash = '';
      const MAX_ATTEMPTS = 10;

      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const candidate = normalizeLicenseKey(keyGen());
        if (!isValidLicenseKeyFormat(candidate)) {
          continue;
        }
        const candidateHash = hashLicenseKey(candidate);
        if (!existingHashes.has(candidateHash)) {
          rawKey = candidate;
          keyHash = candidateHash;
          break;
        }
      }

      if (!rawKey || !keyHash) {
        return {
          success: false,
          status: 500,
          error: 'Failed to generate a unique cryptographic license key after multiple attempts.',
        };
      }

      const { maskedKey, keyLastFour } = maskLicenseKey(rawKey);
      const nowIso = new Date().toISOString();
      const licenseId = `lic_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      const actorLabel = `${admin.name} <${admin.email}>`;

      // Payment rule: A transaction ID entered at creation is NOT proof of payment.
      // Paid licenses ALWAYS remain in 'pending_payment' until explicit manual verification.
      const initialStatus: LicenseStatus = isComplimentary ? 'active' : 'pending_payment';

      const auditLog: LicenseAuditEntry[] = [
        {
          id: `aud_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
          action: 'created',
          timestamp: nowIso,
          actor: actorLabel,
          details: isComplimentary
            ? `Created Lifetime complimentary license (${maskedKey}) for ${customerName} (${customerEmail}).`
            : `Created Lifetime license (${maskedKey}) for ${customerName} (${customerEmail}) in Pending Payment status.${
                paymentReference ? ` Recorded unverified payment reference: ${paymentReference}.` : ''
              }`,
        },
      ];

      if (isComplimentary && complimentaryReason) {
        auditLog.push({
          id: `aud_${Date.now()}_${crypto.randomBytes(3).toString('hex')}_comp`,
          action: 'complimentary_issued',
          timestamp: nowIso,
          actor: actorLabel,
          details: `Activated as admin-authorized complimentary license. Reason: ${complimentaryReason}`,
        });
      }

      const record: LicenseRecord = {
        id: licenseId,
        keyHash,
        maskedKey,
        keyLastFour,
        customerName,
        customerEmail,
        licenseType: 'Lifetime',
        status: initialStatus,
        isComplimentary,
        complimentaryReason,
        paymentReference,
        amount,
        currency,
        paymentVerified: false,
        verifiedBy: null,
        verifiedAt: null,
        createdBy: {
          email: admin.email,
          name: admin.name,
        },
        createdAt: nowIso,
        updatedAt: nowIso,
        activatedAt: null,
        revokedAt: null,
        revokedBy: null,
        revokeReason: null,
        linkedDevice: null,
        lastSeenAt: null,
        validationCount: 0,
        auditLog,
      };

      const saved = await saveLicenseRecord(record);

      return {
        success: true,
        generatedKey: rawKey,
        license: saved,
      };
    } catch (err) {
      if (err instanceof LicenseStorageError) {
        return {
          success: false,
          status: 503,
          error: err.message,
        };
      }
      throw err;
    }
  });
}

export interface VerifyPaymentInput {
  paymentReference?: unknown;
  amount?: unknown;
  currency?: unknown;
  verificationNote?: unknown;
}

/**
 * Explicitly marks a license's payment as verified by an authenticated administrator
 * after independent transaction verification, activating the license.
 */
export async function verifyLicensePayment(
  licenseId: string,
  input: VerifyPaymentInput,
  admin: AdminUser
): Promise<
  | { success: true; license: LicenseRecord }
  | { success: false; status: number; error: string }
> {
  if (!admin || admin.role !== 'admin') {
    return { success: false, status: 401, error: 'Unauthorized administrator session.' };
  }

  return withLicenseLock(async () => {
    try {
      const existing = await getLicenseById(licenseId);
      if (!existing) {
        return { success: false, status: 404, error: 'License record not found.' };
      }

      if (existing.status === 'revoked') {
        return {
          success: false,
          status: 400,
          error: 'Cannot verify payment or activate a revoked license.',
        };
      }

      if (existing.status === 'active' || existing.paymentVerified) {
        return {
          success: false,
          status: 400,
          error: 'Payment for this license has already been verified.',
        };
      }

      const providedRef = sanitizeText(input?.paymentReference, 120);
      const finalPaymentRef = providedRef || existing.paymentReference || null;

      let finalAmount = existing.amount;
      if (
        input?.amount !== undefined &&
        input?.amount !== null &&
        String(input.amount).trim() !== ''
      ) {
        const rawAmount = String(input.amount).trim();
        const num = Number(rawAmount);
        if (isNaN(num) || num < 0 || num > 1_000_000) {
          return {
            success: false,
            status: 400,
            error: 'Amount must be a valid non-negative number.',
          };
        }
        finalAmount = rawAmount;
      }

      const providedCurrency = sanitizeText(input?.currency, 12).toUpperCase();
      const finalCurrency = providedCurrency || existing.currency || (finalAmount ? 'INR' : null);
      const verificationNote = sanitizeText(input?.verificationNote, 240);

      const nowIso = new Date().toISOString();
      const actorLabel = `${admin.name} <${admin.email}>`;
      const refDetail = finalPaymentRef
        ? `Ref: ${finalPaymentRef}`
        : 'No payment reference recorded';
      const amountDetail = finalAmount
        ? `, Amount: ${finalCurrency || ''} ${finalAmount}`.trim()
        : '';

      const auditEntry: LicenseAuditEntry = {
        id: `aud_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        action: 'payment_verified',
        timestamp: nowIso,
        actor: actorLabel,
        details: `Payment independently verified by ${admin.name} (${refDetail}${amountDetail}). Status changed to Active.${
          verificationNote ? ` Note: ${verificationNote}` : ''
        }`,
      };

      const updated: LicenseRecord = {
        ...existing,
        paymentReference: finalPaymentRef,
        amount: finalAmount,
        currency: finalCurrency,
        paymentVerified: true,
        verifiedBy: {
          email: admin.email,
          name: admin.name,
        },
        verifiedAt: nowIso,
        activatedAt: existing.activatedAt || nowIso,
        status: 'active',
        updatedAt: nowIso,
        auditLog: [...(existing.auditLog || []), auditEntry],
      };

      const saved = await saveLicenseRecord(updated);
      return { success: true, license: saved };
    } catch (err) {
      if (err instanceof LicenseStorageError) {
        return {
          success: false,
          status: 503,
          error: err.message,
        };
      }
      throw err;
    }
  });
}

export interface RevokeLicenseInput {
  reason?: unknown;
}

/**
 * Revokes a license so it permanently fails future validation requests.
 */
export async function revokeLicense(
  licenseId: string,
  input: RevokeLicenseInput,
  admin: AdminUser
): Promise<
  | { success: true; license: LicenseRecord }
  | { success: false; status: number; error: string }
> {
  if (!admin || admin.role !== 'admin') {
    return { success: false, status: 401, error: 'Unauthorized administrator session.' };
  }

  return withLicenseLock(async () => {
    try {
      const existing = await getLicenseById(licenseId);
      if (!existing) {
        return { success: false, status: 404, error: 'License record not found.' };
      }

      if (existing.status === 'revoked') {
        return {
          success: false,
          status: 400,
          error: 'This license is already revoked.',
        };
      }

      const reason = sanitizeText(input?.reason, 300) || 'Revoked by administrator';
      const nowIso = new Date().toISOString();
      const actorLabel = `${admin.name} <${admin.email}>`;

      const auditEntry: LicenseAuditEntry = {
        id: `aud_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        action: 'revoked',
        timestamp: nowIso,
        actor: actorLabel,
        details: `License revoked by ${admin.name}. Reason: ${reason}`,
      };

      const updated: LicenseRecord = {
        ...existing,
        status: 'revoked',
        revokedAt: nowIso,
        revokedBy: {
          email: admin.email,
          name: admin.name,
        },
        revokeReason: reason,
        updatedAt: nowIso,
        auditLog: [...(existing.auditLog || []), auditEntry],
      };

      const saved = await saveLicenseRecord(updated);
      return { success: true, license: saved };
    } catch (err) {
      if (err instanceof LicenseStorageError) {
        return {
          success: false,
          status: 503,
          error: err.message,
        };
      }
      throw err;
    }
  });
}

export interface AndroidValidationRequest {
  licenseKey?: unknown;
  deviceInfo?: {
    deviceId?: unknown;
    deviceModel?: unknown;
    androidVersion?: unknown;
    appVersion?: unknown;
  } | null;
}

export interface AndroidValidationResponse {
  valid: boolean;
  status: 'active' | 'pending_payment' | 'revoked' | 'not_found' | 'malformed' | 'storage_error';
  code:
    | 'LICENSE_VALID'
    | 'MALFORMED_KEY'
    | 'UNKNOWN_KEY'
    | 'PAYMENT_UNVERIFIED'
    | 'LICENSE_REVOKED'
    | 'STORAGE_UNAVAILABLE';
  httpStatus: number;
  error?: string;
  revokedAt?: string | null;
  license?: {
    id: string;
    maskedKey: string;
    licenseType: 'Lifetime';
    status: 'active';
    customerName: string;
    activatedAt: string;
    lastSeenAt: string;
    linkedDevice: LinkedDeviceInfo | null;
  };
}

/**
 * Validates a license key for the Zoya Android app.
 * - Rejects malformed keys (400)
 * - Rejects unknown keys (404)
 * - Rejects revoked keys (403)
 * - Rejects pending-payment / unverified keys (403)
 * - Returns HTTP 503 if persistent storage is unavailable
 * - Approves active verified/complimentary keys (200) ONLY after persistent Cloud Firestore write succeeds.
 */
export async function validateLicenseForAndroid(
  payload: AndroidValidationRequest
): Promise<AndroidValidationResponse> {
  if (!payload || typeof payload !== 'object') {
    return {
      valid: false,
      status: 'malformed',
      code: 'MALFORMED_KEY',
      httpStatus: 400,
      error: 'Request payload is required.',
    };
  }

  const normalizedKey = normalizeLicenseKey(payload.licenseKey);
  if (!normalizedKey || !isValidLicenseKeyFormat(normalizedKey)) {
    return {
      valid: false,
      status: 'malformed',
      code: 'MALFORMED_KEY',
      httpStatus: 400,
      error: 'License key format is invalid. Expected ZOYA-XXXX-XXXX-XXXX.',
    };
  }

  const keyHash = hashLicenseKey(normalizedKey);

  return withLicenseLock(async () => {
    try {
      const existing = await getLicenseByKeyHash(keyHash);
      if (!existing) {
        return {
          valid: false,
          status: 'not_found',
          code: 'UNKNOWN_KEY',
          httpStatus: 404,
          error: 'License key not found.',
        };
      }

      if (existing.status === 'revoked') {
        return {
          valid: false,
          status: 'revoked',
          code: 'LICENSE_REVOKED',
          httpStatus: 403,
          revokedAt: existing.revokedAt,
          error: 'This license has been revoked and is no longer valid.',
        };
      }

      const isAuthorizedActive =
        existing.status === 'active' && (existing.paymentVerified || existing.isComplimentary);

      if (!isAuthorizedActive) {
        return {
          valid: false,
          status: 'pending_payment',
          code: 'PAYMENT_UNVERIFIED',
          httpStatus: 403,
          error:
            'This license is pending manual payment verification by an administrator and cannot be activated yet.',
        };
      }

      const nowIso = new Date().toISOString();
      const isFirstActivation =
        (existing.validationCount || 0) === 0 &&
        !(existing.auditLog || []).some((e) => e.action === 'activated');
      const activatedAt = existing.activatedAt || nowIso;

      // Only populate linkedDevice when actual device metadata is sent by the client
      let linkedDevice = existing.linkedDevice || null;
      if (payload.deviceInfo && typeof payload.deviceInfo === 'object') {
        const deviceId = sanitizeText(payload.deviceInfo.deviceId, 120) || null;
        const deviceModel = sanitizeText(payload.deviceInfo.deviceModel, 120) || null;
        const androidVersion = sanitizeText(payload.deviceInfo.androidVersion, 60) || null;
        const appVersion = sanitizeText(payload.deviceInfo.appVersion, 60) || null;

        if (deviceId || deviceModel || androidVersion || appVersion) {
          linkedDevice = {
            deviceId: deviceId ?? linkedDevice?.deviceId ?? null,
            deviceModel: deviceModel ?? linkedDevice?.deviceModel ?? null,
            androidVersion: androidVersion ?? linkedDevice?.androidVersion ?? null,
            appVersion: appVersion ?? linkedDevice?.appVersion ?? null,
            linkedAt: linkedDevice?.linkedAt || nowIso,
          };
        }
      }

      const updatedAuditLog = [...(existing.auditLog || [])];
      if (isFirstActivation) {
        updatedAuditLog.push({
          id: `aud_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
          action: 'activated',
          timestamp: nowIso,
          actor: 'Zoya Android Client',
          details: linkedDevice?.deviceModel
            ? `License activated on device (${linkedDevice.deviceModel}).`
            : 'License activated via validation endpoint.',
        });
      } else if (updatedAuditLog.length < 50) {
        updatedAuditLog.push({
          id: `aud_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
          action: 'validated',
          timestamp: nowIso,
          actor: 'Zoya Android Client',
          details: linkedDevice?.deviceModel
            ? `License validated from device (${linkedDevice.deviceModel}).`
            : 'License validated.',
        });
      }

      const updated: LicenseRecord = {
        ...existing,
        activatedAt,
        lastSeenAt: nowIso,
        linkedDevice,
        validationCount: (existing.validationCount || 0) + 1,
        updatedAt: nowIso,
        auditLog: updatedAuditLog,
      };

      const saved = await saveLicenseRecord(updated);

      return {
        valid: true,
        status: 'active',
        code: 'LICENSE_VALID',
        httpStatus: 200,
        license: {
          id: saved.id,
          maskedKey: saved.maskedKey,
          licenseType: 'Lifetime',
          status: 'active',
          customerName: saved.customerName,
          activatedAt: saved.activatedAt || nowIso,
          lastSeenAt: saved.lastSeenAt || nowIso,
          linkedDevice: saved.linkedDevice,
        },
      };
    } catch (err) {
      if (err instanceof LicenseStorageError) {
        return {
          valid: false,
          status: 'storage_error',
          code: 'STORAGE_UNAVAILABLE',
          httpStatus: 503,
          error: err.message,
        };
      }
      throw err;
    }
  });
}
