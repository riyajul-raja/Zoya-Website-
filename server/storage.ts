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

// Detect serverless environment (Vercel, AWS Lambda) where process.cwd() is read-only
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

// Ensure persistent directories exist safely without crashing on read-only filesystems
function ensureDataDirs() {
  const { dataDir, releasesFile, apksDir } = getStoragePaths();

  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    if (!fs.existsSync(apksDir)) {
      fs.mkdirSync(apksDir, { recursive: true });
    }
    if (!fs.existsSync(releasesFile)) {
      // Check if seed file exists in bundled .data/releases.json
      const bundledFile = path.resolve(process.cwd(), '.data', 'releases.json');
      if (fs.existsSync(bundledFile)) {
        try {
          const bundledContent = fs.readFileSync(bundledFile, 'utf-8');
          fs.writeFileSync(releasesFile, bundledContent, 'utf-8');
        } catch {
          fs.writeFileSync(releasesFile, JSON.stringify([], null, 2), 'utf-8');
        }
      } else {
        fs.writeFileSync(releasesFile, JSON.stringify([], null, 2), 'utf-8');
      }
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

export async function getAllReleases(): Promise<ReleaseMetadata[]> {
  ensureDataDirs();
  const { releasesFile } = getStoragePaths();
  try {
    if (fs.existsSync(releasesFile)) {
      const raw = fs.readFileSync(releasesFile, 'utf-8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    }
    // Fallback: check if read-only bundled file exists
    const bundledFile = path.resolve(process.cwd(), '.data', 'releases.json');
    if (fs.existsSync(bundledFile)) {
      const raw = fs.readFileSync(bundledFile, 'utf-8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    }
    return [];
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
  const { releasesFile } = getStoragePaths();
  const all = await getAllReleases();
  const index = all.findIndex((r) => r.id === release.id);
  if (index >= 0) {
    all[index] = { ...release, updatedAt: new Date().toISOString() };
  } else {
    all.push(release);
  }
  fs.writeFileSync(releasesFile, JSON.stringify(all, null, 2), 'utf-8');
}

export async function deleteRelease(id: string): Promise<boolean> {
  ensureDataDirs();
  const { releasesFile, apksDir } = getStoragePaths();
  const all = await getAllReleases();
  const release = all.find((r) => r.id === id);
  if (!release) return false;

  // Remove physical file if in storage
  const filePath = path.join(apksDir, release.storageKey);
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch (e) {
      console.warn('Could not delete APK file:', e);
    }
  }

  const filtered = all.filter((r) => r.id !== id);
  fs.writeFileSync(releasesFile, JSON.stringify(filtered, null, 2), 'utf-8');
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
  const { apksDir } = getStoragePaths();

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
  const targetPath = path.join(apksDir, storageKey);

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
  const { apksDir } = getStoragePaths();
  const filePath = path.join(apksDir, storageKey);
  if (fs.existsSync(filePath)) {
    return filePath;
  }
  // Fallback to bundled apk if in repo
  const bundledFile = path.resolve(process.cwd(), '.data', 'apks', storageKey);
  if (fs.existsSync(bundledFile)) {
    return bundledFile;
  }
  return null;
}
