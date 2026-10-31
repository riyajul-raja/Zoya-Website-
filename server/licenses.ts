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
  auditLog: LicenseAuditEntry[];
}

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

  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  if (iv.length !== 12) {
    throw new Error(`Invalid IV length for AES-256-GCM. Expected 12 bytes, got ${iv.length}.`);
  }
  if (authTag.length !== 16) {
    throw new Error(`Invalid authentication tag length for AES-256-GCM. Expected 16 bytes, got ${authTag.length}.`);
  }

  const key = getLicenseKeyEncryptionBuffer();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(Buffer.from(`zoya_lic_aad:${licenseId}`, 'utf-8'));
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertextHex, 'hex', 'utf-8');
  decrypted += decipher.final('utf-8');

  return decrypted;
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
    auditLog: Array.isArray(raw.auditLog) ? raw.auditLog : [],
  };

  return sanitizeRecordForStorage(record);
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
 */
export async function getLicenseByKeyHash(keyHash: string): Promise<LicenseRecord | null> {
  if (!keyHash) return null;

  if (useInMemoryStoreForTesting) {
    assertStorageAvailable();
    for (const record of inMemoryTestStore.values()) {
      if (record.keyHash === keyHash) return record;
    }
    return null;
  }

  const cached = keyHashToLicenseCache.get(keyHash);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.data;
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
          error:
            'License key decryption unavailable: LICENSE_KEY_ENCRYPTION_SECRET is not configured on the server. Server fails closed per security policy.',
        };
      }
      return {
        success: false,
        status: 500,
        code: 'DECRYPTION_FAILED',
        error: 'Failed to decrypt license key. Ciphertext may be corrupted, tampered, or encrypted with a different secret.',
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
 * Rebinds an existing license to allow activation on a new phone.
 * Strictly requires authorized administrator action and records the rebind reason in audit history.
 */
export async function rebindLicenseDeviceByAdmin(
  licenseId: string,
  input: AdminRebindLicenseInput,
  admin: AdminUser
): Promise<
  | { success: true; license: LicenseRecord }
  | { success: false; status: number; error: string }
> {
  if (!admin || admin.role !== 'admin') {
    return { success: false, status: 401, error: 'Unauthorized administrator session.' };
  }

  const cleanId = sanitizeText(licenseId, 100);
  if (!cleanId) {
    return { success: false, status: 400, error: 'License ID is required.' };
  }

  const reason = sanitizeText(input.reason, 300);
  if (!reason || reason.length < 3) {
    return {
      success: false,
      status: 400,
      error: 'Administrator authorization reason is required to rebind a device (minimum 3 characters).',
    };
  }

  return withLicenseLock(async () => {
    try {
      const existing = await getLicenseById(cleanId);
      if (!existing) {
        return { success: false, status: 404, error: 'License record not found.' };
      }

      if (existing.status === 'revoked') {
        return { success: false, status: 400, error: 'Cannot rebind a revoked license.' };
      }

      const prevDeviceLabel = existing.linkedDevice?.deviceModel
        ? `${existing.linkedDevice.deviceModel} (${existing.linkedDevice.deviceId})`
        : 'previous device';

      const nowIso = new Date().toISOString();
      const actorLabel = `${admin.name} <${admin.email}>`;

      const auditEntry: LicenseAuditEntry = {
        id: `aud_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        action: 'device_rebound',
        timestamp: nowIso,
        actor: actorLabel,
        details: `Device binding reset by ${admin.name}. Released from ${prevDeviceLabel}. Reason: ${reason}`,
      };

      const updated: LicenseRecord = {
        ...existing,
        status: 'unactivated',
        linkedDevice: null,
        updatedAt: nowIso,
        auditLog: [...(existing.auditLog || []), auditEntry],
      };

      const saved = await saveLicenseRecord(updated);
      return { success: true, license: saved };
    } catch (err) {
      if (err instanceof LicenseStorageError) {
        return { success: false, status: 503, error: err.message };
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

export function generateSignedEntitlementToken(payload: {
  licenseId: string;
  keyHash: string;
  maskedKey: string;
  activatedAt: string;
  deviceId?: string | null;
}): string {
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
  expectedDeviceId?: string | null
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

        // FIRST-TIME ACTIVATION: Atomic binding to this phone
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
          activatedAt: current.activatedAt || nowIso,
          lastSeenAt: nowIso,
          validationCount: 1,
          linkedDevice: newLinkedDevice,
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
      });

      return {
        valid: true,
        status: 'active',
        code: 'LICENSE_VALID',
        httpStatus: 200,
        entitlementToken,
        license: {
          id: saved.id,
          maskedKey: saved.maskedKey,
          licenseType: 'Lifetime',
          status: 'active',
          customerName: saved.customerName,
          activatedAt: saved.activatedAt || new Date().toISOString(),
          lastSeenAt: saved.lastSeenAt || new Date().toISOString(),
          linkedDevice: saved.linkedDevice,
        },
      };
    } catch (err) {
      if (err instanceof LicenseStorageError) {
        // Offline grace validation for previously activated phone submitting valid signed token
        const tokenVerification = verifySignedEntitlementToken(rawToken, keyHash, clientDevice.deviceId);
        if (tokenVerification.valid && tokenVerification.payload) {
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
