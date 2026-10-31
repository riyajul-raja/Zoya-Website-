import 'dotenv/config';
import {
  initializeApp as initializeAdminApp,
  getApps as getAdminApps,
  cert,
  type App as AdminApp,
} from 'firebase-admin/app';
import {
  getFirestore as getAdminFirestoreInstance,
  type Firestore as AdminFirestore,
} from 'firebase-admin/firestore';

// Canonical Firebase project and "(default)" Cloud Firestore database in Delhi (asia-south2)
export const TARGET_FIREBASE_PROJECT_ID = 'zoya-updates';
export const TARGET_FIRESTORE_DATABASE_ID = '(default)';
export const TARGET_FIRESTORE_REGION = 'asia-south2';

export interface ServerServiceAccountCredentials {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

export interface ServerDocSnapshot {
  exists: boolean;
  id: string;
  data: Record<string, any> | undefined;
}

export interface ServerFirestoreTransaction {
  get(collectionName: string, docId: string): Promise<ServerDocSnapshot>;
  set(
    collectionName: string,
    docId: string,
    data: Record<string, any>,
    options?: { merge?: boolean }
  ): void;
}

export interface ServerFirestoreAdapter {
  backendType: 'firebase-admin' | 'test-mock';
  projectId: string;
  databaseId: string;
  getCollectionDocs(collectionName: string): Promise<Array<{ id: string; data: Record<string, any> }>>;
  getDocumentById(collectionName: string, docId: string): Promise<ServerDocSnapshot>;
  queryDocumentsEq(
    collectionName: string,
    field: string,
    value: unknown,
    maxResults?: number
  ): Promise<Array<{ id: string; data: Record<string, any> }>>;
  setDocumentById(
    collectionName: string,
    docId: string,
    data: Record<string, any>,
    options?: { merge?: boolean }
  ): Promise<void>;
  deleteDocumentById(collectionName: string, docId: string): Promise<void>;
  runTransaction<T>(
    updateFunction: (transaction: ServerFirestoreTransaction) => Promise<T>
  ): Promise<T>;
}

let cachedAdminApp: AdminApp | null = null;
let cachedAdminDb: AdminFirestore | null = null;
let cachedAdminProjectId: string | null = null;
let cachedAdminDatabaseId: string | null = null;
let adminDbConfigured = false;

let testAdapterOverride: ServerFirestoreAdapter | null = null;

export function setServerFirestoreTestAdapter(adapter: ServerFirestoreAdapter | null): void {
  testAdapterOverride = adapter;
}

export function resetAdminFirestoreCache(): void {
  cachedAdminApp = null;
  cachedAdminDb = null;
  cachedAdminProjectId = null;
  cachedAdminDatabaseId = null;
  adminDbConfigured = false;
}

function stripSurroundingQuotes(val: string): string {
  const trimmed = val.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function resolveCanonicalProjectId(candidate: string | undefined, defaultProjectId: string): string {
  const cleaned = stripSurroundingQuotes(String(candidate || ''));
  if (!cleaned || cleaned === 'distinguished-arena-4wr9b') {
    return defaultProjectId;
  }
  return cleaned;
}

function resolveCanonicalDatabaseId(candidate: string | undefined): string {
  const cleaned = stripSurroundingQuotes(String(candidate || ''));
  if (
    !cleaned ||
    cleaned === '(default)' ||
    cleaned.startsWith('ai-studio-') ||
    cleaned.includes('distinguished-arena')
  ) {
    return TARGET_FIRESTORE_DATABASE_ID;
  }
  return cleaned;
}

function parseServiceAccountJsonString(rawInput: string): Record<string, any> | null {
  const unquoted = stripSurroundingQuotes(rawInput);
  if (!unquoted) return null;

  const candidates: string[] = [];
  if (unquoted.startsWith('{')) {
    candidates.push(unquoted);
  } else {
    try {
      const decoded = Buffer.from(unquoted, 'base64').toString('utf-8').trim();
      if (decoded.startsWith('{')) {
        candidates.push(decoded);
      }
    } catch {
      // Ignore base64 decode errors
    }
    candidates.push(unquoted);
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      try {
        // Handle multi-line env vars where newlines inside private_key were not escaped
        const escapedNewlines = candidate.replace(/\r?\n/g, '\\n');
        return JSON.parse(escapedNewlines);
      } catch {
        // Continue to next candidate
      }
    }
  }
  return null;
}

/**
 * Parses FIREBASE_SERVICE_ACCOUNT_JSON (raw JSON or base64-encoded) or individual
 * FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY environment variables.
 * Defaults projectId to "zoya-updates". Never logs or exposes secret contents.
 */
export function getServerServiceAccountCredentials(
  defaultProjectId: string = TARGET_FIREBASE_PROJECT_ID
): ServerServiceAccountCredentials | null {
  const rawJson = (process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  if (rawJson.length > 0) {
    const parsed = parseServiceAccountJsonString(rawJson);
    if (parsed && typeof parsed === 'object') {
      const projectId = resolveCanonicalProjectId(
        parsed.project_id || process.env.FIREBASE_PROJECT_ID,
        defaultProjectId
      );
      const clientEmail = stripSurroundingQuotes(String(parsed.client_email || ''));
      const privateKey = stripSurroundingQuotes(String(parsed.private_key || ''))
        .replace(/\\n/g, '\n')
        .trim();

      if (projectId && clientEmail && privateKey.includes('PRIVATE KEY')) {
        return {
          projectId,
          clientEmail,
          privateKey,
        };
      }
    }
  }

  const projectId = resolveCanonicalProjectId(process.env.FIREBASE_PROJECT_ID, defaultProjectId);
  const clientEmail = stripSurroundingQuotes(String(process.env.FIREBASE_CLIENT_EMAIL || ''));
  const privateKey = stripSurroundingQuotes(String(process.env.FIREBASE_PRIVATE_KEY || ''))
    .replace(/\\n/g, '\n')
    .trim();

  if (projectId && clientEmail && privateKey.includes('PRIVATE KEY')) {
    return {
      projectId,
      clientEmail,
      privateKey,
    };
  }

  return null;
}

/**
 * Initializes and returns the privileged server-side Firebase Admin SDK Firestore instance
 * connected to the canonical project ("zoya-updates") and "(default)" database in Delhi (asia-south2).
 * Returns null if service account credentials are not configured in the environment.
 */
export function getAdminFirestore(): {
  db: AdminFirestore;
  projectId: string;
  databaseId: string;
} | null {
  const creds = getServerServiceAccountCredentials(TARGET_FIREBASE_PROJECT_ID);
  if (!creds) {
    return null;
  }

  const targetDbId = resolveCanonicalDatabaseId(process.env.FIRESTORE_DATABASE_ID);
  const appName = `zoya-admin-${creds.projectId}`;

  if (!cachedAdminApp || cachedAdminProjectId !== creds.projectId) {
    const existing = getAdminApps().find((a) => a.name === appName);
    cachedAdminApp =
      existing ||
      initializeAdminApp(
        {
          credential: cert({
            projectId: creds.projectId,
            clientEmail: creds.clientEmail,
            privateKey: creds.privateKey,
          }),
          projectId: creds.projectId,
        },
        appName
      );
    cachedAdminProjectId = creds.projectId;
    cachedAdminDb = null;
    adminDbConfigured = false;
  }

  if (!cachedAdminDb || cachedAdminDatabaseId !== targetDbId) {
    cachedAdminDb =
      targetDbId && targetDbId !== '(default)'
        ? getAdminFirestoreInstance(cachedAdminApp, targetDbId)
        : getAdminFirestoreInstance(cachedAdminApp);
    cachedAdminDatabaseId = targetDbId;
    if (!adminDbConfigured) {
      try {
        cachedAdminDb.settings({
          ignoreUndefinedProperties: true,
          preferRest: true,
        });
      } catch {
        // Ignore if settings were already frozen on this instance
      }
      adminDbConfigured = true;
    }
  }

  return {
    db: cachedAdminDb,
    projectId: creds.projectId,
    databaseId: targetDbId || TARGET_FIRESTORE_DATABASE_ID,
  };
}

/**
 * Extracts a Node.js Buffer from a Firestore binary field regardless of whether
 * it came from Firebase Admin SDK (Buffer / Uint8Array) or Web SDK (Bytes).
 */
export function extractBinaryBuffer(rawField: unknown): Buffer | null {
  if (!rawField) return null;
  if (Buffer.isBuffer(rawField)) {
    return rawField;
  }
  if (rawField instanceof Uint8Array) {
    return Buffer.from(rawField.buffer, rawField.byteOffset, rawField.byteLength);
  }
  if (typeof (rawField as any).toUint8Array === 'function') {
    const uint8: Uint8Array = (rawField as any).toUint8Array();
    return Buffer.from(uint8.buffer, uint8.byteOffset, uint8.byteLength);
  }
  if (typeof (rawField as any).toBuffer === 'function') {
    return (rawField as any).toBuffer();
  }
  return null;
}

/**
 * Normalizes any Buffer/Uint8Array/Bytes properties in a document payload into
 * a standard Node.js Buffer for Firebase Admin SDK storage.
 */
function normalizeDocumentPayloadForAdminSdk(
  data: Record<string, any>
): Record<string, any> {
  const normalized: Record<string, any> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    if (Buffer.isBuffer(value)) {
      normalized[key] = value;
    } else if (value instanceof Uint8Array) {
      normalized[key] = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    } else if (value && typeof (value as any).toUint8Array === 'function') {
      const uint8: Uint8Array = (value as any).toUint8Array();
      normalized[key] = Buffer.from(uint8.buffer, uint8.byteOffset, uint8.byteLength);
    } else {
      normalized[key] = value;
    }
  }
  return normalized;
}

async function withFirestoreRetry<T>(
  initialDb: AdminFirestore,
  operation: (activeDb: AdminFirestore) => Promise<T>
): Promise<T> {
  try {
    return await operation(initialDb);
  } catch (firstErr) {
    resetAdminFirestoreCache();
    const freshInstance = getAdminFirestore();
    if (!freshInstance) {
      throw firstErr;
    }
    return await operation(freshInstance.db);
  }
}

/**
 * Resolves the canonical server-side Firestore adapter for all Zoya Website backend operations:
 * - Uses `zoya-updates/(default)` (asia-south2 Delhi) via Firebase Admin SDK (`FIREBASE_SERVICE_ACCOUNT_JSON`).
 * - Never falls back to the old database if `zoya-updates/(default)` is unconfigured or unavailable.
 * - Throws an explicit error when unavailable so callers return HTTP 503 STORAGE_UNAVAILABLE (never 404 UNKNOWN_KEY).
 */
export async function getActiveServerFirestoreAdapter(): Promise<ServerFirestoreAdapter> {
  if (testAdapterOverride) {
    return testAdapterOverride;
  }

  const adminInstance = getAdminFirestore();
  if (!adminInstance) {
    const err = new Error(
      `Firebase Admin SDK for ${TARGET_FIREBASE_PROJECT_ID}/${TARGET_FIRESTORE_DATABASE_ID} is not configured: FIREBASE_SERVICE_ACCOUNT_JSON is required.`
    );
    (err as any).code = 'STORAGE_UNAVAILABLE';
    throw err;
  }

  const { db, projectId, databaseId } = adminInstance;
  return {
    backendType: 'firebase-admin',
    projectId,
    databaseId,
    async getCollectionDocs(collectionName: string) {
      return withFirestoreRetry(db, async (activeDb) => {
        const snap = await activeDb.collection(collectionName).get();
        return snap.docs.map((d) => ({
          id: d.id,
          data: (d.data() || {}) as Record<string, any>,
        }));
      });
    },
    async getDocumentById(collectionName: string, docId: string) {
      return withFirestoreRetry(db, async (activeDb) => {
        const snap = await activeDb.collection(collectionName).doc(docId).get();
        return {
          exists: snap.exists,
          id: snap.id,
          data: snap.exists ? ((snap.data() || {}) as Record<string, any>) : undefined,
        };
      });
    },
    async queryDocumentsEq(
      collectionName: string,
      field: string,
      value: unknown,
      maxResults = 1
    ) {
      return withFirestoreRetry(db, async (activeDb) => {
        const snap = await activeDb
          .collection(collectionName)
          .where(field, '==', value)
          .limit(maxResults)
          .get();
        return snap.docs.map((d) => ({
          id: d.id,
          data: (d.data() || {}) as Record<string, any>,
        }));
      });
    },
    async setDocumentById(
      collectionName: string,
      docId: string,
      data: Record<string, any>,
      options?: { merge?: boolean }
    ) {
      const payload = normalizeDocumentPayloadForAdminSdk(data);
      return withFirestoreRetry(db, async (activeDb) => {
        if (options?.merge) {
          await activeDb.collection(collectionName).doc(docId).set(payload, { merge: true });
        } else {
          await activeDb.collection(collectionName).doc(docId).set(payload);
        }
      });
    },
    async deleteDocumentById(collectionName: string, docId: string) {
      return withFirestoreRetry(db, async (activeDb) => {
        await activeDb.collection(collectionName).doc(docId).delete();
      });
    },
    async runTransaction<T>(
      updateFunction: (transaction: ServerFirestoreTransaction) => Promise<T>
    ): Promise<T> {
      return withFirestoreRetry(db, async (activeDb) => {
        return activeDb.runTransaction(async (t) => {
          const txWrapper: ServerFirestoreTransaction = {
            async get(collectionName: string, docId: string) {
              const docRef = activeDb.collection(collectionName).doc(docId);
              const snap = await t.get(docRef);
              return {
                exists: snap.exists,
                id: snap.id,
                data: snap.exists ? ((snap.data() || {}) as Record<string, any>) : undefined,
              };
            },
            set(
              collectionName: string,
              docId: string,
              data: Record<string, any>,
              options?: { merge?: boolean }
            ) {
              const docRef = activeDb.collection(collectionName).doc(docId);
              const payload = normalizeDocumentPayloadForAdminSdk(data);
              if (options?.merge) {
                t.set(docRef, payload, { merge: true });
              } else {
                t.set(docRef, payload);
              }
            },
          };
          return updateFunction(txWrapper);
        });
      });
    },
  };
}

export async function serverRunTransaction<T>(
  updateFunction: (transaction: ServerFirestoreTransaction) => Promise<T>
): Promise<T> {
  const adapter = await getActiveServerFirestoreAdapter();
  return adapter.runTransaction(updateFunction);
}

export async function serverGetCollectionDocs(
  collectionName: string
): Promise<Array<{ id: string; data: Record<string, any> }>> {
  const adapter = await getActiveServerFirestoreAdapter();
  return adapter.getCollectionDocs(collectionName);
}

export async function serverGetDocumentById(
  collectionName: string,
  docId: string
): Promise<ServerDocSnapshot> {
  const adapter = await getActiveServerFirestoreAdapter();
  return adapter.getDocumentById(collectionName, docId);
}

export async function serverQueryDocumentsEq(
  collectionName: string,
  field: string,
  value: unknown,
  maxResults = 1
): Promise<Array<{ id: string; data: Record<string, any> }>> {
  const adapter = await getActiveServerFirestoreAdapter();
  return adapter.queryDocumentsEq(collectionName, field, value, maxResults);
}

export async function serverSetDocumentById(
  collectionName: string,
  docId: string,
  data: Record<string, any>,
  options?: { merge?: boolean }
): Promise<void> {
  const adapter = await getActiveServerFirestoreAdapter();
  return adapter.setDocumentById(collectionName, docId, data, options);
}

export async function serverDeleteDocumentById(
  collectionName: string,
  docId: string
): Promise<void> {
  const adapter = await getActiveServerFirestoreAdapter();
  return adapter.deleteDocumentById(collectionName, docId);
}
