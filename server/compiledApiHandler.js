// server/apiHandler.ts
import crypto5 from "crypto";
import path2 from "path";

// server/storage.ts
import crypto from "crypto";
import fs from "fs";
import path from "path";

// server/firebase.ts
import "dotenv/config";
import {
  initializeApp as initializeAdminApp,
  getApps as getAdminApps,
  cert
} from "firebase-admin/app";
import {
  getFirestore as getAdminFirestoreInstance
} from "firebase-admin/firestore";
var TARGET_FIREBASE_PROJECT_ID = "zoya-updates";
var TARGET_FIRESTORE_DATABASE_ID = "(default)";
var cachedAdminApp = null;
var cachedAdminDb = null;
var cachedAdminProjectId = null;
var cachedAdminDatabaseId = null;
var adminDbConfigured = false;
var testAdapterOverride = null;
function resetAdminFirestoreCache() {
  cachedAdminApp = null;
  cachedAdminDb = null;
  cachedAdminProjectId = null;
  cachedAdminDatabaseId = null;
  adminDbConfigured = false;
}
function stripSurroundingQuotes(val) {
  const trimmed = val.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"') || trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}
function resolveCanonicalProjectId(candidate, defaultProjectId) {
  const cleaned = stripSurroundingQuotes(String(candidate || ""));
  if (!cleaned || cleaned === "distinguished-arena-4wr9b") {
    return defaultProjectId;
  }
  return cleaned;
}
function resolveCanonicalDatabaseId(candidate) {
  const cleaned = stripSurroundingQuotes(String(candidate || ""));
  if (!cleaned || cleaned === "(default)" || cleaned.startsWith("ai-studio-") || cleaned.includes("distinguished-arena")) {
    return TARGET_FIRESTORE_DATABASE_ID;
  }
  return cleaned;
}
function parseServiceAccountJsonString(rawInput) {
  const unquoted = stripSurroundingQuotes(rawInput);
  if (!unquoted) return null;
  const candidates = [];
  if (unquoted.startsWith("{")) {
    candidates.push(unquoted);
  } else {
    try {
      const decoded = Buffer.from(unquoted, "base64").toString("utf-8").trim();
      if (decoded.startsWith("{")) {
        candidates.push(decoded);
      }
    } catch {
    }
    candidates.push(unquoted);
  }
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      try {
        const escapedNewlines = candidate.replace(/\r?\n/g, "\\n");
        return JSON.parse(escapedNewlines);
      } catch {
      }
    }
  }
  return null;
}
function getServerServiceAccountCredentials(defaultProjectId = TARGET_FIREBASE_PROJECT_ID) {
  const rawJson = (process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim();
  if (rawJson.length > 0) {
    const parsed = parseServiceAccountJsonString(rawJson);
    if (parsed && typeof parsed === "object") {
      const projectId2 = resolveCanonicalProjectId(
        parsed.project_id || process.env.FIREBASE_PROJECT_ID,
        defaultProjectId
      );
      const clientEmail2 = stripSurroundingQuotes(String(parsed.client_email || ""));
      const privateKey2 = stripSurroundingQuotes(String(parsed.private_key || "")).replace(/\\n/g, "\n").trim();
      if (projectId2 && clientEmail2 && privateKey2.includes("PRIVATE KEY")) {
        return {
          projectId: projectId2,
          clientEmail: clientEmail2,
          privateKey: privateKey2
        };
      }
    }
  }
  const projectId = resolveCanonicalProjectId(process.env.FIREBASE_PROJECT_ID, defaultProjectId);
  const clientEmail = stripSurroundingQuotes(String(process.env.FIREBASE_CLIENT_EMAIL || ""));
  const privateKey = stripSurroundingQuotes(String(process.env.FIREBASE_PRIVATE_KEY || "")).replace(/\\n/g, "\n").trim();
  if (projectId && clientEmail && privateKey.includes("PRIVATE KEY")) {
    return {
      projectId,
      clientEmail,
      privateKey
    };
  }
  return null;
}
function getAdminFirestore() {
  const creds = getServerServiceAccountCredentials(TARGET_FIREBASE_PROJECT_ID);
  if (!creds) {
    return null;
  }
  const targetDbId = resolveCanonicalDatabaseId(process.env.FIRESTORE_DATABASE_ID);
  const appName = `zoya-admin-${creds.projectId}`;
  if (!cachedAdminApp || cachedAdminProjectId !== creds.projectId) {
    const existing = getAdminApps().find((a) => a.name === appName);
    cachedAdminApp = existing || initializeAdminApp(
      {
        credential: cert({
          projectId: creds.projectId,
          clientEmail: creds.clientEmail,
          privateKey: creds.privateKey
        }),
        projectId: creds.projectId
      },
      appName
    );
    cachedAdminProjectId = creds.projectId;
    cachedAdminDb = null;
    adminDbConfigured = false;
  }
  if (!cachedAdminDb || cachedAdminDatabaseId !== targetDbId) {
    cachedAdminDb = targetDbId && targetDbId !== "(default)" ? getAdminFirestoreInstance(cachedAdminApp, targetDbId) : getAdminFirestoreInstance(cachedAdminApp);
    cachedAdminDatabaseId = targetDbId;
    if (!adminDbConfigured) {
      try {
        cachedAdminDb.settings({
          ignoreUndefinedProperties: true,
          preferRest: true
        });
      } catch {
      }
      adminDbConfigured = true;
    }
  }
  return {
    db: cachedAdminDb,
    projectId: creds.projectId,
    databaseId: targetDbId || TARGET_FIRESTORE_DATABASE_ID
  };
}
function extractBinaryBuffer(rawField) {
  if (!rawField) return null;
  if (Buffer.isBuffer(rawField)) {
    return rawField;
  }
  if (rawField instanceof Uint8Array) {
    return Buffer.from(rawField.buffer, rawField.byteOffset, rawField.byteLength);
  }
  if (typeof rawField.toUint8Array === "function") {
    const uint8 = rawField.toUint8Array();
    return Buffer.from(uint8.buffer, uint8.byteOffset, uint8.byteLength);
  }
  if (typeof rawField.toBuffer === "function") {
    return rawField.toBuffer();
  }
  return null;
}
function normalizeDocumentPayloadForAdminSdk(data) {
  const normalized = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === void 0) continue;
    if (Buffer.isBuffer(value)) {
      normalized[key] = value;
    } else if (value instanceof Uint8Array) {
      normalized[key] = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    } else if (value && typeof value.toUint8Array === "function") {
      const uint8 = value.toUint8Array();
      normalized[key] = Buffer.from(uint8.buffer, uint8.byteOffset, uint8.byteLength);
    } else {
      normalized[key] = value;
    }
  }
  return normalized;
}
async function withFirestoreRetry(initialDb, operation) {
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
async function getActiveServerFirestoreAdapter() {
  if (testAdapterOverride) {
    return testAdapterOverride;
  }
  const adminInstance = getAdminFirestore();
  if (!adminInstance) {
    const err = new Error(
      `Firebase Admin SDK for ${TARGET_FIREBASE_PROJECT_ID}/${TARGET_FIRESTORE_DATABASE_ID} is not configured: FIREBASE_SERVICE_ACCOUNT_JSON is required.`
    );
    err.code = "STORAGE_UNAVAILABLE";
    throw err;
  }
  const { db, projectId, databaseId } = adminInstance;
  return {
    backendType: "firebase-admin",
    projectId,
    databaseId,
    async getCollectionDocs(collectionName) {
      return withFirestoreRetry(db, async (activeDb) => {
        const snap = await activeDb.collection(collectionName).get();
        return snap.docs.map((d) => ({
          id: d.id,
          data: d.data() || {}
        }));
      });
    },
    async getDocumentById(collectionName, docId) {
      return withFirestoreRetry(db, async (activeDb) => {
        const snap = await activeDb.collection(collectionName).doc(docId).get();
        return {
          exists: snap.exists,
          id: snap.id,
          data: snap.exists ? snap.data() || {} : void 0
        };
      });
    },
    async queryDocumentsEq(collectionName, field, value, maxResults = 1) {
      return withFirestoreRetry(db, async (activeDb) => {
        const snap = await activeDb.collection(collectionName).where(field, "==", value).limit(maxResults).get();
        return snap.docs.map((d) => ({
          id: d.id,
          data: d.data() || {}
        }));
      });
    },
    async setDocumentById(collectionName, docId, data, options) {
      const payload = normalizeDocumentPayloadForAdminSdk(data);
      return withFirestoreRetry(db, async (activeDb) => {
        if (options?.merge) {
          await activeDb.collection(collectionName).doc(docId).set(payload, { merge: true });
        } else {
          await activeDb.collection(collectionName).doc(docId).set(payload);
        }
      });
    },
    async deleteDocumentById(collectionName, docId) {
      return withFirestoreRetry(db, async (activeDb) => {
        await activeDb.collection(collectionName).doc(docId).delete();
      });
    },
    async runTransaction(updateFunction) {
      return withFirestoreRetry(db, async (activeDb) => {
        return activeDb.runTransaction(async (t) => {
          const txWrapper = {
            async get(collectionName, docId) {
              const docRef = activeDb.collection(collectionName).doc(docId);
              const snap = await t.get(docRef);
              return {
                exists: snap.exists,
                id: snap.id,
                data: snap.exists ? snap.data() || {} : void 0
              };
            },
            set(collectionName, docId, data, options) {
              const docRef = activeDb.collection(collectionName).doc(docId);
              const payload = normalizeDocumentPayloadForAdminSdk(data);
              if (options?.merge) {
                t.set(docRef, payload, { merge: true });
              } else {
                t.set(docRef, payload);
              }
            }
          };
          return updateFunction(txWrapper);
        });
      });
    }
  };
}
async function serverRunTransaction(updateFunction) {
  const adapter = await getActiveServerFirestoreAdapter();
  return adapter.runTransaction(updateFunction);
}
async function serverGetCollectionDocs(collectionName) {
  const adapter = await getActiveServerFirestoreAdapter();
  return adapter.getCollectionDocs(collectionName);
}
async function serverGetDocumentById(collectionName, docId) {
  const adapter = await getActiveServerFirestoreAdapter();
  return adapter.getDocumentById(collectionName, docId);
}
async function serverQueryDocumentsEq(collectionName, field, value, maxResults = 1) {
  const adapter = await getActiveServerFirestoreAdapter();
  return adapter.queryDocumentsEq(collectionName, field, value, maxResults);
}
async function serverSetDocumentById(collectionName, docId, data, options) {
  const adapter = await getActiveServerFirestoreAdapter();
  return adapter.setDocumentById(collectionName, docId, data, options);
}
async function serverDeleteDocumentById(collectionName, docId) {
  const adapter = await getActiveServerFirestoreAdapter();
  return adapter.deleteDocumentById(collectionName, docId);
}

// server/storage.ts
var APK_CHUNK_SIZE = 524288;
var IS_SERVERLESS = Boolean(
  process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT
);
function getStoragePaths() {
  if (IS_SERVERLESS) {
    const tmpData = path.join("/tmp", "zoya-data");
    return {
      dataDir: tmpData,
      releasesFile: path.join(tmpData, "releases.json"),
      apksDir: path.join(tmpData, "apks")
    };
  }
  const localData = path.resolve(process.cwd(), ".data");
  return {
    dataDir: localData,
    releasesFile: path.join(localData, "releases.json"),
    apksDir: path.join(localData, "apks")
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
    console.warn("Storage directory initialization notice:", err);
  }
}
function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}
function isValidApkHeader(buffer) {
  return buffer.length >= 4 && buffer[0] === 80 && buffer[1] === 75 && buffer[2] === 3 && buffer[3] === 4;
}
var RELEASES_CACHE_TTL_MS = 6e4;
var releasesCache = null;
function logStorageNotice(context, err) {
  const errMessage = String(err?.message || err);
  if (errMessage.includes("FIREBASE_SERVICE_ACCOUNT_JSON is required")) {
    return;
  }
  const isQuota = err?.code === "resource-exhausted" || errMessage.includes("Quota limit exceeded");
  if (isQuota) {
    console.warn(`${context}: Daily free tier read/write quota limit reached. Using local/cached fallback.`);
  } else {
    console.warn(`${context}:`, err);
  }
}
function clearReleasesInMemoryCache() {
  releasesCache = null;
}
async function getAllReleases() {
  if (releasesCache && Date.now() - releasesCache.cachedAt < RELEASES_CACHE_TTL_MS) {
    return releasesCache.data;
  }
  try {
    const docs = await serverGetCollectionDocs("releases");
    const releases = [];
    for (const docSnap of docs) {
      const data = docSnap.data;
      if (data && data.id) {
        releases.push(data);
      }
    }
    if (releases.length > 0) {
      releasesCache = { data: releases, cachedAt: Date.now() };
      return releases;
    }
  } catch (err) {
    logStorageNotice("Firestore read notice, checking local backup", err);
  }
  ensureDataDirs();
  const { releasesFile } = getStoragePaths();
  if (fs.existsSync(releasesFile)) {
    try {
      const raw = fs.readFileSync(releasesFile, "utf-8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        releasesCache = { data: parsed, cachedAt: Date.now() };
        return parsed;
      }
    } catch {
    }
  }
  return releasesCache ? releasesCache.data : [];
}
async function getPublishedReleases() {
  const all = await getAllReleases();
  return all.filter((r) => r.isPublished).sort((a, b) => b.versionCode - a.versionCode);
}
async function getLatestPublishedRelease() {
  const published = await getPublishedReleases();
  return published.length > 0 ? published[0] : null;
}
async function getReleaseById(id) {
  if (!id) return null;
  try {
    const docSnap = await serverGetDocumentById("releases", id);
    if (docSnap.exists && docSnap.data) {
      return docSnap.data;
    }
  } catch (err) {
    logStorageNotice("Firestore getDoc notice, falling back to getAllReleases", err);
  }
  const all = await getAllReleases();
  return all.find((r) => r.id === id) || null;
}
async function saveRelease(release) {
  clearReleasesInMemoryCache();
  const rawRelease = {
    ...release,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  const updatedRelease = Object.fromEntries(
    Object.entries(rawRelease).filter(([, v]) => v !== void 0)
  );
  await serverSetDocumentById("releases", updatedRelease.id, updatedRelease);
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
    fs.writeFileSync(releasesFile, JSON.stringify(all, null, 2), "utf-8");
  } catch (err) {
    console.warn("Local releases backup write notice:", err);
  }
}
async function deleteStoredChunks(storageKey, totalChunks) {
  if (!storageKey || totalChunks <= 0) return;
  try {
    const delPromises = [];
    for (let i = 0; i < totalChunks; i++) {
      delPromises.push(serverDeleteDocumentById("apk_chunks", `${storageKey}_chunk_${i}`));
    }
    await Promise.allSettled(delPromises);
  } catch (err) {
    console.warn("Firestore apk_chunks cleanup notice:", err);
  }
}
async function deleteRelease(id) {
  if (!id) return false;
  clearReleasesInMemoryCache();
  const existingRecord = await getReleaseById(id);
  if (!existingRecord) return false;
  try {
    await serverDeleteDocumentById("releases", id);
  } catch (err) {
    console.error("Firestore deleteRelease error:", err);
  }
  if (existingRecord.storageKey) {
    try {
      let totalChunks = existingRecord.chunkCount || 0;
      if (!totalChunks) {
        const chunk0 = await serverGetDocumentById("apk_chunks", `${existingRecord.storageKey}_chunk_0`);
        if (chunk0.exists && chunk0.data) {
          totalChunks = Number(chunk0.data.totalChunks) || 1;
        }
      }
      if (totalChunks > 0) {
        const delPromises = [];
        for (let i = 0; i < totalChunks; i++) {
          delPromises.push(
            serverDeleteDocumentById("apk_chunks", `${existingRecord.storageKey}_chunk_${i}`)
          );
        }
        await Promise.allSettled(delPromises);
      }
    } catch (err) {
      console.warn("Firestore apk_chunks cleanup notice:", err);
    }
  }
  ensureDataDirs();
  const { apksDir, releasesFile } = getStoragePaths();
  if (existingRecord.storageKey) {
    const filePath = path.join(apksDir, existingRecord.storageKey);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (e) {
        console.warn("Could not delete local APK file:", e);
      }
    }
  }
  try {
    const all = await getAllReleases();
    const filtered = all.filter((r) => r.id !== id);
    fs.writeFileSync(releasesFile, JSON.stringify(filtered, null, 2), "utf-8");
  } catch (err) {
    console.warn("Local releases backup update notice:", err);
  }
  return true;
}
async function storeApkChunk(storageKey, index, totalChunks, chunkBuffer) {
  if (!storageKey) {
    throw new Error("storageKey is required for chunk storage.");
  }
  if (index === 0 && !isValidApkHeader(chunkBuffer)) {
    throw new Error("Invalid APK file: Header does not match Android Package / ZIP format (magic bytes PK\\x03\\x04).");
  }
  if (chunkBuffer.length > 9e5) {
    throw new Error(`Chunk size (${chunkBuffer.length} bytes) exceeds safe Firestore document limit.`);
  }
  const binarySlice = Buffer.from(chunkBuffer.buffer, chunkBuffer.byteOffset, chunkBuffer.byteLength);
  await serverSetDocumentById("apk_chunks", `${storageKey}_chunk_${index}`, {
    storageKey,
    index,
    totalChunks,
    size: chunkBuffer.length,
    data: binarySlice,
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  });
}
async function verifyStoredChunks(storageKey, totalChunks) {
  if (!storageKey || totalChunks <= 0) return false;
  try {
    const firstSnap = await serverGetDocumentById("apk_chunks", `${storageKey}_chunk_0`);
    if (!firstSnap.exists || !firstSnap.data) return false;
    const firstBytes = extractBinaryBuffer(firstSnap.data.data);
    if (!firstBytes || !isValidApkHeader(firstBytes)) return false;
    if (totalChunks > 1) {
      const lastSnap = await serverGetDocumentById(
        "apk_chunks",
        `${storageKey}_chunk_${totalChunks - 1}`
      );
      if (!lastSnap.exists) return false;
    }
    return true;
  } catch (err) {
    console.error("Error verifying stored APK chunks:", err);
    return false;
  }
}
async function hasApkBinary(release) {
  if (!release || !release.storageKey) return false;
  try {
    const chunk0Snap = await serverGetDocumentById("apk_chunks", `${release.storageKey}_chunk_0`);
    if (chunk0Snap.exists && chunk0Snap.data) {
      const bytes = extractBinaryBuffer(chunk0Snap.data.data);
      if (bytes && isValidApkHeader(bytes)) {
        return true;
      }
    }
  } catch (err) {
    logStorageNotice("hasApkBinary Firestore notice", err);
  }
  const bundledFile = path.resolve(process.cwd(), ".data", "apks", release.storageKey);
  if (fs.existsSync(bundledFile)) {
    return true;
  }
  return false;
}
async function storeApkBuffer(buffer, originalFilename) {
  if (!isValidApkHeader(buffer)) {
    throw new Error("Invalid APK file: Header does not match Android Package / ZIP format (magic bytes PK\\x03\\x04).");
  }
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  const fileSize = buffer.length;
  const fileSizeFormatted = formatBytes(fileSize);
  const safeBase = path.basename(originalFilename).replace(/[^a-zA-Z0-9._-]/g, "_");
  const storageKey = `${Date.now()}-${safeBase}`;
  const storagePath = `apk_chunks/${storageKey}`;
  const totalChunks = Math.ceil(buffer.length / APK_CHUNK_SIZE);
  for (let i = 0; i < totalChunks; i += 3) {
    const batchPromises = [];
    for (let j = i; j < Math.min(i + 3, totalChunks); j++) {
      const slice = buffer.subarray(j * APK_CHUNK_SIZE, Math.min((j + 1) * APK_CHUNK_SIZE, buffer.length));
      batchPromises.push(storeApkChunk(storageKey, j, totalChunks, slice));
    }
    await Promise.all(batchPromises);
  }
  try {
    ensureDataDirs();
    const { apksDir } = getStoragePaths();
    const targetPath = path.join(apksDir, storageKey);
    fs.writeFileSync(targetPath, buffer);
  } catch (err) {
    console.warn("Local APK cache write notice:", err);
  }
  return {
    storageKey,
    storagePath,
    chunkCount: totalChunks,
    fileSize,
    fileSizeFormatted,
    sha256
  };
}
async function getApkBuffer(storageKey, storagePath, chunkCount) {
  if (!storageKey) return null;
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
      console.warn("Local APK cache read error:", e);
    }
  }
  const bundledFile = path.resolve(process.cwd(), ".data", "apks", storageKey);
  if (fs.existsSync(bundledFile)) {
    try {
      const bundled = fs.readFileSync(bundledFile);
      if (isValidApkHeader(bundled)) {
        return bundled;
      }
    } catch (e) {
      console.warn("Bundled APK read error:", e);
    }
  }
  try {
    let total = chunkCount && chunkCount > 0 ? chunkCount : 0;
    let chunk0Buffer = null;
    if (!total) {
      const snap0 = await serverGetDocumentById("apk_chunks", `${storageKey}_chunk_0`);
      if (snap0.exists && snap0.data) {
        const bytes0 = extractBinaryBuffer(snap0.data.data);
        if (bytes0) {
          total = Number(snap0.data.totalChunks) || 1;
          chunk0Buffer = bytes0;
        }
      }
    }
    if (total > 0) {
      const chunkBuffers = new Array(total);
      const startIndex = chunk0Buffer ? 1 : 0;
      if (chunk0Buffer) {
        chunkBuffers[0] = chunk0Buffer;
      }
      if (startIndex < total) {
        const indices = Array.from({ length: total - startIndex }, (_, idx) => idx + startIndex);
        const snaps = await Promise.all(
          indices.map((idx) => serverGetDocumentById("apk_chunks", `${storageKey}_chunk_${idx}`))
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
            }
            return fullBuffer;
          }
        }
      } else if (chunk0Buffer && isValidApkHeader(chunk0Buffer)) {
        try {
          fs.writeFileSync(localPath, chunk0Buffer);
        } catch {
        }
        return chunk0Buffer;
      }
    }
  } catch (err) {
    console.error(`Firestore apk_chunks download error for ${storageKey}:`, err);
  }
  return null;
}

// server/apkParser.ts
import zlib from "zlib";
var OFFICIAL_ZOYA_PACKAGE = "com.riyajul.zoya";
function formatBytes2(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}
function formatAndroidSdk(sdkVersion, isMin = true) {
  if (!sdkVersion || isNaN(sdkVersion) || sdkVersion <= 0) {
    return isMin ? "Not specified in APK" : "Not specified";
  }
  const sdkMap = {
    21: "Android 5.0",
    22: "Android 5.1",
    23: "Android 6.0",
    24: "Android 7.0",
    25: "Android 7.1",
    26: "Android 8.0",
    27: "Android 8.1",
    28: "Android 9.0",
    29: "Android 10.0",
    30: "Android 11.0",
    31: "Android 12.0",
    32: "Android 12L",
    33: "Android 13.0",
    34: "Android 14.0",
    35: "Android 15.0"
  };
  const base = sdkMap[sdkVersion] || "Android";
  return isMin ? `${base} (API ${sdkVersion})+` : `${base} (API ${sdkVersion})`;
}
function extractAndroidManifestBytes(zipBuffer) {
  if (zipBuffer.length < 22 || zipBuffer[0] !== 80 || zipBuffer[1] !== 75 || zipBuffer[2] !== 3 || zipBuffer[3] !== 4) {
    throw new Error("Invalid APK file: File is not a valid ZIP/APK archive.");
  }
  const maxCommentLength = 65535;
  const searchStart = Math.max(0, zipBuffer.length - 22 - maxCommentLength);
  let eocdOffset = -1;
  for (let i = zipBuffer.length - 22; i >= searchStart; i--) {
    if (zipBuffer.readUInt32LE(i) === 101010256) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset !== -1) {
    const cdSize = zipBuffer.readUInt32LE(eocdOffset + 12);
    const cdOffset = zipBuffer.readUInt32LE(eocdOffset + 16);
    if (cdOffset + cdSize <= zipBuffer.length) {
      let ptr = cdOffset;
      const cdEnd = cdOffset + cdSize;
      while (ptr + 46 <= cdEnd) {
        const sig = zipBuffer.readUInt32LE(ptr);
        if (sig !== 33639237) break;
        const compressionMethod = zipBuffer.readUInt16LE(ptr + 10);
        const compressedSize = zipBuffer.readUInt32LE(ptr + 20);
        const fileNameLen = zipBuffer.readUInt16LE(ptr + 28);
        const extraLen = zipBuffer.readUInt16LE(ptr + 30);
        const commentLen = zipBuffer.readUInt16LE(ptr + 32);
        const localHeaderOffset = zipBuffer.readUInt32LE(ptr + 42);
        const nameStart = ptr + 46;
        if (nameStart + fileNameLen > zipBuffer.length) break;
        const entryName = zipBuffer.subarray(nameStart, nameStart + fileNameLen).toString("utf8");
        if (entryName === "AndroidManifest.xml") {
          if (localHeaderOffset + 30 > zipBuffer.length) {
            throw new Error("Corrupted APK: Invalid local header offset for AndroidManifest.xml.");
          }
          const localSig = zipBuffer.readUInt32LE(localHeaderOffset);
          if (localSig !== 67324752) {
            throw new Error("Corrupted APK: Invalid local file header signature for AndroidManifest.xml.");
          }
          const localNameLen = zipBuffer.readUInt16LE(localHeaderOffset + 26);
          const localExtraLen = zipBuffer.readUInt16LE(localHeaderOffset + 28);
          const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
          const dataEnd = dataStart + compressedSize;
          if (dataEnd > zipBuffer.length) {
            throw new Error("Corrupted APK: AndroidManifest.xml data extends beyond file boundary.");
          }
          const rawSlice = zipBuffer.subarray(dataStart, dataEnd);
          if (compressionMethod === 0) {
            return rawSlice;
          }
          if (compressionMethod === 8) {
            return zlib.inflateRawSync(rawSlice);
          }
          throw new Error(`Unsupported ZIP compression method (${compressionMethod}) for AndroidManifest.xml.`);
        }
        ptr = nameStart + fileNameLen + extraLen + commentLen;
      }
    }
  }
  let offset = 0;
  while (offset + 30 <= zipBuffer.length) {
    const sig = zipBuffer.readUInt32LE(offset);
    if (sig !== 67324752) break;
    const compressionMethod = zipBuffer.readUInt16LE(offset + 8);
    const compressedSize = zipBuffer.readUInt32LE(offset + 18);
    const fileNameLen = zipBuffer.readUInt16LE(offset + 26);
    const extraLen = zipBuffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    if (nameStart + fileNameLen > zipBuffer.length) break;
    const entryName = zipBuffer.subarray(nameStart, nameStart + fileNameLen).toString("utf8");
    const dataStart = nameStart + fileNameLen + extraLen;
    const dataEnd = dataStart + compressedSize;
    if (entryName === "AndroidManifest.xml") {
      if (dataEnd > zipBuffer.length || compressedSize === 0) {
        throw new Error("Invalid APK: Cannot read AndroidManifest.xml payload.");
      }
      const rawSlice = zipBuffer.subarray(dataStart, dataEnd);
      if (compressionMethod === 0) return rawSlice;
      if (compressionMethod === 8) return zlib.inflateRawSync(rawSlice);
      throw new Error(`Unsupported compression method (${compressionMethod}) for AndroidManifest.xml.`);
    }
    if (compressedSize === 0) break;
    offset = dataEnd;
  }
  throw new Error("Invalid APK file: AndroidManifest.xml was not found inside the archive.");
}
function parseBinaryAndroidManifest(axml) {
  if (axml.length < 8) {
    throw new Error("Invalid AndroidManifest.xml: File is too small.");
  }
  const xmlChunkType = axml.readUInt16LE(0);
  const xmlHeaderSize = axml.readUInt16LE(2);
  if (xmlChunkType !== 3) {
    throw new Error("Invalid AndroidManifest.xml: Not in compiled Android Binary XML (AXML) format.");
  }
  let strings = [];
  let resourceIds = [];
  let packageName = "";
  let versionName = "";
  let versionCode = 0;
  let versionCodeMajor = 0;
  let minSdkVersion = null;
  let targetSdkVersion = null;
  let offset = xmlHeaderSize;
  while (offset + 8 <= axml.length) {
    const chunkType = axml.readUInt16LE(offset);
    const headerSize = axml.readUInt16LE(offset + 2);
    const chunkSize = axml.readUInt32LE(offset + 4);
    if (chunkSize < 8 || offset + chunkSize > axml.length) {
      break;
    }
    if (chunkType === 1) {
      const stringCount = axml.readUInt32LE(offset + 8);
      const flags = axml.readUInt32LE(offset + 16);
      const stringsStart = axml.readUInt32LE(offset + 20);
      const isUtf8 = (flags & 256) !== 0;
      const offsetsBase = offset + headerSize;
      const poolDataBase = offset + stringsStart;
      strings = new Array(stringCount);
      for (let i = 0; i < stringCount; i++) {
        if (offsetsBase + (i + 1) * 4 > offset + chunkSize) {
          strings[i] = "";
          continue;
        }
        const strOffset = poolDataBase + axml.readUInt32LE(offsetsBase + i * 4);
        if (strOffset >= offset + chunkSize) {
          strings[i] = "";
          continue;
        }
        if (isUtf8) {
          let p = strOffset;
          const u16Len = axml[p++];
          if ((u16Len & 128) !== 0) p++;
          let u8Len = axml[p++];
          if ((u8Len & 128) !== 0) {
            u8Len = (u8Len & 127) << 8 | axml[p++];
          }
          strings[i] = axml.subarray(p, Math.min(p + u8Len, offset + chunkSize)).toString("utf8");
        } else {
          let p = strOffset;
          let u16Len = axml.readUInt16LE(p);
          p += 2;
          if ((u16Len & 32768) !== 0) {
            u16Len = (u16Len & 32767) << 16 | axml.readUInt16LE(p);
            p += 2;
          }
          const byteLen = u16Len * 2;
          strings[i] = axml.subarray(p, Math.min(p + byteLen, offset + chunkSize)).toString("utf16le");
        }
      }
    } else if (chunkType === 384) {
      const count = Math.floor((chunkSize - headerSize) / 4);
      resourceIds = new Array(count);
      for (let i = 0; i < count; i++) {
        resourceIds[i] = axml.readUInt32LE(offset + headerSize + i * 4);
      }
    } else if (chunkType === 258) {
      const nameIdx = axml.readInt32LE(offset + 20);
      const attrStart = axml.readUInt16LE(offset + 24);
      const attrSize = axml.readUInt16LE(offset + 26) || 20;
      const attrCount = axml.readUInt16LE(offset + 28);
      const elemName = nameIdx >= 0 && nameIdx < strings.length ? strings[nameIdx] : "";
      const attrsBase = offset + 16 + attrStart;
      for (let i = 0; i < attrCount; i++) {
        const aOff = attrsBase + i * attrSize;
        if (aOff + 20 > offset + chunkSize) break;
        const attrNameIdx = axml.readInt32LE(aOff + 4);
        const rawValueIdx = axml.readInt32LE(aOff + 8);
        const dataType = axml[aOff + 15];
        const dataValue = axml.readInt32LE(aOff + 16);
        const attrName = attrNameIdx >= 0 && attrNameIdx < strings.length ? strings[attrNameIdx] : "";
        const resId = attrNameIdx >= 0 && attrNameIdx < resourceIds.length ? resourceIds[attrNameIdx] : 0;
        let strVal = "";
        if (rawValueIdx >= 0 && rawValueIdx < strings.length) {
          strVal = strings[rawValueIdx];
        } else if (dataType === 3 && dataValue >= 0 && dataValue < strings.length) {
          strVal = strings[dataValue];
        } else {
          strVal = String(dataValue);
        }
        const intVal = dataType === 16 || dataType === 17 ? dataValue : parseInt(strVal, 10);
        if (elemName === "manifest") {
          if (attrName === "package" && strVal) {
            packageName = strVal.trim();
          } else if (attrName === "versionCode" || resId === 16843291) {
            if (!isNaN(intVal)) versionCode = intVal;
          } else if (attrName === "versionCodeMajor" || resId === 16844150) {
            if (!isNaN(intVal)) versionCodeMajor = intVal;
          } else if (attrName === "versionName" || resId === 16843292) {
            if (strVal) versionName = strVal.trim();
          }
        } else if (elemName === "uses-sdk") {
          if (attrName === "minSdkVersion" || resId === 16843276) {
            if (!isNaN(intVal) && intVal > 0) minSdkVersion = intVal;
          } else if (attrName === "targetSdkVersion" || resId === 16843376) {
            if (!isNaN(intVal) && intVal > 0) targetSdkVersion = intVal;
          }
        }
      }
    }
    offset += chunkSize;
  }
  const finalVersionCode = versionCodeMajor > 0 ? versionCodeMajor * 4294967296 + (versionCode >>> 0) : versionCode;
  return {
    packageName,
    versionName,
    versionCode: finalVersionCode,
    minSdkVersion,
    targetSdkVersion
  };
}
function parseApkBuffer(apkBuffer) {
  if (!apkBuffer || apkBuffer.length < 64) {
    throw new Error("Invalid APK file: File is empty or too small to be an Android APK.");
  }
  const manifestBytes = extractAndroidManifestBytes(apkBuffer);
  const parsed = parseBinaryAndroidManifest(manifestBytes);
  if (!parsed.packageName) {
    throw new Error("Invalid APK file: Could not extract Android package name from AndroidManifest.xml.");
  }
  if (!parsed.versionName) {
    throw new Error("Invalid APK file: Could not extract versionName from AndroidManifest.xml.");
  }
  if (!parsed.versionCode || parsed.versionCode <= 0 || !Number.isInteger(parsed.versionCode)) {
    throw new Error("Invalid APK file: Could not extract a valid integer versionCode from AndroidManifest.xml.");
  }
  const fileSize = apkBuffer.length;
  return {
    packageName: parsed.packageName,
    versionName: parsed.versionName,
    versionCode: parsed.versionCode,
    minSdkVersion: parsed.minSdkVersion,
    targetSdkVersion: parsed.targetSdkVersion,
    minAndroidVersion: formatAndroidSdk(parsed.minSdkVersion, true),
    targetAndroidVersion: parsed.targetSdkVersion ? formatAndroidSdk(parsed.targetSdkVersion, false) : null,
    fileSize,
    fileSizeFormatted: formatBytes2(fileSize)
  };
}

// server/auth.ts
import crypto2 from "crypto";

// firebase-applet-config.json
var firebase_applet_config_default = {
  projectId: "distinguished-arena-4wr9b",
  appId: "1:637371888461:web:07815ddf5396a2648cfd04",
  apiKey: "AIzaSyC12px3Oua-fE5zvKlNkC8GBlqQpwqAxmE",
  authDomain: "distinguished-arena-4wr9b.firebaseapp.com",
  firestoreDatabaseId: "ai-studio-zoyaaiassistant-e56902ff-e9da-4d13-ba83-43ec01e84e99",
  storageBucket: "distinguished-arena-4wr9b.firebasestorage.app",
  messagingSenderId: "637371888461",
  measurementId: "",
  oAuthClientId: "637371888461-of1t68o1p0g16og0amo50fid6lf6kl1g.apps.googleusercontent.com",
  recaptchaSiteKey: ""
};

// server/auth.ts
var DEFAULT_ADMIN_PIN = "8825316434";
var cachedDerivedJwtSecret = null;
var loggedJwtSecretNotice = false;
function getAdminPin() {
  const envPin = process.env.ZOYA_ADMIN_PIN;
  if (envPin !== void 0 && envPin !== null && String(envPin).trim().length > 0) {
    return String(envPin).trim();
  }
  return DEFAULT_ADMIN_PIN;
}
function readServerIdentitySalt() {
  if (firebase_applet_config_default && typeof firebase_applet_config_default.firestoreDatabaseId === "string" && typeof firebase_applet_config_default.appId === "string") {
    return `${firebase_applet_config_default.projectId || "zoya"}:${firebase_applet_config_default.firestoreDatabaseId}:${firebase_applet_config_default.appId}`;
  }
  return "zoya-server-jwt-derivation-v2";
}
function getJwtSecret() {
  const envSecret = process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET;
  if (envSecret !== void 0 && envSecret !== null && String(envSecret).trim().length >= 16) {
    return String(envSecret).trim();
  }
  if (!cachedDerivedJwtSecret) {
    if (!loggedJwtSecretNotice) {
      loggedJwtSecretNotice = true;
      console.warn(
        "[Security Notice] ADMIN_JWT_SECRET is not configured in environment variables. Deriving a server-only cryptographic JWT key so existing Admin Portal PIN login continues working without interruption. Set ADMIN_JWT_SECRET (32+ random bytes) in Vercel environment variables for dedicated secret rotation."
      );
    }
    const pinSeed = getAdminPin();
    const salt = `zoya-admin-jwt-v2:${readServerIdentitySalt()}`;
    cachedDerivedJwtSecret = crypto2.pbkdf2Sync(pinSeed, salt, 1e5, 32, "sha256").toString("hex");
  }
  return cachedDerivedJwtSecret;
}
function createToken(user) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      email: user.email,
      role: user.role,
      name: user.name,
      iat: Math.floor(Date.now() / 1e3),
      exp: Math.floor(Date.now() / 1e3) + 60 * 60 * 2
      // 2-hour session expiration
    })
  ).toString("base64url");
  const signature = crypto2.createHmac("sha256", getJwtSecret()).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}
function verifyToken(token) {
  if (!token) return null;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [header, payload, signature] = parts;
    const expectedSignature = crypto2.createHmac("sha256", getJwtSecret()).update(`${header}.${payload}`).digest("base64url");
    const sigBuf = Buffer.from(signature, "utf-8");
    const expectedBuf = Buffer.from(expectedSignature, "utf-8");
    if (sigBuf.length !== expectedBuf.length || !crypto2.timingSafeEqual(sigBuf, expectedBuf)) {
      return null;
    }
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
    if (!decoded.exp || decoded.exp < Math.floor(Date.now() / 1e3)) {
      return null;
    }
    if (decoded.role !== "admin") {
      return null;
    }
    return {
      email: decoded.email || "admin@zoya.ai",
      role: "admin",
      name: decoded.name || "Administrator"
    };
  } catch {
    return null;
  }
}
function authenticateAdminPin(pin) {
  if (pin === void 0 || pin === null) return null;
  const cleanPin = String(pin).trim();
  const targetPin = getAdminPin();
  if (!cleanPin || !targetPin) return null;
  const cleanBuf = Buffer.from(cleanPin, "utf-8");
  const targetBuf = Buffer.from(targetPin, "utf-8");
  if (cleanBuf.length === targetBuf.length && crypto2.timingSafeEqual(cleanBuf, targetBuf)) {
    return {
      email: "admin@zoya.ai",
      role: "admin",
      name: "Riyajul (Administrator)"
    };
  }
  return null;
}
function authenticateAdmin(email, password) {
  const pinMatch = authenticateAdminPin(password);
  if (pinMatch) {
    return pinMatch;
  }
  const targetPassword = (process.env.ADMIN_PASSWORD || "").trim();
  if (!targetPassword || !password) {
    return null;
  }
  const passBuf = Buffer.from(password, "utf-8");
  const targetBuf = Buffer.from(targetPassword, "utf-8");
  if (passBuf.length === targetBuf.length && crypto2.timingSafeEqual(passBuf, targetBuf)) {
    return {
      email: email?.trim().toLowerCase() || "riyajulansari113b@gmail.com",
      role: "admin",
      name: "Riyajul (Administrator)"
    };
  }
  return null;
}
function extractAuthToken(reqHeaders) {
  if (!reqHeaders) return null;
  let bearerCandidate = null;
  const authHeader = reqHeaders["authorization"] || reqHeaders["Authorization"];
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    const bearer = authHeader.substring(7).trim();
    if (bearer && bearer !== "cookie-session") {
      bearerCandidate = bearer;
      if (verifyToken(bearerCandidate)) {
        return bearerCandidate;
      }
    }
  }
  let cookieCandidate = null;
  const rawCookie = reqHeaders["cookie"] || reqHeaders["Cookie"];
  const cookieHeaders = Array.isArray(rawCookie) ? rawCookie : typeof rawCookie === "string" ? [rawCookie] : [];
  for (const cookieHeader of cookieHeaders) {
    const cookies = cookieHeader.split(";").map((c) => c.trim());
    for (const c of cookies) {
      if (c.startsWith("zoya_admin_token=")) {
        const val = c.substring("zoya_admin_token=".length).trim();
        if (val && val !== "cookie-session") {
          cookieCandidate = val;
          if (verifyToken(cookieCandidate)) {
            return cookieCandidate;
          }
        }
      }
    }
  }
  return bearerCandidate || cookieCandidate || null;
}

// server/fcm.ts
import crypto3 from "crypto";
var DEFAULT_FCM_TOPIC = "zoya_releases";
var DEFAULT_PRODUCTION_SITE_URL = "https://zoya-website-eta.vercel.app";
var cachedAccessToken = null;
function getPublicSiteOrigin() {
  const envUrl = (process.env.PUBLIC_SITE_URL || DEFAULT_PRODUCTION_SITE_URL).trim();
  if (envUrl.startsWith("http://") || envUrl.startsWith("https://")) {
    return envUrl.replace(/\/+$/, "");
  }
  return DEFAULT_PRODUCTION_SITE_URL;
}
function getFcmTopic() {
  const custom = (process.env.FCM_RELEASE_TOPIC || "").trim();
  return custom || DEFAULT_FCM_TOPIC;
}
function getServiceAccountCredentials() {
  return getServerServiceAccountCredentials(TARGET_FIREBASE_PROJECT_ID);
}
async function getFcmAccessToken(creds) {
  const nowSec = Math.floor(Date.now() / 1e3);
  if (cachedAccessToken && cachedAccessToken.expiresAt - 300 > nowSec) {
    return cachedAccessToken.token;
  }
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", typ: "JWT" })
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iss: creds.clientEmail,
      sub: creds.clientEmail,
      aud: "https://oauth2.googleapis.com/token",
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      iat: nowSec,
      exp: nowSec + 3600
    })
  ).toString("base64url");
  const unsignedJwt = `${header}.${payload}`;
  const signer = crypto3.createSign("RSA-SHA256");
  signer.update(unsignedJwt);
  signer.end();
  const signature = signer.sign(creds.privateKey, "base64url");
  const assertion = `${unsignedJwt}.${signature}`;
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    }).toString()
  });
  const tokenText = await tokenRes.text();
  let tokenData = {};
  try {
    tokenData = tokenText ? JSON.parse(tokenText) : {};
  } catch {
    throw new Error(`Invalid OAuth2 token response (${tokenRes.status})`);
  }
  if (!tokenRes.ok || !tokenData.access_token) {
    throw new Error(
      tokenData.error_description || tokenData.error || `Failed to obtain FCM OAuth2 access token (${tokenRes.status})`
    );
  }
  cachedAccessToken = {
    token: String(tokenData.access_token),
    expiresAt: nowSec + (Number(tokenData.expires_in) || 3600)
  };
  return cachedAccessToken.token;
}
function buildReleaseNotificationContent(release) {
  const siteOrigin = getPublicSiteOrigin();
  const relativeDownload = release.downloadUrl.startsWith("/") ? release.downloadUrl : `/${release.downloadUrl}`;
  const fullDownloadUrl = release.downloadUrl.startsWith("http") ? release.downloadUrl : `${siteOrigin}${relativeDownload}`;
  const title = "Zoya Update Available";
  const body = `Zoya ${release.versionName} is now available and ready to install.`;
  const data = {
    type: "apk_release",
    action: "OPEN_APP_UPDATE",
    releaseId: String(release.id),
    versionName: String(release.versionName),
    versionCode: String(release.versionCode),
    applicationId: String(release.applicationId || "com.riyajul.zoya"),
    downloadUrl: fullDownloadUrl,
    manifestUrl: `${siteOrigin}/api/releases/manifest`,
    sha256: String(release.sha256 || ""),
    fileSize: String(release.fileSize || 0),
    fileSizeFormatted: String(release.fileSizeFormatted || ""),
    minAndroidVersion: String(release.minAndroidVersion || "Android 8.0 (API 26)+"),
    releaseDate: String(release.releaseDate || ""),
    releaseNotes: String(release.releaseNotes || ""),
    publishedAt: String(release.publishedAt || (/* @__PURE__ */ new Date()).toISOString())
  };
  return { title, body, data };
}
async function sendFcmV1Request(projectId, accessToken, target, title, body, data, notificationTag, options) {
  const endpoint = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`;
  const collapseKey = options?.collapseKey || "zoya_release_update";
  const clickAction = options?.clickAction || "OPEN_APP_UPDATE";
  const fcmPayload = {
    message: {
      ...target,
      notification: {
        title,
        body
      },
      data,
      android: {
        priority: "HIGH",
        collapse_key: collapseKey,
        ttl: "604800s",
        notification: {
          title,
          body,
          channel_id: "zoya_updates",
          tag: notificationTag,
          click_action: clickAction,
          default_sound: true,
          default_vibrate_timings: true
        }
      }
    }
  };
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(fcmPayload)
  });
  const rawText = await res.text();
  let parsed = {};
  try {
    parsed = rawText ? JSON.parse(rawText) : {};
  } catch {
  }
  if (res.ok && parsed.name) {
    return { ok: true, messageId: String(parsed.name) };
  }
  const errorCode = parsed?.error?.details?.[0]?.errorCode || parsed?.error?.status || String(res.status);
  const errorMessage = parsed?.error?.message || `FCM HTTP v1 error (${res.status})`;
  return { ok: false, errorCode, errorMessage };
}
async function registerFcmDeviceToken(params) {
  const cleanToken = String(params.token || "").trim();
  if (!cleanToken || cleanToken.length < 20) {
    throw new Error("A valid FCM registration token is required.");
  }
  const deviceId = crypto3.createHash("sha256").update(cleanToken).digest("hex").substring(0, 40);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  await serverSetDocumentById(
    "fcm_devices",
    deviceId,
    {
      token: cleanToken,
      platform: String(params.platform || "android"),
      applicationId: String(params.applicationId || "com.riyajul.zoya"),
      appVersion: String(params.appVersion || ""),
      versionCode: Number(params.versionCode) || 0,
      updatedAt: now,
      createdAt: now
    },
    { merge: true }
  );
  return { deviceId };
}
async function getFcmStatus() {
  const creds = getServiceAccountCredentials();
  const projectId = creds?.projectId || process.env.FIREBASE_PROJECT_ID || TARGET_FIREBASE_PROJECT_ID;
  const topic = getFcmTopic();
  let registeredDevicesCount = 0;
  try {
    const docs = await serverGetCollectionDocs("fcm_devices");
    registeredDevicesCount = docs.length;
  } catch {
  }
  return {
    configured: Boolean(creds),
    projectId,
    topic,
    registeredDevicesCount
  };
}
async function sendReleasePushNotification(release) {
  const topic = getFcmTopic();
  const idempotencyKey = `${release.id}_v${release.versionCode}`;
  const { title, body, data } = buildReleaseNotificationContent(release);
  const creds = getServiceAccountCredentials();
  const projectId = creds?.projectId || process.env.FIREBASE_PROJECT_ID || TARGET_FIREBASE_PROJECT_ID;
  if (!release.isPublished || !release.id || !release.versionName || release.versionCode <= 0) {
    return {
      sent: false,
      skipped: true,
      configured: Boolean(creds),
      idempotencyKey,
      topic,
      projectId,
      reason: "Release is not published or has incomplete version metadata.",
      title,
      body,
      data
    };
  }
  const binaryValid = await hasApkBinary(release);
  if (!binaryValid) {
    return {
      sent: false,
      skipped: true,
      configured: Boolean(creds),
      idempotencyKey,
      topic,
      projectId,
      reason: "APK binary is missing or invalid in persistent storage.",
      title,
      body,
      data
    };
  }
  try {
    const existingSnap = await serverGetDocumentById("fcm_notifications", idempotencyKey);
    if (existingSnap.exists && existingSnap.data) {
      const existingData = existingSnap.data;
      if (existingData.status === "sent") {
        return {
          sent: false,
          alreadySent: true,
          configured: Boolean(creds),
          idempotencyKey,
          topic,
          projectId,
          messageId: existingData.messageId,
          sentAt: existingData.sentAt,
          reason: "Push notification was already sent for this published release.",
          title,
          body,
          data
        };
      }
    }
  } catch (err) {
    console.warn("FCM idempotency check warning:", err);
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
      reason: "Push notification was already recorded on this release document.",
      title,
      body,
      data
    };
  }
  if (!creds) {
    return {
      sent: false,
      skipped: true,
      configured: false,
      idempotencyKey,
      topic,
      projectId,
      reason: "FCM service account credentials (FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY) are not configured on the server.",
      title,
      body,
      data
    };
  }
  try {
    const accessToken = await getFcmAccessToken(creds);
    const notificationTag = `zoya_release_${release.id}_v${release.versionCode}`;
    const topicResult = await sendFcmV1Request(
      creds.projectId,
      accessToken,
      { topic },
      title,
      body,
      data,
      notificationTag
    );
    let devicesTargeted = 0;
    let devicesSucceeded = 0;
    try {
      const deviceDocs = await serverGetCollectionDocs("fcm_devices");
      devicesTargeted = deviceDocs.length;
      const staleDeviceIds = [];
      const tokenPromises = deviceDocs.map(async (deviceDoc) => {
        const devData = deviceDoc.data;
        const devToken = String(devData?.token || "").trim();
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
        } else if (res.errorCode === "UNREGISTERED" || res.errorCode === "NOT_FOUND") {
          staleDeviceIds.push(deviceDoc.id);
        }
      });
      await Promise.allSettled(tokenPromises);
      if (staleDeviceIds.length > 0) {
        await Promise.allSettled(
          staleDeviceIds.map((id) => serverDeleteDocumentById("fcm_devices", id))
        );
      }
    } catch (devErr) {
      console.warn("FCM registered devices broadcast notice:", devErr);
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
        reason: topicResult.errorMessage || "FCM dispatch failed.",
        title,
        body,
        data
      };
    }
    const sentAt = (/* @__PURE__ */ new Date()).toISOString();
    const messageId = topicResult.messageId || `devices:${devicesSucceeded}`;
    try {
      await serverSetDocumentById("fcm_notifications", idempotencyKey, {
        idempotencyKey,
        releaseId: release.id,
        versionName: release.versionName,
        versionCode: release.versionCode,
        status: "sent",
        messageId,
        topic,
        devicesNotified: devicesSucceeded,
        sentAt
      });
    } catch (err) {
      console.warn("Could not save FCM idempotency record:", err);
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
      data
    };
  } catch (err) {
    console.error("FCM sendReleasePushNotification error:", err instanceof Error ? err.message : "Unknown error");
    return {
      sent: false,
      configured: true,
      idempotencyKey,
      topic,
      projectId: creds.projectId,
      reason: err instanceof Error ? err.message : "Failed to send FCM push notification.",
      title,
      body,
      data
    };
  }
}
var MAX_MANUAL_TITLE_LENGTH = 60;
var MAX_MANUAL_MESSAGE_LENGTH = 200;
var MANUAL_DEDUP_WINDOW_MS = 60 * 1e3;
var inFlightManualKeys = /* @__PURE__ */ new Set();
var recentManualSends = /* @__PURE__ */ new Map();
function sanitizeNotificationText(raw, allowNewlines = false) {
  if (typeof raw !== "string") return "";
  const withoutControls = allowNewlines ? raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "") : raw.replace(/[\x00-\x1F\x7F]/g, " ");
  return withoutControls.replace(/\r\n/g, "\n").trim();
}
function validateAndSanitizeManualNotification(input) {
  if (!input || typeof input !== "object") {
    return { valid: false, error: "Invalid request payload." };
  }
  if (typeof input.title !== "string") {
    return { valid: false, error: "Notification title is required and must be a string." };
  }
  if (typeof input.message !== "string") {
    return { valid: false, error: "Notification message is required and must be a string." };
  }
  const title = sanitizeNotificationText(input.title, false);
  const message = sanitizeNotificationText(input.message, true);
  const requestId = typeof input.requestId === "string" && input.requestId.trim().length > 0 ? sanitizeNotificationText(input.requestId, false).slice(0, 80) : void 0;
  if (!title) {
    return { valid: false, error: "Notification title cannot be empty." };
  }
  if (title.length > MAX_MANUAL_TITLE_LENGTH) {
    return {
      valid: false,
      error: `Notification title cannot exceed ${MAX_MANUAL_TITLE_LENGTH} characters (received ${title.length}).`
    };
  }
  if (!message) {
    return { valid: false, error: "Notification message cannot be empty." };
  }
  if (message.length > MAX_MANUAL_MESSAGE_LENGTH) {
    return {
      valid: false,
      error: `Notification message cannot exceed ${MAX_MANUAL_MESSAGE_LENGTH} characters (received ${message.length}).`
    };
  }
  return { valid: true, title, message, requestId };
}
async function sendManualPushNotification(params) {
  const validation = validateAndSanitizeManualNotification(params);
  const topic = getFcmTopic();
  const creds = getServiceAccountCredentials();
  const projectId = creds?.projectId || process.env.FIREBASE_PROJECT_ID || TARGET_FIREBASE_PROJECT_ID;
  if (!validation.valid) {
    return {
      sent: false,
      configured: Boolean(creds),
      idempotencyKey: "",
      topic,
      projectId,
      reason: validation.error,
      title: String(params?.title || ""),
      body: String(params?.message || ""),
      data: {}
    };
  }
  const { title, message, requestId } = validation;
  const contentHash = crypto3.createHash("sha256").update(`${title}
${message}`).digest("hex").substring(0, 32);
  const idempotencyKey = requestId ? `manual_req_${crypto3.createHash("sha256").update(requestId).digest("hex").substring(0, 32)}` : `manual_msg_${contentHash}`;
  const contentDedupKey = `manual_msg_${contentHash}`;
  const nowMs = Date.now();
  const sentAtIso = new Date(nowMs).toISOString();
  const data = {
    type: "manual_notification",
    action: "OPEN_ZOYA_APP",
    title,
    body: message,
    sentAt: sentAtIso
  };
  if (inFlightManualKeys.has(idempotencyKey) || inFlightManualKeys.has(contentDedupKey)) {
    return {
      sent: false,
      alreadySent: true,
      configured: Boolean(creds),
      idempotencyKey,
      topic,
      projectId,
      reason: "This notification is already being sent. Please wait.",
      title,
      body: message,
      data
    };
  }
  const recentByReq = recentManualSends.get(idempotencyKey);
  const recentByContent = recentManualSends.get(contentDedupKey);
  const activeRecent = recentByReq || (recentByContent && nowMs - recentByContent.timestampMs < MANUAL_DEDUP_WINDOW_MS ? recentByContent : null);
  if (activeRecent) {
    return {
      sent: false,
      alreadySent: true,
      configured: Boolean(creds),
      idempotencyKey,
      topic,
      projectId,
      messageId: activeRecent.messageId,
      sentAt: activeRecent.sentAt,
      reason: "Duplicate notification prevented: An identical notification was just sent less than a minute ago.",
      title,
      body: message,
      data
    };
  }
  try {
    const existingSnap = await serverGetDocumentById("fcm_notifications", contentDedupKey);
    if (existingSnap.exists && existingSnap.data) {
      const existingData = existingSnap.data;
      const prevSentMs = existingData?.sentAt ? Date.parse(String(existingData.sentAt)) : 0;
      if (existingData?.status === "sent" && (requestId && existingData.requestId === requestId || prevSentMs > 0 && nowMs - prevSentMs < MANUAL_DEDUP_WINDOW_MS)) {
        return {
          sent: false,
          alreadySent: true,
          configured: Boolean(creds),
          idempotencyKey,
          topic,
          projectId,
          messageId: existingData.messageId,
          sentAt: existingData.sentAt,
          reason: "Duplicate notification prevented: An identical notification was just sent recently.",
          title,
          body: message,
          data
        };
      }
    }
  } catch {
  }
  if (!creds) {
    return {
      sent: false,
      skipped: true,
      configured: false,
      idempotencyKey,
      topic,
      projectId,
      reason: "FCM service account credentials (FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY) are not configured on the server.",
      title,
      body: message,
      data
    };
  }
  inFlightManualKeys.add(idempotencyKey);
  inFlightManualKeys.add(contentDedupKey);
  try {
    const accessToken = await getFcmAccessToken(creds);
    const notificationTag = `zoya_manual_${contentHash.substring(0, 12)}_${Math.floor(nowMs / 1e3)}`;
    const topicResult = await sendFcmV1Request(
      creds.projectId,
      accessToken,
      { topic },
      title,
      message,
      data,
      notificationTag,
      {
        collapseKey: "zoya_manual_notification",
        clickAction: "OPEN_ZOYA_APP"
      }
    );
    let devicesTargeted = 0;
    let devicesSucceeded = 0;
    try {
      const deviceDocs = await serverGetCollectionDocs("fcm_devices");
      devicesTargeted = deviceDocs.length;
      const staleDeviceIds = [];
      const tokenPromises = deviceDocs.map(async (deviceDoc) => {
        const devData = deviceDoc.data;
        const devToken = String(devData?.token || "").trim();
        if (!devToken) return;
        const res = await sendFcmV1Request(
          creds.projectId,
          accessToken,
          { token: devToken },
          title,
          message,
          data,
          notificationTag,
          {
            collapseKey: "zoya_manual_notification",
            clickAction: "OPEN_ZOYA_APP"
          }
        );
        if (res.ok) {
          devicesSucceeded += 1;
        } else if (res.errorCode === "UNREGISTERED" || res.errorCode === "NOT_FOUND") {
          staleDeviceIds.push(deviceDoc.id);
        }
      });
      await Promise.allSettled(tokenPromises);
      if (staleDeviceIds.length > 0) {
        await Promise.allSettled(
          staleDeviceIds.map((id) => serverDeleteDocumentById("fcm_devices", id))
        );
      }
    } catch {
    }
    if (!topicResult.ok && devicesSucceeded === 0) {
      console.error("FCM manual notification dispatch failed:", {
        topic,
        projectId: creds.projectId,
        errorCode: topicResult.errorCode || "UNKNOWN",
        errorMessage: topicResult.errorMessage || "FCM dispatch failed"
      });
      return {
        sent: false,
        configured: true,
        idempotencyKey,
        topic,
        projectId: creds.projectId,
        devicesTargeted,
        devicesSucceeded,
        reason: topicResult.errorMessage || "FCM HTTP v1 dispatch failed.",
        title,
        body: message,
        data
      };
    }
    const finalSentAt = (/* @__PURE__ */ new Date()).toISOString();
    const messageId = topicResult.messageId || `devices:${devicesSucceeded}`;
    recentManualSends.set(idempotencyKey, {
      sentAt: finalSentAt,
      timestampMs: Date.now(),
      messageId
    });
    recentManualSends.set(contentDedupKey, {
      sentAt: finalSentAt,
      timestampMs: Date.now(),
      messageId
    });
    try {
      await serverSetDocumentById("fcm_notifications", contentDedupKey, {
        idempotencyKey,
        requestId: requestId || null,
        type: "manual_notification",
        title,
        body: message,
        status: "sent",
        messageId,
        topic,
        devicesNotified: devicesSucceeded,
        sentAt: finalSentAt
      });
    } catch {
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
      sentAt: finalSentAt,
      title,
      body: message,
      data
    };
  } catch (err) {
    const safeErrorMsg = err instanceof Error ? err.message : "Failed to send manual FCM notification.";
    console.error("FCM sendManualPushNotification error:", {
      topic,
      projectId: creds.projectId,
      error: safeErrorMsg
    });
    return {
      sent: false,
      configured: true,
      idempotencyKey,
      topic,
      projectId: creds.projectId,
      reason: safeErrorMsg,
      title,
      body: message,
      data
    };
  } finally {
    inFlightManualKeys.delete(idempotencyKey);
    inFlightManualKeys.delete(contentDedupKey);
  }
}

// server/licenses.ts
import crypto4 from "crypto";
var LicenseStorageError = class extends Error {
  constructor(message, cause) {
    super(message);
    this.cause = cause;
    this.status = 503;
    this.code = "STORAGE_UNAVAILABLE";
    this.name = "LicenseStorageError";
  }
};
var simulatedStorageFailureForTesting = false;
var useInMemoryStoreForTesting = false;
var inMemoryTestStore = /* @__PURE__ */ new Map();
function assertStorageAvailable() {
  if (simulatedStorageFailureForTesting) {
    throw new LicenseStorageError(
      "Persistent license storage (Cloud Firestore) is currently unavailable."
    );
  }
}
var LICENSE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
var LICENSE_KEY_REGEX = /^ZOYA-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
var licenseOperationChain = Promise.resolve();
function withLicenseLock(fn) {
  const next = licenseOperationChain.then(fn, fn);
  licenseOperationChain = next.then(
    () => void 0,
    () => void 0
  );
  return next;
}
function isValidDeviceId(id) {
  if (typeof id !== "string") return false;
  if (id !== id.trim()) return false;
  const trimmed = id.trim();
  if (trimmed.length < 8 || trimmed.length > 120) return false;
  const lower = trimmed.toLowerCase();
  if (lower === "unknown" || lower === "null" || lower === "undefined" || lower === "none" || lower === "12345678" || /^0+$/.test(lower)) {
    return false;
  }
  return /^[a-zA-Z0-9_\-.:]+$/.test(trimmed);
}
function validateClientDeviceInfo(deviceInfo) {
  if (!deviceInfo || typeof deviceInfo !== "object") {
    return {
      valid: false,
      error: "Device information is required to activate or validate a lifetime license on this phone."
    };
  }
  const raw = deviceInfo;
  const deviceId = typeof raw.deviceId === "string" ? raw.deviceId.trim() : "";
  const deviceModel = typeof raw.deviceModel === "string" ? raw.deviceModel.trim().slice(0, 120) : "";
  if (!isValidDeviceId(deviceId)) {
    return {
      valid: false,
      error: "A valid Android device identifier (minimum 8 alphanumeric characters) is required for device binding."
    };
  }
  const cleanModel = deviceModel.length >= 2 ? deviceModel : "Android Device";
  const androidVersion = typeof raw.androidVersion === "string" ? raw.androidVersion.trim().slice(0, 60) : null;
  const appVersion = typeof raw.appVersion === "string" ? raw.appVersion.trim().slice(0, 60) : null;
  return {
    valid: true,
    data: {
      deviceId,
      deviceModel: cleanModel,
      androidVersion,
      appVersion
    }
  };
}
function generateCryptographicLicenseKey() {
  const group = () => {
    let chars = "";
    for (let i = 0; i < 4; i++) {
      const idx = crypto4.randomInt(0, LICENSE_ALPHABET.length);
      chars += LICENSE_ALPHABET[idx];
    }
    return chars;
  };
  return `ZOYA-${group()}-${group()}-${group()}`;
}
function normalizeLicenseKey(rawKey) {
  if (typeof rawKey !== "string") return "";
  return rawKey.trim().toUpperCase();
}
function isValidLicenseKeyFormat(rawKey) {
  const normalized = normalizeLicenseKey(rawKey);
  return LICENSE_KEY_REGEX.test(normalized);
}
function hashLicenseKey(rawKey) {
  const normalized = normalizeLicenseKey(rawKey);
  return crypto4.createHash("sha256").update(`zoya_license_v1:${normalized}`).digest("hex");
}
function maskLicenseKey(rawKey) {
  const normalized = normalizeLicenseKey(rawKey);
  const parts = normalized.split("-");
  const lastFour = parts.length === 4 && parts[3].length === 4 ? parts[3] : normalized.slice(-4);
  return {
    maskedKey: `ZOYA-\u2022\u2022\u2022\u2022-\u2022\u2022\u2022\u2022-${lastFour}`,
    keyLastFour: lastFour
  };
}
var LicenseEncryptionConfigurationError = class extends Error {
  constructor(message = "LICENSE_KEY_ENCRYPTION_SECRET is not configured or shorter than 32 bytes. Server fails closed per security policy.") {
    super(message);
    this.status = 500;
    this.code = "ENCRYPTION_NOT_CONFIGURED";
    this.name = "LicenseEncryptionConfigurationError";
  }
};
function getLicenseEncryptionSecret() {
  const envSecret = process.env.LICENSE_KEY_ENCRYPTION_SECRET;
  if (!envSecret || typeof envSecret !== "string") {
    throw new LicenseEncryptionConfigurationError(
      "LICENSE_KEY_ENCRYPTION_SECRET is not configured. Server fails closed per security policy."
    );
  }
  const trimmed = envSecret.trim();
  if (Buffer.byteLength(trimmed, "utf-8") < 32) {
    throw new LicenseEncryptionConfigurationError(
      "LICENSE_KEY_ENCRYPTION_SECRET is too short (must be at least 32 cryptographically random bytes). Server fails closed per security policy."
    );
  }
  return trimmed;
}
function getLicenseKeyEncryptionBuffer() {
  const secret = getLicenseEncryptionSecret();
  return crypto4.createHash("sha256").update(`zoya_aes_256_gcm:${secret}`).digest();
}
function encryptLicenseKey(plaintextKey, licenseId) {
  if (!plaintextKey || typeof plaintextKey !== "string") {
    throw new Error("Cannot encrypt empty license key.");
  }
  const key = getLicenseKeyEncryptionBuffer();
  const iv = crypto4.randomBytes(12);
  const cipher = crypto4.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`zoya_lic_aad:${licenseId}`, "utf-8"));
  let ciphertext = cipher.update(plaintextKey.trim(), "utf-8", "hex");
  ciphertext += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  const ivHex = iv.toString("hex");
  return `${ivHex}:${authTag}:${ciphertext}`;
}
function decryptLicenseKey(encryptedPayload, licenseId) {
  if (!encryptedPayload || typeof encryptedPayload !== "string") {
    throw new Error("Encrypted license payload is required.");
  }
  const parts = encryptedPayload.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted license key payload format. Expected iv:authTag:ciphertext.");
  }
  const [ivHex, authTagHex, ciphertextHex] = parts;
  if (!ivHex || !authTagHex || !ciphertextHex) {
    throw new Error("Encrypted license key payload is missing required cryptographic components.");
  }
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  if (iv.length !== 12) {
    throw new Error(`Invalid IV length for AES-256-GCM. Expected 12 bytes, got ${iv.length}.`);
  }
  if (authTag.length !== 16) {
    throw new Error(`Invalid authentication tag length for AES-256-GCM. Expected 16 bytes, got ${authTag.length}.`);
  }
  const key = getLicenseKeyEncryptionBuffer();
  const decipher = crypto4.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(`zoya_lic_aad:${licenseId}`, "utf-8"));
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(ciphertextHex, "hex", "utf-8");
  decrypted += decipher.final("utf-8");
  return decrypted;
}
function sanitizeText(raw, maxLen = 200) {
  if (typeof raw !== "string") return "";
  return raw.replace(/[\x00-\x1F\x7F]/g, " ").trim().slice(0, maxLen);
}
var EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function sanitizeRecordForStorage(record) {
  const copy = { ...record };
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
    Object.entries(copy).filter(([, v]) => v !== void 0)
  );
  return cleaned;
}
var CACHE_TTL_MS = 6e4;
var idToLicenseCache = /* @__PURE__ */ new Map();
var keyHashToLicenseCache = /* @__PURE__ */ new Map();
var allLicensesCache = null;
function cacheLicenseRecord(record) {
  const now = Date.now();
  idToLicenseCache.set(record.id, { data: record, cachedAt: now });
  if (record.keyHash) {
    keyHashToLicenseCache.set(record.keyHash, { data: record, cachedAt: now });
  }
}
function normalizeRecordOnRead(raw) {
  const statusRaw = String(raw.status || "").trim();
  let status = "unactivated";
  if (statusRaw === "active") {
    status = "active";
  } else if (statusRaw === "revoked") {
    status = "revoked";
  } else {
    status = "unactivated";
  }
  let linkedDevice = null;
  if (raw.linkedDevice && typeof raw.linkedDevice === "object" && raw.linkedDevice.deviceId) {
    linkedDevice = {
      deviceId: String(raw.linkedDevice.deviceId).trim(),
      deviceModel: String(raw.linkedDevice.deviceModel || "Android Device").trim(),
      androidVersion: raw.linkedDevice.androidVersion ? String(raw.linkedDevice.androidVersion).trim() : null,
      appVersion: raw.linkedDevice.appVersion ? String(raw.linkedDevice.appVersion).trim() : null,
      linkedAt: String(raw.linkedDevice.linkedAt || raw.activatedAt || raw.createdAt || (/* @__PURE__ */ new Date()).toISOString())
    };
  }
  const record = {
    id: String(raw.id || ""),
    keyHash: String(raw.keyHash || ""),
    maskedKey: String(raw.maskedKey || ""),
    keyLastFour: String(raw.keyLastFour || raw.maskedKey?.slice(-4) || ""),
    encryptedKey: raw.encryptedKey && typeof raw.encryptedKey === "string" ? raw.encryptedKey.trim() : null,
    customerName: String(raw.customerName || ""),
    customerEmail: String(raw.customerEmail || ""),
    licenseType: "Lifetime",
    status,
    createdBy: raw.createdBy && typeof raw.createdBy === "object" ? { email: String(raw.createdBy.email || ""), name: String(raw.createdBy.name || "") } : { email: "admin@zoya.ai", name: "Administrator" },
    createdAt: String(raw.createdAt || (/* @__PURE__ */ new Date()).toISOString()),
    updatedAt: String(raw.updatedAt || (/* @__PURE__ */ new Date()).toISOString()),
    activatedAt: raw.activatedAt ? String(raw.activatedAt) : null,
    revokedAt: raw.revokedAt ? String(raw.revokedAt) : null,
    revokedBy: raw.revokedBy && typeof raw.revokedBy === "object" ? { email: String(raw.revokedBy.email || ""), name: String(raw.revokedBy.name || "") } : null,
    revokeReason: raw.revokeReason ? String(raw.revokeReason) : null,
    linkedDevice,
    lastSeenAt: raw.lastSeenAt ? String(raw.lastSeenAt) : null,
    validationCount: Number(raw.validationCount) || (status === "active" ? 1 : 0),
    auditLog: Array.isArray(raw.auditLog) ? raw.auditLog : []
  };
  return sanitizeRecordForStorage(record);
}
async function getAllLicenses() {
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
    const docs = await serverGetCollectionDocs("licenses");
    const all = [];
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
      "Persistent license storage (Cloud Firestore) is unavailable. Could not retrieve licenses.",
      err
    );
  }
}
async function getLicenseById(id) {
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
    const snap = await serverGetDocumentById("licenses", cleanId);
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
      "Persistent license storage (Cloud Firestore) is unavailable. Could not read license record.",
      err
    );
  }
}
async function getLicenseByKeyHash(keyHash) {
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
    const docs = await serverQueryDocumentsEq("licenses", "keyHash", keyHash, 1);
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
      "Persistent license storage (Cloud Firestore) is unavailable. Could not query license record by keyHash.",
      err
    );
  }
}
async function saveLicenseRecord(record) {
  assertStorageAvailable();
  const safeRecord = sanitizeRecordForStorage({
    ...record,
    updatedAt: record.updatedAt || (/* @__PURE__ */ new Date()).toISOString()
  });
  if (useInMemoryStoreForTesting) {
    inMemoryTestStore.set(safeRecord.id, safeRecord);
    cacheLicenseRecord(safeRecord);
    allLicensesCache = null;
    return safeRecord;
  }
  try {
    await serverSetDocumentById("licenses", safeRecord.id, safeRecord);
    cacheLicenseRecord(safeRecord);
    allLicensesCache = null;
    return safeRecord;
  } catch (err) {
    if (err instanceof LicenseStorageError) {
      throw err;
    }
    throw new LicenseStorageError(
      "Persistent license storage (Cloud Firestore) failed to save license record.",
      err
    );
  }
}
function computeLicenseStats(licenses) {
  let activated = 0;
  let unactivated = 0;
  let revoked = 0;
  for (const lic of licenses) {
    if (lic.status === "active") {
      activated += 1;
    } else if (lic.status === "revoked") {
      revoked += 1;
    } else {
      unactivated += 1;
    }
  }
  return {
    total: licenses.length,
    activated,
    unactivated,
    revoked
  };
}
async function createLifetimeLicense(input, admin, customKeyGenerator) {
  if (!admin || admin.role !== "admin") {
    return { success: false, status: 401, error: "Unauthorized administrator session." };
  }
  if (!input || typeof input !== "object") {
    return { success: false, status: 400, error: "Invalid license creation payload." };
  }
  const customerName = sanitizeText(input.customerName, 120);
  const customerEmail = sanitizeText(input.customerEmail, 160).toLowerCase();
  const licenseTypeRaw = input.licenseType !== void 0 && input.licenseType !== null ? sanitizeText(input.licenseType, 40) : "Lifetime";
  if (!customerName || customerName.length < 2) {
    return {
      success: false,
      status: 400,
      error: "Customer name is required (minimum 2 characters)."
    };
  }
  if (!customerEmail || !EMAIL_REGEX.test(customerEmail)) {
    return {
      success: false,
      status: 400,
      error: "A valid customer email address is required."
    };
  }
  if (licenseTypeRaw !== "Lifetime") {
    return {
      success: false,
      status: 400,
      error: "Only Lifetime licenses are supported."
    };
  }
  return withLicenseLock(async () => {
    try {
      const existingLicenses = await getAllLicenses();
      const existingHashes = new Set(existingLicenses.map((l) => l.keyHash));
      const keyGen = customKeyGenerator || generateCryptographicLicenseKey;
      let rawKey = "";
      let keyHash = "";
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
          error: "Failed to generate a unique cryptographic license key after multiple attempts."
        };
      }
      const { maskedKey, keyLastFour } = maskLicenseKey(rawKey);
      const nowIso = (/* @__PURE__ */ new Date()).toISOString();
      const licenseId = `lic_${Date.now()}_${crypto4.randomBytes(4).toString("hex")}`;
      const actorLabel = `${admin.name} <${admin.email}>`;
      const auditLog = [
        {
          id: `aud_${Date.now()}_${crypto4.randomBytes(3).toString("hex")}`,
          action: "created",
          timestamp: nowIso,
          actor: actorLabel,
          details: `Created Lifetime license (${maskedKey}) for ${customerName} (${customerEmail}) in Unactivated status.`
        }
      ];
      let encryptedKey = null;
      try {
        encryptedKey = encryptLicenseKey(rawKey, licenseId);
      } catch (encErr) {
        if (encErr instanceof LicenseEncryptionConfigurationError) {
          return {
            success: false,
            status: 500,
            error: "License creation failed: LICENSE_KEY_ENCRYPTION_SECRET is not configured on the server. Server fails closed per security policy."
          };
        }
        throw encErr;
      }
      const record = {
        id: licenseId,
        keyHash,
        maskedKey,
        keyLastFour,
        encryptedKey,
        customerName,
        customerEmail,
        licenseType: "Lifetime",
        status: "unactivated",
        createdBy: {
          email: admin.email,
          name: admin.name
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
        auditLog
      };
      const saved = await saveLicenseRecord(record);
      return {
        success: true,
        generatedKey: rawKey,
        license: saved
      };
    } catch (err) {
      if (err instanceof LicenseStorageError) {
        return {
          success: false,
          status: 503,
          error: err.message
        };
      }
      throw err;
    }
  });
}
async function revealLicenseKeyByAdmin(licenseId, admin) {
  if (!admin || admin.role !== "admin") {
    return {
      success: false,
      status: 401,
      code: "UNAUTHORIZED",
      error: "Unauthorized administrator session."
    };
  }
  const cleanId = sanitizeText(licenseId, 100);
  if (!cleanId) {
    return {
      success: false,
      status: 400,
      error: "License ID is required."
    };
  }
  try {
    const license = await getLicenseById(cleanId);
    if (!license) {
      return {
        success: false,
        status: 404,
        code: "LICENSE_NOT_FOUND",
        error: "License record not found."
      };
    }
    if (!license.encryptedKey) {
      return {
        success: false,
        status: 404,
        code: "KEY_NOT_RECOVERABLE",
        error: "This license key was generated prior to reversible encryption. Per security architecture, the original key cannot be recovered."
      };
    }
    try {
      const decryptedKey = decryptLicenseKey(license.encryptedKey, license.id);
      return {
        success: true,
        status: 200,
        licenseKey: decryptedKey
      };
    } catch (decErr) {
      if (decErr instanceof LicenseEncryptionConfigurationError) {
        return {
          success: false,
          status: 500,
          code: "CONFIGURATION_ERROR",
          error: "License key decryption unavailable: LICENSE_KEY_ENCRYPTION_SECRET is not configured on the server. Server fails closed per security policy."
        };
      }
      return {
        success: false,
        status: 500,
        code: "DECRYPTION_FAILED",
        error: "Failed to decrypt license key. Ciphertext may be corrupted, tampered, or encrypted with a different secret."
      };
    }
  } catch (err) {
    if (err instanceof LicenseStorageError) {
      return {
        success: false,
        status: 503,
        error: err.message
      };
    }
    throw err;
  }
}
async function rebindLicenseDeviceByAdmin(licenseId, input, admin) {
  if (!admin || admin.role !== "admin") {
    return { success: false, status: 401, error: "Unauthorized administrator session." };
  }
  const cleanId = sanitizeText(licenseId, 100);
  if (!cleanId) {
    return { success: false, status: 400, error: "License ID is required." };
  }
  const reason = sanitizeText(input.reason, 300);
  if (!reason || reason.length < 3) {
    return {
      success: false,
      status: 400,
      error: "Administrator authorization reason is required to rebind a device (minimum 3 characters)."
    };
  }
  return withLicenseLock(async () => {
    try {
      const existing = await getLicenseById(cleanId);
      if (!existing) {
        return { success: false, status: 404, error: "License record not found." };
      }
      if (existing.status === "revoked") {
        return { success: false, status: 400, error: "Cannot rebind a revoked license." };
      }
      const prevDeviceLabel = existing.linkedDevice?.deviceModel ? `${existing.linkedDevice.deviceModel} (${existing.linkedDevice.deviceId})` : "previous device";
      const nowIso = (/* @__PURE__ */ new Date()).toISOString();
      const actorLabel = `${admin.name} <${admin.email}>`;
      const auditEntry = {
        id: `aud_${Date.now()}_${crypto4.randomBytes(3).toString("hex")}`,
        action: "device_rebound",
        timestamp: nowIso,
        actor: actorLabel,
        details: `Device binding reset by ${admin.name}. Released from ${prevDeviceLabel}. Reason: ${reason}`
      };
      const updated = {
        ...existing,
        status: "unactivated",
        linkedDevice: null,
        updatedAt: nowIso,
        auditLog: [...existing.auditLog || [], auditEntry]
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
async function revokeLicense(licenseId, input, admin) {
  if (!admin || admin.role !== "admin") {
    return { success: false, status: 401, error: "Unauthorized administrator session." };
  }
  return withLicenseLock(async () => {
    try {
      const existing = await getLicenseById(licenseId);
      if (!existing) {
        return { success: false, status: 404, error: "License record not found." };
      }
      if (existing.status === "revoked") {
        return {
          success: false,
          status: 400,
          error: "This license is already revoked."
        };
      }
      const reason = sanitizeText(input?.reason, 300) || "Revoked by administrator";
      const nowIso = (/* @__PURE__ */ new Date()).toISOString();
      const actorLabel = `${admin.name} <${admin.email}>`;
      const auditEntry = {
        id: `aud_${Date.now()}_${crypto4.randomBytes(3).toString("hex")}`,
        action: "revoked",
        timestamp: nowIso,
        actor: actorLabel,
        details: `License revoked by ${admin.name}. Reason: ${reason}`
      };
      const updated = {
        ...existing,
        status: "revoked",
        revokedAt: nowIso,
        revokedBy: {
          email: admin.email,
          name: admin.name
        },
        revokeReason: reason,
        updatedAt: nowIso,
        auditLog: [...existing.auditLog || [], auditEntry]
      };
      const saved = await saveLicenseRecord(updated);
      return { success: true, license: saved };
    } catch (err) {
      if (err instanceof LicenseStorageError) {
        return {
          success: false,
          status: 503,
          error: err.message
        };
      }
      throw err;
    }
  });
}
function generateSignedEntitlementToken(payload) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const nowSec = Math.floor(Date.now() / 1e3);
  const expSec = nowSec + 30 * 24 * 60 * 60;
  const body = Buffer.from(
    JSON.stringify({
      id: payload.licenseId,
      kh: payload.keyHash,
      mk: payload.maskedKey,
      act: payload.activatedAt,
      did: payload.deviceId || null,
      iat: nowSec,
      exp: expSec
    })
  ).toString("base64url");
  const signature = crypto4.createHmac("sha256", getJwtSecret()).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}
function verifySignedEntitlementToken(token, expectedKeyHash, expectedDeviceId) {
  if (!token || typeof token !== "string") {
    return { valid: false, reason: "Entitlement token missing or invalid." };
  }
  const parts = token.trim().split(".");
  if (parts.length !== 3) {
    return { valid: false, reason: "Entitlement token malformed." };
  }
  const [header, body, signature] = parts;
  const expectedSig = crypto4.createHmac("sha256", getJwtSecret()).update(`${header}.${body}`).digest("base64url");
  const sigBuf = Buffer.from(signature, "utf-8");
  const expBuf = Buffer.from(expectedSig, "utf-8");
  if (sigBuf.length !== expBuf.length || !crypto4.timingSafeEqual(sigBuf, expBuf)) {
    return { valid: false, reason: "Entitlement token signature mismatch or untrusted." };
  }
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf-8"));
    if (!payload || typeof payload !== "object") {
      return { valid: false, reason: "Entitlement token payload invalid." };
    }
    if (payload.kh !== expectedKeyHash) {
      return { valid: false, reason: "Entitlement token key mismatch." };
    }
    const nowSec = Math.floor(Date.now() / 1e3);
    if (!payload.exp || payload.exp < nowSec) {
      return { valid: false, reason: "Entitlement token grace period expired." };
    }
    if (expectedDeviceId && payload.did && payload.did !== expectedDeviceId) {
      return { valid: false, reason: "Entitlement token was issued to a different Android device." };
    }
    return { valid: true, payload };
  } catch {
    return { valid: false, reason: "Entitlement token parse error." };
  }
}
async function validateLicenseForAndroid(payload) {
  if (!payload || typeof payload !== "object") {
    return {
      valid: false,
      status: "malformed",
      code: "MALFORMED_KEY",
      httpStatus: 400,
      error: "Request payload is required."
    };
  }
  const normalizedKey = normalizeLicenseKey(payload.licenseKey);
  if (!normalizedKey || !isValidLicenseKeyFormat(normalizedKey)) {
    return {
      valid: false,
      status: "malformed",
      code: "MALFORMED_KEY",
      httpStatus: 400,
      error: "License key format is invalid. Expected ZOYA-XXXX-XXXX-XXXX."
    };
  }
  const keyHash = hashLicenseKey(normalizedKey);
  const rawToken = typeof payload.entitlementToken === "string" ? payload.entitlementToken.trim() : "";
  const deviceValidation = validateClientDeviceInfo(payload.deviceInfo);
  if (!deviceValidation.valid || !deviceValidation.data) {
    return {
      valid: false,
      status: "malformed",
      code: "INVALID_DEVICE_INFO",
      httpStatus: 400,
      error: deviceValidation.error || "A valid Android device identifier is required."
    };
  }
  const clientDevice = deviceValidation.data;
  return withLicenseLock(async () => {
    try {
      const existing = await getLicenseByKeyHash(keyHash);
      if (!existing) {
        return {
          valid: false,
          status: "not_found",
          code: "UNKNOWN_KEY",
          httpStatus: 404,
          error: "License key not found."
        };
      }
      if (existing.status === "revoked") {
        return {
          valid: false,
          status: "revoked",
          code: "LICENSE_REVOKED",
          httpStatus: 403,
          revokedAt: existing.revokedAt,
          error: "This lifetime license has been revoked and is no longer valid."
        };
      }
      const txResult = await serverRunTransaction(async (tx) => {
        const snap = await tx.get("licenses", existing.id);
        if (!snap.exists || !snap.data) {
          throw new Error("License document missing during transaction.");
        }
        const current = normalizeRecordOnRead(snap.data);
        if (current.status === "revoked") {
          return {
            type: "revoked",
            revokedAt: current.revokedAt
          };
        }
        const nowIso = (/* @__PURE__ */ new Date()).toISOString();
        if (current.linkedDevice && current.linkedDevice.deviceId) {
          if (current.linkedDevice.deviceId !== clientDevice.deviceId) {
            return {
              type: "mismatch",
              boundModel: current.linkedDevice.deviceModel
            };
          }
          const updatedAudit2 = [...current.auditLog || []];
          if (updatedAudit2.length < 50) {
            updatedAudit2.push({
              id: `aud_${Date.now()}_${crypto4.randomBytes(3).toString("hex")}`,
              action: "validated",
              timestamp: nowIso,
              actor: "Zoya Android Phone",
              details: `Validated on bound device (${clientDevice.deviceModel}).`
            });
          }
          const updated2 = {
            ...current,
            status: "active",
            lastSeenAt: nowIso,
            validationCount: (current.validationCount || 0) + 1,
            linkedDevice: {
              ...current.linkedDevice,
              deviceModel: clientDevice.deviceModel || current.linkedDevice.deviceModel,
              androidVersion: clientDevice.androidVersion || current.linkedDevice.androidVersion,
              appVersion: clientDevice.appVersion || current.linkedDevice.appVersion
            },
            updatedAt: nowIso,
            auditLog: updatedAudit2
          };
          tx.set("licenses", current.id, updated2);
          return { type: "success", record: updated2, isFirstActivation: false };
        }
        const newLinkedDevice = {
          deviceId: clientDevice.deviceId,
          deviceModel: clientDevice.deviceModel,
          androidVersion: clientDevice.androidVersion,
          appVersion: clientDevice.appVersion,
          linkedAt: nowIso
        };
        const updatedAudit = [...current.auditLog || []];
        updatedAudit.push({
          id: `aud_${Date.now()}_${crypto4.randomBytes(3).toString("hex")}`,
          action: "activated",
          timestamp: nowIso,
          actor: "Zoya Android Phone",
          details: `Lifetime license activated and permanently bound to ${clientDevice.deviceModel} (${clientDevice.deviceId}).`
        });
        const updated = {
          ...current,
          status: "active",
          activatedAt: current.activatedAt || nowIso,
          lastSeenAt: nowIso,
          validationCount: 1,
          linkedDevice: newLinkedDevice,
          updatedAt: nowIso,
          auditLog: updatedAudit
        };
        tx.set("licenses", current.id, updated);
        return { type: "success", record: updated, isFirstActivation: true };
      });
      if (txResult.type === "revoked") {
        return {
          valid: false,
          status: "revoked",
          code: "LICENSE_REVOKED",
          httpStatus: 403,
          revokedAt: txResult.revokedAt,
          error: "This lifetime license has been revoked."
        };
      }
      if (txResult.type === "mismatch") {
        return {
          valid: false,
          status: "device_mismatch",
          code: "DEVICE_MISMATCH",
          httpStatus: 403,
          error: `This lifetime license is already bound to another phone (${txResult.boundModel}). One-phone lifetime license policy is strictly enforced.`
        };
      }
      const saved = txResult.record;
      cacheLicenseRecord(saved);
      allLicensesCache = null;
      const entitlementToken = generateSignedEntitlementToken({
        licenseId: saved.id,
        keyHash: saved.keyHash,
        maskedKey: saved.maskedKey,
        activatedAt: saved.activatedAt || (/* @__PURE__ */ new Date()).toISOString(),
        deviceId: saved.linkedDevice?.deviceId || clientDevice.deviceId
      });
      return {
        valid: true,
        status: "active",
        code: "LICENSE_VALID",
        httpStatus: 200,
        entitlementToken,
        license: {
          id: saved.id,
          maskedKey: saved.maskedKey,
          licenseType: "Lifetime",
          status: "active",
          customerName: saved.customerName,
          activatedAt: saved.activatedAt || (/* @__PURE__ */ new Date()).toISOString(),
          lastSeenAt: saved.lastSeenAt || (/* @__PURE__ */ new Date()).toISOString(),
          linkedDevice: saved.linkedDevice
        }
      };
    } catch (err) {
      if (err instanceof LicenseStorageError) {
        const tokenVerification = verifySignedEntitlementToken(rawToken, keyHash, clientDevice.deviceId);
        if (tokenVerification.valid && tokenVerification.payload) {
          return {
            valid: true,
            status: "active",
            code: "LICENSE_VALID",
            httpStatus: 200,
            isOfflineGrace: true,
            entitlementToken: rawToken,
            error: "Server storage is temporarily unavailable. License validated via cryptographic offline grace token on bound device.",
            license: {
              id: tokenVerification.payload.id || "grace_id",
              maskedKey: tokenVerification.payload.mk || maskLicenseKey(normalizedKey).maskedKey,
              licenseType: "Lifetime",
              status: "active",
              customerName: "Lifetime Subscriber",
              activatedAt: tokenVerification.payload.act || (/* @__PURE__ */ new Date()).toISOString(),
              lastSeenAt: (/* @__PURE__ */ new Date()).toISOString(),
              linkedDevice: {
                deviceId: clientDevice.deviceId,
                deviceModel: clientDevice.deviceModel,
                linkedAt: tokenVerification.payload.act || (/* @__PURE__ */ new Date()).toISOString()
              }
            }
          };
        }
        if (tokenVerification.reason?.includes("different Android device")) {
          return {
            valid: false,
            status: "device_mismatch",
            code: "DEVICE_MISMATCH",
            httpStatus: 403,
            error: "Offline grace token was issued to a different Android device."
          };
        }
        return {
          valid: false,
          status: "storage_error",
          code: "STORAGE_UNAVAILABLE",
          httpStatus: 503,
          error: err.message
        };
      }
      throw err;
    }
  });
}

// server/rateLimit.ts
var buckets = /* @__PURE__ */ new Map();
function getClientIdentifier(req) {
  const headers = req.headers || {};
  const forwarded = headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim().length > 0) {
    return forwarded.split(",")[0].trim();
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return String(forwarded[0]).split(",")[0].trim();
  }
  const realIp = headers["x-real-ip"];
  if (typeof realIp === "string" && realIp.trim().length > 0) {
    return realIp.trim();
  }
  const socketAddr = req.socket?.remoteAddress;
  if (socketAddr) {
    return socketAddr;
  }
  return "unknown-client";
}
function checkRateLimit(req, options) {
  const clientIp = getClientIdentifier(req);
  const key = `${options.namespace}:${clientIp}`;
  const now = Date.now();
  const windowStart = now - options.windowMs;
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { timestamps: [] };
    buckets.set(key, bucket);
  }
  bucket.timestamps = bucket.timestamps.filter((ts) => ts > windowStart);
  if (bucket.timestamps.length >= options.maxRequests) {
    const oldestInWindow = bucket.timestamps[0] || now;
    const retryAfterMs = Math.max(1e3, options.windowMs - (now - oldestInWindow));
    const retryAfterSeconds = Math.ceil(retryAfterMs / 1e3);
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds,
      limit: options.maxRequests
    };
  }
  bucket.timestamps.push(now);
  if (buckets.size > 5e3) {
    for (const [k, v] of buckets.entries()) {
      const active = v.timestamps.filter((ts) => ts > now - 36e5);
      if (active.length === 0) {
        buckets.delete(k);
      } else {
        v.timestamps = active;
      }
    }
  }
  return {
    allowed: true,
    remaining: Math.max(0, options.maxRequests - bucket.timestamps.length),
    retryAfterSeconds: 0,
    limit: options.maxRequests
  };
}
function applyRateLimitHeaders(res, result) {
  if (res.writableEnded || res.headersSent) return;
  res.setHeader("X-RateLimit-Limit", String(result.limit));
  res.setHeader("X-RateLimit-Remaining", String(result.remaining));
  if (!result.allowed && result.retryAfterSeconds > 0) {
    res.setHeader("Retry-After", String(result.retryAfterSeconds));
  }
}

// server/apiHandler.ts
function sendJson(res, status, data) {
  if (res.writableEnded || res.headersSent) {
    return;
  }
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.end(JSON.stringify(data));
}
function sendError(res, status, message, code) {
  sendJson(res, status, {
    success: false,
    ...code ? { code } : status === 503 ? { code: "STORAGE_UNAVAILABLE" } : {},
    error: message
  });
}
async function parseJsonBody(req) {
  const anyReq = req;
  if (anyReq.body !== void 0 && anyReq.body !== null) {
    if (Buffer.isBuffer(anyReq.body) || anyReq.body instanceof Uint8Array) {
      try {
        const text = Buffer.from(anyReq.body).toString("utf-8").trim();
        return text ? JSON.parse(text) : {};
      } catch {
        throw new Error("Invalid JSON");
      }
    }
    if (typeof anyReq.body === "string") {
      try {
        const trimmed = anyReq.body.trim();
        return trimmed ? JSON.parse(trimmed) : {};
      } catch {
        throw new Error("Invalid JSON");
      }
    }
    if (typeof anyReq.body === "object") {
      return anyReq.body;
    }
  }
  if (anyReq.readableEnded) {
    return {};
  }
  return new Promise((resolve, reject) => {
    let body = "";
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        try {
          const parsed = body.trim() ? JSON.parse(body) : {};
          resolve(parsed);
        } catch {
          resolve({});
        }
      }
    }, 2500);
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 5 * 1024 * 1024) {
        done = true;
        clearTimeout(timer);
        reject(new Error("Request body too large (max 5MB)"));
      }
    });
    req.on("end", () => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        try {
          const parsed = body.trim() ? JSON.parse(body) : {};
          resolve(parsed);
        } catch {
          reject(new Error("Invalid JSON"));
        }
      }
    });
    req.on("error", (err) => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        reject(err);
      }
    });
  });
}
async function readBinaryBody(req) {
  const anyReq = req;
  if (Buffer.isBuffer(anyReq.body)) {
    return anyReq.body;
  }
  if (anyReq.body instanceof Uint8Array) {
    return Buffer.from(anyReq.body);
  }
  if (anyReq.rawBody && Buffer.isBuffer(anyReq.rawBody)) {
    return anyReq.rawBody;
  }
  if (typeof anyReq.body === "string") {
    return Buffer.from(anyReq.body, "binary");
  }
  if (anyReq.readableEnded) {
    return Buffer.alloc(0);
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalSize = 0;
    const MAX_SIZE = 150 * 1024 * 1024;
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        resolve(Buffer.concat(chunks));
      }
    }, 3e4);
    req.on("data", (chunk) => {
      totalSize += chunk.length;
      if (totalSize > MAX_SIZE) {
        done = true;
        clearTimeout(timer);
        reject(new Error("File exceeds maximum allowable size (150MB)"));
        return;
      }
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on("end", () => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        resolve(Buffer.concat(chunks));
      }
    });
    req.on("error", (err) => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        reject(err);
      }
    });
  });
}
async function handleApiRequest(req, res, explicitRoute) {
  const url = req.url || "";
  const parsedUrl = new URL(url, "http://localhost:3000");
  const rawReqPath = parsedUrl.pathname.replace(/\/+$/, "") || "/";
  const rewrittenRoute = (parsedUrl.searchParams.get("__route") || "").trim();
  let pathname;
  if (rewrittenRoute) {
    pathname = rewrittenRoute;
  } else if (rawReqPath === "/api/admin/notify" || rawReqPath === "/admin/notify" || parsedUrl.searchParams.get("action") === "notify") {
    pathname = "/api/admin/notify";
  } else if (rawReqPath === "/api/admin/licenses" || rawReqPath === "/admin/licenses" || rawReqPath.startsWith("/api/admin/licenses/") || rawReqPath.startsWith("/admin/licenses/")) {
    pathname = rawReqPath;
  } else if (rawReqPath === "/api/licenses/validate" || rawReqPath === "/licenses/validate") {
    pathname = "/api/licenses/validate";
  } else {
    pathname = explicitRoute || parsedUrl.pathname;
  }
  if (!pathname.startsWith("/api/")) {
    pathname = `/api${pathname.startsWith("/") ? pathname : "/" + pathname}`;
  }
  pathname = pathname.replace(/\/+$/, "") || "/";
  const method = req.method?.toUpperCase() || "GET";
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-filename, Accept, X-Requested-With");
  if (method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return true;
  }
  try {
    if (pathname === "/api/releases/latest" && method === "GET") {
      const latest = await getLatestPublishedRelease();
      if (!latest) {
        sendJson(res, 200, {
          published: false,
          message: "No official APK release has been published yet."
        });
        return true;
      }
      const binaryVerified = await hasApkBinary(latest);
      sendJson(res, 200, {
        published: true,
        release: {
          ...latest,
          binaryVerified
        }
      });
      return true;
    }
    if (pathname === "/api/releases/manifest" && method === "GET") {
      const latest = await getLatestPublishedRelease();
      if (!latest) {
        sendJson(res, 404, {
          error: "No published releases found"
        });
        return true;
      }
      const manifest = {
        applicationId: latest.applicationId || OFFICIAL_ZOYA_PACKAGE,
        latestRelease: {
          versionName: latest.versionName,
          versionCode: latest.versionCode,
          downloadUrl: latest.downloadUrl,
          sha256: latest.sha256,
          fileSize: latest.fileSize,
          fileSizeFormatted: latest.fileSizeFormatted,
          minAndroidVersion: latest.minAndroidVersion,
          minSdkVersion: latest.minSdkVersion ?? null,
          targetSdkVersion: latest.targetSdkVersion ?? null,
          releaseDate: latest.releaseDate,
          releaseNotes: latest.releaseNotes
        },
        publishedAt: latest.publishedAt || latest.createdAt
      };
      sendJson(res, 200, manifest);
      return true;
    }
    if (pathname === "/api/releases/download" && (method === "GET" || method === "HEAD")) {
      const releaseId = parsedUrl.searchParams.get("id");
      let targetRelease = null;
      if (releaseId) {
        targetRelease = await getReleaseById(releaseId);
      } else {
        targetRelease = await getLatestPublishedRelease();
      }
      if (!targetRelease) {
        sendError(res, 404, "Release not found.");
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
          "APK file binary missing from persistent cloud storage. Please re-upload and publish the APK in the Admin Portal."
        );
        return true;
      }
      const cleanVersion = (targetRelease.versionName || "latest").trim().replace(/[^a-zA-Z0-9._-]/g, "-");
      const outputFilename = `zoya-assistant-${cleanVersion}.apk`;
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/vnd.android.package-archive");
      res.setHeader("Content-Disposition", `attachment; filename="${outputFilename}"`);
      res.setHeader("Content-Length", String(apkBuffer.length));
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.setHeader("X-Content-Type-Options", "nosniff");
      if (method === "HEAD") {
        res.end();
        return true;
      }
      res.end(apkBuffer);
      return true;
    }
    if (pathname === "/api/devices/register") {
      if (method !== "POST") {
        sendError(res, 405, `Method ${method} Not Allowed. Expected POST.`);
        return true;
      }
      let body = {};
      try {
        body = await parseJsonBody(req);
      } catch (err) {
        sendError(res, 400, err instanceof Error ? err.message : "Invalid JSON body.");
        return true;
      }
      if (!body.token || typeof body.token !== "string" || body.token.trim().length < 20) {
        sendError(res, 400, "Valid FCM registration token is required.");
        return true;
      }
      const { deviceId } = await registerFcmDeviceToken({
        token: body.token,
        platform: body.platform || "android",
        applicationId: body.applicationId || "com.riyajul.zoya",
        appVersion: body.appVersion,
        versionCode: body.versionCode
      });
      sendJson(res, 200, {
        success: true,
        deviceId,
        message: "Android device registered for Zoya release notifications."
      });
      return true;
    }
    if (pathname === "/api/licenses/validate" || pathname === "/api/licenses/activate") {
      if (method !== "POST") {
        sendError(res, 405, `Method ${method} Not Allowed. Expected POST.`);
        return true;
      }
      const rateLimit = checkRateLimit(req, {
        namespace: "license_validate",
        maxRequests: 20,
        windowMs: 6e4
      });
      applyRateLimitHeaders(res, rateLimit);
      if (!rateLimit.allowed) {
        sendJson(res, 429, {
          success: false,
          valid: false,
          status: "rate_limited",
          code: "RATE_LIMITED",
          error: `Too many license validation requests. Please wait ${rateLimit.retryAfterSeconds}s and try again.`
        });
        return true;
      }
      let body = {};
      try {
        body = await parseJsonBody(req);
      } catch (err) {
        sendJson(res, 400, {
          success: false,
          valid: false,
          status: "malformed",
          code: "MALFORMED_KEY",
          error: err instanceof Error ? err.message : "Invalid JSON body."
        });
        return true;
      }
      const result = await validateLicenseForAndroid(body);
      const { httpStatus, ...payload } = result;
      sendJson(res, httpStatus, {
        success: result.valid,
        ...payload
      });
      return true;
    }
    if (pathname === "/api/admin/login") {
      if (method !== "POST") {
        sendError(res, 405, `Method ${method} Not Allowed. Expected POST.`);
        return true;
      }
      const loginRateLimit = checkRateLimit(req, {
        namespace: "admin_login",
        maxRequests: 10,
        windowMs: 6e4
      });
      applyRateLimitHeaders(res, loginRateLimit);
      if (!loginRateLimit.allowed) {
        sendJson(res, 429, {
          success: false,
          code: "RATE_LIMITED",
          error: `Too many login attempts. Please wait ${loginRateLimit.retryAfterSeconds}s before trying again.`
        });
        return true;
      }
      let body = {};
      try {
        body = await parseJsonBody(req);
      } catch (err) {
        sendError(res, 400, err instanceof Error ? err.message : "Invalid JSON body.");
        return true;
      }
      const pin = body && body.pin !== void 0 && body.pin !== null ? String(body.pin).trim() : "";
      const email = body && typeof body.email === "string" ? body.email.trim() : "";
      const password = body && typeof body.password === "string" ? body.password : "";
      let user = null;
      if (pin.length > 0) {
        user = authenticateAdminPin(pin);
      } else if (email || password) {
        user = authenticateAdmin(email, password);
      } else {
        sendError(res, 400, "Administrator PIN is required.");
        return true;
      }
      if (!user) {
        sendError(res, 401, "Invalid administrator PIN.");
        return true;
      }
      const token = createToken(user);
      res.setHeader(
        "Set-Cookie",
        `zoya_admin_token=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=7200`
      );
      sendJson(res, 200, {
        success: true,
        token,
        user: { email: user.email, name: user.name, role: user.role }
      });
      return true;
    }
    if (pathname === "/api/admin/session") {
      if (method !== "GET") {
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
        token,
        user: { email: user.email, name: user.name, role: user.role }
      });
      return true;
    }
    if (pathname === "/api/admin/logout" && method === "POST") {
      res.setHeader("Set-Cookie", "zoya_admin_token=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0");
      sendJson(res, 200, { success: true, message: "Logged out successfully." });
      return true;
    }
    if (pathname.startsWith("/api/admin/")) {
      const token = extractAuthToken(req.headers);
      const user = verifyToken(token);
      if (!user) {
        sendError(res, 401, "Unauthorized: Admin authentication token is required or expired.");
        return true;
      }
      if (pathname === "/api/admin/releases" && method === "GET") {
        const [releases, fcmStatus] = await Promise.all([
          getAllReleases(),
          getFcmStatus()
        ]);
        releases.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        const enriched = await Promise.all(
          releases.map(async (r) => ({
            ...r,
            binaryVerified: await hasApkBinary(r)
          }))
        );
        sendJson(res, 200, { success: true, releases: enriched, fcmStatus });
        return true;
      }
      if (pathname === "/api/admin/upload" && method === "POST") {
        const phase = parsedUrl.searchParams.get("phase");
        if (phase === "chunk") {
          const storageKey = (parsedUrl.searchParams.get("storageKey") || "").trim();
          const index = Number(parsedUrl.searchParams.get("index"));
          const totalChunks = Number(parsedUrl.searchParams.get("totalChunks"));
          if (!storageKey || isNaN(index) || index < 0 || isNaN(totalChunks) || totalChunks <= 0) {
            sendError(res, 400, "Invalid chunk parameters.");
            return true;
          }
          const chunkBuffer = await readBinaryBody(req);
          if (!chunkBuffer || chunkBuffer.length === 0) {
            sendError(res, 400, "Empty chunk payload.");
            return true;
          }
          await storeApkChunk(storageKey, index, totalChunks, chunkBuffer);
          sendJson(res, 200, { success: true, index, size: chunkBuffer.length });
          return true;
        }
        if (phase === "finalize") {
          const body = await parseJsonBody(req);
          const storageKey = (body.storageKey || "").trim();
          const fileName = path2.basename(body.fileName || "zoya-assistant.apk");
          const totalChunks = Number(body.totalChunks) || 0;
          if (!storageKey || !fileName.toLowerCase().endsWith(".apk") || totalChunks <= 0) {
            sendError(res, 400, "Invalid finalize parameters for APK upload.");
            return true;
          }
          const verified = await verifyStoredChunks(storageKey, totalChunks);
          if (!verified) {
            sendError(res, 400, "APK chunks failed verification in persistent cloud storage.");
            return true;
          }
          const apkBuffer = await getApkBuffer(storageKey, `apk_chunks/${storageKey}`, totalChunks);
          if (!apkBuffer || !isValidApkHeader(apkBuffer)) {
            await deleteStoredChunks(storageKey, totalChunks);
            sendError(res, 400, "Invalid APK binary: Could not reassemble a valid Android package from uploaded chunks.");
            return true;
          }
          let parsedApk2;
          try {
            parsedApk2 = parseApkBuffer(apkBuffer);
          } catch (err) {
            await deleteStoredChunks(storageKey, totalChunks);
            sendError(res, 400, err instanceof Error ? err.message : "Failed to parse AndroidManifest.xml from APK.");
            return true;
          }
          if (parsedApk2.packageName !== OFFICIAL_ZOYA_PACKAGE) {
            await deleteStoredChunks(storageKey, totalChunks);
            sendError(
              res,
              400,
              `Invalid Android package name "${parsedApk2.packageName}". Only the official Zoya package ("${OFFICIAL_ZOYA_PACKAGE}") can be uploaded.`
            );
            return true;
          }
          const latestPublished2 = await getLatestPublishedRelease();
          if (latestPublished2 && parsedApk2.versionCode <= latestPublished2.versionCode) {
            await deleteStoredChunks(storageKey, totalChunks);
            sendError(
              res,
              400,
              `Version conflict: Uploaded APK versionCode (${parsedApk2.versionCode}) must be strictly greater than the currently published release (${latestPublished2.versionName}, versionCode ${latestPublished2.versionCode}) to prevent duplicate or downgrade releases.`
            );
            return true;
          }
          const serverSha256 = crypto5.createHash("sha256").update(apkBuffer).digest("hex");
          const draftId2 = `rel_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
          const downloadUrl2 = `/api/releases/download?id=${draftId2}`;
          const nowIso2 = (/* @__PURE__ */ new Date()).toISOString();
          const newDraft2 = {
            id: draftId2,
            versionName: parsedApk2.versionName,
            versionCode: parsedApk2.versionCode,
            applicationId: parsedApk2.packageName,
            fileName,
            fileSize: parsedApk2.fileSize,
            fileSizeFormatted: parsedApk2.fileSizeFormatted,
            sha256: serverSha256,
            storageKey,
            storagePath: `apk_chunks/${storageKey}`,
            chunkCount: totalChunks,
            binaryVerified: true,
            downloadUrl: downloadUrl2,
            releaseDate: "",
            releaseNotes: "",
            minAndroidVersion: parsedApk2.minAndroidVersion,
            minSdkVersion: parsedApk2.minSdkVersion,
            targetSdkVersion: parsedApk2.targetSdkVersion,
            targetAndroidVersion: parsedApk2.targetAndroidVersion,
            isPublished: false,
            createdAt: nowIso2,
            updatedAt: nowIso2
          };
          await saveRelease(newDraft2);
          sendJson(res, 201, {
            success: true,
            message: "APK uploaded, inspected, and verified in persistent storage. Ready for release publication.",
            draft: newDraft2
          });
          return true;
        }
        const filenameHeader = req.headers["x-filename"];
        const filename = typeof filenameHeader === "string" ? decodeURIComponent(filenameHeader) : "zoya-assistant.apk";
        if (!filename.toLowerCase().endsWith(".apk")) {
          sendError(res, 400, "Invalid file: Must have a .apk extension.");
          return true;
        }
        const buffer = await readBinaryBody(req);
        if (buffer.length < 64) {
          sendError(res, 400, "File is empty or too small to be a valid APK package.");
          return true;
        }
        let parsedApk;
        try {
          parsedApk = parseApkBuffer(buffer);
        } catch (err) {
          sendError(res, 400, err instanceof Error ? err.message : "Failed to parse AndroidManifest.xml from APK.");
          return true;
        }
        if (parsedApk.packageName !== OFFICIAL_ZOYA_PACKAGE) {
          sendError(
            res,
            400,
            `Invalid Android package name "${parsedApk.packageName}". Only the official Zoya package ("${OFFICIAL_ZOYA_PACKAGE}") can be uploaded.`
          );
          return true;
        }
        const latestPublished = await getLatestPublishedRelease();
        if (latestPublished && parsedApk.versionCode <= latestPublished.versionCode) {
          sendError(
            res,
            400,
            `Version conflict: Uploaded APK versionCode (${parsedApk.versionCode}) must be strictly greater than the currently published release (${latestPublished.versionName}, versionCode ${latestPublished.versionCode}) to prevent duplicate or downgrade releases.`
          );
          return true;
        }
        const stored = await storeApkBuffer(buffer, filename);
        const draftId = `rel_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const downloadUrl = `/api/releases/download?id=${draftId}`;
        const nowIso = (/* @__PURE__ */ new Date()).toISOString();
        const newDraft = {
          id: draftId,
          versionName: parsedApk.versionName,
          versionCode: parsedApk.versionCode,
          applicationId: parsedApk.packageName,
          fileName: filename,
          fileSize: stored.fileSize,
          fileSizeFormatted: stored.fileSizeFormatted,
          sha256: stored.sha256,
          storageKey: stored.storageKey,
          storagePath: stored.storagePath,
          chunkCount: stored.chunkCount,
          binaryVerified: true,
          downloadUrl,
          releaseDate: "",
          releaseNotes: "",
          minAndroidVersion: parsedApk.minAndroidVersion,
          minSdkVersion: parsedApk.minSdkVersion,
          targetSdkVersion: parsedApk.targetSdkVersion,
          targetAndroidVersion: parsedApk.targetAndroidVersion,
          isPublished: false,
          createdAt: nowIso,
          updatedAt: nowIso
        };
        await saveRelease(newDraft);
        sendJson(res, 201, {
          success: true,
          message: "APK uploaded, inspected, and verified in persistent storage. Ready for release publication.",
          draft: newDraft
        });
        return true;
      }
      if (pathname === "/api/admin/publish" && method === "POST") {
        const body = await parseJsonBody(req);
        if (!body.draftId) {
          sendError(res, 400, "Draft ID is required.");
          return true;
        }
        const draft = await getReleaseById(body.draftId);
        if (!draft) {
          sendError(res, 404, "Draft release record not found.");
          return true;
        }
        if (draft.isPublished) {
          sendError(res, 400, `Release ${draft.versionName} (versionCode ${draft.versionCode}) is already published.`);
          return true;
        }
        const binaryExists = await hasApkBinary(draft);
        if (!binaryExists) {
          sendError(
            res,
            400,
            "Cannot publish release: APK binary is missing from persistent cloud storage. Please re-upload the APK file."
          );
          return true;
        }
        let versionName = (draft.versionName || "").trim();
        let versionCode = Number(draft.versionCode);
        let applicationId = (draft.applicationId || "").trim();
        let minAndroidVersion = draft.minAndroidVersion;
        let minSdkVersion = draft.minSdkVersion ?? null;
        let targetSdkVersion = draft.targetSdkVersion ?? null;
        let targetAndroidVersion = draft.targetAndroidVersion ?? null;
        let fileSize = draft.fileSize;
        let fileSizeFormatted = draft.fileSizeFormatted;
        if (!versionName || !versionCode || !applicationId) {
          const apkBuffer = await getApkBuffer(draft.storageKey, draft.storagePath, draft.chunkCount);
          if (!apkBuffer) {
            sendError(res, 400, "Cannot read APK binary to verify release metadata.");
            return true;
          }
          try {
            const parsed = parseApkBuffer(apkBuffer);
            versionName = parsed.versionName;
            versionCode = parsed.versionCode;
            applicationId = parsed.packageName;
            minAndroidVersion = parsed.minAndroidVersion;
            minSdkVersion = parsed.minSdkVersion;
            targetSdkVersion = parsed.targetSdkVersion;
            targetAndroidVersion = parsed.targetAndroidVersion;
            fileSize = parsed.fileSize;
            fileSizeFormatted = parsed.fileSizeFormatted;
          } catch (err) {
            sendError(res, 400, err instanceof Error ? err.message : "Invalid APK binary.");
            return true;
          }
        }
        if (applicationId !== OFFICIAL_ZOYA_PACKAGE) {
          sendError(
            res,
            400,
            `Cannot publish release: APK package name "${applicationId}" does not match official Zoya package "${OFFICIAL_ZOYA_PACKAGE}".`
          );
          return true;
        }
        if (!versionName) {
          sendError(res, 400, "Cannot publish release: APK versionName is missing.");
          return true;
        }
        if (!versionCode || isNaN(versionCode) || versionCode <= 0 || !Number.isInteger(versionCode)) {
          sendError(res, 400, "Cannot publish release: APK versionCode must be a positive integer.");
          return true;
        }
        const latestPublished = await getLatestPublishedRelease();
        if (latestPublished && latestPublished.id !== draft.id) {
          if (versionCode <= latestPublished.versionCode) {
            sendError(
              res,
              400,
              `Cannot publish release: APK versionCode (${versionCode}) must be strictly greater than the currently published release (${latestPublished.versionName}, versionCode ${latestPublished.versionCode}) to prevent duplicate or downgrade releases.`
            );
            return true;
          }
        }
        const nowIso = (/* @__PURE__ */ new Date()).toISOString();
        const serverReleaseDate = nowIso.split("T")[0];
        const updatedRelease = {
          ...draft,
          versionName,
          versionCode,
          applicationId,
          fileSize,
          fileSizeFormatted,
          releaseNotes: (body.releaseNotes || "").trim(),
          minAndroidVersion,
          minSdkVersion,
          targetSdkVersion,
          targetAndroidVersion,
          releaseDate: serverReleaseDate,
          isPublished: true,
          binaryVerified: true,
          publishedAt: nowIso,
          updatedAt: nowIso
        };
        await saveRelease(updatedRelease);
        const notificationResult = await sendReleasePushNotification(updatedRelease);
        if (notificationResult.sent && notificationResult.sentAt) {
          updatedRelease.notificationSentAt = notificationResult.sentAt;
          updatedRelease.notificationMessageId = notificationResult.messageId;
          await saveRelease(updatedRelease);
        }
        sendJson(res, 200, {
          success: true,
          message: "Release published successfully.",
          release: updatedRelease,
          notification: notificationResult
        });
        return true;
      }
      if ((pathname.startsWith("/api/admin/releases/") || pathname === "/api/admin/releases") && method === "DELETE") {
        const anyReq = req;
        const queryId = anyReq.query?.id || parsedUrl.searchParams.get("id");
        const pathId = pathname.startsWith("/api/admin/releases/") ? pathname.substring("/api/admin/releases/".length) : "";
        const id = (queryId || pathId || "").trim();
        if (!id) {
          sendError(res, 400, "Release ID required.");
          return true;
        }
        const deleted = await deleteRelease(id);
        if (!deleted) {
          sendError(res, 404, "Release not found.");
          return true;
        }
        sendJson(res, 200, { success: true, message: "Release deleted." });
        return true;
      }
      if (pathname === "/api/admin/notify") {
        if (method !== "POST") {
          sendError(res, 405, `Method ${method} Not Allowed. Expected POST.`);
          return true;
        }
        let body = {};
        try {
          body = await parseJsonBody(req);
        } catch (err) {
          sendError(res, 400, err instanceof Error ? err.message : "Invalid JSON body.");
          return true;
        }
        const validation = validateAndSanitizeManualNotification(body);
        if (!validation.valid) {
          sendError(res, 400, validation.error);
          return true;
        }
        const result = await sendManualPushNotification({
          title: validation.title,
          message: validation.message,
          requestId: validation.requestId
        });
        if (result.alreadySent) {
          sendJson(res, 409, {
            success: false,
            error: result.reason || "Duplicate notification prevented.",
            notification: result
          });
          return true;
        }
        if (!result.configured) {
          sendJson(res, 503, {
            success: false,
            error: result.reason || "Firebase Cloud Messaging credentials are not configured on the server.",
            notification: result
          });
          return true;
        }
        if (!result.sent) {
          sendJson(res, 502, {
            success: false,
            error: result.reason || "Failed to dispatch push notification via FCM.",
            notification: result
          });
          return true;
        }
        sendJson(res, 200, {
          success: true,
          message: `Push notification "${result.title}" sent to topic "${result.topic}".`,
          notification: result
        });
        return true;
      }
      if (pathname === "/api/admin/licenses" && method === "GET") {
        const licenses = await getAllLicenses();
        const stats = computeLicenseStats(licenses);
        sendJson(res, 200, {
          success: true,
          stats,
          licenses
        });
        return true;
      }
      if (pathname === "/api/admin/licenses" && method === "POST") {
        let body = {};
        try {
          body = await parseJsonBody(req);
        } catch (err) {
          sendError(res, 400, err instanceof Error ? err.message : "Invalid JSON body.");
          return true;
        }
        const created = await createLifetimeLicense(body, user);
        if (!created.success) {
          sendError(res, created.status, created.error);
          return true;
        }
        sendJson(res, 201, {
          success: true,
          message: `Lifetime license generated for ${created.license.customerName} (Unactivated).`,
          generatedKey: created.generatedKey,
          license: created.license
        });
        return true;
      }
      if (pathname.startsWith("/api/admin/licenses/")) {
        const anyReq = req;
        const queryId = anyReq.query?.id || parsedUrl.searchParams.get("id");
        const rawSubPath = pathname.substring("/api/admin/licenses/".length).trim();
        const isKeyRequest = rawSubPath.endsWith("/key");
        const cleanSubPath = isKeyRequest ? rawSubPath.slice(0, -"/key".length).trim() : rawSubPath;
        const licenseId = (cleanSubPath && cleanSubPath !== ":id" && cleanSubPath !== "[id]" ? cleanSubPath : queryId || "").trim();
        if (!licenseId) {
          sendError(res, 400, "License ID is required.");
          return true;
        }
        if (isKeyRequest) {
          const revealed = await revealLicenseKeyByAdmin(licenseId, user);
          if (!revealed.success) {
            sendError(res, revealed.status, revealed.error || "Failed to retrieve license key.", revealed.code);
            return true;
          }
          sendJson(res, 200, {
            success: true,
            licenseKey: revealed.licenseKey
          });
          return true;
        }
        if (method === "GET") {
          const license = await getLicenseById(licenseId);
          if (!license) {
            sendError(res, 404, "License record not found.");
            return true;
          }
          sendJson(res, 200, {
            success: true,
            license
          });
          return true;
        }
        if (method === "POST" || method === "PATCH") {
          let body = {};
          try {
            body = await parseJsonBody(req);
          } catch (err) {
            sendError(res, 400, err instanceof Error ? err.message : "Invalid JSON body.");
            return true;
          }
          const action = typeof body.action === "string" ? body.action.trim() : "";
          if (action === "reveal" || action === "get_key") {
            const revealed = await revealLicenseKeyByAdmin(licenseId, user);
            if (!revealed.success) {
              sendError(res, revealed.status, revealed.error || "Failed to retrieve license key.", revealed.code);
              return true;
            }
            sendJson(res, 200, {
              success: true,
              licenseKey: revealed.licenseKey
            });
            return true;
          }
          if (action === "rebind") {
            const rebound = await rebindLicenseDeviceByAdmin(licenseId, body, user);
            if (!rebound.success) {
              sendError(res, rebound.status, rebound.error);
              return true;
            }
            sendJson(res, 200, {
              success: true,
              message: `License device binding cleared by administrator (${user.name}). Key is now ready for activation on a new phone.`,
              license: rebound.license
            });
            return true;
          }
          if (action === "revoke") {
            const revoked = await revokeLicense(licenseId, body, user);
            if (!revoked.success) {
              sendError(res, revoked.status, revoked.error);
              return true;
            }
            sendJson(res, 200, {
              success: true,
              message: `License ${revoked.license.maskedKey} has been revoked.`,
              license: revoked.license
            });
            return true;
          }
          sendError(
            res,
            400,
            'Invalid license action. Supported actions: "reveal", "rebind", "revoke".'
          );
          return true;
        }
        sendError(res, 405, `Method ${method} Not Allowed on /api/admin/licenses/:id.`);
        return true;
      }
    }
    sendError(res, 404, `Endpoint ${method} ${pathname} not found.`);
    return true;
  } catch (err) {
    if (err instanceof LicenseStorageError) {
      sendError(res, 503, err.message, err.code);
      return true;
    }
    console.error("API Error:", err);
    sendError(res, 500, err instanceof Error ? err.message : "Internal Server Error");
    return true;
  }
}
export {
  handleApiRequest,
  sendError,
  sendJson
};
