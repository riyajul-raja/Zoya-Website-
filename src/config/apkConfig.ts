/**
 * Centralized Configuration for Zoya AI Assistant APK Releases
 * 
 * IMPORTANT:
 * - Do not invent arbitrary download links or fake release statistics.
 * - When no verified APK URL is configured, the website automatically displays
 *   "Download Coming Soon" and disables the download button.
 * - When an official build is ready, simply populate `downloadUrl` and verified
 *   metadata below, or supply VITE_ZOYA_APK_URL via environment variables.
 */

export interface ApkReleaseConfig {
  /** The Android package identifier */
  packageName: string;
  /** Current release availability status */
  status: 'available' | 'coming_soon';
  /** Direct URL to the actual APK binary file. Empty string when not yet published. */
  downloadUrl: string;
  /** Confirmed release version tag (e.g., 'v1.0.0'). Only shown when verified. */
  version?: string;
  /** Confirmed APK file size (e.g., '24.6 MB'). Only shown when verified. */
  fileSize?: string;
  /** Confirmed release date. Only shown when verified. */
  releaseDate?: string;
  /** Minimum confirmed Android operating system requirement */
  minAndroidVersion: string;
  /** Target device architecture */
  targetArchitecture?: string;
  /** Optional verified SHA-256 integrity checksum */
  sha256Checksum?: string;
  /** Official project repository or release discussion page */
  projectRepositoryUrl?: string;
  /** Confirmed changelog / feature notes for this release */
  changelog?: string[];
}

/**
 * Production APK Release Configuration
 * 
 * In this production baseline, Zoya is actively being developed by Riyajul.
 * Because no official public APK binary has been published to a permanent host yet,
 * downloadUrl is set to empty and status defaults to 'coming_soon'.
 * 
 * To activate a live release:
 * 1. Set `status: 'available'`
 * 2. Put the direct APK link in `downloadUrl` (e.g. 'https://.../zoya.apk')
 * 3. Fill in the confirmed version, fileSize, and releaseDate.
 */
export const DEFAULT_APK_CONFIG: ApkReleaseConfig = {
  packageName: 'com.riyajul.zoya',
  // Current status: Zoya is actively in development; APK release is coming soon.
  status: (import.meta.env.VITE_ZOYA_APK_URL ? 'available' : 'coming_soon'),
  downloadUrl: import.meta.env.VITE_ZOYA_APK_URL || '',
  version: import.meta.env.VITE_ZOYA_APK_VERSION || undefined,
  fileSize: import.meta.env.VITE_ZOYA_APK_SIZE || undefined,
  releaseDate: import.meta.env.VITE_ZOYA_APK_DATE || undefined,
  minAndroidVersion: 'Android 8.0 (Oreo)+',
  targetArchitecture: 'ARM64 / Universal',
  projectRepositoryUrl: 'https://github.com/riyajul-ansari',
  changelog: [
    'Speech recognition pipeline tuned for clear voice capture',
    'Contextual multi-turn dialogue memory architecture',
    'Customizable speech playback rate and assistant preferences',
    'Designed exclusively for Android with minimal background battery draw',
  ],
};

/**
 * Checks if a real, valid APK download link is configured
 */
export function isApkDownloadAvailable(config: ApkReleaseConfig): boolean {
  if (config.status !== 'available') return false;
  if (!config.downloadUrl || typeof config.downloadUrl !== 'string') return false;
  const trimmed = config.downloadUrl.trim();
  // Must be a non-empty string that resembles a valid URL or path
  return trimmed.length > 4 && (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('/'));
}

/**
 * Generates an appropriate download filename
 */
export function getApkFileName(config: ApkReleaseConfig): string {
  if (config.version) {
    return `zoya-assistant-${config.version}.apk`;
  }
  return 'zoya-assistant.apk';
}
