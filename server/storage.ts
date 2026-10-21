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
} from 'firebase/firestore';
import {
  ref,
  uploadBytes,
  getBytes,
  deleteObject,
} from 'firebase/storage';

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
  downloadUrl: string;
  releaseDate: string;
  releaseNotes: string;
  minAndroidVersion: string;
  isPublished: boolean;
  publishedAt?: string;
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
  try {
    const db = getDb();
    const docRef = doc(db, 'releases', updatedRelease.id);
    await setDoc(docRef, updatedRelease);
  } catch (err) {
    console.error('Firestore saveRelease error:', err);
  }

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

  // 1. Delete permanently from Cloud Firestore
  try {
    const db = getDb();
    const docRef = doc(db, 'releases', id);
    await deleteDoc(docRef);
  } catch (err) {
    console.error('Firestore deleteRelease error:', err);
  }

  // 2. Delete object from Firebase Cloud Storage
  if (existingRecord.storageKey) {
    const storageObjectPath = existingRecord.storagePath || `apks/${existingRecord.storageKey}`;
    try {
      const storage = getStorageInstance();
      const storageRef = ref(storage, storageObjectPath);
      await deleteObject(storageRef);
    } catch (err) {
      console.warn('Firebase Cloud Storage delete notice:', err);
    }
  }

  // 3. Remove physical local file cache if present
  ensureDataDirs();
  const { apksDir, releasesFile } = getStoragePaths();
  const filePath = path.join(apksDir, existingRecord.storageKey);
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch (e) {
      console.warn('Could not delete local APK file:', e);
    }
  }

  // 4. Update local backup file
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
// PERSISTENT FIREBASE CLOUD STORAGE APK BINARY OPERATIONS
// ----------------------------------------------------

/**
 * Saves uploaded APK file buffer persistently to Firebase Cloud Storage,
 * calculates SHA-256 checksum and size, and caches locally for current invocation.
 */
export async function storeApkBuffer(
  buffer: Buffer,
  originalFilename: string
): Promise<{
  storageKey: string;
  storagePath: string;
  fileSize: number;
  fileSizeFormatted: string;
  sha256: string;
}> {
  // Validate ZIP / APK Magic Bytes ('PK\x03\x04')
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b || buffer[2] !== 0x03 || buffer[3] !== 0x04) {
    throw new Error('Invalid APK file: Header does not match Android Package / ZIP format (magic bytes PK\\x03\\x04).');
  }

  // Calculate genuine SHA-256 checksum server-side
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const fileSize = buffer.length;
  const fileSizeFormatted = formatBytes(fileSize);

  // Generate unique storage key and cloud storage object path
  const safeBase = path.basename(originalFilename).replace(/[^a-zA-Z0-9._-]/g, '_');
  const storageKey = `${Date.now()}-${safeBase}`;
  const storagePath = `apks/${storageKey}`;

  // 1. Upload persistently to Firebase Cloud Storage
  try {
    const storage = getStorageInstance();
    const storageRef = ref(storage, storagePath);
    const uint8Array = new Uint8Array(buffer);
    await uploadBytes(storageRef, uint8Array, {
      contentType: 'application/vnd.android.package-archive',
      customMetadata: {
        originalFilename,
        sha256,
        uploadedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('Firebase Cloud Storage upload error:', err);
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
    fileSize,
    fileSizeFormatted,
    sha256,
  };
}

/**
 * Retrieves APK binary buffer persistently across Vercel serverless invocations.
 * First checks local cache, then downloads persistently from Firebase Cloud Storage.
 */
export async function getApkBuffer(storageKey: string, storagePath?: string): Promise<Buffer | null> {
  if (!storageKey) return null;

  // 1. Check local cache first
  ensureDataDirs();
  const { apksDir } = getStoragePaths();
  const localPath = path.join(apksDir, storageKey);
  if (fs.existsSync(localPath)) {
    try {
      return fs.readFileSync(localPath);
    } catch (e) {
      console.warn('Local APK cache read error:', e);
    }
  }

  // Check bundled repository file
  const bundledFile = path.resolve(process.cwd(), '.data', 'apks', storageKey);
  if (fs.existsSync(bundledFile)) {
    try {
      return fs.readFileSync(bundledFile);
    } catch (e) {
      console.warn('Bundled APK read error:', e);
    }
  }

  // 2. Download permanently from Firebase Cloud Storage across separate Lambdas
  const objectPath = storagePath || `apks/${storageKey}`;
  try {
    const storage = getStorageInstance();
    const storageRef = ref(storage, objectPath);
    const arrayBuffer = await getBytes(storageRef);
    const buffer = Buffer.from(arrayBuffer);

    // Cache locally for fast subsequent reads on this container instance
    try {
      fs.writeFileSync(localPath, buffer);
    } catch {
      // Ignored
    }

    return buffer;
  } catch (err) {
    console.error(`Firebase Cloud Storage download error for path ${objectPath}:`, err);
    return null;
  }
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
