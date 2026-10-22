import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getDb, getStorageInstance } from './firebase';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  Bytes,
} from 'firebase/firestore';
import {
  ref,
  uploadBytes,
  getBytes,
  deleteObject,
} from 'firebase/storage';

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

export async function getAllReleases(): Promise<ReleaseMetadata[]> {
  try {
    const db = getDb();
    const snapshot = await getDocs(collection(db, 'releases'));
    const releases: ReleaseMetadata[] = [];
    snapshot.forEach((docSnap) => {
      const data = docSnap.data() as ReleaseMetadata;
      if (data && data.id) {
        releases.push(data);
      }
    });
    if (releases.length > 0) {
      return releases;
    }
  } catch (err) {
    console.warn('Firestore read error, checking local backup:', err);
  }

  ensureDataDirs();
  const { releasesFile } = getStoragePaths();
  if (fs.existsSync(releasesFile)) {
    try {
      const raw = fs.readFileSync(releasesFile, 'utf-8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
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
    const db = getDb();
    const docRef = doc(db, 'releases', id);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      return docSnap.data() as ReleaseMetadata;
    }
  } catch (err) {
    console.warn('Firestore getDoc error, falling back to getAllReleases:', err);
  }
  const all = await getAllReleases();
  return all.find((r) => r.id === id) || null;
}

export async function saveRelease(release: ReleaseMetadata): Promise<void> {
  const updatedRelease: ReleaseMetadata = {
    ...release,
    updatedAt: new Date().toISOString(),
  };

  // 1. Persist permanently to Cloud Firestore
  const db = getDb();
  const docRef = doc(db, 'releases', updatedRelease.id);
  await setDoc(docRef, updatedRelease);

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

export async function deleteRelease(id: string): Promise<boolean> {
  if (!id) return false;

  const existingRecord = await getReleaseById(id);
  if (!existingRecord) return false;

  const db = getDb();

  // 1. Delete permanently from Cloud Firestore releases collection
  try {
    await deleteDoc(doc(db, 'releases', id));
  } catch (err) {
    console.error('Firestore deleteRelease error:', err);
  }

  // 2. Delete binary chunks from Cloud Firestore apk_chunks collection
  if (existingRecord.storageKey) {
    try {
      let totalChunks = existingRecord.chunkCount || 0;
      if (!totalChunks) {
        const chunk0 = await getDoc(doc(db, 'apk_chunks', `${existingRecord.storageKey}_chunk_0`));
        if (chunk0.exists()) {
          totalChunks = Number(chunk0.data()?.totalChunks) || 1;
        }
      }
      if (totalChunks > 0) {
        const delPromises: Promise<void>[] = [];
        for (let i = 0; i < totalChunks; i++) {
          delPromises.push(deleteDoc(doc(db, 'apk_chunks', `${existingRecord.storageKey}_chunk_${i}`)));
        }
        await Promise.allSettled(delPromises);
      }
    } catch (err) {
      console.warn('Firestore apk_chunks cleanup notice:', err);
    }

    // 3. Also attempt delete from Firebase Cloud Storage if bucket exists
    const storageObjectPath = existingRecord.storagePath || `apks/${existingRecord.storageKey}`;
    if (storageObjectPath.startsWith('apks/')) {
      try {
        const storage = getStorageInstance();
        const storageRef = ref(storage, storageObjectPath);
        await deleteObject(storageRef);
      } catch {
        // Ignore if bucket not provisioned
      }
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

  const db = getDb();
  const uint8 = new Uint8Array(chunkBuffer.buffer, chunkBuffer.byteOffset, chunkBuffer.byteLength);
  await setDoc(doc(db, 'apk_chunks', `${storageKey}_chunk_${index}`), {
    storageKey,
    index,
    totalChunks,
    size: chunkBuffer.length,
    data: Bytes.fromUint8Array(uint8),
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
    const db = getDb();
    const firstSnap = await getDoc(doc(db, 'apk_chunks', `${storageKey}_chunk_0`));
    if (!firstSnap.exists()) return false;
    const firstData = firstSnap.data();
    if (!firstData || !firstData.data) return false;
    const firstBytes: Uint8Array = firstData.data.toUint8Array();
    if (!isValidApkHeader(firstBytes)) return false;

    if (totalChunks > 1) {
      const lastSnap = await getDoc(doc(db, 'apk_chunks', `${storageKey}_chunk_${totalChunks - 1}`));
      if (!lastSnap.exists()) return false;
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
    const db = getDb();
    const chunk0Snap = await getDoc(doc(db, 'apk_chunks', `${release.storageKey}_chunk_0`));
    if (chunk0Snap.exists()) {
      const d = chunk0Snap.data();
      if (d && d.data && typeof d.data.toUint8Array === 'function') {
        const bytes = d.data.toUint8Array();
        if (isValidApkHeader(bytes)) {
          return true;
        }
      }
    }
  } catch (err) {
    console.warn('hasApkBinary Firestore check error:', err);
  }

  // 2. Check local disk only when not on Vercel serverless (or if bundled in repo)
  const bundledFile = path.resolve(process.cwd(), '.data', 'apks', release.storageKey);
  if (fs.existsSync(bundledFile)) {
    return true;
  }

  // 3. Check Firebase Cloud Storage if bucket exists
  const objectPath = release.storagePath || `apks/${release.storageKey}`;
  if (objectPath.startsWith('apks/')) {
    try {
      const storage = getStorageInstance();
      const storageRef = ref(storage, objectPath);
      const bytes = await getBytes(storageRef, 16);
      if (bytes && bytes.byteLength >= 4) {
        return true;
      }
    } catch {
      // Bucket not provisioned or object does not exist
    }
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
    const db = getDb();
    let total = chunkCount && chunkCount > 0 ? chunkCount : 0;
    let chunk0Buffer: Buffer | null = null;

    if (!total) {
      const snap0 = await getDoc(doc(db, 'apk_chunks', `${storageKey}_chunk_0`));
      if (snap0.exists()) {
        const data0 = snap0.data();
        if (data0 && data0.data && typeof data0.data.toUint8Array === 'function') {
          total = Number(data0.totalChunks) || 1;
          chunk0Buffer = Buffer.from(data0.data.toUint8Array());
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
          indices.map((idx) => getDoc(doc(db, 'apk_chunks', `${storageKey}_chunk_${idx}`)))
        );

        let allFound = true;
        for (let k = 0; k < snaps.length; k++) {
          const snap = snaps[k];
          if (!snap.exists()) {
            allFound = false;
            break;
          }
          const d = snap.data();
          if (!d || !d.data || typeof d.data.toUint8Array !== 'function') {
            allFound = false;
            break;
          }
          chunkBuffers[indices[k]] = Buffer.from(d.data.toUint8Array());
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

  // 3. Fallback: try Firebase Cloud Storage if bucket is provisioned
  const objectPath = storagePath && storagePath.startsWith('apks/') ? storagePath : `apks/${storageKey}`;
  try {
    const storage = getStorageInstance();
    const storageRef = ref(storage, objectPath);
    const arrayBuffer = await getBytes(storageRef);
    const buffer = Buffer.from(arrayBuffer);
    if (isValidApkHeader(buffer)) {
      try {
        fs.writeFileSync(localPath, buffer);
      } catch {
        // Ignored
      }
      return buffer;
    }
  } catch {
    // Storage bucket not provisioned or object missing
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
