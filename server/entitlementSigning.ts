import crypto from 'crypto';

export const ENTITLEMENT_ISSUER = 'https://zoyalive.vercel.app';
export const ENTITLEMENT_AUDIENCE = 'com.riyajul.zoya';
export const ENTITLEMENT_ALGORITHM = 'ES256';
export const ENTITLEMENT_GRACE_TTL_SECONDS = 30 * 24 * 60 * 60; // 30-day offline grace policy (unchanged)
const MAX_CLOCK_SKEW_SECONDS = 60;

export class EntitlementSigningConfigurationError extends Error {
  public readonly status = 503;
  public readonly code = 'ENTITLEMENT_SIGNING_NOT_CONFIGURED';

  constructor(message: string) {
    super(message);
    this.name = 'EntitlementSigningConfigurationError';
  }
}

export interface PublicEcJwk {
  kid: string;
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
}

export interface EntitlementTokenClaims {
  iss: string;
  aud: string;
  licenseId: string;
  bindingVersion: number;
  status: 'active';
  deviceId: string;
  maskedKey: string;
  kh: string;
  act: string;
  iat: number;
  exp: number;
}

export interface SignEntitlementTokenInput {
  licenseId: string;
  keyHash: string;
  maskedKey: string;
  activatedAt: string;
  deviceId: string;
  bindingVersion: number;
  status?: 'active';
}

export interface VerifyEntitlementTokenOptions {
  expectedKeyHash?: string | null;
  expectedDeviceId?: string | null;
  expectedLicenseId?: string | null;
  expectedBindingVersion?: number | null;
  nowSec?: number;
}

export interface VerifyEntitlementTokenResult {
  valid: boolean;
  header?: { alg: 'ES256'; typ: 'JWT'; kid: string };
  payload?: EntitlementTokenClaims;
  reason?: string;
}

interface LoadedSigningMaterial {
  cacheKey: string;
  activeKid: string;
  privateKey: crypto.KeyObject;
  activePublicKey: crypto.KeyObject;
  activePublicJwk: PublicEcJwk;
  publicKeysByKid: Map<string, { publicKey: crypto.KeyObject; jwk: PublicEcJwk }>;
  publicJwks: PublicEcJwk[];
}

let cachedMaterial: LoadedSigningMaterial | null = null;

const BASE64URL_SEGMENT_REGEX = /^[A-Za-z0-9_-]+$/;
const KID_FORMAT_REGEX = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * Decodes a private key PEM from an environment variable.
 * Supports multi-line PEM, single-line escaped `\n` PEM, or base64-encoded PEM.
 */
function normalizePemFromEnv(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith('CHANGE_ME')) {
    return '';
  }

  // Strip accidental surrounding double/single quotes from env files
  const unquoted =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
      ? trimmed.slice(1, -1).trim()
      : trimmed;

  if (unquoted.includes('-----BEGIN ')) {
    return unquoted.replace(/\\n/g, '\n').replace(/\r\n/g, '\n').trim();
  }

  // Allow base64-encoded PEM for single-line env var ergonomics
  try {
    const decoded = Buffer.from(unquoted, 'base64').toString('utf-8').trim();
    if (decoded.includes('-----BEGIN ')) {
      return decoded.replace(/\\n/g, '\n').replace(/\r\n/g, '\n').trim();
    }
  } catch {
    // Fall through to invalid PEM handling
  }

  return '';
}

/**
 * Computes a deterministic, public-only RFC 7638 JWK SHA-256 thumbprint prefix
 * to provide a stable `kid` when ENTITLEMENT_ES256_KEY_ID is not explicitly set.
 */
function computePublicJwkKid(jwk: { kty: 'EC'; crv: 'P-256'; x: string; y: string }): string {
  // RFC 7638 lexicographical order for EC public keys: crv, kty, x, y
  const canonical = JSON.stringify({
    crv: jwk.crv,
    kty: jwk.kty,
    x: jwk.x,
    y: jwk.y,
  });
  const thumbprint = crypto.createHash('sha256').update(canonical, 'utf-8').digest('hex').slice(0, 16);
  return `zoya-es256-${thumbprint}`;
}

/**
 * Extracts strictly the public EC P-256 JWK fields (`kid`, `kty`, `crv`, `x`, `y`).
 * Never includes private key parameters (`d`, etc.).
 */
function toPublicEcJwk(publicKey: crypto.KeyObject, explicitKid?: string | null): PublicEcJwk {
  const exported = publicKey.export({ format: 'jwk' }) as Record<string, unknown>;
  if (
    !exported ||
    exported.kty !== 'EC' ||
    exported.crv !== 'P-256' ||
    typeof exported.x !== 'string' ||
    typeof exported.y !== 'string' ||
    !exported.x ||
    !exported.y
  ) {
    throw new EntitlementSigningConfigurationError(
      'ENTITLEMENT_ES256_PRIVATE_KEY must be a valid EC P-256 (prime256v1) key.'
    );
  }

  const cleanExplicitKid = typeof explicitKid === 'string' ? explicitKid.trim() : '';
  if (cleanExplicitKid && !KID_FORMAT_REGEX.test(cleanExplicitKid)) {
    throw new EntitlementSigningConfigurationError(
      'ENTITLEMENT_ES256_KEY_ID must match ^[A-Za-z0-9._-]{1,64}$.'
    );
  }

  const kid =
    cleanExplicitKid ||
    computePublicJwkKid({
      kty: 'EC',
      crv: 'P-256',
      x: exported.x,
      y: exported.y,
    });

  return {
    kid,
    kty: 'EC',
    crv: 'P-256',
    x: exported.x,
    y: exported.y,
  };
}

/**
 * Parses optional additional public JWKs for zero-downtime key rotation
 * from ENTITLEMENT_ES256_ADDITIONAL_PUBLIC_JWKS (JSON array of public EC P-256 JWKs).
 */
function parseAdditionalPublicJwks(
  rawJson: string
): Array<{ publicKey: crypto.KeyObject; jwk: PublicEcJwk }> {
  const trimmed = rawJson.trim();
  if (!trimmed) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new EntitlementSigningConfigurationError(
      'ENTITLEMENT_ES256_ADDITIONAL_PUBLIC_JWKS must be a valid JSON array of public EC P-256 JWKs.'
    );
  }

  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { keys?: unknown }).keys)
      ? (parsed as { keys: unknown[] }).keys
      : null;

  if (!list) {
    throw new EntitlementSigningConfigurationError(
      'ENTITLEMENT_ES256_ADDITIONAL_PUBLIC_JWKS must be a JSON array or {"keys":[...]} object.'
    );
  }

  const results: Array<{ publicKey: crypto.KeyObject; jwk: PublicEcJwk }> = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') {
      throw new EntitlementSigningConfigurationError(
        'Each entry in ENTITLEMENT_ES256_ADDITIONAL_PUBLIC_JWKS must be a JWK object.'
      );
    }
    const raw = item as Record<string, unknown>;
    if (
      typeof raw.kid !== 'string' ||
      !KID_FORMAT_REGEX.test(raw.kid.trim()) ||
      raw.kty !== 'EC' ||
      raw.crv !== 'P-256' ||
      typeof raw.x !== 'string' ||
      typeof raw.y !== 'string' ||
      !BASE64URL_SEGMENT_REGEX.test(raw.x) ||
      !BASE64URL_SEGMENT_REGEX.test(raw.y)
    ) {
      throw new EntitlementSigningConfigurationError(
        'Each entry in ENTITLEMENT_ES256_ADDITIONAL_PUBLIC_JWKS must include valid public fields: kid, kty="EC", crv="P-256", x, y.'
      );
    }

    // Explicitly reconstruct public-only JWK (never copy `d` or unknown properties)
    const sanitizedJwk: PublicEcJwk = {
      kid: raw.kid.trim(),
      kty: 'EC',
      crv: 'P-256',
      x: raw.x,
      y: raw.y,
    };

    try {
      const publicKey = crypto.createPublicKey({
        key: {
          kty: sanitizedJwk.kty,
          crv: sanitizedJwk.crv,
          x: sanitizedJwk.x,
          y: sanitizedJwk.y,
        },
        format: 'jwk',
      });
      results.push({ publicKey, jwk: sanitizedJwk });
    } catch {
      throw new EntitlementSigningConfigurationError(
        `Invalid EC P-256 public JWK for kid "${sanitizedJwk.kid}" in ENTITLEMENT_ES256_ADDITIONAL_PUBLIC_JWKS.`
      );
    }
  }

  return results;
}

function loadSigningMaterial(): LoadedSigningMaterial {
  const rawPrivateKey = String(process.env.ENTITLEMENT_ES256_PRIVATE_KEY || '');
  const rawKeyId = String(process.env.ENTITLEMENT_ES256_KEY_ID || '');
  const rawAdditional = String(process.env.ENTITLEMENT_ES256_ADDITIONAL_PUBLIC_JWKS || '');
  const cacheKey = `${rawPrivateKey}\u0000${rawKeyId}\u0000${rawAdditional}`;

  if (cachedMaterial && cachedMaterial.cacheKey === cacheKey) {
    return cachedMaterial;
  }

  const pem = normalizePemFromEnv(rawPrivateKey);
  if (!pem) {
    throw new EntitlementSigningConfigurationError(
      'Offline entitlement signing is not configured on the server: ENTITLEMENT_ES256_PRIVATE_KEY (EC P-256 PEM private key) is required.'
    );
  }

  let privateKey: crypto.KeyObject;
  let activePublicKey: crypto.KeyObject;
  try {
    privateKey = crypto.createPrivateKey({ key: pem, format: 'pem' });
    if (privateKey.type !== 'private' || privateKey.asymmetricKeyType !== 'ec') {
      throw new Error('Not an EC private key');
    }
    activePublicKey = crypto.createPublicKey(privateKey);
  } catch {
    throw new EntitlementSigningConfigurationError(
      'ENTITLEMENT_ES256_PRIVATE_KEY is invalid. Expected a PEM-encoded EC P-256 (prime256v1) private key.'
    );
  }

  const activePublicJwk = toPublicEcJwk(activePublicKey, rawKeyId);
  const publicKeysByKid = new Map<string, { publicKey: crypto.KeyObject; jwk: PublicEcJwk }>();
  const publicJwks: PublicEcJwk[] = [];

  publicKeysByKid.set(activePublicJwk.kid, {
    publicKey: activePublicKey,
    jwk: activePublicJwk,
  });
  publicJwks.push(activePublicJwk);

  const additional = parseAdditionalPublicJwks(rawAdditional);
  for (const entry of additional) {
    if (!publicKeysByKid.has(entry.jwk.kid)) {
      publicKeysByKid.set(entry.jwk.kid, entry);
      publicJwks.push(entry.jwk);
    }
  }

  cachedMaterial = {
    cacheKey,
    activeKid: activePublicJwk.kid,
    privateKey,
    activePublicKey,
    activePublicJwk,
    publicKeysByKid,
    publicJwks,
  };

  return cachedMaterial;
}

/**
 * Verifies that ES256 entitlement signing is configured on the server.
 * Throws EntitlementSigningConfigurationError (fail-closed) when unconfigured.
 */
export function assertEntitlementSigningConfigured(): void {
  loadSigningMaterial();
}

/**
 * Returns whether ES256 entitlement signing is currently configured.
 */
export function isEntitlementSigningConfigured(): boolean {
  try {
    loadSigningMaterial();
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns the read-only public JWK Set (`{ keys: [...] }`) containing strictly
 * public EC P-256 fields (`kid`, `kty`, `crv`, `x`, `y`).
 * Never returns private key material.
 */
export function getEntitlementPublicJwks(): { keys: PublicEcJwk[] } {
  const material = loadSigningMaterial();
  return {
    keys: material.publicJwks.map((k) => ({
      kid: k.kid,
      kty: 'EC',
      crv: 'P-256',
      x: k.x,
      y: k.y,
    })),
  };
}

/**
 * Signs an active device-bound license entitlement as a standard RFC 7515 compact JWS
 * using ES256 (ECDSA P-256 + SHA-256, IEEE P1363 64-byte raw signature).
 */
export function signEs256EntitlementToken(
  input: SignEntitlementTokenInput,
  nowSecOverride?: number
): string {
  const material = loadSigningMaterial();

  const licenseId = typeof input.licenseId === 'string' ? input.licenseId.trim() : '';
  const deviceId = typeof input.deviceId === 'string' ? input.deviceId.trim() : '';
  const maskedKey = typeof input.maskedKey === 'string' ? input.maskedKey.trim() : '';
  const keyHash = typeof input.keyHash === 'string' ? input.keyHash.trim() : '';
  const activatedAt =
    typeof input.activatedAt === 'string' && input.activatedAt.trim()
      ? input.activatedAt.trim()
      : new Date().toISOString();

  if (input.status && input.status !== 'active') {
    throw new Error('Entitlement tokens may only be signed for active licenses.');
  }
  if (!licenseId || !deviceId || !maskedKey || !keyHash) {
    throw new Error('Cannot sign entitlement token without licenseId, deviceId, maskedKey, and keyHash.');
  }
  if (
    typeof input.bindingVersion !== 'number' ||
    !Number.isInteger(input.bindingVersion) ||
    input.bindingVersion < 1
  ) {
    throw new Error('Cannot sign entitlement token without a valid positive integer bindingVersion.');
  }

  const nowSec =
    typeof nowSecOverride === 'number' && Number.isInteger(nowSecOverride) && nowSecOverride > 0
      ? nowSecOverride
      : Math.floor(Date.now() / 1000);
  const expSec = nowSec + ENTITLEMENT_GRACE_TTL_SECONDS;

  const protectedHeader = {
    alg: ENTITLEMENT_ALGORITHM,
    typ: 'JWT',
    kid: material.activeKid,
  };

  const claims: EntitlementTokenClaims = {
    iss: ENTITLEMENT_ISSUER,
    aud: ENTITLEMENT_AUDIENCE,
    licenseId,
    bindingVersion: input.bindingVersion,
    status: 'active',
    deviceId,
    maskedKey,
    kh: keyHash,
    act: activatedAt,
    iat: nowSec,
    exp: expSec,
  };

  const headerB64 = Buffer.from(JSON.stringify(protectedHeader), 'utf-8').toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(claims), 'utf-8').toString('base64url');
  const signingInput = `${headerB64}.${payloadB64}`;

  const signatureBuf = crypto.sign('sha256', Buffer.from(signingInput, 'utf-8'), {
    key: material.privateKey,
    dsaEncoding: 'ieee-p1363',
  });

  if (signatureBuf.length !== 64) {
    throw new Error('Unexpected ES256 signature length.');
  }

  return `${signingInput}.${signatureBuf.toString('base64url')}`;
}

/**
 * Strictly verifies an ES256 compact JWS entitlement token against configured public keys.
 * Rejects HMAC/HS256 tokens, algorithm substitution, unknown `kid`, invalid signatures,
 * modified payloads, wrong issuer/audience/status/deviceId/licenseId/bindingVersion,
 * and expired or future-dated timestamps.
 */
export function verifyEs256EntitlementToken(
  token: string | null | undefined,
  options: VerifyEntitlementTokenOptions = {}
): VerifyEntitlementTokenResult {
  if (!token || typeof token !== 'string') {
    return { valid: false, reason: 'Entitlement token missing or invalid.' };
  }

  const trimmed = token.trim();
  const parts = trimmed.split('.');
  if (
    parts.length !== 3 ||
    !parts[0] ||
    !parts[1] ||
    !parts[2] ||
    !BASE64URL_SEGMENT_REGEX.test(parts[0]) ||
    !BASE64URL_SEGMENT_REGEX.test(parts[1]) ||
    !BASE64URL_SEGMENT_REGEX.test(parts[2])
  ) {
    return { valid: false, reason: 'Entitlement token malformed.' };
  }

  const [headerB64, payloadB64, signatureB64] = parts;

  // 1. Parse and strictly validate protected header BEFORE trusting any claim
  let headerObj: Record<string, unknown>;
  try {
    const parsedHeader = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf-8'));
    if (!parsedHeader || typeof parsedHeader !== 'object' || Array.isArray(parsedHeader)) {
      return { valid: false, reason: 'Entitlement token header invalid.' };
    }
    headerObj = parsedHeader as Record<string, unknown>;
  } catch {
    return { valid: false, reason: 'Entitlement token header parse error.' };
  }

  if (headerObj.alg !== ENTITLEMENT_ALGORITHM) {
    return {
      valid: false,
      reason: `Unsupported entitlement token algorithm "${String(headerObj.alg || '')}". Only ES256 is accepted.`,
    };
  }

  if (headerObj.typ !== 'JWT') {
    return { valid: false, reason: 'Entitlement token typ header must be JWT.' };
  }

  const kid = typeof headerObj.kid === 'string' ? headerObj.kid.trim() : '';
  if (!kid || !KID_FORMAT_REGEX.test(kid)) {
    return { valid: false, reason: 'Entitlement token header missing valid kid.' };
  }

  // 2. Resolve public verification key strictly by `kid`
  let material: LoadedSigningMaterial;
  try {
    material = loadSigningMaterial();
  } catch (err) {
    return {
      valid: false,
      reason: err instanceof Error ? err.message : 'Entitlement verification keys are not configured.',
    };
  }

  const keyEntry = material.publicKeysByKid.get(kid);
  if (!keyEntry) {
    return { valid: false, reason: `Entitlement token key ID (kid="${kid}") is unknown.` };
  }

  // 3. Verify 64-byte IEEE P1363 ECDSA P-256 SHA-256 signature
  const signatureBuf = Buffer.from(signatureB64, 'base64url');
  if (signatureBuf.length !== 64) {
    return { valid: false, reason: 'Entitlement token ES256 signature length invalid.' };
  }

  const signingInput = `${headerB64}.${payloadB64}`;
  const signatureValid = crypto.verify(
    'sha256',
    Buffer.from(signingInput, 'utf-8'),
    {
      key: keyEntry.publicKey,
      dsaEncoding: 'ieee-p1363',
    },
    signatureBuf
  );

  if (!signatureValid) {
    return { valid: false, reason: 'Entitlement token ES256 signature mismatch or untrusted.' };
  }

  // 4. Parse and strictly validate all required claims
  let rawPayload: Record<string, unknown>;
  try {
    const parsedPayload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8'));
    if (!parsedPayload || typeof parsedPayload !== 'object' || Array.isArray(parsedPayload)) {
      return { valid: false, reason: 'Entitlement token payload invalid.' };
    }
    rawPayload = parsedPayload as Record<string, unknown>;
  } catch {
    return { valid: false, reason: 'Entitlement token payload parse error.' };
  }

  if (rawPayload.iss !== ENTITLEMENT_ISSUER) {
    return { valid: false, reason: 'Entitlement token issuer (iss) mismatch.' };
  }

  if (rawPayload.aud !== ENTITLEMENT_AUDIENCE) {
    return { valid: false, reason: 'Entitlement token audience (aud) mismatch.' };
  }

  if (rawPayload.status !== 'active') {
    return { valid: false, reason: 'Entitlement token status is not active.' };
  }

  const licenseId = typeof rawPayload.licenseId === 'string' ? rawPayload.licenseId.trim() : '';
  if (!licenseId) {
    return { valid: false, reason: 'Entitlement token missing licenseId.' };
  }

  const deviceId = typeof rawPayload.deviceId === 'string' ? rawPayload.deviceId.trim() : '';
  if (!deviceId) {
    return { valid: false, reason: 'Entitlement token missing deviceId.' };
  }

  const maskedKey = typeof rawPayload.maskedKey === 'string' ? rawPayload.maskedKey.trim() : '';
  if (!maskedKey) {
    return { valid: false, reason: 'Entitlement token missing maskedKey.' };
  }

  const bindingVersion = rawPayload.bindingVersion;
  if (
    typeof bindingVersion !== 'number' ||
    !Number.isInteger(bindingVersion) ||
    bindingVersion < 1
  ) {
    return { valid: false, reason: 'Entitlement token has invalid bindingVersion.' };
  }

  const iat = rawPayload.iat;
  const exp = rawPayload.exp;
  if (
    typeof iat !== 'number' ||
    !Number.isInteger(iat) ||
    iat <= 0 ||
    typeof exp !== 'number' ||
    !Number.isInteger(exp) ||
    exp <= iat
  ) {
    return { valid: false, reason: 'Entitlement token has invalid iat/exp timestamps.' };
  }

  const nowSec =
    typeof options.nowSec === 'number' && Number.isFinite(options.nowSec)
      ? Math.floor(options.nowSec)
      : Math.floor(Date.now() / 1000);

  if (iat > nowSec + MAX_CLOCK_SKEW_SECONDS) {
    return { valid: false, reason: 'Entitlement token issued-at (iat) is in the future.' };
  }

  if (exp <= nowSec) {
    return { valid: false, reason: 'Entitlement token grace period expired.' };
  }

  const kh = typeof rawPayload.kh === 'string' ? rawPayload.kh.trim() : '';
  if (options.expectedKeyHash) {
    if (!kh || kh !== options.expectedKeyHash) {
      return { valid: false, reason: 'Entitlement token key mismatch.' };
    }
  }

  if (options.expectedDeviceId && deviceId !== options.expectedDeviceId) {
    return { valid: false, reason: 'Entitlement token was issued to a different Android device.' };
  }

  if (options.expectedLicenseId && licenseId !== options.expectedLicenseId) {
    return { valid: false, reason: 'Entitlement token licenseId mismatch.' };
  }

  if (options.expectedBindingVersion !== undefined && options.expectedBindingVersion !== null) {
    if (
      typeof options.expectedBindingVersion !== 'number' ||
      !Number.isInteger(options.expectedBindingVersion) ||
      options.expectedBindingVersion < 1 ||
      bindingVersion !== options.expectedBindingVersion
    ) {
      return {
        valid: false,
        reason: 'Entitlement token belongs to a superseded license binding version.',
      };
    }
  }

  const act = typeof rawPayload.act === 'string' && rawPayload.act.trim()
    ? rawPayload.act.trim()
    : new Date(iat * 1000).toISOString();

  return {
    valid: true,
    header: {
      alg: 'ES256',
      typ: 'JWT',
      kid,
    },
    payload: {
      iss: ENTITLEMENT_ISSUER,
      aud: ENTITLEMENT_AUDIENCE,
      licenseId,
      bindingVersion,
      status: 'active',
      deviceId,
      maskedKey,
      kh,
      act,
      iat,
      exp,
    },
  };
}
