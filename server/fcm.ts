import crypto from 'crypto';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import { getDb } from './firebase';
import { ReleaseMetadata, hasApkBinary } from './storage';

export const DEFAULT_FCM_TOPIC = 'zoya_releases';
export const DEFAULT_PRODUCTION_SITE_URL = 'https://zoya-website-opal.vercel.app';

interface ServiceAccountCredentials {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

export interface FcmSendResult {
  sent: boolean;
  alreadySent?: boolean;
  skipped?: boolean;
  configured: boolean;
  idempotencyKey: string;
  topic: string;
  projectId: string;
  messageId?: string;
  devicesTargeted?: number;
  devicesSucceeded?: number;
  sentAt?: string;
  reason?: string;
  title: string;
  body: string;
  data: Record<string, string>;
}

let cachedAccessToken: { token: string; expiresAt: number } | null = null;

export function getPublicSiteOrigin(): string {
  const envUrl = (
    process.env.PUBLIC_SITE_URL ||
    DEFAULT_PRODUCTION_SITE_URL
  ).trim();
  if (envUrl.startsWith('http://') || envUrl.startsWith('https://')) {
    return envUrl.replace(/\/+$/, '');
  }
  return DEFAULT_PRODUCTION_SITE_URL;
}

export function getFcmTopic(): string {
  const custom = (process.env.FCM_RELEASE_TOPIC || '').trim();
  return custom || DEFAULT_FCM_TOPIC;
}

/**
 * Resolves Firebase Service Account credentials strictly from server-side environment variables.
 * Never exposes private keys or credentials to client code.
 */
export function getServiceAccountCredentials(): ServiceAccountCredentials | null {
  const rawJson = (process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  if (rawJson) {
    try {
      const decoded = rawJson.startsWith('{')
        ? rawJson
        : Buffer.from(rawJson, 'base64').toString('utf-8');
      const parsed = JSON.parse(decoded);
      const projectId = String(parsed.project_id || firebaseConfig.projectId || '').trim();
      const clientEmail = String(parsed.client_email || '').trim();
      const privateKey = String(parsed.private_key || '').replace(/\\n/g, '\n').trim();

      if (projectId && clientEmail && privateKey.includes('PRIVATE KEY')) {
        return { projectId, clientEmail, privateKey };
      }
    } catch (err) {
      console.error('Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON:', err);
    }
  }

  const projectId = String(
    process.env.FIREBASE_PROJECT_ID || firebaseConfig.projectId || ''
  ).trim();
  const clientEmail = String(process.env.FIREBASE_CLIENT_EMAIL || '').trim();
  const privateKey = String(process.env.FIREBASE_PRIVATE_KEY || '')
    .replace(/\\n/g, '\n')
    .trim();

  if (projectId && clientEmail && privateKey.includes('PRIVATE KEY')) {
    return { projectId, clientEmail, privateKey };
  }

  return null;
}

/**
 * Generates an OAuth2 Bearer access token for Firebase Cloud Messaging HTTP v1 API
 * using Node's native crypto RS256 signer.
 */
async function getFcmAccessToken(creds: ServiceAccountCredentials): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  if (cachedAccessToken && cachedAccessToken.expiresAt - 300 > nowSec) {
    return cachedAccessToken.token;
  }

  const header = Buffer.from(
    JSON.stringify({ alg: 'RS256', typ: 'JWT' })
  ).toString('base64url');

  const payload = Buffer.from(
    JSON.stringify({
      iss: creds.clientEmail,
      sub: creds.clientEmail,
      aud: 'https://oauth2.googleapis.com/token',
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      iat: nowSec,
      exp: nowSec + 3600,
    })
  ).toString('base64url');

  const unsignedJwt = `${header}.${payload}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsignedJwt);
  signer.end();
  const signature = signer.sign(creds.privateKey, 'base64url');
  const assertion = `${unsignedJwt}.${signature}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
  });

  const tokenText = await tokenRes.text();
  let tokenData: any = {};
  try {
    tokenData = tokenText ? JSON.parse(tokenText) : {};
  } catch {
    throw new Error(`Invalid OAuth2 token response (${tokenRes.status})`);
  }

  if (!tokenRes.ok || !tokenData.access_token) {
    throw new Error(
      tokenData.error_description ||
        tokenData.error ||
        `Failed to obtain FCM OAuth2 access token (${tokenRes.status})`
    );
  }

  cachedAccessToken = {
    token: String(tokenData.access_token),
    expiresAt: nowSec + (Number(tokenData.expires_in) || 3600),
  };

  return cachedAccessToken.token;
}

/**
 * Builds the exact notification title, body, and data payload for a published release.
 */
export function buildReleaseNotificationContent(release: ReleaseMetadata): {
  title: string;
  body: string;
  data: Record<string, string>;
} {
  const siteOrigin = getPublicSiteOrigin();
  const relativeDownload = release.downloadUrl.startsWith('/')
    ? release.downloadUrl
    : `/${release.downloadUrl}`;
  const fullDownloadUrl = release.downloadUrl.startsWith('http')
    ? release.downloadUrl
    : `${siteOrigin}${relativeDownload}`;

  const title = 'Zoya Update Available';
  const body = `Zoya ${release.versionName} is now available and ready to install.`;

  const data: Record<string, string> = {
    type: 'apk_release',
    action: 'OPEN_APP_UPDATE',
    releaseId: String(release.id),
    versionName: String(release.versionName),
    versionCode: String(release.versionCode),
    applicationId: String(release.applicationId || 'com.riyajul.zoya'),
    downloadUrl: fullDownloadUrl,
    manifestUrl: `${siteOrigin}/api/releases/manifest`,
    sha256: String(release.sha256 || ''),
    fileSize: String(release.fileSize || 0),
    fileSizeFormatted: String(release.fileSizeFormatted || ''),
    minAndroidVersion: String(release.minAndroidVersion || 'Android 8.0 (API 26)+'),
    releaseDate: String(release.releaseDate || ''),
    releaseNotes: String(release.releaseNotes || ''),
    publishedAt: String(release.publishedAt || new Date().toISOString()),
  };

  return { title, body, data };
}

/**
 * Dispatches a single FCM HTTP v1 message to either a topic or a specific device token.
 */
async function sendFcmV1Request(
  projectId: string,
  accessToken: string,
  target: { topic: string } | { token: string },
  title: string,
  body: string,
  data: Record<string, string>,
  notificationTag: string
): Promise<{ ok: boolean; messageId?: string; errorCode?: string; errorMessage?: string }> {
  const endpoint = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`;

  const fcmPayload = {
    message: {
      ...target,
      notification: {
        title,
        body,
      },
      data,
      android: {
        priority: 'HIGH',
        collapse_key: 'zoya_release_update',
        ttl: '604800s',
        notification: {
          title,
          body,
          channel_id: 'zoya_updates',
          tag: notificationTag,
          click_action: 'OPEN_APP_UPDATE',
          default_sound: true,
          default_vibrate_timings: true,
        },
      },
    },
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(fcmPayload),
  });

  const rawText = await res.text();
  let parsed: any = {};
  try {
    parsed = rawText ? JSON.parse(rawText) : {};
  } catch {
    // Ignore
  }

  if (res.ok && parsed.name) {
    return { ok: true, messageId: String(parsed.name) };
  }

  const errorCode =
    parsed?.error?.details?.[0]?.errorCode ||
    parsed?.error?.status ||
    String(res.status);
  const errorMessage =
    parsed?.error?.message || `FCM HTTP v1 error (${res.status})`;

  return { ok: false, errorCode, errorMessage };
}

/**
 * Registers an Android device's FCM registration token in Firestore (`/fcm_devices/{tokenHash}`).
 */
export async function registerFcmDeviceToken(params: {
  token: string;
  platform?: string;
  applicationId?: string;
  appVersion?: string;
  versionCode?: number;
}): Promise<{ deviceId: string }> {
  const cleanToken = String(params.token || '').trim();
  if (!cleanToken || cleanToken.length < 20) {
    throw new Error('A valid FCM registration token is required.');
  }

  const deviceId = crypto
    .createHash('sha256')
    .update(cleanToken)
    .digest('hex')
    .substring(0, 40);

  const db = getDb();
  const now = new Date().toISOString();
  await setDoc(
    doc(db, 'fcm_devices', deviceId),
    {
      token: cleanToken,
      platform: String(params.platform || 'android'),
      applicationId: String(params.applicationId || 'com.riyajul.zoya'),
      appVersion: String(params.appVersion || ''),
      versionCode: Number(params.versionCode) || 0,
      updatedAt: now,
      createdAt: now,
    },
    { merge: true }
  );

  return { deviceId };
}

/**
 * Returns non-secret FCM configuration status for the Admin Portal.
 */
export async function getFcmStatus(): Promise<{
  configured: boolean;
  projectId: string;
  topic: string;
  registeredDevicesCount: number;
}> {
  const creds = getServiceAccountCredentials();
  const projectId = creds?.projectId || firebaseConfig.projectId || '';
  const topic = getFcmTopic();
  let registeredDevicesCount = 0;

  try {
    const db = getDb();
    const snap = await getDocs(collection(db, 'fcm_devices'));
    registeredDevicesCount = snap.size;
  } catch {
    // Ignore
  }

  return {
    configured: Boolean(creds),
    projectId,
    topic,
    registeredDevicesCount,
  };
}

/**
 * Idempotently sends an FCM push notification for a newly published Zoya Android APK release.
 * - Never sends for unpublished drafts or releases with missing/invalid APK binaries.
 * - Enforces idempotency per (releaseId + versionCode) in Firestore `/fcm_notifications`.
 */
export async function sendReleasePushNotification(
  release: ReleaseMetadata
): Promise<FcmSendResult> {
  const topic = getFcmTopic();
  const idempotencyKey = `${release.id}_v${release.versionCode}`;
  const { title, body, data } = buildReleaseNotificationContent(release);
  const creds = getServiceAccountCredentials();
  const projectId = creds?.projectId || firebaseConfig.projectId || '';

  // 1. Guard: Never send for unpublished drafts
  if (!release.isPublished || !release.id || !release.versionName || release.versionCode <= 0) {
    return {
      sent: false,
      skipped: true,
      configured: Boolean(creds),
      idempotencyKey,
      topic,
      projectId,
      reason: 'Release is not published or has incomplete version metadata.',
      title,
      body,
      data,
    };
  }

  // 2. Guard: Never send if APK binary is missing or invalid in persistent storage
  const binaryValid = await hasApkBinary(release);
  if (!binaryValid) {
    return {
      sent: false,
      skipped: true,
      configured: Boolean(creds),
      idempotencyKey,
      topic,
      projectId,
      reason: 'APK binary is missing or invalid in persistent storage.',
      title,
      body,
      data,
    };
  }

  // 3. Guard: Idempotency check in Firestore `/fcm_notifications/{idempotencyKey}`
  const db = getDb();
  const notifDocRef = doc(db, 'fcm_notifications', idempotencyKey);
  try {
    const existingSnap = await getDoc(notifDocRef);
    if (existingSnap.exists()) {
      const existingData = existingSnap.data();
      if (existingData && existingData.status === 'sent') {
        return {
          sent: false,
          alreadySent: true,
          configured: Boolean(creds),
          idempotencyKey,
          topic,
          projectId,
          messageId: existingData.messageId,
          sentAt: existingData.sentAt,
          reason: 'Push notification was already sent for this published release.',
          title,
          body,
          data,
        };
      }
    }
  } catch (err) {
    console.warn('FCM idempotency check warning:', err);
  }

  if (release.notificationSentAt && release.notificationMessageId) {
    return {
      sent: false,
      alreadySent: true,
      configured: Boolean(creds),
      idempotencyKey,
      topic,
      projectId,
      messageId: release.notificationMessageId,
      sentAt: release.notificationSentAt,
      reason: 'Push notification was already recorded on this release document.',
      title,
      body,
      data,
    };
  }

  // 4. Verify server-side Firebase service account credentials are configured
  if (!creds) {
    return {
      sent: false,
      skipped: true,
      configured: false,
      idempotencyKey,
      topic,
      projectId,
      reason:
        'FCM service account credentials (FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY) are not configured on the server.',
      title,
      body,
      data,
    };
  }

  try {
    const accessToken = await getFcmAccessToken(creds);
    const notificationTag = `zoya_release_${release.id}_v${release.versionCode}`;

    // 5. Send to FCM topic (`zoya_releases`)
    const topicResult = await sendFcmV1Request(
      creds.projectId,
      accessToken,
      { topic },
      title,
      body,
      data,
      notificationTag
    );

    // 6. Also broadcast to any explicitly registered Android device tokens in `/fcm_devices`
    let devicesTargeted = 0;
    let devicesSucceeded = 0;
    try {
      const devicesSnap = await getDocs(collection(db, 'fcm_devices'));
      devicesTargeted = devicesSnap.size;
      const staleDeviceIds: string[] = [];

      const tokenPromises = devicesSnap.docs.map(async (deviceDoc) => {
        const devData = deviceDoc.data();
        const devToken = String(devData?.token || '').trim();
        if (!devToken) return;

        const res = await sendFcmV1Request(
          creds.projectId,
          accessToken,
          { token: devToken },
          title,
          body,
          data,
          notificationTag
        );

        if (res.ok) {
          devicesSucceeded += 1;
        } else if (
          res.errorCode === 'UNREGISTERED' ||
          res.errorCode === 'NOT_FOUND'
        ) {
          staleDeviceIds.push(deviceDoc.id);
        }
      });

      await Promise.allSettled(tokenPromises);

      if (staleDeviceIds.length > 0) {
        await Promise.allSettled(
          staleDeviceIds.map((id) => deleteDoc(doc(db, 'fcm_devices', id)))
        );
      }
    } catch (devErr) {
      console.warn('FCM registered devices broadcast notice:', devErr);
    }

    if (!topicResult.ok && devicesSucceeded === 0) {
      return {
        sent: false,
        configured: true,
        idempotencyKey,
        topic,
        projectId: creds.projectId,
        devicesTargeted,
        devicesSucceeded,
        reason: topicResult.errorMessage || 'FCM dispatch failed.',
        title,
        body,
        data,
      };
    }

    const sentAt = new Date().toISOString();
    const messageId = topicResult.messageId || `devices:${devicesSucceeded}`;

    // 7. Record idempotency lock in Firestore `/fcm_notifications/{idempotencyKey}`
    try {
      await setDoc(notifDocRef, {
        idempotencyKey,
        releaseId: release.id,
        versionName: release.versionName,
        versionCode: release.versionCode,
        status: 'sent',
        messageId,
        topic,
        devicesNotified: devicesSucceeded,
        sentAt,
      });
    } catch (err) {
      console.warn('Could not save FCM idempotency record:', err);
    }

    return {
      sent: true,
      configured: true,
      idempotencyKey,
      topic,
      projectId: creds.projectId,
      messageId,
      devicesTargeted,
      devicesSucceeded,
      sentAt,
      title,
      body,
      data,
    };
  } catch (err: unknown) {
    console.error('FCM sendReleasePushNotification error:', err);
    return {
      sent: false,
      configured: true,
      idempotencyKey,
      topic,
      projectId: creds.projectId,
      reason: err instanceof Error ? err.message : 'Failed to send FCM push notification.',
      title,
      body,
      data,
    };
  }
}
