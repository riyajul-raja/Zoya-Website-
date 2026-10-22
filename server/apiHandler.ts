import type { IncomingMessage, ServerResponse } from 'http';
import path from 'path';
import {
  getAllReleases,
  getLatestPublishedRelease,
  getReleaseById,
  saveRelease,
  deleteRelease,
  storeApkBuffer,
  storeApkChunk,
  verifyStoredChunks,
  hasApkBinary,
  getApkBuffer,
  formatBytes,
  isValidApkHeader,
  ReleaseMetadata,
  ReleaseManifest,
} from './storage';
import {
  authenticateAdmin,
  authenticateAdminPin,
  createToken,
  verifyToken,
  extractAuthToken,
} from './auth';
import {
  sendReleasePushNotification,
  registerFcmDeviceToken,
  getFcmStatus,
} from './fcm';

export function sendJson(res: ServerResponse, status: number, data: unknown) {
  if (res.writableEnded || res.headersSent) {
    return;
  }
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

export function sendError(res: ServerResponse, status: number, message: string) {
  sendJson(res, status, { success: false, error: message });
}

async function parseJsonBody<T>(req: IncomingMessage): Promise<T> {
  const anyReq = req as any;

  // 1. If body has already been parsed by Vercel Serverless / Express / body-parser
  if (anyReq.body !== undefined && anyReq.body !== null) {
    if (Buffer.isBuffer(anyReq.body) || anyReq.body instanceof Uint8Array) {
      try {
        const text = Buffer.from(anyReq.body).toString('utf-8').trim();
        return (text ? JSON.parse(text) : {}) as T;
      } catch {
        throw new Error('Invalid JSON');
      }
    }
    if (typeof anyReq.body === 'string') {
      try {
        const trimmed = anyReq.body.trim();
        return (trimmed ? JSON.parse(trimmed) : {}) as T;
      } catch {
        throw new Error('Invalid JSON');
      }
    }
    if (typeof anyReq.body === 'object') {
      return anyReq.body as T;
    }
  }

  // 2. If the stream already ended and no body was attached
  if (anyReq.readableEnded) {
    return {} as T;
  }

  // 3. Otherwise read from stream with safety timeout so it never hangs
  return new Promise<T>((resolve, reject) => {
    let body = '';
    let done = false;

    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        try {
          const parsed = body.trim() ? JSON.parse(body) : {};
          resolve(parsed as T);
        } catch {
          resolve({} as T);
        }
      }
    }, 2500);

    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 5 * 1024 * 1024) {
        done = true;
        clearTimeout(timer);
        reject(new Error('Request body too large (max 5MB)'));
      }
    });

    req.on('end', () => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        try {
          const parsed = body.trim() ? JSON.parse(body) : {};
          resolve(parsed as T);
        } catch {
          reject(new Error('Invalid JSON'));
        }
      }
    });

    req.on('error', (err) => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        reject(err);
      }
    });
  });
}

async function readBinaryBody(req: IncomingMessage): Promise<Buffer> {
  const anyReq = req as any;

  // 1. Check if Vercel/Express already buffered the body
  if (Buffer.isBuffer(anyReq.body)) {
    return anyReq.body;
  }
  if (anyReq.body instanceof Uint8Array) {
    return Buffer.from(anyReq.body);
  }
  if (anyReq.rawBody && Buffer.isBuffer(anyReq.rawBody)) {
    return anyReq.rawBody;
  }
  if (typeof anyReq.body === 'string') {
    return Buffer.from(anyReq.body, 'binary');
  }

  if (anyReq.readableEnded) {
    return Buffer.alloc(0);
  }

  // 2. Stream binary chunks with safety timeout
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalSize = 0;
    const MAX_SIZE = 150 * 1024 * 1024; // 150MB max APK size
    let done = false;

    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        resolve(Buffer.concat(chunks));
      }
    }, 30000);

    req.on('data', (chunk: Buffer) => {
      totalSize += chunk.length;
      if (totalSize > MAX_SIZE) {
        done = true;
        clearTimeout(timer);
        reject(new Error('File exceeds maximum allowable size (150MB)'));
        return;
      }
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    req.on('end', () => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        resolve(Buffer.concat(chunks));
      }
    });

    req.on('error', (err) => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        reject(err);
      }
    });
  });
}

export async function handleApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  explicitRoute?: string
): Promise<boolean> {
  const url = req.url || '';
  const parsedUrl = new URL(url, 'http://localhost:3000');
  let pathname = explicitRoute || parsedUrl.pathname;

  // Ensure leading /api if missing from proxy/rewrites
  if (!pathname.startsWith('/api/')) {
    pathname = `/api${pathname.startsWith('/') ? pathname : '/' + pathname}`;
  }

  // Strip trailing slashes (e.g. /api/admin/login/ -> /api/admin/login)
  pathname = pathname.replace(/\/+$/, '') || '/';
  const method = req.method?.toUpperCase() || 'GET';

  // CORS headers for API safety
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-filename, Accept, X-Requested-With');

  if (method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return true;
  }

  try {
    // ----------------------------------------------------
    // PUBLIC ENDPOINTS
    // ----------------------------------------------------

    // 1. GET /api/releases/latest
    if (pathname === '/api/releases/latest' && method === 'GET') {
      const latest = await getLatestPublishedRelease();
      if (!latest) {
        sendJson(res, 200, {
          published: false,
          message: 'No official APK release has been published yet.',
        });
        return true;
      }

      const binaryVerified = await hasApkBinary(latest);

      sendJson(res, 200, {
        published: true,
        release: {
          ...latest,
          binaryVerified,
        },
      });
      return true;
    }

    // 2. GET /api/releases/manifest
    if (pathname === '/api/releases/manifest' && method === 'GET') {
      const latest = await getLatestPublishedRelease();
      if (!latest) {
        sendJson(res, 404, {
          error: 'No published releases found',
        });
        return true;
      }

      const manifest: ReleaseManifest = {
        applicationId: latest.applicationId || 'com.riyajul.zoya',
        latestRelease: {
          versionName: latest.versionName,
          versionCode: latest.versionCode,
          downloadUrl: latest.downloadUrl,
          sha256: latest.sha256,
          fileSize: latest.fileSize,
          fileSizeFormatted: latest.fileSizeFormatted,
          minAndroidVersion: latest.minAndroidVersion,
          releaseDate: latest.releaseDate,
          releaseNotes: latest.releaseNotes,
        },
        publishedAt: latest.publishedAt || latest.createdAt,
      };

      sendJson(res, 200, manifest);
      return true;
    }

    // 3. GET/HEAD /api/releases/download
    if (pathname === '/api/releases/download' && (method === 'GET' || method === 'HEAD')) {
      const releaseId = parsedUrl.searchParams.get('id');
      let targetRelease: ReleaseMetadata | null = null;

      if (releaseId) {
        targetRelease = await getReleaseById(releaseId);
      } else {
        targetRelease = await getLatestPublishedRelease();
      }

      if (!targetRelease) {
        sendError(res, 404, 'Release not found.');
        return true;
      }

      const apkBuffer = await getApkBuffer(
        targetRelease.storageKey,
        targetRelease.storagePath,
        targetRelease.chunkCount
      );

      if (!apkBuffer || !isValidApkHeader(apkBuffer)) {
        sendError(
          res,
          404,
          'APK file binary missing from persistent cloud storage. Please re-upload and publish the APK in the Admin Portal.'
        );
        return true;
      }

      const cleanVersion = (targetRelease.versionName || 'latest')
        .trim()
        .replace(/[^a-zA-Z0-9._-]/g, '-');
      const outputFilename = `zoya-assistant-${cleanVersion}.apk`;

      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/vnd.android.package-archive');
      res.setHeader('Content-Disposition', `attachment; filename="${outputFilename}"`);
      res.setHeader('Content-Length', String(apkBuffer.length));
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.setHeader('X-Content-Type-Options', 'nosniff');

      if (method === 'HEAD') {
        res.end();
        return true;
      }

      res.end(apkBuffer);
      return true;
    }

    // 4. POST /api/devices/register (Public Android FCM token registration endpoint)
    if (pathname === '/api/devices/register') {
      if (method !== 'POST') {
        sendError(res, 405, `Method ${method} Not Allowed. Expected POST.`);
        return true;
      }

      let body: {
        token?: string;
        platform?: string;
        applicationId?: string;
        appVersion?: string;
        versionCode?: number;
      } = {};
      try {
        body = await parseJsonBody(req);
      } catch (err) {
        sendError(res, 400, err instanceof Error ? err.message : 'Invalid JSON body.');
        return true;
      }

      if (!body.token || typeof body.token !== 'string' || body.token.trim().length < 20) {
        sendError(res, 400, 'Valid FCM registration token is required.');
        return true;
      }

      const { deviceId } = await registerFcmDeviceToken({
        token: body.token,
        platform: body.platform || 'android',
        applicationId: body.applicationId || 'com.riyajul.zoya',
        appVersion: body.appVersion,
        versionCode: body.versionCode,
      });

      sendJson(res, 200, {
        success: true,
        deviceId,
        message: 'Android device registered for Zoya release notifications.',
      });
      return true;
    }

    // ----------------------------------------------------
    // ADMIN AUTHENTICATION ENDPOINTS
    // ----------------------------------------------------

    // POST /api/admin/login
    if (pathname === '/api/admin/login') {
      if (method !== 'POST') {
        sendError(res, 405, `Method ${method} Not Allowed. Expected POST.`);
        return true;
      }

      let body: { pin?: string | number; email?: string; password?: string } = {};
      try {
        body = await parseJsonBody<{ pin?: string | number; email?: string; password?: string }>(req);
      } catch (err) {
        sendError(res, 400, err instanceof Error ? err.message : 'Invalid JSON body.');
        return true;
      }

      const pin = body && body.pin !== undefined && body.pin !== null ? String(body.pin).trim() : '';
      const email = body && typeof body.email === 'string' ? body.email.trim() : '';
      const password = body && typeof body.password === 'string' ? body.password : '';

      let user = null;
      if (pin.length > 0) {
        user = authenticateAdminPin(pin);
      } else if (email || password) {
        user = authenticateAdmin(email, password);
      } else {
        sendError(res, 400, 'Administrator PIN is required.');
        return true;
      }

      if (!user) {
        sendError(res, 401, 'Invalid administrator PIN.');
        return true;
      }

      const token = createToken(user);
      res.setHeader(
        'Set-Cookie',
        `zoya_admin_token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 7}`
      );

      sendJson(res, 200, {
        success: true,
        token,
        user: { email: user.email, name: user.name, role: user.role },
      });
      return true;
    }

    // GET /api/admin/session
    if (pathname === '/api/admin/session') {
      if (method !== 'GET') {
        sendError(res, 405, `Method ${method} Not Allowed. Expected GET.`);
        return true;
      }

      const token = extractAuthToken(req.headers);
      const user = verifyToken(token);

      if (!user) {
        sendJson(res, 200, { authenticated: false });
        return true;
      }

      sendJson(res, 200, {
        authenticated: true,
        user: { email: user.email, name: user.name, role: user.role },
      });
      return true;
    }

    // POST /api/admin/logout
    if (pathname === '/api/admin/logout' && method === 'POST') {
      res.setHeader('Set-Cookie', 'zoya_admin_token=; Path=/; HttpOnly; Max-Age=0');
      sendJson(res, 200, { success: true, message: 'Logged out successfully.' });
      return true;
    }

    // ----------------------------------------------------
    // PROTECTED ADMIN ENDPOINTS (Require Valid Token)
    // ----------------------------------------------------
    if (pathname.startsWith('/api/admin/')) {
      const token = extractAuthToken(req.headers);
      const user = verifyToken(token);

      if (!user) {
        sendError(res, 401, 'Unauthorized: Admin authentication token is required or expired.');
        return true;
      }

      // GET /api/admin/releases
      if (pathname === '/api/admin/releases' && method === 'GET') {
        const [releases, fcmStatus] = await Promise.all([
          getAllReleases(),
          getFcmStatus(),
        ]);
        releases.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        const enriched = await Promise.all(
          releases.map(async (r) => ({
            ...r,
            binaryVerified: await hasApkBinary(r),
          }))
        );

        sendJson(res, 200, { success: true, releases: enriched, fcmStatus });
        return true;
      }

      // POST /api/admin/upload
      if (pathname === '/api/admin/upload' && method === 'POST') {
        const phase = parsedUrl.searchParams.get('phase');

        // Mode 1: Chunked binary upload (for reliable serverless uploads of any size)
        if (phase === 'chunk') {
          const storageKey = (parsedUrl.searchParams.get('storageKey') || '').trim();
          const index = Number(parsedUrl.searchParams.get('index'));
          const totalChunks = Number(parsedUrl.searchParams.get('totalChunks'));

          if (!storageKey || isNaN(index) || index < 0 || isNaN(totalChunks) || totalChunks <= 0) {
            sendError(res, 400, 'Invalid chunk parameters.');
            return true;
          }

          const chunkBuffer = await readBinaryBody(req);
          if (!chunkBuffer || chunkBuffer.length === 0) {
            sendError(res, 400, 'Empty chunk payload.');
            return true;
          }

          await storeApkChunk(storageKey, index, totalChunks, chunkBuffer);
          sendJson(res, 200, { success: true, index, size: chunkBuffer.length });
          return true;
        }

        // Mode 2: Finalize chunked upload and create draft record
        if (phase === 'finalize') {
          const body = await parseJsonBody<{
            storageKey: string;
            fileName: string;
            fileSize: number;
            totalChunks: number;
            sha256: string;
          }>(req);

          const storageKey = (body.storageKey || '').trim();
          const fileName = path.basename(body.fileName || 'zoya-assistant.apk');
          const fileSize = Number(body.fileSize) || 0;
          const totalChunks = Number(body.totalChunks) || 0;
          const sha256 = (body.sha256 || '').trim().toLowerCase();

          if (!storageKey || !fileName.toLowerCase().endsWith('.apk') || fileSize < 1024 || totalChunks <= 0 || !sha256) {
            sendError(res, 400, 'Invalid finalize parameters for APK upload.');
            return true;
          }

          const verified = await verifyStoredChunks(storageKey, totalChunks);
          if (!verified) {
            sendError(res, 400, 'APK chunks failed verification in persistent cloud storage.');
            return true;
          }

          const draftId = `rel_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
          const downloadUrl = `/api/releases/download?id=${draftId}`;

          const newDraft: ReleaseMetadata = {
            id: draftId,
            versionName: '',
            versionCode: 0,
            applicationId: 'com.riyajul.zoya',
            fileName,
            fileSize,
            fileSizeFormatted: formatBytes(fileSize),
            sha256,
            storageKey,
            storagePath: `apk_chunks/${storageKey}`,
            chunkCount: totalChunks,
            binaryVerified: true,
            downloadUrl,
            releaseDate: new Date().toISOString().split('T')[0],
            releaseNotes: '',
            minAndroidVersion: 'Android 8.0 (API 26)+',
            isPublished: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };

          await saveRelease(newDraft);

          sendJson(res, 201, {
            success: true,
            message: 'APK uploaded and verified in persistent storage. Ready for release publication.',
            draft: newDraft,
          });
          return true;
        }

        // Mode 3: Standard single-request binary upload
        const filenameHeader = req.headers['x-filename'];
        const filename =
          typeof filenameHeader === 'string'
            ? decodeURIComponent(filenameHeader)
            : 'zoya-assistant.apk';

        if (!filename.toLowerCase().endsWith('.apk')) {
          sendError(res, 400, 'Invalid file: Must have a .apk extension.');
          return true;
        }

        const buffer = await readBinaryBody(req);
        if (buffer.length < 1024) {
          sendError(res, 400, 'File is empty or too small to be a valid APK package.');
          return true;
        }

        const stored = await storeApkBuffer(buffer, filename);
        const draftId = `rel_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const downloadUrl = `/api/releases/download?id=${draftId}`;

        const newDraft: ReleaseMetadata = {
          id: draftId,
          versionName: '',
          versionCode: 0,
          applicationId: 'com.riyajul.zoya',
          fileName: filename,
          fileSize: stored.fileSize,
          fileSizeFormatted: stored.fileSizeFormatted,
          sha256: stored.sha256,
          storageKey: stored.storageKey,
          storagePath: stored.storagePath,
          chunkCount: stored.chunkCount,
          binaryVerified: true,
          downloadUrl,
          releaseDate: new Date().toISOString().split('T')[0],
          releaseNotes: '',
          minAndroidVersion: 'Android 8.0 (API 26)+',
          isPublished: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        await saveRelease(newDraft);

        sendJson(res, 201, {
          success: true,
          message: 'APK uploaded and verified in persistent storage. Ready for release publication.',
          draft: newDraft,
        });
        return true;
      }

      // POST /api/admin/publish
      if (pathname === '/api/admin/publish' && method === 'POST') {
        const body = await parseJsonBody<{
          draftId: string;
          versionName: string;
          versionCode: number;
          applicationId?: string;
          releaseNotes: string;
          minAndroidVersion?: string;
          releaseDate?: string;
        }>(req);

        if (!body.draftId) {
          sendError(res, 400, 'Draft ID is required.');
          return true;
        }

        const draft = await getReleaseById(body.draftId);
        if (!draft) {
          sendError(res, 404, 'Draft release record not found.');
          return true;
        }

        const binaryExists = await hasApkBinary(draft);
        if (!binaryExists) {
          sendError(
            res,
            400,
            'Cannot publish release: APK binary is missing from persistent cloud storage. Please re-upload the APK file.'
          );
          return true;
        }

        const cleanVersionName = (body.versionName || '').trim();
        const versionCode = Number(body.versionCode);

        if (!cleanVersionName) {
          sendError(res, 400, 'Version name (e.g. v1.0.0) is required.');
          return true;
        }
        if (!versionCode || isNaN(versionCode) || versionCode <= 0) {
          sendError(res, 400, 'Android versionCode must be a positive integer.');
          return true;
        }

        const latestPublished = await getLatestPublishedRelease();
        let compatibilityWarning: string | null = null;

        if (latestPublished && latestPublished.id !== draft.id) {
          if (versionCode <= latestPublished.versionCode) {
            compatibilityWarning = `Notice: VersionCode (${versionCode}) is not higher than the latest published release (${latestPublished.versionCode}). Android devices with version ${latestPublished.versionCode} installed will reject this update.`;
          }
        }

        const nowIso = new Date().toISOString();
        const updatedRelease: ReleaseMetadata = {
          ...draft,
          versionName: cleanVersionName,
          versionCode,
          applicationId: body.applicationId || 'com.riyajul.zoya',
          releaseNotes: (body.releaseNotes || '').trim(),
          minAndroidVersion: body.minAndroidVersion || 'Android 8.0 (API 26)+',
          releaseDate: body.releaseDate || nowIso.split('T')[0],
          isPublished: true,
          binaryVerified: true,
          publishedAt: draft.publishedAt || nowIso,
          updatedAt: nowIso,
        };

        await saveRelease(updatedRelease);

        // Trigger idempotent FCM push notification ONLY after release is published and verified
        const notificationResult = await sendReleasePushNotification(updatedRelease);

        if (notificationResult.sent && notificationResult.sentAt) {
          updatedRelease.notificationSentAt = notificationResult.sentAt;
          updatedRelease.notificationMessageId = notificationResult.messageId;
          await saveRelease(updatedRelease);
        }

        sendJson(res, 200, {
          success: true,
          message: 'Release published successfully.',
          release: updatedRelease,
          warning: compatibilityWarning,
          notification: notificationResult,
        });
        return true;
      }

      // DELETE /api/admin/releases/:id or /api/admin/releases?id=...
      if ((pathname.startsWith('/api/admin/releases/') || pathname === '/api/admin/releases') && method === 'DELETE') {
        const anyReq = req as any;
        const queryId = anyReq.query?.id || parsedUrl.searchParams.get('id');
        const pathId = pathname.startsWith('/api/admin/releases/')
          ? pathname.substring('/api/admin/releases/'.length)
          : '';
        const id = (queryId || pathId || '').trim();

        if (!id) {
          sendError(res, 400, 'Release ID required.');
          return true;
        }

        const deleted = await deleteRelease(id);
        if (!deleted) {
          sendError(res, 404, 'Release not found.');
          return true;
        }

        sendJson(res, 200, { success: true, message: 'Release deleted.' });
        return true;
      }
    }

    // Unmatched API route
    sendError(res, 404, `Endpoint ${method} ${pathname} not found.`);
    return true;
  } catch (err: unknown) {
    console.error('API Error:', err);
    sendError(res, 500, err instanceof Error ? err.message : 'Internal Server Error');
    return true;
  }
}
