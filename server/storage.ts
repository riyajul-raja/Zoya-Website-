import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

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

const DATA_DIR = path.resolve(process.cwd(), '.data');
const RELEASES_FILE = path.join(DATA_DIR, 'releases.json');
const APKS_DIR = path.join(DATA_DIR, 'apks');

// Ensure local persistent directories exist
function ensureDataDirs() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(APKS_DIR)) {
    fs.mkdirSync(APKS_DIR, { recursive: true });
  }
  if (!fs.existsSync(RELEASES_FILE)) {
    fs.writeFileSync(RELEASES_FILE, JSON.stringify([], null, 2), 'utf-8');
  }
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export async function getAllReleases(): Promise<ReleaseMetadata[]> {
  ensureDataDirs();
  try {
    const raw = fs.readFileSync(RELEASES_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('Error reading releases file:', err);
    return [];
  }
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
  const all = await getAllReleases();
  return all.find((r) => r.id === id) || null;
}

export async function saveRelease(release: ReleaseMetadata): Promise<void> {
  ensureDataDirs();
  const all = await getAllReleases();
  const index = all.findIndex((r) => r.id === release.id);
  if (index >= 0) {
    all[index] = { ...release, updatedAt: new Date().toISOString() };
  } else {
    all.push(release);
  }
  fs.writeFileSync(RELEASES_FILE, JSON.stringify(all, null, 2), 'utf-8');
}

export async function deleteRelease(id: string): Promise<boolean> {
  ensureDataDirs();
  const all = await getAllReleases();
  const release = all.find((r) => r.id === id);
  if (!release) return false;

  // Remove physical file if in local storage
  const filePath = path.join(APKS_DIR, release.storageKey);
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch (e) {
      console.warn('Could not delete APK file:', e);
    }
  }

  const filtered = all.filter((r) => r.id !== id);
  fs.writeFileSync(RELEASES_FILE, JSON.stringify(filtered, null, 2), 'utf-8');
  return true;
}

/**
 * Saves uploaded APK file buffer and calculates true SHA-256 checksum and size
 */
export async function storeApkBuffer(
  buffer: Buffer,
  originalFilename: string
): Promise<{
  storageKey: string;
  fileSize: number;
  fileSizeFormatted: string;
  sha256: string;
}> {
  ensureDataDirs();

  // Validate ZIP / APK Magic Bytes ('PK\x03\x04')
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b || buffer[2] !== 0x03 || buffer[3] !== 0x04) {
    throw new Error('Invalid APK file: Header does not match Android Package / ZIP format (magic bytes PK\\x03\\x04).');
  }

  // Calculate genuine SHA-256 checksum server-side
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const fileSize = buffer.length;
  const fileSizeFormatted = formatBytes(fileSize);

  // Generate unique storage key
  const safeBase = path.basename(originalFilename).replace(/[^a-zA-Z0-9._-]/g, '_');
  const storageKey = `${Date.now()}-${safeBase}`;
  const targetPath = path.join(APKS_DIR, storageKey);

  fs.writeFileSync(targetPath, buffer);

  return {
    storageKey,
    fileSize,
    fileSizeFormatted,
    sha256,
  };
}

export function getApkFilePath(storageKey: string): string | null {
  ensureDataDirs();
  const filePath = path.join(APKS_DIR, storageKey);
  if (fs.existsSync(filePath)) {
    return filePath;
  }
  return null;
}
