import crypto from 'crypto';
import {
  serverGetCollectionDocs,
  serverGetDocumentById,
  serverQueryDocumentsEq,
  serverSetDocumentById,
  serverDeleteDocumentById,
  serverRunTransaction,
} from './firebase';
import { getJwtSecret, type AdminUser } from './auth';
import {
  sendLicenseDeviceFcmNotification,
  type LicenseFcmNotificationResult,
} from './fcm';

export class LicenseStorageError extends Error {
  public readonly status = 503;
  public readonly code = 'STORAGE_UNAVAILABLE';

  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'LicenseStorageError';
  }
}

let simulatedStorageFailureForTesting = false;
let useInMemoryStoreForTesting = false;
const inMemoryTestStore = new Map<string, LicenseRecord>();

export function setSimulatedStorageFailureForTesting(shouldFail: boolean): void {
  simulatedStorageFailureForTesting = shouldFail;
}

export function setUseInMemoryStoreForTesting(enabled: boolean): void {
  useInMemoryStoreForTesting = enabled;
  if (!enabled) {
    inMemoryTestStore.clear();
  }
}

function assertStorageAvailable(): void {
  if (simulatedStorageFailureForTesting) {
    throw new LicenseStorageError(
      'Persistent license storage (Cloud Firestore) is currently unavailable.'
    );
  }
}

// Unambiguous uppercase alphanumeric alphabet (excludes 0/O, 1/I for readability)
export const LICENSE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const LICENSE_KEY_REGEX = /^ZOYA-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

export type LicenseStatus = 'unactivated' | 'active' | 'revoked';

export type LicenseAuditAction =
  | 'created'
  | 'activated'
  | 'validated'
  | 'device_rebound'
  | 'device_unbound'
  | 'revoked';

export interface LicenseAuditEntry {
  id: string;
  action: LicenseAuditAction;
  timestamp: string;
  actor: string;
  details: string;
}

export interface LinkedDeviceInfo {
  deviceId: string;
  deviceModel: string;
  androidVersion?: string | null;
  appVersion?: string | null;
  linkedAt: string;
}

export interface LicenseRecord {
  id: string;
  keyHash: string;
  maskedKey: string;
  keyLastFour: string;
  encryptedKey?: string | null;
  customerName: string;
  customerEmail: string;
  userSub?: string | null;
  licenseType: 'Lifetime';
  status: LicenseStatus;
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
  bindingVersion: number;
  lastUnboundAt: string | null;
  lastUserUnboundAt?: string | null;
  unbindCount: number;
  lastUnboundDeviceId?: string | null;
  deviceFcmToken?: string | null;
  deviceFcmTokenUpdatedAt?: string | null;
  auditLog: LicenseAuditEntry[];
}

export const USER_UNBIND_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface LicenseSummaryStats {
  total: number;
  activated: number;
  unactivated: number;
  revoked: number;
}

// Process-level async mutex to serialize concurrent license operations
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
 * Validates a client-supplied device identifier server-side.
 * Never trusts unvalidated client device IDs.
 */
export function isValidDeviceId(id: unknown): boolean {
  if (typeof id !== 'string') return false;
  if (id !== id.trim()) return false;
  const trimmed = id.trim();
  if (trimmed.length < 8 || trimmed.length > 120) return false;
  const lower = trimmed.toLowerCase();
  if (
    lower === 'unknown' ||
    lower === 'null' ||
    lower === 'undefined' ||
    lower === 'none' ||
    lower === '12345678' ||
    /^0+$/.test(lower)
  ) {
    return false;
  }
  return /^[a-zA-Z0-9_\-.:]+$/.test(trimmed);
}

/**
 * Validates an Android FCM registration token server-side.
 * Rejects empty, whitespace-containing, control-character, or abnormally short/long values.
 */
export function isValidFcmRegistrationToken(token: unknown): boolean {
  if (typeof token !== 'string') return false;
  const trimmed = token.trim();
  if (trimmed !== token) return false;
  if (trimmed.length < 20 || trimmed.length > 4096) return false;
  if (/[\s\x00-\x1F\x7F]/.test(trimmed)) return false;
  return true;
}

/**
 * Strips sensitive server-only fields (such as device FCM registration tokens) before
 * returning a LicenseRecord in any API, Admin Portal, or public response.
 */
export function sanitizeLicenseForResponse(record: LicenseRecord): LicenseRecord {
  const copy = { ...(record as unknown as Record<string, unknown>) };
  delete copy.deviceFcmToken;
  delete copy.deviceFcmTokenUpdatedAt;
  delete copy.licenseKey;
  delete copy.plaintextKey;
  delete copy.rawKey;
  return copy as unknown as LicenseRecord;
}

/**
 * Validates client-supplied device metadata.
 */
export function validateClientDeviceInfo(deviceInfo: unknown): {
  valid: boolean;
  error?: string;
  data?: {
    deviceId: string;
    deviceModel: string;
    androidVersion: string | null;
    appVersion: string | null;
  };
} {
  if (!deviceInfo || typeof deviceInfo !== 'object') {
    return {
      valid: false,
      error: 'Device information is required to activate or validate a lifetime license on this phone.',
    };
  }

  const raw = deviceInfo as Record<string, unknown>;
  const deviceId = typeof raw.deviceId === 'string' ? raw.deviceId.trim() : '';
  const deviceModel = typeof raw.deviceModel === 'string' ? raw.deviceModel.trim().slice(0, 120) : '';

  if (!isValidDeviceId(deviceId)) {
    return {
      valid: false,
      error: 'A valid Android device identifier (minimum 8 alphanumeric characters) is required for device binding.',
    };
  }

  const cleanModel = deviceModel.length >= 2 ? deviceModel : 'Android Device';
  const androidVersion = typeof raw.androidVersion === 'string' ? raw.androidVersion.trim().slice(0, 60) : null;
  const appVersion = typeof raw.appVersion === 'string' ? raw.appVersion.trim().slice(0, 60) : null;

  return {
    valid: true,
    data: {
      deviceId,
      deviceModel: cleanModel,
      androidVersion,
      appVersion,
    },
  };
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

export class LicenseEncryptionConfigurationError extends Error {
  public readonly status = 500;
  public readonly code = 'ENCRYPTION_NOT_CONFIGURED';

  constructor(
    message = 'LICENSE_KEY_ENCRYPTION_SECRET is not configured or shorter than 32 bytes. Server fails closed per security policy.'
  ) {
    super(message);
    this.name = 'LicenseEncryptionConfigurationError';
  }
}

/**
 * Retrieves the explicitly configured AES-256-GCM authenticated encryption secret.
 * STRICT SECURITY REQUIREMENT:
 * - Must be explicitly configured via process.env.LICENSE_KEY_ENCRYPTION_SECRET.
 * - Must be at least 32 cryptographically secure bytes (>= 32 chars).
 * - Zero deterministic, zero hardcoded, and zero fallback secrets.
 * - If the secret is missing or invalid, fails closed by throwing LicenseEncryptionConfigurationError.
 */
export function getLicenseEncryptionSecret(): string {
  const envSecret = process.env.LICENSE_KEY_ENCRYPTION_SECRET;
  if (!envSecret || typeof envSecret !== 'string') {
    throw new LicenseEncryptionConfigurationError(
      'LICENSE_KEY_ENCRYPTION_SECRET is not configured. Server fails closed per security policy.'
    );
  }

  const trimmed = envSecret.trim();
  if (Buffer.byteLength(trimmed, 'utf-8') < 32) {
    throw new LicenseEncryptionConfigurationError(
      'LICENSE_KEY_ENCRYPTION_SECRET is too short (must be at least 32 cryptographically random bytes). Server fails closed per security policy.'
    );
  }

  return trimmed;
}

export function getLicenseKeyEncryptionBuffer(): Buffer {
  const secret = getLicenseEncryptionSecret();
  return crypto.createHash('sha256').update(`zoya_aes_256_gcm:${secret}`).digest();
}

/**
 * Encrypts a plaintext license key using AES-256-GCM authenticated encryption.
 * Ciphertext format: "ivHex:authTagHex:ciphertextHex"
 * Additional Authenticated Data (AAD) binds the ciphertext to the licenseId.
 */
export function encryptLicenseKey(plaintextKey: string, licenseId: string): string {
  if (!plaintextKey || typeof plaintextKey !== 'string') {
    throw new Error('Cannot encrypt empty license key.');
  }
  const key = getLicenseKeyEncryptionBuffer();
  // 12-byte IV standard for AES-GCM
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`zoya_lic_aad:${licenseId}`, 'utf-8'));

  let ciphertext = cipher.update(plaintextKey.trim(), 'utf-8', 'hex');
  ciphertext += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  const ivHex = iv.toString('hex');

  return `${ivHex}:${authTag}:${ciphertext}`;
}

/**
 * Decrypts an AES-256-GCM encrypted license key.
 * Verifies authenticity with Auth Tag and AAD.
 * Throws an Error if tampered, wrong key, or corrupt.
 */
export function decryptLicenseKey(encryptedPayload: string, licenseId: string): string {
  if (!encryptedPayload || typeof encryptedPayload !== 'string') {
    throw new Error('Encrypted license payload is required.');
  }

  const parts = encryptedPayload.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted license key payload format. Expected iv:authTag:ciphertext.');
  }

  const [ivHex, authTagHex, ciphertextHex] = parts;
  if (!ivHex || !authTagHex || !ciphertextHex) {
    throw new Error('Encrypted license key payload is missing required cryptographic components.');
  }

  if (!/^[0-9a-fA-F]{24}$/.test(ivHex)) {
    throw new Error('Invalid IV format for AES-256-GCM. Expected 12-byte (24-char) hex string.');
  }
  if (!/^[0-9a-fA-F]{32}$/.test(authTagHex)) {
    throw new Error('Invalid authentication tag format for AES-256-GCM. Expected 16-byte (32-char) hex string.');
  }
  if (!/^[0-9a-fA-F]+$/.test(ciphertextHex) || ciphertextHex.length % 2 !== 0) {
    throw new Error('Invalid ciphertext hex encoding for AES-256-GCM.');
  }

  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const key = getLicenseKeyEncryptionBuffer();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(Buffer.from(`zoya_lic_aad:${licenseId}`, 'utf-8'));
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertextHex, 'hex', 'utf-8');
  decrypted += decipher.final('utf-8');

  const normalized = normalizeLicenseKey(decrypted);
  if (!isValidLicenseKeyFormat(normalized)) {
    throw new Error('Decrypted license key does not match valid ZOYA-XXXX-XXXX-XXXX format.');
  }

  return normalized;
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
 * Strips any accidental undefined fields, plaintext keys, or legacy payment fields before persisting.
 */
function sanitizeRecordForStorage(record: LicenseRecord): LicenseRecord {
  const copy = { ...(record as unknown as Record<string, unknown>) };
  delete copy.licenseKey;
  delete copy.plaintextKey;
  delete copy.rawKey;
  delete copy.paymentReference;
  delete copy.paymentVerified;
  delete copy.amount;
  delete copy.currency;
  delete copy.verifiedBy;
  delete copy.verifiedAt;
  delete copy.isComplimentary;
  delete copy.complimentaryReason;

  const cleaned = Object.fromEntries(
    Object.entries(copy).filter(([, v]) => v !== undefined)
  ) as unknown as LicenseRecord;
  return cleaned;
}

const CACHE_TTL_MS = 60_000; // 60 seconds TTL

interface CacheEntry<T> {
  data: T;
  cachedAt: number;
}

const idToLicenseCache = new Map<string, CacheEntry<LicenseRecord>>();
const keyHashToLicenseCache = new Map<string, CacheEntry<LicenseRecord>>();
let allLicensesCache: CacheEntry<LicenseRecord[]> | null = null;

function cacheLicenseRecord(record: LicenseRecord): void {
  const now = Date.now();
  idToLicenseCache.set(record.id, { data: record, cachedAt: now });
  if (record.keyHash) {
    keyHashToLicenseCache.set(record.keyHash, { data: record, cachedAt: now });
  }
}

export function clearLicenseInMemoryCache(): void {
  idToLicenseCache.clear();
  keyHashToLicenseCache.clear();
  allLicensesCache = null;
}

/**
 * Normalizes legacy records on read so they match current LicenseRecord schema.
 */
function normalizeRecordOnRead(raw: Record<string, any>): LicenseRecord {
  const statusRaw = String(raw.status || '').trim();
  let status: LicenseStatus = 'unactivated';
  if (statusRaw === 'active') {
    status = 'active';
  } else if (statusRaw === 'revoked') {
    status = 'revoked';
  } else {
    status = 'unactivated';
  }

  let linkedDevice: LinkedDeviceInfo | null = null;
  if (raw.linkedDevice && typeof raw.linkedDevice === 'object' && raw.linkedDevice.deviceId) {
    linkedDevice = {
      deviceId: String(raw.linkedDevice.deviceId).trim(),
      deviceModel: String(raw.linkedDevice.deviceModel || 'Android Device').trim(),
      androidVersion: raw.linkedDevice.androidVersion ? String(raw.linkedDevice.androidVersion).trim() : null,
      appVersion: raw.linkedDevice.appVersion ? String(raw.linkedDevice.appVersion).trim() : null,
      linkedAt: String(raw.linkedDevice.linkedAt || raw.activatedAt || raw.createdAt || new Date().toISOString()),
    };
  }

  const record: LicenseRecord = {
    id: String(raw.id || ''),
    keyHash: String(raw.keyHash || ''),
    maskedKey: String(raw.maskedKey || ''),
    keyLastFour: String(raw.keyLastFour || raw.maskedKey?.slice(-4) || ''),
    encryptedKey: raw.encryptedKey && typeof raw.encryptedKey === 'string' ? raw.encryptedKey.trim() : null,
    customerName: String(raw.customerName || ''),
    customerEmail: String(raw.customerEmail || ''),
    userSub: raw.userSub && typeof raw.userSub === 'string' ? raw.userSub.trim() : null,
    licenseType: 'Lifetime',
    status,
    createdBy: raw.createdBy && typeof raw.createdBy === 'object'
      ? { email: String(raw.createdBy.email || ''), name: String(raw.createdBy.name || '') }
      : { email: 'admin@zoya.ai', name: 'Administrator' },
    createdAt: String(raw.createdAt || new Date().toISOString()),
    updatedAt: String(raw.updatedAt || new Date().toISOString()),
    activatedAt: raw.activatedAt ? String(raw.activatedAt) : null,
    revokedAt: raw.revokedAt ? String(raw.revokedAt) : null,
    revokedBy: raw.revokedBy && typeof raw.revokedBy === 'object'
      ? { email: String(raw.revokedBy.email || ''), name: String(raw.revokedBy.name || '') }
      : null,
    revokeReason: raw.revokeReason ? String(raw.revokeReason) : null,
    linkedDevice,
    lastSeenAt: raw.lastSeenAt ? String(raw.lastSeenAt) : null,
    validationCount: Number(raw.validationCount) || (status === 'active' ? 1 : 0),
    bindingVersion:
      typeof raw.bindingVersion === 'number' && Number.isInteger(raw.bindingVersion) && raw.bindingVersion >= 1
        ? raw.bindingVersion
        : Math.max(
            1,
            (typeof raw.unbindCount === 'number' && Number.isInteger(raw.unbindCount) && raw.unbindCount >= 0
              ? raw.unbindCount
              : 0) + 1
          ),
    lastUnboundAt: raw.lastUnboundAt ? String(raw.lastUnboundAt) : null,
    lastUserUnboundAt: raw.lastUserUnboundAt ? String(raw.lastUserUnboundAt) : null,
    unbindCount:
      typeof raw.unbindCount === 'number' && Number.isInteger(raw.unbindCount) && raw.unbindCount >= 0
        ? raw.unbindCount
        : 0,
    lastUnboundDeviceId:
      raw.lastUnboundDeviceId && typeof raw.lastUnboundDeviceId === 'string'
        ? raw.lastUnboundDeviceId.trim()
        : null,
    deviceFcmToken:
      raw.deviceFcmToken && typeof raw.deviceFcmToken === 'string'
        ? raw.deviceFcmToken.trim()
        : null,
    deviceFcmTokenUpdatedAt:
      raw.deviceFcmTokenUpdatedAt && typeof raw.deviceFcmTokenUpdatedAt === 'string'
        ? raw.deviceFcmTokenUpdatedAt.trim()
        : null,
    auditLog: Array.isArray(raw.auditLog) ? raw.auditLog : [],
  };

  return sanitizeRecordForStorage(record);
}

function invalidateLicenseCaches(licenseId?: string | null, keyHash?: string | null): void {
  if (licenseId) {
    idToLicenseCache.delete(licenseId);
  }
  if (keyHash) {
    keyHashToLicenseCache.delete(keyHash);
  }
  allLicensesCache = null;
}

export function getUserUnbindCooldownStatus(
  record: Pick<LicenseRecord, 'lastUserUnboundAt'>,
  nowMs = Date.now()
): {
  active: boolean;
  nextUnbindAvailableAt: string | null;
  remainingMs: number;
} {
  if (!record.lastUserUnboundAt) {
    return { active: false, nextUnbindAvailableAt: null, remainingMs: 0 };
  }
  const parsedMs = Date.parse(record.lastUserUnboundAt);
  if (!Number.isFinite(parsedMs)) {
    return { active: false, nextUnbindAvailableAt: null, remainingMs: 0 };
  }
  const nextAvailableMs = parsedMs + USER_UNBIND_COOLDOWN_MS;
  if (nowMs < nextAvailableMs) {
    return {
      active: true,
      nextUnbindAvailableAt: new Date(nextAvailableMs).toISOString(),
      remainingMs: nextAvailableMs - nowMs,
    };
  }
  return { active: false, nextUnbindAvailableAt: null, remainingMs: 0 };
}

/**
 * Retrieves all licenses strictly from persistent Cloud Firestore (`licenses` collection).
 * Throws LicenseStorageError (HTTP 503) if Cloud Firestore is unavailable.
 */
export async function getAllLicenses(): Promise<LicenseRecord[]> {
  if (useInMemoryStoreForTesting) {
    assertStorageAvailable();
    const all = Array.from(inMemoryTestStore.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    return all;
  }

  if (allLicensesCache && Date.now() - allLicensesCache.cachedAt < CACHE_TTL_MS) {
    return allLicensesCache.data;
  }

  assertStorageAvailable();

  try {
    const docs = await serverGetCollectionDocs('licenses');
    const all: LicenseRecord[] = [];
    for (const docSnap of docs) {
      const data = docSnap.data;
      if (data && data.id && data.keyHash) {
        const normalized = normalizeRecordOnRead(data);
        all.push(normalized);
        cacheLicenseRecord(normalized);
      }
    }
    all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    allLicensesCache = { data: all, cachedAt: Date.now() };
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

  if (useInMemoryStoreForTesting) {
    assertStorageAvailable();
    return inMemoryTestStore.get(cleanId) || null;
  }

  const cached = idToLicenseCache.get(cleanId);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.data;
  }

  assertStorageAvailable();

  try {
    const snap = await serverGetDocumentById('licenses', cleanId);
    if (snap.exists && snap.data) {
      const normalized = normalizeRecordOnRead(snap.data);
      cacheLicenseRecord(normalized);
      return normalized;
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
 * Retrieves a single license by its SHA-256 keyHash using an indexed query (1 document read).
 * Supports bypassing the short-lived in-memory cache so activation and verification always read
 * directly from persistent Firestore storage.
 */
export async function getLicenseByKeyHash(
  keyHash: string,
  options?: { bypassCache?: boolean }
): Promise<LicenseRecord | null> {
  if (!keyHash) return null;

  if (useInMemoryStoreForTesting) {
    assertStorageAvailable();
    for (const record of inMemoryTestStore.values()) {
      if (record.keyHash === keyHash) return record;
    }
    return null;
  }

  if (!options?.bypassCache) {
    const cached = keyHashToLicenseCache.get(keyHash);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      return cached.data;
    }
  }

  assertStorageAvailable();

  try {
    const docs = await serverQueryDocumentsEq('licenses', 'keyHash', keyHash, 1);
    if (docs.length > 0) {
      const normalized = normalizeRecordOnRead(docs[0].data);
      cacheLicenseRecord(normalized);
      return normalized;
    }
    return null;
  } catch (err) {
    if (err instanceof LicenseStorageError) {
      throw err;
    }
    throw new LicenseStorageError(
      'Persistent license storage (Cloud Firestore) is unavailable. Could not query license record by keyHash.',
      err
    );
  }
}

/**
 * Persists a license record strictly to Cloud Firestore (`licenses/{id}`).
 * Guarantees no plaintext license key or payment fields are ever stored.
 */
export async function saveLicenseRecord(record: LicenseRecord): Promise<LicenseRecord> {
  assertStorageAvailable();

  const safeRecord = sanitizeRecordForStorage({
    ...record,
    updatedAt: record.updatedAt || new Date().toISOString(),
  });

  if (useInMemoryStoreForTesting) {
    inMemoryTestStore.set(safeRecord.id, safeRecord);
    cacheLicenseRecord(safeRecord);
    allLicensesCache = null;
    return safeRecord;
  }

  try {
    await serverSetDocumentById('licenses', safeRecord.id, safeRecord);
    cacheLicenseRecord(safeRecord);
    allLicensesCache = null;
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

  if (useInMemoryStoreForTesting) {
    const existing = inMemoryTestStore.get(cleanId);
    inMemoryTestStore.delete(cleanId);
    idToLicenseCache.delete(cleanId);
    if (existing?.keyHash) {
      keyHashToLicenseCache.delete(existing.keyHash);
    }
    allLicensesCache = null;
    return true;
  }

  try {
    const existing = await getLicenseById(cleanId);
    await serverDeleteDocumentById('licenses', cleanId);

    idToLicenseCache.delete(cleanId);
    if (existing?.keyHash) {
      keyHashToLicenseCache.delete(existing.keyHash);
    }
    allLicensesCache = null;
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
 * Computes genuine summary counts for the License Management overview dashboard.
 */
export function computeLicenseStats(licenses: LicenseRecord[]): LicenseSummaryStats {
  let activated = 0;
  let unactivated = 0;
  let revoked = 0;

  for (const lic of licenses) {
    if (lic.status === 'active') {
      activated += 1;
    } else if (lic.status === 'revoked') {
      revoked += 1;
    } else {
      unactivated += 1;
    }
  }

  return {
    total: licenses.length,
    activated,
    unactivated,
    revoked,
  };
}

export interface CreateLicenseInput {
  customerName?: unknown;
  customerEmail?: unknown;
  licenseType?: unknown;
}

/**
 * Generates a unique Lifetime license key for a customer.
 * - Initially ALWAYS in `unactivated` status.
 * - Generation and activation remain strictly separate operations.
 * - Never stores plaintext key in database.
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

      const auditLog: LicenseAuditEntry[] = [
        {
          id: `aud_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
          action: 'created',
          timestamp: nowIso,
          actor: actorLabel,
          details: `Created Lifetime license (${maskedKey}) for ${customerName} (${customerEmail}) in Unactivated status.`,
        },
      ];

      let encryptedKey: string | null = null;
      try {
        encryptedKey = encryptLicenseKey(rawKey, licenseId);
      } catch (encErr) {
        if (encErr instanceof LicenseEncryptionConfigurationError) {
          return {
            success: false,
            status: 500,
            error:
              'License creation failed: LICENSE_KEY_ENCRYPTION_SECRET is not configured on the server. Server fails closed per security policy.',
          };
        }
        throw encErr;
      }

      const record: LicenseRecord = {
        id: licenseId,
        keyHash,
        maskedKey,
        keyLastFour,
        encryptedKey,
        customerName,
        customerEmail,
        licenseType: 'Lifetime',
        status: 'unactivated',
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
        bindingVersion: 1,
        lastUnboundAt: null,
        lastUserUnboundAt: null,
        unbindCount: 0,
        lastUnboundDeviceId: null,
        deviceFcmToken: null,
        deviceFcmTokenUpdatedAt: null,
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

export interface RevealLicenseKeyResult {
  success: boolean;
  status: number;
  licenseKey?: string;
  error?: string;
  code?:
    | 'KEY_NOT_RECOVERABLE'
    | 'DECRYPTION_FAILED'
    | 'LICENSE_NOT_FOUND'
    | 'UNAUTHORIZED'
    | 'CONFIGURATION_ERROR';
}

/**
 * Authenticated admin-only action to decrypt and retrieve the complete original license key.
 * If the license is a legacy SHA-256-only record (encryptedKey missing), returns KEY_NOT_RECOVERABLE.
 * Never exposes the key or encryption secret in logs.
 */
export async function revealLicenseKeyByAdmin(
  licenseId: string,
  admin: AdminUser
): Promise<RevealLicenseKeyResult> {
  if (!admin || admin.role !== 'admin') {
    return {
      success: false,
      status: 401,
      code: 'UNAUTHORIZED',
      error: 'Unauthorized administrator session.',
    };
  }

  const cleanId = sanitizeText(licenseId, 100);
  if (!cleanId) {
    return {
      success: false,
      status: 400,
      error: 'License ID is required.',
    };
  }

  try {
    const license = await getLicenseById(cleanId);
    if (!license) {
      return {
        success: false,
        status: 404,
        code: 'LICENSE_NOT_FOUND',
        error: 'License record not found.',
      };
    }

    if (!license.encryptedKey) {
      return {
        success: false,
        status: 404,
        code: 'KEY_NOT_RECOVERABLE',
        error:
          'This license key was generated prior to reversible encryption. Per security architecture, the original key cannot be recovered.',
      };
    }

    try {
      const decryptedKey = decryptLicenseKey(license.encryptedKey, license.id);
      if (license.keyHash && hashLicenseKey(decryptedKey) !== license.keyHash) {
        return {
          success: false,
          status: 500,
          code: 'DECRYPTION_FAILED',
          error: 'License key decryption failed: decrypted key does not match stored license integrity hash.',
        };
      }
      return {
        success: true,
        status: 200,
        licenseKey: decryptedKey,
      };
    } catch (decErr) {
      if (decErr instanceof LicenseEncryptionConfigurationError) {
        return {
          success: false,
          status: 500,
          code: 'CONFIGURATION_ERROR',
          error: decErr.message,
        };
      }
      const rawReason = decErr instanceof Error ? decErr.message : '';
      const isAuthMismatch =
        rawReason.includes('unable to authenticate data') ||
        rawReason.includes('Unsupported state');
      return {
        success: false,
        status: 500,
        code: 'DECRYPTION_FAILED',
        error: isAuthMismatch
          ? 'License key decryption failed: AES-256-GCM authentication tag verification failed. Ensure LICENSE_KEY_ENCRYPTION_SECRET matches the secret used when this license was encrypted.'
          : 'Failed to decrypt license key. Ciphertext may be corrupted, tampered, or encrypted with a different secret.',
      };
    }
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
}

export interface AdminRebindLicenseInput {
  reason?: unknown;
}

/**
 * Unbinds / rebinds an existing activated license to allow activation on a new phone.
 * - Executes inside an atomic Firestore transaction (`serverRunTransaction`) to prevent race conditions.
 * - Strictly requires authorized administrator action and a reason.
 * - Admin unbind bypasses the 24-hour user cooldown.
 * - Never revokes or deletes the license; preserves ownership, key, and append-only audit history.
 * - Records `lastUnboundDeviceId` so the previously bound phone cannot silently reclaim the license.
 */
export async function rebindLicenseDeviceByAdmin(
  licenseId: string,
  input: AdminRebindLicenseInput,
  admin: AdminUser
): Promise<
  | { success: true; license: LicenseRecord; fcmNotification?: LicenseFcmNotificationResult }
  | { success: false; status: number; error: string; code?: string }
> {
  if (!admin || admin.role !== 'admin') {
    return { success: false, status: 401, code: 'UNAUTHORIZED', error: 'Unauthorized administrator session.' };
  }

  const cleanId = sanitizeText(licenseId, 100);
  if (!cleanId) {
    return { success: false, status: 400, error: 'License ID is required.' };
  }

  const reason = sanitizeText(input?.reason, 300);
  if (!reason || reason.length < 3) {
    return {
      success: false,
      status: 400,
      error: 'Administrator authorization reason is required to unbind/rebind a device (minimum 3 characters).',
    };
  }

  return withLicenseLock(async () => {
    try {
      assertStorageAvailable();

      const txResult = await serverRunTransaction(async (tx) => {
        const snap = await tx.get('licenses', cleanId);
        if (!snap.exists || !snap.data) {
          return { type: 'not_found' as const };
        }

        const current = normalizeRecordOnRead(snap.data);
        if (current.status === 'revoked') {
          return { type: 'revoked' as const };
        }

        if (current.status !== 'active' || !current.linkedDevice || !current.linkedDevice.deviceId) {
          return { type: 'not_bound' as const };
        }

        const prevDevice = current.linkedDevice;
        const capturedDeviceId = prevDevice.deviceId;
        const capturedFcmToken = current.deviceFcmToken || null;
        const capturedBindingVersion = current.bindingVersion >= 1 ? current.bindingVersion : 1;
        const eventId = `evt_${crypto.randomUUID()}`;
        const prevDeviceLabel = `${prevDevice.deviceModel} (${prevDevice.deviceId})`;
        const nowIso = new Date().toISOString();
        const actorLabel = `${admin.name} <${admin.email}>`;
        const nextBindingVersion = capturedBindingVersion + 1;
        const nextUnbindCount = (current.unbindCount || 0) + 1;

        const auditEntry: LicenseAuditEntry = {
          id: `aud_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
          action: 'device_rebound',
          timestamp: nowIso,
          actor: actorLabel,
          details: `Device unbound/rebound by ${admin.name} (binding v${nextBindingVersion}). Released from ${prevDeviceLabel}. Reason: ${reason}`,
        };

        const updated: LicenseRecord = sanitizeRecordForStorage({
          ...current,
          status: 'unactivated',
          linkedDevice: null,
          bindingVersion: nextBindingVersion,
          lastUnboundAt: nowIso,
          unbindCount: nextUnbindCount,
          lastUnboundDeviceId: prevDevice.deviceId,
          deviceFcmToken: null,
          deviceFcmTokenUpdatedAt: null,
          updatedAt: nowIso,
          auditLog: [...(current.auditLog || []), auditEntry],
        });

        tx.set('licenses', current.id, updated);
        return {
          type: 'success' as const,
          record: updated,
          capturedDeviceId,
          capturedFcmToken,
          capturedBindingVersion,
          eventId,
        };
      });

      if (txResult.type === 'not_found') {
        return { success: false, status: 404, code: 'LICENSE_NOT_FOUND', error: 'License record not found.' };
      }

      if (txResult.type === 'revoked') {
        return { success: false, status: 400, code: 'LICENSE_REVOKED', error: 'Cannot unbind or rebind a revoked license.' };
      }

      if (txResult.type === 'not_bound') {
        return {
          success: false,
          status: 400,
          code: 'LICENSE_NOT_BOUND',
          error: 'This license does not currently have an active bound device to unbind.',
        };
      }

      const saved = txResult.record;
      invalidateLicenseCaches(saved.id, saved.keyHash);

      // Dispatch device-specific FCM notification strictly AFTER transaction commits.
      // Carries the exact deviceId and bindingVersion of the unbound binding (never the newer version).
      // FCM failure must never roll back or fail a committed unbind.
      let fcmNotification: LicenseFcmNotificationResult | undefined;
      try {
        fcmNotification = await sendLicenseDeviceFcmNotification({
          fcmToken: txResult.capturedFcmToken,
          deviceId: txResult.capturedDeviceId,
          eventId: txResult.eventId,
          eventType: 'license_unbound',
          licenseId: saved.id,
          maskedKey: saved.maskedKey,
          bindingVersion: txResult.capturedBindingVersion,
          initiatedBy: 'admin',
          timestamp: saved.lastUnboundAt || saved.updatedAt,
        });
      } catch {
        // Non-fatal: unbind has already committed in Firestore
      }

      return {
        success: true,
        license: sanitizeLicenseForResponse(saved),
        fcmNotification,
      };
    } catch (err) {
      if (err instanceof LicenseStorageError) {
        return { success: false, status: 503, code: 'STORAGE_UNAVAILABLE', error: err.message };
      }
      throw new LicenseStorageError(
        'Persistent license storage (Cloud Firestore) failed while unbinding license device.',
        err
      );
    }
  });
}

export interface RevokeLicenseInput {
  reason?: unknown;
}

/**
 * Revokes a license atomically so it permanently fails future activation/verification/validation requests.
 * - Executes inside an atomic Firestore transaction (`serverRunTransaction`).
 * - Captures and clears any linked device FCM token inside the transaction.
 * - Sends a device-specific `license_revoked` FCM notification strictly AFTER the transaction commits.
 * - FCM delivery failure never rolls back or fails a committed revocation.
 */
export async function revokeLicense(
  licenseId: string,
  input: RevokeLicenseInput,
  admin: AdminUser
): Promise<
  | { success: true; license: LicenseRecord; fcmNotification?: LicenseFcmNotificationResult }
  | { success: false; status: number; error: string }
> {
  if (!admin || admin.role !== 'admin') {
    return { success: false, status: 401, error: 'Unauthorized administrator session.' };
  }

  const cleanId = sanitizeText(licenseId, 100);
  if (!cleanId) {
    return { success: false, status: 400, error: 'License ID is required.' };
  }

  return withLicenseLock(async () => {
    try {
      assertStorageAvailable();

      const txResult = await serverRunTransaction(async (tx) => {
        const snap = await tx.get('licenses', cleanId);
        if (!snap.exists || !snap.data) {
          return { type: 'not_found' as const };
        }

        const current = normalizeRecordOnRead(snap.data);
        if (current.status === 'revoked') {
          return { type: 'already_revoked' as const };
        }

        const reason = sanitizeText(input?.reason, 300) || 'Revoked by administrator';
        const nowIso = new Date().toISOString();
        const actorLabel = `${admin.name} <${admin.email}>`;
        const hasActiveBoundDevice = Boolean(
          current.status === 'active' && current.linkedDevice && current.linkedDevice.deviceId
        );
        const capturedDeviceId = hasActiveBoundDevice ? current.linkedDevice!.deviceId : null;
        const capturedFcmToken = hasActiveBoundDevice ? current.deviceFcmToken || null : null;
        const capturedBindingVersion = current.bindingVersion >= 1 ? current.bindingVersion : 1;
        const nextBindingVersion = capturedBindingVersion + 1;
        const eventId = `evt_${crypto.randomUUID()}`;

        const auditEntry: LicenseAuditEntry = {
          id: `aud_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
          action: 'revoked',
          timestamp: nowIso,
          actor: actorLabel,
          details: `License revoked by ${admin.name}. Reason: ${reason}`,
        };

        const updated: LicenseRecord = sanitizeRecordForStorage({
          ...current,
          status: 'revoked',
          bindingVersion: nextBindingVersion,
          revokedAt: nowIso,
          revokedBy: {
            email: admin.email,
            name: admin.name,
          },
          revokeReason: reason,
          deviceFcmToken: null,
          deviceFcmTokenUpdatedAt: null,
          updatedAt: nowIso,
          auditLog: [...(current.auditLog || []), auditEntry],
        });

        tx.set('licenses', current.id, updated);
        return {
          type: 'success' as const,
          record: updated,
          capturedDeviceId,
          capturedFcmToken,
          capturedBindingVersion,
          eventId,
        };
      });

      if (txResult.type === 'not_found') {
        return { success: false, status: 404, error: 'License record not found.' };
      }

      if (txResult.type === 'already_revoked') {
        return {
          success: false,
          status: 400,
          error: 'This license is already revoked.',
        };
      }

      const saved = txResult.record;
      invalidateLicenseCaches(saved.id, saved.keyHash);

      // Dispatch device-specific `license_revoked` FCM notification strictly AFTER transaction commits.
      // Carries the exact deviceId and bindingVersion of the revoked active binding.
      // FCM failure must never roll back or fail a committed revocation.
      let fcmNotification: LicenseFcmNotificationResult | undefined;
      try {
        fcmNotification = await sendLicenseDeviceFcmNotification({
          fcmToken: txResult.capturedFcmToken,
          deviceId: txResult.capturedDeviceId,
          eventId: txResult.eventId,
          eventType: 'license_revoked',
          licenseId: saved.id,
          maskedKey: saved.maskedKey,
          bindingVersion: txResult.capturedBindingVersion,
          initiatedBy: 'admin',
          timestamp: saved.revokedAt || saved.updatedAt,
        });
      } catch {
        // Non-fatal: revocation has already committed in Firestore
      }

      return {
        success: true,
        license: sanitizeLicenseForResponse(saved),
        fcmNotification,
      };
    } catch (err) {
      if (err instanceof LicenseStorageError) {
        return {
          success: false,
          status: 503,
          error: err.message,
        };
      }
      throw new LicenseStorageError(
        'Persistent license storage (Cloud Firestore) failed while revoking license.',
        err
      );
    }
  });
}

export function generateSignedEntitlementToken(payload: {
  licenseId: string;
  keyHash: string;
  maskedKey: string;
  activatedAt: string;
  deviceId?: string | null;
  bindingVersion?: number;
}): string {
  const safeBindingVersion =
    typeof payload.bindingVersion === 'number' &&
    Number.isInteger(payload.bindingVersion) &&
    payload.bindingVersion >= 1
      ? payload.bindingVersion
      : 1;
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const nowSec = Math.floor(Date.now() / 1000);
  const expSec = nowSec + 30 * 24 * 60 * 60; // 30-day offline grace validity
  const body = Buffer.from(
    JSON.stringify({
      id: payload.licenseId,
      kh: payload.keyHash,
      mk: payload.maskedKey,
      act: payload.activatedAt,
      did: payload.deviceId || null,
      bv: safeBindingVersion,
      bindingVersion: safeBindingVersion,
      iat: nowSec,
      exp: expSec,
    })
  ).toString('base64url');

  const signature = crypto
    .createHmac('sha256', getJwtSecret())
    .update(`${header}.${body}`)
    .digest('base64url');

  return `${header}.${body}.${signature}`;
}

export function verifySignedEntitlementToken(
  token: string | null | undefined,
  expectedKeyHash: string,
  expectedDeviceId?: string | null,
  expectedBindingVersion?: number | null
): { valid: boolean; payload?: any; reason?: string } {
  if (!token || typeof token !== 'string') {
    return { valid: false, reason: 'Entitlement token missing or invalid.' };
  }

  const parts = token.trim().split('.');
  if (parts.length !== 3) {
    return { valid: false, reason: 'Entitlement token malformed.' };
  }

  const [header, body, signature] = parts;
  const expectedSig = crypto
    .createHmac('sha256', getJwtSecret())
    .update(`${header}.${body}`)
    .digest('base64url');

  const sigBuf = Buffer.from(signature, 'utf-8');
  const expBuf = Buffer.from(expectedSig, 'utf-8');
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return { valid: false, reason: 'Entitlement token signature mismatch or untrusted.' };
  }

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8'));
    if (!payload || typeof payload !== 'object') {
      return { valid: false, reason: 'Entitlement token payload invalid.' };
    }

    if (payload.kh !== expectedKeyHash) {
      return { valid: false, reason: 'Entitlement token key mismatch.' };
    }

    const nowSec = Math.floor(Date.now() / 1000);
    if (!payload.exp || payload.exp < nowSec) {
      return { valid: false, reason: 'Entitlement token grace period expired.' };
    }

    // Preserve one-phone device binding during offline grace validation
    if (expectedDeviceId && payload.did && payload.did !== expectedDeviceId) {
      return { valid: false, reason: 'Entitlement token was issued to a different Android device.' };
    }

    if (
      typeof expectedBindingVersion === 'number' &&
      Number.isInteger(expectedBindingVersion) &&
      expectedBindingVersion >= 1
    ) {
      const tokenBv =
        typeof payload.bindingVersion === 'number'
          ? payload.bindingVersion
          : typeof payload.bv === 'number'
            ? payload.bv
            : null;
      if (tokenBv !== null && tokenBv !== expectedBindingVersion) {
        return { valid: false, reason: 'Entitlement token belongs to a superseded license binding version.' };
      }
    }

    return { valid: true, payload };
  } catch {
    return { valid: false, reason: 'Entitlement token parse error.' };
  }
}

export interface AndroidValidationRequest {
  licenseKey?: unknown;
  entitlementToken?: unknown;
  deviceInfo?: {
    deviceId?: unknown;
    deviceModel?: unknown;
    androidVersion?: unknown;
    appVersion?: unknown;
  } | null;
}

export interface AndroidValidationResponse {
  valid: boolean;
  status: 'active' | 'unactivated' | 'revoked' | 'device_mismatch' | 'not_found' | 'malformed' | 'storage_error';
  code:
    | 'LICENSE_VALID'
    | 'LICENSE_NOT_ACTIVATED'
    | 'MALFORMED_KEY'
    | 'UNKNOWN_KEY'
    | 'INVALID_DEVICE_INFO'
    | 'DEVICE_MISMATCH'
    | 'LICENSE_REVOKED'
    | 'STORAGE_UNAVAILABLE';
  httpStatus: number;
  error?: string;
  revokedAt?: string | null;
  entitlementToken?: string;
  isOfflineGrace?: boolean;
  license?: {
    id: string;
    maskedKey: string;
    licenseType: 'Lifetime';
    status: 'active';
    customerName: string;
    activatedAt: string;
    lastSeenAt: string;
    bindingVersion: number;
    linkedDevice: LinkedDeviceInfo | null;
  };
}

/**
 * Validates and activates a license key for the Zoya Android app.
 * - Rejects malformed keys (400)
 * - Rejects unknown keys (404)
 * - Rejects revoked keys (403)
 * - Requires valid server-side device information (400)
 * - On first activation: atomically binds the license to the phone (200)
 * - On repeated validation from same phone: idempotent success (200)
 * - On attempt from a different phone: rejects with DEVICE_MISMATCH (403)
 * - During Firestore outages: allows 30-day offline grace validation if previously verified HMAC token matches same phone.
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
  const rawToken = typeof payload.entitlementToken === 'string' ? payload.entitlementToken.trim() : '';

  // Validate server-side device info
  const deviceValidation = validateClientDeviceInfo(payload.deviceInfo);
  if (!deviceValidation.valid || !deviceValidation.data) {
    return {
      valid: false,
      status: 'malformed',
      code: 'INVALID_DEVICE_INFO',
      httpStatus: 400,
      error: deviceValidation.error || 'A valid Android device identifier is required.',
    };
  }

  const clientDevice = deviceValidation.data;

  return withLicenseLock(async () => {
    try {
      const existing = await getLicenseByKeyHash(keyHash, { bypassCache: true });
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
          error: 'This lifetime license has been revoked and is no longer valid.',
        };
      }

      // Execute atomic transaction for device binding and validation
      const txResult = await serverRunTransaction(async (tx) => {
        const snap = await tx.get('licenses', existing.id);
        if (!snap.exists || !snap.data) {
          throw new Error('License document missing during transaction.');
        }

        const current = normalizeRecordOnRead(snap.data);
        if (current.status === 'revoked') {
          return {
            type: 'revoked' as const,
            revokedAt: current.revokedAt,
          };
        }

        const nowIso = new Date().toISOString();

        // Check one-phone binding
        if (current.linkedDevice && current.linkedDevice.deviceId) {
          // Already bound to a device
          if (current.linkedDevice.deviceId !== clientDevice.deviceId) {
            // DIFFERENT PHONE ATTEMPT!
            return {
              type: 'mismatch' as const,
              boundModel: current.linkedDevice.deviceModel,
            };
          }

          // SAME PHONE: Idempotent validation
          const updatedAudit = [...(current.auditLog || [])];
          if (updatedAudit.length < 50) {
            updatedAudit.push({
              id: `aud_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
              action: 'validated',
              timestamp: nowIso,
              actor: 'Zoya Android Phone',
              details: `Validated on bound device (${clientDevice.deviceModel}).`,
            });
          }

          const updated: LicenseRecord = {
            ...current,
            status: 'active',
            lastSeenAt: nowIso,
            validationCount: (current.validationCount || 0) + 1,
            linkedDevice: {
              ...current.linkedDevice,
              deviceModel: clientDevice.deviceModel || current.linkedDevice.deviceModel,
              androidVersion: clientDevice.androidVersion || current.linkedDevice.androidVersion,
              appVersion: clientDevice.appVersion || current.linkedDevice.appVersion,
            },
            updatedAt: nowIso,
            auditLog: updatedAudit,
          };

          tx.set('licenses', current.id, updated);
          return { type: 'success' as const, record: updated, isFirstActivation: false };
        }

        // Prevent a recently unbound phone from silently reclaiming the license on background /validate calls
        if (current.lastUnboundDeviceId && current.lastUnboundDeviceId === clientDevice.deviceId) {
          return {
            type: 'previous_device_unbound' as const,
          };
        }

        // FIRST-TIME ACTIVATION (or new phone activation after unbind): Atomic binding to this phone
        const newLinkedDevice: LinkedDeviceInfo = {
          deviceId: clientDevice.deviceId,
          deviceModel: clientDevice.deviceModel,
          androidVersion: clientDevice.androidVersion,
          appVersion: clientDevice.appVersion,
          linkedAt: nowIso,
        };

        const updatedAudit = [...(current.auditLog || [])];
        updatedAudit.push({
          id: `aud_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
          action: 'activated',
          timestamp: nowIso,
          actor: 'Zoya Android Phone',
          details: `Lifetime license activated and permanently bound to ${clientDevice.deviceModel} (${clientDevice.deviceId}).`,
        });

        const updated: LicenseRecord = {
          ...current,
          status: 'active',
          bindingVersion: current.bindingVersion >= 1 ? current.bindingVersion : 1,
          activatedAt: current.activatedAt || nowIso,
          lastSeenAt: nowIso,
          validationCount: 1,
          linkedDevice: newLinkedDevice,
          lastUnboundDeviceId: null,
          deviceFcmToken: null,
          deviceFcmTokenUpdatedAt: null,
          updatedAt: nowIso,
          auditLog: updatedAudit,
        };

        tx.set('licenses', current.id, updated);
        return { type: 'success' as const, record: updated, isFirstActivation: true };
      });

      if (txResult.type === 'revoked') {
        return {
          valid: false,
          status: 'revoked',
          code: 'LICENSE_REVOKED',
          httpStatus: 403,
          revokedAt: txResult.revokedAt,
          error: 'This lifetime license has been revoked.',
        };
      }

      if (txResult.type === 'previous_device_unbound') {
        return {
          valid: false,
          status: 'device_mismatch',
          code: 'DEVICE_MISMATCH',
          httpStatus: 403,
          error:
            'This device was unbound from the license and cannot automatically reclaim it. Activate the license on your new Android device first.',
        };
      }

      if (txResult.type === 'mismatch') {
        return {
          valid: false,
          status: 'device_mismatch',
          code: 'DEVICE_MISMATCH',
          httpStatus: 403,
          error: `This lifetime license is already bound to another phone (${txResult.boundModel}). One-phone lifetime license policy is strictly enforced.`,
        };
      }

      const saved = txResult.record;
      cacheLicenseRecord(saved);
      allLicensesCache = null;

      const entitlementToken = generateSignedEntitlementToken({
        licenseId: saved.id,
        keyHash: saved.keyHash,
        maskedKey: saved.maskedKey,
        activatedAt: saved.activatedAt || new Date().toISOString(),
        deviceId: saved.linkedDevice?.deviceId || clientDevice.deviceId,
        bindingVersion: saved.bindingVersion,
      });

      return {
        valid: true,
        status: 'active',
        code: 'LICENSE_VALID',
        httpStatus: 200,
        entitlementToken,
        license: buildSafeAndroidLicenseView(saved),
      };
    } catch (err) {
      if (err instanceof LicenseStorageError) {
        // Offline grace validation for previously activated phone submitting valid signed token
        const tokenVerification = verifySignedEntitlementToken(rawToken, keyHash, clientDevice.deviceId);
        if (tokenVerification.valid && tokenVerification.payload) {
          const graceBindingVersion =
            typeof tokenVerification.payload.bindingVersion === 'number' &&
            Number.isInteger(tokenVerification.payload.bindingVersion) &&
            tokenVerification.payload.bindingVersion >= 1
              ? tokenVerification.payload.bindingVersion
              : typeof tokenVerification.payload.bv === 'number' &&
                  Number.isInteger(tokenVerification.payload.bv) &&
                  tokenVerification.payload.bv >= 1
                ? tokenVerification.payload.bv
                : 1;
          return {
            valid: true,
            status: 'active',
            code: 'LICENSE_VALID',
            httpStatus: 200,
            isOfflineGrace: true,
            entitlementToken: rawToken,
            error:
              'Server storage is temporarily unavailable. License validated via cryptographic offline grace token on bound device.',
            license: {
              id: tokenVerification.payload.id || 'grace_id',
              maskedKey: tokenVerification.payload.mk || maskLicenseKey(normalizedKey).maskedKey,
              licenseType: 'Lifetime',
              status: 'active',
              customerName: 'Lifetime Subscriber',
              activatedAt: tokenVerification.payload.act || new Date().toISOString(),
              lastSeenAt: new Date().toISOString(),
              bindingVersion: graceBindingVersion,
              linkedDevice: {
                deviceId: clientDevice.deviceId,
                deviceModel: clientDevice.deviceModel,
                linkedAt: tokenVerification.payload.act || new Date().toISOString(),
              },
            },
          };
        }

        if (tokenVerification.reason?.includes('different Android device')) {
          return {
            valid: false,
            status: 'device_mismatch',
            code: 'DEVICE_MISMATCH',
            httpStatus: 403,
            error: 'Offline grace token was issued to a different Android device.',
          };
        }

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

function buildSafeAndroidLicenseView(record: LicenseRecord): NonNullable<AndroidValidationResponse['license']> {
  return {
    id: record.id,
    maskedKey: record.maskedKey,
    licenseType: 'Lifetime',
    status: 'active',
    customerName: record.customerName,
    activatedAt: record.activatedAt || record.updatedAt || new Date().toISOString(),
    lastSeenAt: record.lastSeenAt || record.activatedAt || new Date().toISOString(),
    bindingVersion:
      typeof record.bindingVersion === 'number' &&
      Number.isInteger(record.bindingVersion) &&
      record.bindingVersion >= 1
        ? record.bindingVersion
        : 1,
    linkedDevice: record.linkedDevice,
  };
}

/**
 * STAGE 2 — FAST ACTIVE (POST /api/licenses/activate)
 * Handles initial license activation and reactivation after app data clear / reinstall.
 * - Reads directly from persistent Firestore storage (bypasses in-memory cache as source of truth).
 * - First activation: atomically binds the license to the device via transaction and persists `active`.
 * - Repeated activation on the SAME bound device while already `active`: returns 200 + entitlementToken
 *   WITHOUT repeating Firestore writes or running unnecessary activation transactions.
 * - Rejects revoked licenses and device mismatches cleanly; never silently rebinds an activated key.
 */
export async function activateLicenseForAndroid(
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
  const rawToken = typeof payload.entitlementToken === 'string' ? payload.entitlementToken.trim() : '';

  const deviceValidation = validateClientDeviceInfo(payload.deviceInfo);
  if (!deviceValidation.valid || !deviceValidation.data) {
    return {
      valid: false,
      status: 'malformed',
      code: 'INVALID_DEVICE_INFO',
      httpStatus: 400,
      error: deviceValidation.error || 'A valid Android device identifier is required.',
    };
  }

  const clientDevice = deviceValidation.data;

  return withLicenseLock(async () => {
    try {
      // Read directly from persistent Firestore storage (never trust stale in-memory cache)
      const existing = await getLicenseByKeyHash(keyHash, { bypassCache: true });
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
          error: 'This lifetime license has been revoked and is no longer valid.',
        };
      }

      // Fast Active fast-path: already active and bound to a device
      if (existing.status === 'active' && existing.linkedDevice && existing.linkedDevice.deviceId) {
        if (existing.linkedDevice.deviceId !== clientDevice.deviceId) {
          return {
            valid: false,
            status: 'device_mismatch',
            code: 'DEVICE_MISMATCH',
            httpStatus: 403,
            error: `This lifetime license is already bound to another phone (${existing.linkedDevice.deviceModel}). One-phone lifetime license policy is strictly enforced.`,
          };
        }

        // Same device & already active: return success WITHOUT repeating Firestore writes or transactions
        const entitlementToken = generateSignedEntitlementToken({
          licenseId: existing.id,
          keyHash: existing.keyHash,
          maskedKey: existing.maskedKey,
          activatedAt: existing.activatedAt || existing.updatedAt || new Date().toISOString(),
          deviceId: existing.linkedDevice.deviceId,
          bindingVersion: existing.bindingVersion,
        });

        return {
          valid: true,
          status: 'active',
          code: 'LICENSE_VALID',
          httpStatus: 200,
          entitlementToken,
          license: buildSafeAndroidLicenseView(existing),
        };
      }

      // Prevent the previously unbound device from silently reclaiming the license before a new device binds
      if (
        !existing.linkedDevice &&
        existing.lastUnboundDeviceId &&
        existing.lastUnboundDeviceId === clientDevice.deviceId
      ) {
        return {
          valid: false,
          status: 'device_mismatch',
          code: 'DEVICE_MISMATCH',
          httpStatus: 403,
          error:
            'This device was unbound from the license and cannot automatically reclaim it. Activate the license on your new Android device first.',
        };
      }

      // First activation (or reactivation on a new phone after unbind): atomically bind device
      const txResult = await serverRunTransaction(async (tx) => {
        const snap = await tx.get('licenses', existing.id);
        if (!snap.exists || !snap.data) {
          throw new Error('License document missing during transaction.');
        }

        const current = normalizeRecordOnRead(snap.data);
        if (current.status === 'revoked') {
          return {
            type: 'revoked' as const,
            revokedAt: current.revokedAt,
          };
        }

        if (current.linkedDevice && current.linkedDevice.deviceId) {
          if (current.linkedDevice.deviceId !== clientDevice.deviceId) {
            return {
              type: 'mismatch' as const,
              boundModel: current.linkedDevice.deviceModel,
            };
          }

          if (current.status === 'active') {
            // Concurrent request already activated on the same device: no redundant write needed
            return { type: 'already_active' as const, record: current };
          }
        }

        if (current.lastUnboundDeviceId && current.lastUnboundDeviceId === clientDevice.deviceId) {
          return {
            type: 'previous_device_unbound' as const,
          };
        }

        const nowIso = new Date().toISOString();
        const newLinkedDevice: LinkedDeviceInfo = {
          deviceId: clientDevice.deviceId,
          deviceModel: clientDevice.deviceModel,
          androidVersion: clientDevice.androidVersion,
          appVersion: clientDevice.appVersion,
          linkedAt: nowIso,
        };

        const updatedAudit = [...(current.auditLog || [])];
        updatedAudit.push({
          id: `aud_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
          action: 'activated',
          timestamp: nowIso,
          actor: 'Zoya Android Phone',
          details: `Lifetime license activated and permanently bound to ${clientDevice.deviceModel} (${clientDevice.deviceId}).`,
        });

        const updated: LicenseRecord = {
          ...current,
          status: 'active',
          bindingVersion: current.bindingVersion >= 1 ? current.bindingVersion : 1,
          activatedAt: current.activatedAt || nowIso,
          lastSeenAt: nowIso,
          validationCount: 1,
          linkedDevice: newLinkedDevice,
          lastUnboundDeviceId: null,
          deviceFcmToken: null,
          deviceFcmTokenUpdatedAt: null,
          updatedAt: nowIso,
          auditLog: updatedAudit,
        };

        tx.set('licenses', current.id, updated);
        return { type: 'activated' as const, record: updated };
      });

      if (txResult.type === 'revoked') {
        return {
          valid: false,
          status: 'revoked',
          code: 'LICENSE_REVOKED',
          httpStatus: 403,
          revokedAt: txResult.revokedAt,
          error: 'This lifetime license has been revoked.',
        };
      }

      if (txResult.type === 'previous_device_unbound') {
        return {
          valid: false,
          status: 'device_mismatch',
          code: 'DEVICE_MISMATCH',
          httpStatus: 403,
          error:
            'This device was unbound from the license and cannot automatically reclaim it. Activate the license on your new Android device first.',
        };
      }

      if (txResult.type === 'mismatch') {
        return {
          valid: false,
          status: 'device_mismatch',
          code: 'DEVICE_MISMATCH',
          httpStatus: 403,
          error: `This lifetime license is already bound to another phone (${txResult.boundModel}). One-phone lifetime license policy is strictly enforced.`,
        };
      }

      const saved = txResult.record;
      cacheLicenseRecord(saved);
      allLicensesCache = null;

      const entitlementToken = generateSignedEntitlementToken({
        licenseId: saved.id,
        keyHash: saved.keyHash,
        maskedKey: saved.maskedKey,
        activatedAt: saved.activatedAt || new Date().toISOString(),
        deviceId: saved.linkedDevice?.deviceId || clientDevice.deviceId,
        bindingVersion: saved.bindingVersion,
      });

      return {
        valid: true,
        status: 'active',
        code: 'LICENSE_VALID',
        httpStatus: 200,
        entitlementToken,
        license: buildSafeAndroidLicenseView(saved),
      };
    } catch (err) {
      if (err instanceof LicenseStorageError) {
        const tokenVerification = verifySignedEntitlementToken(rawToken, keyHash, clientDevice.deviceId);
        if (tokenVerification.valid && tokenVerification.payload) {
          const graceBindingVersion =
            typeof tokenVerification.payload.bindingVersion === 'number' &&
            Number.isInteger(tokenVerification.payload.bindingVersion) &&
            tokenVerification.payload.bindingVersion >= 1
              ? tokenVerification.payload.bindingVersion
              : typeof tokenVerification.payload.bv === 'number' &&
                  Number.isInteger(tokenVerification.payload.bv) &&
                  tokenVerification.payload.bv >= 1
                ? tokenVerification.payload.bv
                : 1;
          return {
            valid: true,
            status: 'active',
            code: 'LICENSE_VALID',
            httpStatus: 200,
            isOfflineGrace: true,
            entitlementToken: rawToken,
            error:
              'Server storage is temporarily unavailable. License validated via cryptographic offline grace token on bound device.',
            license: {
              id: tokenVerification.payload.id || 'grace_id',
              maskedKey: tokenVerification.payload.mk || maskLicenseKey(normalizedKey).maskedKey,
              licenseType: 'Lifetime',
              status: 'active',
              customerName: 'Lifetime Subscriber',
              activatedAt: tokenVerification.payload.act || new Date().toISOString(),
              lastSeenAt: new Date().toISOString(),
              bindingVersion: graceBindingVersion,
              linkedDevice: {
                deviceId: clientDevice.deviceId,
                deviceModel: clientDevice.deviceModel,
                linkedAt: tokenVerification.payload.act || new Date().toISOString(),
              },
            },
          };
        }

        if (tokenVerification.reason?.includes('different Android device')) {
          return {
            valid: false,
            status: 'device_mismatch',
            code: 'DEVICE_MISMATCH',
            httpStatus: 403,
            error: 'Offline grace token was issued to a different Android device.',
          };
        }

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

/**
 * STAGE 2 — SEPARATE READ-ONLY VERIFICATION (POST /api/licenses/verify)
 * Strictly checks the previously persisted license record directly from Firestore without activating,
 * rebinding, writing, running transactions, or trusting client-supplied activation state.
 */
export async function verifyLicenseForAndroid(
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

  const deviceValidation = validateClientDeviceInfo(payload.deviceInfo);
  if (!deviceValidation.valid || !deviceValidation.data) {
    return {
      valid: false,
      status: 'malformed',
      code: 'INVALID_DEVICE_INFO',
      httpStatus: 400,
      error: deviceValidation.error || 'A valid Android device identifier is required.',
    };
  }

  const keyHash = hashLicenseKey(normalizedKey);
  const clientDevice = deviceValidation.data;

  try {
    // Always read directly from persistent Firestore storage (never rely on in-memory cache)
    const existing = await getLicenseByKeyHash(keyHash, { bypassCache: true });
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
        error: 'This lifetime license has been revoked and is no longer valid.',
      };
    }

    if (existing.status !== 'active' || !existing.linkedDevice || !existing.linkedDevice.deviceId) {
      return {
        valid: false,
        status: 'unactivated',
        code: 'LICENSE_NOT_ACTIVATED',
        httpStatus: 403,
        error: 'This lifetime license has not been activated yet. Activate it first via /api/licenses/activate.',
      };
    }

    if (existing.linkedDevice.deviceId !== clientDevice.deviceId) {
      return {
        valid: false,
        status: 'device_mismatch',
        code: 'DEVICE_MISMATCH',
        httpStatus: 403,
        error: `This lifetime license is bound to another phone (${existing.linkedDevice.deviceModel}). One-phone lifetime license policy is strictly enforced.`,
      };
    }

    return {
      valid: true,
      status: 'active',
      code: 'LICENSE_VALID',
      httpStatus: 200,
      license: buildSafeAndroidLicenseView(existing),
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
}

export interface UserAccountLicenseView {
  id: string;
  maskedKey: string;
  licenseType: 'Lifetime';
  status: LicenseStatus;
  createdAt: string;
  activatedAt: string | null;
  lastSeenAt: string | null;
  revokedAt: string | null;
  canRevealKey: boolean;
  canUnbindDevice: boolean;
  lastUnboundAt: string | null;
  nextUnbindAvailableAt: string | null;
  matchMethod: 'user_sub' | 'verified_email';
  linkedDevice: {
    deviceModel: string;
    androidVersion: string | null;
    appVersion: string | null;
    linkedAt: string;
  } | null;
}

export interface UserAccountLicenseSummary {
  status: 'active' | 'unactivated' | 'revoked' | 'not_purchased';
  hasLicense: boolean;
  license: UserAccountLicenseView | null;
  licenseCount: number;
  linkageMode: 'user_sub_or_verified_email';
}

function isLicenseOwnedByAuthenticatedUser(
  record: LicenseRecord,
  user: { googleSub: string; email: string; emailVerified: boolean }
): 'user_sub' | 'verified_email' | null {
  if (record.userSub && user.googleSub && record.userSub === user.googleSub) {
    return 'user_sub';
  }
  const normalizedUserEmail = (user.email || '').trim().toLowerCase();
  const normalizedLicenseEmail = (record.customerEmail || '').trim().toLowerCase();
  if (
    user.emailVerified &&
    normalizedUserEmail &&
    normalizedLicenseEmail &&
    normalizedLicenseEmail === normalizedUserEmail
  ) {
    return 'verified_email';
  }
  return null;
}

function selectPrimaryUserLicense(
  matches: Array<{ record: LicenseRecord; matchMethod: 'user_sub' | 'verified_email' }>
): { record: LicenseRecord; matchMethod: 'user_sub' | 'verified_email' } | null {
  if (matches.length === 0) return null;
  const priority: Record<LicenseStatus, number> = {
    active: 3,
    unactivated: 2,
    revoked: 1,
  };
  const sorted = [...matches].sort((a, b) => {
    const pDiff = priority[b.record.status] - priority[a.record.status];
    if (pDiff !== 0) return pDiff;
    return Date.parse(b.record.createdAt || '') - Date.parse(a.record.createdAt || '');
  });
  return sorted[0];
}

/**
 * Authoritative server-side license lookup strictly scoped to the authenticated user.
 * Matches by immutable `userSub` first, then by verified Google email (`emailVerified === true`).
 * Never exposes another user's license, raw hashes, ciphertext, or admin audit internals.
 */
export async function getUserOwnedLicenseSummary(user: {
  googleSub: string;
  email: string;
  emailVerified: boolean;
}): Promise<UserAccountLicenseSummary> {
  assertStorageAvailable();

  const normalizedEmail = (user.email || '').trim().toLowerCase();
  const matchedMap = new Map<
    string,
    { record: LicenseRecord; matchMethod: 'user_sub' | 'verified_email' }
  >();

  try {
    if (useInMemoryStoreForTesting) {
      for (const record of inMemoryTestStore.values()) {
        const matchMethod = isLicenseOwnedByAuthenticatedUser(record, user);
        if (matchMethod) {
          matchedMap.set(record.id, { record, matchMethod });
        }
      }
    } else {
      if (user.googleSub) {
        const subDocs = await serverQueryDocumentsEq('licenses', 'userSub', user.googleSub, 10);
        for (const docSnap of subDocs) {
          if (docSnap.data && docSnap.data.id && docSnap.data.keyHash) {
            const normalized = normalizeRecordOnRead(docSnap.data);
            matchedMap.set(normalized.id, { record: normalized, matchMethod: 'user_sub' });
          }
        }
      }

      if (user.emailVerified && normalizedEmail) {
        const emailDocs = await serverQueryDocumentsEq(
          'licenses',
          'customerEmail',
          normalizedEmail,
          10
        );
        for (const docSnap of emailDocs) {
          if (docSnap.data && docSnap.data.id && docSnap.data.keyHash) {
            const normalized = normalizeRecordOnRead(docSnap.data);
            if (!matchedMap.has(normalized.id)) {
              matchedMap.set(normalized.id, {
                record: normalized,
                matchMethod: 'verified_email',
              });
            }
          }
        }
      }
    }
  } catch (err) {
    if (err instanceof LicenseStorageError) {
      throw err;
    }
    throw new LicenseStorageError(
      'Persistent license storage (Cloud Firestore) is unavailable. Could not verify license status.',
      err
    );
  }

  const allMatches = Array.from(matchedMap.values());
  const primary = selectPrimaryUserLicense(allMatches);

  if (!primary) {
    return {
      status: 'not_purchased',
      hasLicense: false,
      license: null,
      licenseCount: 0,
      linkageMode: 'user_sub_or_verified_email',
    };
  }

  const rec = primary.record;
  let encryptionConfigured = false;
  try {
    getLicenseEncryptionSecret();
    encryptionConfigured = true;
  } catch {
    encryptionConfigured = false;
  }

  const cooldown = getUserUnbindCooldownStatus(rec);

  return {
    status: rec.status,
    hasLicense: rec.status === 'active' || rec.status === 'unactivated',
    licenseCount: allMatches.length,
    linkageMode: 'user_sub_or_verified_email',
    license: {
      id: rec.id,
      maskedKey: rec.maskedKey,
      licenseType: rec.licenseType,
      status: rec.status,
      createdAt: rec.createdAt,
      activatedAt: rec.activatedAt,
      lastSeenAt: rec.lastSeenAt,
      revokedAt: rec.revokedAt,
      canRevealKey: Boolean(rec.encryptedKey && encryptionConfigured && rec.status !== 'revoked'),
      canUnbindDevice: Boolean(rec.status === 'active' && rec.linkedDevice && !cooldown.active),
      lastUnboundAt: rec.lastUnboundAt ?? null,
      nextUnbindAvailableAt: cooldown.active ? cooldown.nextUnbindAvailableAt : null,
      matchMethod: primary.matchMethod,
      linkedDevice: rec.linkedDevice
        ? {
            deviceModel: rec.linkedDevice.deviceModel,
            androidVersion: rec.linkedDevice.androidVersion ?? null,
            appVersion: rec.linkedDevice.appVersion ?? null,
            linkedAt: rec.linkedDevice.linkedAt,
          }
        : null,
    },
  };
}

/**
 * Allows an authenticated account owner to reveal their own non-revoked license key
 * strictly after verifying server-side ownership.
 */
export async function revealLicenseKeyForUser(
  licenseId: string,
  user: { googleSub: string; email: string; emailVerified: boolean }
): Promise<RevealLicenseKeyResult> {
  const cleanId = sanitizeText(licenseId, 100);
  if (!cleanId) {
    return {
      success: false,
      status: 400,
      error: 'License ID is required.',
    };
  }

  try {
    const license = await getLicenseById(cleanId);
    if (!license) {
      return {
        success: false,
        status: 404,
        code: 'LICENSE_NOT_FOUND',
        error: 'License record not found.',
      };
    }

    const ownership = isLicenseOwnedByAuthenticatedUser(license, user);
    if (!ownership) {
      return {
        success: false,
        status: 403,
        code: 'UNAUTHORIZED',
        error: 'You are not authorized to access this license.',
      };
    }

    if (license.status === 'revoked') {
      return {
        success: false,
        status: 403,
        code: 'UNAUTHORIZED',
        error: 'Revoked license keys cannot be revealed.',
      };
    }

    if (!license.encryptedKey) {
      return {
        success: false,
        status: 404,
        code: 'KEY_NOT_RECOVERABLE',
        error: 'This license key cannot be recovered in plaintext.',
      };
    }

    try {
      const decryptedKey = decryptLicenseKey(license.encryptedKey, license.id);
      if (license.keyHash && hashLicenseKey(decryptedKey) !== license.keyHash) {
        return {
          success: false,
          status: 500,
          code: 'DECRYPTION_FAILED',
          error: 'License key integrity check failed.',
        };
      }
      return {
        success: true,
        status: 200,
        licenseKey: decryptedKey,
      };
    } catch (decErr) {
      if (decErr instanceof LicenseEncryptionConfigurationError) {
        return {
          success: false,
          status: 500,
          code: 'CONFIGURATION_ERROR',
          error: 'License key decryption is currently unavailable on the server.',
        };
      }
      return {
        success: false,
        status: 500,
        code: 'DECRYPTION_FAILED',
        error: 'Failed to decrypt license key.',
      };
    }
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
}

export interface UserUnbindDeviceResult {
  success: boolean;
  status: number;
  message?: string;
  licenseSummary?: UserAccountLicenseSummary;
  fcmNotification?: LicenseFcmNotificationResult;
  error?: string;
  code?:
    | 'LICENSE_NOT_FOUND'
    | 'UNAUTHORIZED'
    | 'LICENSE_REVOKED'
    | 'LICENSE_NOT_BOUND'
    | 'UNBIND_COOLDOWN_ACTIVE'
    | 'STORAGE_UNAVAILABLE';
  nextUnbindAvailableAt?: string | null;
}

/**
 * Allows an authenticated license owner to unbind/release their currently bound Android phone.
 * - Executes inside an atomic Firestore transaction (`serverRunTransaction`).
 * - Verifies license ownership strictly server-side (`userSub` or verified Google email).
 * - Enforces a server-side 24-hour user cooldown per license.
 * - Preserves customer ownership, key, and append-only audit history; never revokes or deletes the license.
 * - Captures and clears any linked device FCM token inside the transaction, then sends a device-specific
 *   `license_unbound` FCM notification strictly AFTER commit (non-fatal if FCM fails).
 * - Records `lastUnboundDeviceId` so the unbound phone cannot silently reclaim the license.
 */
export async function unbindLicenseDeviceForUser(
  licenseId: string,
  user: { googleSub: string; email: string; emailVerified: boolean }
): Promise<UserUnbindDeviceResult> {
  const cleanId = sanitizeText(licenseId, 100);
  if (!cleanId) {
    return {
      success: false,
      status: 400,
      error: 'License ID is required.',
    };
  }

  return withLicenseLock(async () => {
    try {
      assertStorageAvailable();

      const txResult = await serverRunTransaction(async (tx) => {
        const snap = await tx.get('licenses', cleanId);
        if (!snap.exists || !snap.data) {
          return { type: 'not_found' as const };
        }

        const current = normalizeRecordOnRead(snap.data);
        const ownership = isLicenseOwnedByAuthenticatedUser(current, user);
        if (!ownership) {
          return { type: 'unauthorized' as const };
        }

        if (current.status === 'revoked') {
          return { type: 'revoked' as const };
        }

        if (current.status !== 'active' || !current.linkedDevice || !current.linkedDevice.deviceId) {
          return { type: 'not_bound' as const };
        }

        const nowMs = Date.now();
        const cooldown = getUserUnbindCooldownStatus(current, nowMs);
        if (cooldown.active) {
          return {
            type: 'cooldown' as const,
            nextUnbindAvailableAt: cooldown.nextUnbindAvailableAt,
          };
        }

        const nowIso = new Date(nowMs).toISOString();
        const prevDevice = current.linkedDevice;
        const capturedDeviceId = prevDevice.deviceId;
        const capturedFcmToken = current.deviceFcmToken || null;
        const capturedBindingVersion = current.bindingVersion >= 1 ? current.bindingVersion : 1;
        const eventId = `evt_${crypto.randomUUID()}`;
        const prevDeviceLabel = `${prevDevice.deviceModel} (${prevDevice.deviceId})`;
        const nextBindingVersion = capturedBindingVersion + 1;
        const nextUnbindCount = (current.unbindCount || 0) + 1;

        const auditEntry: LicenseAuditEntry = {
          id: `aud_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
          action: 'device_unbound',
          timestamp: nowIso,
          actor: `Account Owner <${user.email}>`,
          details: `Device unbound by license owner (${user.email}, match: ${ownership}, binding v${nextBindingVersion}). Released from ${prevDeviceLabel}.`,
        };

        const updated: LicenseRecord = sanitizeRecordForStorage({
          ...current,
          userSub: current.userSub || user.googleSub,
          status: 'unactivated',
          linkedDevice: null,
          bindingVersion: nextBindingVersion,
          lastUnboundAt: nowIso,
          lastUserUnboundAt: nowIso,
          unbindCount: nextUnbindCount,
          lastUnboundDeviceId: prevDevice.deviceId,
          deviceFcmToken: null,
          deviceFcmTokenUpdatedAt: null,
          updatedAt: nowIso,
          auditLog: [...(current.auditLog || []), auditEntry],
        });

        tx.set('licenses', current.id, updated);
        return {
          type: 'success' as const,
          record: updated,
          prevDeviceModel: prevDevice.deviceModel,
          capturedDeviceId,
          capturedFcmToken,
          capturedBindingVersion,
          eventId,
        };
      });

      if (txResult.type === 'not_found') {
        return {
          success: false,
          status: 404,
          code: 'LICENSE_NOT_FOUND',
          error: 'License record not found.',
        };
      }

      if (txResult.type === 'unauthorized') {
        return {
          success: false,
          status: 403,
          code: 'UNAUTHORIZED',
          error: 'You are not authorized to unbind this license.',
        };
      }

      if (txResult.type === 'revoked') {
        return {
          success: false,
          status: 403,
          code: 'LICENSE_REVOKED',
          error: 'Revoked licenses cannot be unbound.',
        };
      }

      if (txResult.type === 'not_bound') {
        return {
          success: false,
          status: 400,
          code: 'LICENSE_NOT_BOUND',
          error: 'This license is not currently bound to an active device.',
        };
      }

      if (txResult.type === 'cooldown') {
        return {
          success: false,
          status: 429,
          code: 'UNBIND_COOLDOWN_ACTIVE',
          nextUnbindAvailableAt: txResult.nextUnbindAvailableAt,
          error: txResult.nextUnbindAvailableAt
            ? `You can unbind this license once every 24 hours. Next unbind available after ${txResult.nextUnbindAvailableAt}.`
            : 'You can unbind this license once every 24 hours. Please try again later.',
        };
      }

      const saved = txResult.record;
      invalidateLicenseCaches(saved.id, saved.keyHash);

      // Dispatch device-specific `license_unbound` FCM notification strictly AFTER transaction commits.
      // Carries the exact deviceId and bindingVersion of the unbound binding (never the newer version).
      // FCM failure must never roll back or fail a committed unbind.
      let fcmNotification: LicenseFcmNotificationResult | undefined;
      try {
        fcmNotification = await sendLicenseDeviceFcmNotification({
          fcmToken: txResult.capturedFcmToken,
          deviceId: txResult.capturedDeviceId,
          eventId: txResult.eventId,
          eventType: 'license_unbound',
          licenseId: saved.id,
          maskedKey: saved.maskedKey,
          bindingVersion: txResult.capturedBindingVersion,
          initiatedBy: 'user',
          timestamp: saved.lastUnboundAt || saved.updatedAt,
        });
      } catch {
        // Non-fatal: unbind has already committed in Firestore
      }

      const licenseSummary = await getUserOwnedLicenseSummary(user);
      return {
        success: true,
        status: 200,
        message: `Device "${txResult.prevDeviceModel}" has been unbound. Your license remains linked to your Google account and is ready to activate on a new Android phone.`,
        licenseSummary,
        fcmNotification,
      };
    } catch (err) {
      if (err instanceof LicenseStorageError) {
        return {
          success: false,
          status: 503,
          code: 'STORAGE_UNAVAILABLE',
          error: err.message,
        };
      }
      throw new LicenseStorageError(
        'Persistent license storage (Cloud Firestore) failed while unbinding license device.',
        err
      );
    }
  });
}

export interface RegisterLicenseFcmTokenRequest {
  licenseKey?: unknown;
  deviceId?: unknown;
  deviceInfo?: { deviceId?: unknown } | null;
  fcmToken?: unknown;
  token?: unknown;
}

export interface RegisterLicenseFcmTokenResponse {
  success: boolean;
  httpStatus: number;
  registered?: boolean;
  replaced?: boolean;
  updatedAt?: string;
  code?:
    | 'FCM_TOKEN_REGISTERED'
    | 'MALFORMED_KEY'
    | 'INVALID_DEVICE_INFO'
    | 'INVALID_FCM_TOKEN'
    | 'UNKNOWN_KEY'
    | 'LICENSE_UNACTIVATED'
    | 'LICENSE_REVOKED'
    | 'DEVICE_MISMATCH'
    | 'STORAGE_UNAVAILABLE';
  error?: string;
}

/**
 * Securely registers or refreshes an Android device's FCM token against its existing activated license.
 * - Verifies license key hash directly against persistent Firestore storage (never trusts client status).
 * - Requires `status === 'active'` and `linkedDevice.deviceId === deviceId`.
 * - Rejects malformed keys, invalid device IDs, invalid FCM tokens, unknown keys, unactivated licenses,
 *   revoked licenses, and mismatched devices.
 * - Executes inside an atomic Firestore transaction (`serverRunTransaction`) to prevent race conditions.
 * - Never returns FCM tokens, plaintext keys, key hashes, or secrets in responses.
 */
export async function registerLicenseDeviceFcmToken(
  payload: RegisterLicenseFcmTokenRequest
): Promise<RegisterLicenseFcmTokenResponse> {
  if (!payload || typeof payload !== 'object') {
    return {
      success: false,
      httpStatus: 400,
      code: 'MALFORMED_KEY',
      error: 'Request payload is required.',
    };
  }

  const normalizedKey = normalizeLicenseKey(payload.licenseKey);
  if (!normalizedKey || !isValidLicenseKeyFormat(normalizedKey)) {
    return {
      success: false,
      httpStatus: 400,
      code: 'MALFORMED_KEY',
      error: 'License key format is invalid. Expected ZOYA-XXXX-XXXX-XXXX.',
    };
  }

  const rawDeviceId =
    payload.deviceId !== undefined
      ? payload.deviceId
      : payload.deviceInfo && typeof payload.deviceInfo === 'object'
        ? payload.deviceInfo.deviceId
        : undefined;

  if (!isValidDeviceId(rawDeviceId)) {
    return {
      success: false,
      httpStatus: 400,
      code: 'INVALID_DEVICE_INFO',
      error: 'A valid Android deviceId is required.',
    };
  }
  const cleanDeviceId = String(rawDeviceId).trim();

  const rawFcmToken = payload.fcmToken !== undefined ? payload.fcmToken : payload.token;
  if (!isValidFcmRegistrationToken(rawFcmToken)) {
    return {
      success: false,
      httpStatus: 400,
      code: 'INVALID_FCM_TOKEN',
      error: 'A valid FCM registration token is required.',
    };
  }
  const cleanFcmToken = String(rawFcmToken).trim();

  const keyHash = hashLicenseKey(normalizedKey);

  return withLicenseLock(async () => {
    try {
      assertStorageAvailable();

      const existing = await getLicenseByKeyHash(keyHash, { bypassCache: true });
      if (!existing) {
        return {
          success: false,
          httpStatus: 404,
          code: 'UNKNOWN_KEY',
          error: 'License key not found.',
        };
      }

      const txResult = await serverRunTransaction(async (tx) => {
        const snap = await tx.get('licenses', existing.id);
        if (!snap.exists || !snap.data) {
          return { type: 'not_found' as const };
        }

        const current = normalizeRecordOnRead(snap.data);

        if (current.status === 'revoked') {
          return { type: 'revoked' as const };
        }

        if (current.status !== 'active' || !current.linkedDevice || !current.linkedDevice.deviceId) {
          return { type: 'unactivated' as const };
        }

        if (current.linkedDevice.deviceId !== cleanDeviceId) {
          return { type: 'mismatch' as const };
        }

        if (current.deviceFcmToken === cleanFcmToken) {
          return {
            type: 'unchanged' as const,
            record: current,
            updatedAt: current.deviceFcmTokenUpdatedAt || current.updatedAt,
          };
        }

        const nowIso = new Date().toISOString();
        const hadExistingToken = Boolean(current.deviceFcmToken);
        const updated: LicenseRecord = sanitizeRecordForStorage({
          ...current,
          deviceFcmToken: cleanFcmToken,
          deviceFcmTokenUpdatedAt: nowIso,
          updatedAt: nowIso,
        });

        tx.set('licenses', current.id, updated);
        return {
          type: 'saved' as const,
          record: updated,
          replaced: hadExistingToken,
          updatedAt: nowIso,
        };
      });

      if (txResult.type === 'not_found') {
        return {
          success: false,
          httpStatus: 404,
          code: 'UNKNOWN_KEY',
          error: 'License key not found.',
        };
      }

      if (txResult.type === 'revoked') {
        return {
          success: false,
          httpStatus: 403,
          code: 'LICENSE_REVOKED',
          error: 'This lifetime license has been revoked and cannot register an FCM token.',
        };
      }

      if (txResult.type === 'unactivated') {
        return {
          success: false,
          httpStatus: 403,
          code: 'LICENSE_UNACTIVATED',
          error: 'License must be actively bound to this device before registering an FCM token.',
        };
      }

      if (txResult.type === 'mismatch') {
        return {
          success: false,
          httpStatus: 403,
          code: 'DEVICE_MISMATCH',
          error: 'This license is bound to a different Android device.',
        };
      }

      if (txResult.type === 'unchanged') {
        return {
          success: true,
          httpStatus: 200,
          registered: true,
          replaced: false,
          updatedAt: txResult.updatedAt,
          code: 'FCM_TOKEN_REGISTERED',
        };
      }

      invalidateLicenseCaches(txResult.record.id, txResult.record.keyHash);
      return {
        success: true,
        httpStatus: 200,
        registered: true,
        replaced: txResult.replaced,
        updatedAt: txResult.updatedAt,
        code: 'FCM_TOKEN_REGISTERED',
      };
    } catch (err) {
      if (err instanceof LicenseStorageError) {
        return {
          success: false,
          httpStatus: 503,
          code: 'STORAGE_UNAVAILABLE',
          error: err.message,
        };
      }
      throw new LicenseStorageError(
        'Persistent license storage (Cloud Firestore) failed while registering device FCM token.',
        err
      );
    }
  });
}
