import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  serverGetCollectionDocs,
  serverGetDocumentById,
  serverSetDocumentById,
  serverDeleteDocumentById,
  extractBinaryBuffer,
} from './firebase';

// 512 KB per chunk — safely under Firestore's 1 MiB document limit and Vercel's 4.5 MB request limit
export const APK_CHUNK_SIZE = 524288;

export interface ReleaseMetadata {
  id: string;
  versionName: string;
  versionCode: number;
  applicationId: string;
  fileName: string;
  fileSize: number;
  fileSizeFormatted: string;
  sha256: string;
  storageKey: string;
  storagePath?: string;
  chunkCount?: number;
  binaryVerified?: boolean;
  downloadUrl: string;
  releaseDate: string;
  releaseNotes: string;
  minAndroidVersion: string;
  minSdkVersion?: number | null;
  targetSdkVersion?: number | null;
  targetAndroidVersion?: string | null;
  isPublished: boolean;
  publishedAt?: string;
  notificationSentAt?: string;
  notificationMessageId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReleaseManifest {
  applicationId: string;
  latestRelease: {
    versionName: string;
    versionCode: number;
    downloadUrl: string;
    sha256: string;
    fileSize: number;
    fileSizeFormatted: string;
    minAndroidVersion: string;
    minSdkVersion?: number | null;
    targetSdkVersion?: number | null;
    releaseDate: string;
    releaseNotes: string;
  };
  publishedAt: string;
}

// Detect serverless environment (Vercel, AWS Lambda)
const IS_SERVERLESS = Boolean(
  process.env.VERCEL ||
  process.env.AWS_LAMBDA_FUNCTION_NAME ||
  process.env.LAMBDA_TASK_ROOT
);

function getStoragePaths() {
  if (IS_SERVERLESS) {
    const tmpData = path.join('/tmp', 'zoya-data');
    return {
      dataDir: tmpData,
      releasesFile: path.join(tmpData, 'releases.json'),
      apksDir: path.join(tmpData, 'apks'),
    };
  }

  // Local development
  const localData = path.resolve(process.cwd(), '.data');
  return {
    dataDir: localData,
    releasesFile: path.join(localData, 'releases.json'),
    apksDir: path.join(localData, 'apks'),
  };
}

function ensureDataDirs() {
  const { dataDir, apksDir } = getStoragePaths();
  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    if (!fs.existsSync(apksDir)) {
      fs.mkdirSync(apksDir, { recursive: true });
    }
  } catch (err) {
    console.warn('Storage directory initialization notice:', err);
  }
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function isValidApkHeader(buffer: Buffer | Uint8Array): boolean {
  return (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    buffer[2] === 0x03 &&
    buffer[3] === 0x04
  );
}

// ----------------------------------------------------
// PERSISTENT FIRESTORE METADATA OPERATIONS
// ----------------------------------------------------

const RELEASES_CACHE_TTL_MS = 60_000;
let releasesCache: { data: ReleaseMetadata[]; cachedAt: number } | null = null;

function logStorageNotice(context: string, err: unknown): void {
  const errMessage = String((err as any)?.message || err);
  if (errMessage.includes('FIREBASE_SERVICE_ACCOUNT_JSON is required')) {
    return;
  }
  const isQuota =
    (err as any)?.code === 'resource-exhausted' ||
    errMessage.includes('Quota limit exceeded');
  if (isQuota) {
    console.warn(`${context}: Daily free tier read/write quota limit reached. Using local/cached fallback.`);
  } else {
    console.warn(`${context}:`, err);
  }
}

export function clearReleasesInMemoryCache(): void {
  releasesCache = null;
}

export async function getAllReleases(): Promise<ReleaseMetadata[]> {
  if (releasesCache && Date.now() - releasesCache.cachedAt < RELEASES_CACHE_TTL_MS) {
    return releasesCache.data;
  }

  try {
    const docs = await serverGetCollectionDocs('releases');
    const releases: ReleaseMetadata[] = [];
    for (const docSnap of docs) {
      const data = docSnap.data as ReleaseMetadata;
      if (data && data.id) {
        releases.push(data);
      }
    }
    if (releases.length > 0) {
      releasesCache = { data: releases, cachedAt: Date.now() };
      return releases;
    }
  } catch (err) {
    logStorageNotice('Firestore read notice, checking local backup', err);
  }

  ensureDataDirs();
  const { releasesFile } = getStoragePaths();
  if (fs.existsSync(releasesFile)) {
    try {
      const raw = fs.readFileSync(releasesFile, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        releasesCache = { data: parsed, cachedAt: Date.now() };
        return parsed;
      }
    } catch {
      // Ignore
    }
  }
  return releasesCache ? releasesCache.data : [];
}

export async function getPublishedReleases(): Promise<ReleaseMetadata[]> {
  const all = await getAllReleases();
  return all
    .filter((r) => r.isPublished)
    .sort((a, b) => b.versionCode - a.versionCode);
}

export async function getLatestPublishedRelease(): Promise<ReleaseMetadata | null> {
  const published = await getPublishedReleases();
  return published.length > 0 ? published[0] : null;
}

export async function getReleaseById(id: string): Promise<ReleaseMetadata | null> {
  if (!id) return null;
  try {
    const docSnap = await serverGetDocumentById('releases', id);
    if (docSnap.exists && docSnap.data) {
      return docSnap.data as ReleaseMetadata;
    }
  } catch (err) {
    logStorageNotice('Firestore getDoc notice, falling back to getAllReleases', err);
  }
  const all = await getAllReleases();
  return all.find((r) => r.id === id) || null;
}

export async function saveRelease(release: ReleaseMetadata): Promise<void> {
  clearReleasesInMemoryCache();
  const rawRelease: ReleaseMetadata = {
    ...release,
    updatedAt: new Date().toISOString(),
  };

  // Strip any undefined fields so Firestore setDoc never rejects the document
  const updatedRelease = Object.fromEntries(
    Object.entries(rawRelease).filter(([, v]) => v !== undefined)
  ) as unknown as ReleaseMetadata;

  // 1. Persist permanently to Cloud Firestore
  await serverSetDocumentById('releases', updatedRelease.id, updatedRelease);

  // 2. Also save to local storage file as backup
  try {
    ensureDataDirs();
    const { releasesFile } = getStoragePaths();
    const all = await getAllReleases();
    const index = all.findIndex((r) => r.id === updatedRelease.id);
    if (index >= 0) {
      all[index] = updatedRelease;
    } else {
      all.push(updatedRelease);
    }
    fs.writeFileSync(releasesFile, JSON.stringify(all, null, 2), 'utf-8');
  } catch (err) {
    console.warn('Local releases backup write notice:', err);
  }
}

export async function deleteStoredChunks(storageKey: string, totalChunks: number): Promise<void> {
  if (!storageKey || totalChunks <= 0) return;
  try {
    const delPromises: Promise<void>[] = [];
    for (let i = 0; i < totalChunks; i++) {
      delPromises.push(serverDeleteDocumentById('apk_chunks', `${storageKey}_chunk_${i}`));
    }
    await Promise.allSettled(delPromises);
  } catch (err) {
    console.warn('Firestore apk_chunks cleanup notice:', err);
  }
}

export async function deleteRelease(id: string): Promise<boolean> {
  if (!id) return false;
  clearReleasesInMemoryCache();

  const existingRecord = await getReleaseById(id);
  if (!existingRecord) return false;

  // 1. Delete permanently from Cloud Firestore releases collection
  try {
    await serverDeleteDocumentById('releases', id);
  } catch (err) {
    console.error('Firestore deleteRelease error:', err);
  }

  // 2. Delete binary chunks from Cloud Firestore apk_chunks collection
  if (existingRecord.storageKey) {
    try {
      let totalChunks = existingRecord.chunkCount || 0;
      if (!totalChunks) {
        const chunk0 = await serverGetDocumentById('apk_chunks', `${existingRecord.storageKey}_chunk_0`);
        if (chunk0.exists && chunk0.data) {
          totalChunks = Number(chunk0.data.totalChunks) || 1;
        }
      }
      if (totalChunks > 0) {
        const delPromises: Promise<void>[] = [];
        for (let i = 0; i < totalChunks; i++) {
          delPromises.push(
            serverDeleteDocumentById('apk_chunks', `${existingRecord.storageKey}_chunk_${i}`)
          );
        }
        await Promise.allSettled(delPromises);
      }
    } catch (err) {
      console.warn('Firestore apk_chunks cleanup notice:', err);
    }
  }

  // 4. Remove physical local file cache if present
  ensureDataDirs();
  const { apksDir, releasesFile } = getStoragePaths();
  if (existingRecord.storageKey) {
    const filePath = path.join(apksDir, existingRecord.storageKey);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (e) {
        console.warn('Could not delete local APK file:', e);
      }
    }
  }

  // 5. Update local backup file
  try {
    const all = await getAllReleases();
    const filtered = all.filter((r) => r.id !== id);
    fs.writeFileSync(releasesFile, JSON.stringify(filtered, null, 2), 'utf-8');
  } catch (err) {
    console.warn('Local releases backup update notice:', err);
  }

  return true;
}

// ----------------------------------------------------
// PERSISTENT APK BINARY CHUNK OPERATIONS (FIRESTORE + STORAGE)
// ----------------------------------------------------

/**
 * Stores a single binary chunk (<= 512 KB) in Cloud Firestore `apk_chunks`.
 */
export async function storeApkChunk(
  storageKey: string,
  index: number,
  totalChunks: number,
  chunkBuffer: Buffer
): Promise<void> {
  if (!storageKey) {
    throw new Error('storageKey is required for chunk storage.');
  }
  if (index === 0 && !isValidApkHeader(chunkBuffer)) {
    throw new Error('Invalid APK file: Header does not match Android Package / ZIP format (magic bytes PK\\x03\\x04).');
  }
  if (chunkBuffer.length > 900000) {
    throw new Error(`Chunk size (${chunkBuffer.length} bytes) exceeds safe Firestore document limit.`);
  }

  const binarySlice = Buffer.from(chunkBuffer.buffer, chunkBuffer.byteOffset, chunkBuffer.byteLength);
  await serverSetDocumentById('apk_chunks', `${storageKey}_chunk_${index}`, {
    storageKey,
    index,
    totalChunks,
    size: chunkBuffer.length,
    data: binarySlice,
    createdAt: new Date().toISOString(),
  });
}

/**
 * Verifies that all expected chunks (or chunk 0 and last chunk) exist in Cloud Firestore.
 */
export async function verifyStoredChunks(
  storageKey: string,
  totalChunks: number
): Promise<boolean> {
  if (!storageKey || totalChunks <= 0) return false;
  try {
    const firstSnap = await serverGetDocumentById('apk_chunks', `${storageKey}_chunk_0`);
    if (!firstSnap.exists || !firstSnap.data) return false;
    const firstBytes = extractBinaryBuffer(firstSnap.data.data);
    if (!firstBytes || !isValidApkHeader(firstBytes)) return false;

    if (totalChunks > 1) {
      const lastSnap = await serverGetDocumentById(
        'apk_chunks',
        `${storageKey}_chunk_${totalChunks - 1}`
      );
      if (!lastSnap.exists) return false;
    }
    return true;
  } catch (err) {
    console.error('Error verifying stored APK chunks:', err);
    return false;
  }
}

/**
 * Checks whether the APK binary for a given release record actually exists in persistent storage.
 */
export async function hasApkBinary(release: ReleaseMetadata | null | undefined): Promise<boolean> {
  if (!release || !release.storageKey) return false;

  // 1. Check Cloud Firestore apk_chunks (primary persistent cross-instance store)
  try {
    const chunk0Snap = await serverGetDocumentById('apk_chunks', `${release.storageKey}_chunk_0`);
    if (chunk0Snap.exists && chunk0Snap.data) {
      const bytes = extractBinaryBuffer(chunk0Snap.data.data);
      if (bytes && isValidApkHeader(bytes)) {
        return true;
      }
    }
  } catch (err) {
    logStorageNotice('hasApkBinary Firestore notice', err);
  }

  // 2. Check local disk only when not on Vercel serverless (or if bundled in repo)
  const bundledFile = path.resolve(process.cwd(), '.data', 'apks', release.storageKey);
  if (fs.existsSync(bundledFile)) {
    return true;
  }

  return false;
}

/**
 * Saves uploaded APK file buffer persistently to Cloud Firestore (`apk_chunks`),
 * calculates SHA-256 checksum and size, and caches locally for current invocation.
 */
export async function storeApkBuffer(
  buffer: Buffer,
  originalFilename: string
): Promise<{
  storageKey: string;
  storagePath: string;
  chunkCount: number;
  fileSize: number;
  fileSizeFormatted: string;
  sha256: string;
}> {
  // Validate ZIP / APK Magic Bytes ('PK\x03\x04')
  if (!isValidApkHeader(buffer)) {
    throw new Error('Invalid APK file: Header does not match Android Package / ZIP format (magic bytes PK\\x03\\x04).');
  }

  // Calculate genuine SHA-256 checksum server-side
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const fileSize = buffer.length;
  const fileSizeFormatted = formatBytes(fileSize);

  // Generate unique storage key
  const safeBase = path.basename(originalFilename).replace(/[^a-zA-Z0-9._-]/g, '_');
  const storageKey = `${Date.now()}-${safeBase}`;
  const storagePath = `apk_chunks/${storageKey}`;
  const totalChunks = Math.ceil(buffer.length / APK_CHUNK_SIZE);

  // 1. Persist all chunks to Cloud Firestore `apk_chunks` (primary persistent storage)
  for (let i = 0; i < totalChunks; i += 3) {
    const batchPromises: Promise<void>[] = [];
    for (let j = i; j < Math.min(i + 3, totalChunks); j++) {
      const slice = buffer.subarray(j * APK_CHUNK_SIZE, Math.min((j + 1) * APK_CHUNK_SIZE, buffer.length));
      batchPromises.push(storeApkChunk(storageKey, j, totalChunks, slice));
    }
    await Promise.all(batchPromises);
  }

  // 2. Cache in local disk for fast access in current process/invocation
  try {
    ensureDataDirs();
    const { apksDir } = getStoragePaths();
    const targetPath = path.join(apksDir, storageKey);
    fs.writeFileSync(targetPath, buffer);
  } catch (err) {
    console.warn('Local APK cache write notice:', err);
  }

  return {
    storageKey,
    storagePath,
    chunkCount: totalChunks,
    fileSize,
    fileSizeFormatted,
    sha256,
  };
}

/**
 * Retrieves APK binary buffer persistently across Vercel serverless invocations.
 * Checks local cache first, then reassembles binary chunks from Cloud Firestore `apk_chunks`,
 * then falls back to Firebase Cloud Storage if configured.
 */
export async function getApkBuffer(
  storageKey: string,
  storagePath?: string,
  chunkCount?: number
): Promise<Buffer | null> {
  if (!storageKey) return null;

  // 1. Check local cache first
  ensureDataDirs();
  const { apksDir } = getStoragePaths();
  const localPath = path.join(apksDir, storageKey);
  if (fs.existsSync(localPath)) {
    try {
      const cached = fs.readFileSync(localPath);
      if (isValidApkHeader(cached)) {
        return cached;
      }
    } catch (e) {
      console.warn('Local APK cache read error:', e);
    }
  }

  // Check bundled repository file
  const bundledFile = path.resolve(process.cwd(), '.data', 'apks', storageKey);
  if (fs.existsSync(bundledFile)) {
    try {
      const bundled = fs.readFileSync(bundledFile);
      if (isValidApkHeader(bundled)) {
        return bundled;
      }
    } catch (e) {
      console.warn('Bundled APK read error:', e);
    }
  }

  // 2. Download permanently from Cloud Firestore `apk_chunks` across separate Vercel Lambdas
  try {
    let total = chunkCount && chunkCount > 0 ? chunkCount : 0;
    let chunk0Buffer: Buffer | null = null;

    if (!total) {
      const snap0 = await serverGetDocumentById('apk_chunks', `${storageKey}_chunk_0`);
      if (snap0.exists && snap0.data) {
        const bytes0 = extractBinaryBuffer(snap0.data.data);
        if (bytes0) {
          total = Number(snap0.data.totalChunks) || 1;
          chunk0Buffer = bytes0;
        }
      }
    }

    if (total > 0) {
      const chunkBuffers: Buffer[] = new Array(total);
      const startIndex = chunk0Buffer ? 1 : 0;
      if (chunk0Buffer) {
        chunkBuffers[0] = chunk0Buffer;
      }

      if (startIndex < total) {
        const indices = Array.from({ length: total - startIndex }, (_, idx) => idx + startIndex);
        const snaps = await Promise.all(
          indices.map((idx) => serverGetDocumentById('apk_chunks', `${storageKey}_chunk_${idx}`))
        );

        let allFound = true;
        for (let k = 0; k < snaps.length; k++) {
          const snap = snaps[k];
          if (!snap.exists || !snap.data) {
            allFound = false;
            break;
          }
          const buf = extractBinaryBuffer(snap.data.data);
          if (!buf) {
            allFound = false;
            break;
          }
          chunkBuffers[indices[k]] = buf;
        }

        if (allFound) {
          const fullBuffer = Buffer.concat(chunkBuffers);
          if (isValidApkHeader(fullBuffer)) {
            try {
              fs.writeFileSync(localPath, fullBuffer);
            } catch {
              // Ignore local cache write error
            }
            return fullBuffer;
          }
        }
      } else if (chunk0Buffer && isValidApkHeader(chunk0Buffer)) {
        try {
          fs.writeFileSync(localPath, chunk0Buffer);
        } catch {
          // Ignore
        }
        return chunk0Buffer;
      }
    }
  } catch (err) {
    console.error(`Firestore apk_chunks download error for ${storageKey}:`, err);
  }

  return null;
}

export function getApkFilePath(storageKey: string): string | null {
  ensureDataDirs();
  const { apksDir } = getStoragePaths();
  const filePath = path.join(apksDir, storageKey);
  if (fs.existsSync(filePath)) {
    return filePath;
  }
  const bundledFile = path.resolve(process.cwd(), '.data', 'apks', storageKey);
  if (fs.existsSync(bundledFile)) {
    return bundledFile;
  }
  return null;
}
