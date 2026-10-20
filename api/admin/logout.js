// server/apiHandler.ts
import fs2 from "fs";

// server/storage.ts
import crypto from "crypto";
import fs from "fs";
import path from "path";
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
  const { dataDir, releasesFile, apksDir } = getStoragePaths();
  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    if (!fs.existsSync(apksDir)) {
      fs.mkdirSync(apksDir, { recursive: true });
    }
    if (!fs.existsSync(releasesFile)) {
      const bundledFile = path.resolve(process.cwd(), ".data", "releases.json");
      if (fs.existsSync(bundledFile)) {
        try {
          const bundledContent = fs.readFileSync(bundledFile, "utf-8");
          fs.writeFileSync(releasesFile, bundledContent, "utf-8");
        } catch {
          fs.writeFileSync(releasesFile, JSON.stringify([], null, 2), "utf-8");
        }
      } else {
        fs.writeFileSync(releasesFile, JSON.stringify([], null, 2), "utf-8");
      }
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
async function getAllReleases() {
  ensureDataDirs();
  const { releasesFile } = getStoragePaths();
  try {
    if (fs.existsSync(releasesFile)) {
      const raw = fs.readFileSync(releasesFile, "utf-8");
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    }
    const bundledFile = path.resolve(process.cwd(), ".data", "releases.json");
    if (fs.existsSync(bundledFile)) {
      const raw = fs.readFileSync(bundledFile, "utf-8");
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    }
    return [];
  } catch (err) {
    console.error("Error reading releases file:", err);
    return [];
  }
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
  const all = await getAllReleases();
  return all.find((r) => r.id === id) || null;
}
async function saveRelease(release) {
  ensureDataDirs();
  const { releasesFile } = getStoragePaths();
  const all = await getAllReleases();
  const index = all.findIndex((r) => r.id === release.id);
  if (index >= 0) {
    all[index] = { ...release, updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
  } else {
    all.push(release);
  }
  fs.writeFileSync(releasesFile, JSON.stringify(all, null, 2), "utf-8");
}
async function deleteRelease(id) {
  ensureDataDirs();
  const { releasesFile, apksDir } = getStoragePaths();
  const all = await getAllReleases();
  const release = all.find((r) => r.id === id);
  if (!release) return false;
  const filePath = path.join(apksDir, release.storageKey);
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch (e) {
      console.warn("Could not delete APK file:", e);
    }
  }
  const filtered = all.filter((r) => r.id !== id);
  fs.writeFileSync(releasesFile, JSON.stringify(filtered, null, 2), "utf-8");
  return true;
}
async function storeApkBuffer(buffer, originalFilename) {
  ensureDataDirs();
  const { apksDir } = getStoragePaths();
  if (buffer.length < 4 || buffer[0] !== 80 || buffer[1] !== 75 || buffer[2] !== 3 || buffer[3] !== 4) {
    throw new Error("Invalid APK file: Header does not match Android Package / ZIP format (magic bytes PK\\x03\\x04).");
  }
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  const fileSize = buffer.length;
  const fileSizeFormatted = formatBytes(fileSize);
  const safeBase = path.basename(originalFilename).replace(/[^a-zA-Z0-9._-]/g, "_");
  const storageKey = `${Date.now()}-${safeBase}`;
  const targetPath = path.join(apksDir, storageKey);
  fs.writeFileSync(targetPath, buffer);
  return {
    storageKey,
    fileSize,
    fileSizeFormatted,
    sha256
  };
}
function getApkFilePath(storageKey) {
  ensureDataDirs();
  const { apksDir } = getStoragePaths();
  const filePath = path.join(apksDir, storageKey);
  if (fs.existsSync(filePath)) {
    return filePath;
  }
  const bundledFile = path.resolve(process.cwd(), ".data", "apks", storageKey);
  if (fs.existsSync(bundledFile)) {
    return bundledFile;
  }
  return null;
}

// server/auth.ts
import crypto2 from "crypto";
var DEFAULT_ADMIN_EMAIL = "riyajulansari113b@gmail.com";
var DEFAULT_ADMIN_PASSWORD = "zoya-admin-2026";
var DEFAULT_JWT_SECRET = "zoya-secret-jwt-key-release-mgr-2026";
function getAdminEmail() {
  return (process.env.ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL).trim().toLowerCase();
}
function getAdminPassword() {
  return process.env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD;
}
function getJwtSecret() {
  return process.env.ADMIN_JWT_SECRET || DEFAULT_JWT_SECRET;
}
function createToken(user) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      email: user.email,
      role: user.role,
      name: user.name,
      iat: Math.floor(Date.now() / 1e3),
      exp: Math.floor(Date.now() / 1e3) + 60 * 60 * 24 * 7
      // 7 days
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
    if (signature !== expectedSignature) {
      return null;
    }
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
    if (decoded.exp && decoded.exp < Math.floor(Date.now() / 1e3)) {
      return null;
    }
    if (decoded.role !== "admin") {
      return null;
    }
    return {
      email: decoded.email,
      role: "admin",
      name: decoded.name || "Administrator"
    };
  } catch (err) {
    return null;
  }
}
function authenticateAdmin(email, password) {
  const cleanEmail = (email || "").trim().toLowerCase();
  const targetEmail = getAdminEmail();
  const targetPassword = getAdminPassword();
  if (cleanEmail === targetEmail && password === targetPassword) {
    return {
      email: targetEmail,
      role: "admin",
      name: "Riyajul (Administrator)"
    };
  }
  return null;
}
function extractAuthToken(reqHeaders) {
  const authHeader = reqHeaders["authorization"] || reqHeaders["Authorization"];
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    return authHeader.substring(7).trim();
  }
  const rawCookie = reqHeaders["cookie"] || reqHeaders["Cookie"];
  const cookieHeaders = Array.isArray(rawCookie) ? rawCookie : typeof rawCookie === "string" ? [rawCookie] : [];
  for (const cookieHeader of cookieHeaders) {
    const cookies = cookieHeader.split(";").map((c) => c.trim());
    for (const c of cookies) {
      if (c.startsWith("zoya_admin_token=")) {
        return c.substring("zoya_admin_token=".length);
      }
    }
  }
  return null;
}

// server/apiHandler.ts
function sendJson(res, status, data) {
  if (res.writableEnded || res.headersSent) {
    return;
  }
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}
function sendError(res, status, message) {
  sendJson(res, status, { success: false, error: message });
}
async function parseJsonBody(req) {
  const anyReq = req;
  if (anyReq.body !== void 0 && anyReq.body !== null) {
    if (typeof anyReq.body === "object") {
      return anyReq.body;
    }
    if (typeof anyReq.body === "string") {
      try {
        const trimmed = anyReq.body.trim();
        return trimmed ? JSON.parse(trimmed) : {};
      } catch {
        throw new Error("Invalid JSON");
      }
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
        } catch (err) {
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
      chunks.push(chunk);
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
  let pathname = explicitRoute || parsedUrl.pathname;
  if (!pathname.startsWith("/api/")) {
    pathname = `/api${pathname.startsWith("/") ? pathname : "/" + pathname}`;
  }
  pathname = pathname.replace(/\/+$/, "") || "/";
  const method = req.method?.toUpperCase() || "GET";
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-filename");
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
      sendJson(res, 200, {
        published: true,
        release: latest
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
        applicationId: latest.applicationId || "com.riyajul.zoya",
        latestRelease: {
          versionName: latest.versionName,
          versionCode: latest.versionCode,
          downloadUrl: latest.downloadUrl,
          sha256: latest.sha256,
          fileSize: latest.fileSize,
          fileSizeFormatted: latest.fileSizeFormatted,
          minAndroidVersion: latest.minAndroidVersion,
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
      if (!targetRelease || !targetRelease.isPublished) {
        sendError(res, 404, "Release not found or not published.");
        return true;
      }
      const filePath = getApkFilePath(targetRelease.storageKey);
      if (!filePath || !fs2.existsSync(filePath)) {
        sendError(res, 404, "APK file binary missing from storage.");
        return true;
      }
      const stat = fs2.statSync(filePath);
      const outputFilename = `zoya-${targetRelease.versionName || "assistant"}.apk`;
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/vnd.android.package-archive");
      res.setHeader("Content-Disposition", `attachment; filename="${outputFilename}"`);
      res.setHeader("Content-Length", stat.size);
      res.setHeader("Cache-Control", "public, max-age=3600");
      if (method === "HEAD") {
        res.end();
        return true;
      }
      const stream = fs2.createReadStream(filePath);
      stream.pipe(res);
      return true;
    }
    if (pathname === "/api/admin/login") {
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
      const email = typeof body.email === "string" ? body.email.trim() : "";
      const password = typeof body.password === "string" ? body.password : "";
      if (!email || !password) {
        sendError(res, 400, "Email and password are required.");
        return true;
      }
      const user = authenticateAdmin(email, password);
      if (!user) {
        sendError(res, 401, "Invalid administrator email or password.");
        return true;
      }
      const token = createToken(user);
      res.setHeader(
        "Set-Cookie",
        `zoya_admin_token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 7}`
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
        user: { email: user.email, name: user.name, role: user.role }
      });
      return true;
    }
    if (pathname === "/api/admin/logout" && method === "POST") {
      res.setHeader("Set-Cookie", "zoya_admin_token=; Path=/; HttpOnly; Max-Age=0");
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
        const releases = await getAllReleases();
        releases.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        sendJson(res, 200, { success: true, releases });
        return true;
      }
      if (pathname === "/api/admin/upload" && method === "POST") {
        const filenameHeader = req.headers["x-filename"];
        const filename = typeof filenameHeader === "string" ? decodeURIComponent(filenameHeader) : "zoya-assistant.apk";
        if (!filename.toLowerCase().endsWith(".apk")) {
          sendError(res, 400, "Invalid file: Must have a .apk extension.");
          return true;
        }
        const buffer = await readBinaryBody(req);
        if (buffer.length < 1024) {
          sendError(res, 400, "File is empty or too small to be a valid APK package.");
          return true;
        }
        const stored = await storeApkBuffer(buffer, filename);
        const draftId = `rel_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const downloadUrl = `/api/releases/download?id=${draftId}`;
        const newDraft = {
          id: draftId,
          versionName: "",
          versionCode: 0,
          applicationId: "com.riyajul.zoya",
          fileName: filename,
          fileSize: stored.fileSize,
          fileSizeFormatted: stored.fileSizeFormatted,
          sha256: stored.sha256,
          storageKey: stored.storageKey,
          downloadUrl,
          releaseDate: (/* @__PURE__ */ new Date()).toISOString().split("T")[0],
          releaseNotes: "",
          minAndroidVersion: "Android 8.0 (API 26)+",
          isPublished: false,
          createdAt: (/* @__PURE__ */ new Date()).toISOString(),
          updatedAt: (/* @__PURE__ */ new Date()).toISOString()
        };
        await saveRelease(newDraft);
        sendJson(res, 201, {
          success: true,
          message: "APK uploaded and verified successfully. Ready for release publication.",
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
        const cleanVersionName = (body.versionName || "").trim();
        const versionCode = Number(body.versionCode);
        if (!cleanVersionName) {
          sendError(res, 400, "Version name (e.g. v1.0.0) is required.");
          return true;
        }
        if (!versionCode || isNaN(versionCode) || versionCode <= 0) {
          sendError(res, 400, "Android versionCode must be a positive integer.");
          return true;
        }
        const latestPublished = await getLatestPublishedRelease();
        let compatibilityWarning = null;
        if (latestPublished && latestPublished.id !== draft.id) {
          if (versionCode <= latestPublished.versionCode) {
            compatibilityWarning = `Notice: VersionCode (${versionCode}) is not higher than the latest published release (${latestPublished.versionCode}). Android devices with version ${latestPublished.versionCode} installed will reject this update.`;
          }
        }
        const updatedRelease = {
          ...draft,
          versionName: cleanVersionName,
          versionCode,
          applicationId: body.applicationId || "com.riyajul.zoya",
          releaseNotes: (body.releaseNotes || "").trim(),
          minAndroidVersion: body.minAndroidVersion || "Android 8.0 (API 26)+",
          releaseDate: body.releaseDate || (/* @__PURE__ */ new Date()).toISOString().split("T")[0],
          isPublished: true,
          publishedAt: (/* @__PURE__ */ new Date()).toISOString(),
          updatedAt: (/* @__PURE__ */ new Date()).toISOString()
        };
        await saveRelease(updatedRelease);
        sendJson(res, 200, {
          success: true,
          message: "Release published successfully.",
          release: updatedRelease,
          warning: compatibilityWarning
        });
        return true;
      }
      if ((pathname.startsWith("/api/admin/releases/") || pathname === "/api/admin/releases") && method === "DELETE") {
        const queryId = req.query?.id || parsedUrl.searchParams.get("id");
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
    }
    sendError(res, 404, `Endpoint ${method} ${pathname} not found.`);
    return true;
  } catch (err) {
    console.error("API Error:", err);
    sendError(res, 500, err instanceof Error ? err.message : "Internal Server Error");
    return true;
  }
}

// server/api/admin/logout.ts
async function handler(req, res) {
  try {
    const handled = await handleApiRequest(req, res, "/api/admin/logout");
    if (!handled && !(res.writableEnded || res.headersSent)) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ success: false, error: "Endpoint not found" }));
    }
  } catch (err) {
    console.error("Unhandled error in /api/admin/logout:", err);
    if (!(res.writableEnded || res.headersSent)) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(
        JSON.stringify({
          success: false,
          error: err instanceof Error ? err.message : "Internal Server Error"
        })
      );
    }
  }
}
export {
  handler as default
};
