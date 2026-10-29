import type { IncomingMessage, ServerResponse } from 'http';

interface RateLimitBucket {
  timestamps: number[];
}

const buckets = new Map<string, RateLimitBucket>();

export interface RateLimitOptions {
  namespace: string;
  maxRequests: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
  limit: number;
}

/**
 * Extracts client identifier (IP address) from request headers or socket.
 */
export function getClientIdentifier(req: IncomingMessage): string {
  const headers = req.headers || {};
  const forwarded = headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim().length > 0) {
    return forwarded.split(',')[0].trim();
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return String(forwarded[0]).split(',')[0].trim();
  }
  const realIp = headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim().length > 0) {
    return realIp.trim();
  }
  const socketAddr = (req.socket as { remoteAddress?: string } | undefined)?.remoteAddress;
  if (socketAddr) {
    return socketAddr;
  }
  return 'unknown-client';
}

/**
 * Checks and records a request against a sliding-window rate limit.
 */
export function checkRateLimit(
  req: IncomingMessage,
  options: RateLimitOptions
): RateLimitResult {
  const clientIp = getClientIdentifier(req);
  const key = `${options.namespace}:${clientIp}`;
  const now = Date.now();
  const windowStart = now - options.windowMs;

  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { timestamps: [] };
    buckets.set(key, bucket);
  }

  // Prune expired timestamps outside the window
  bucket.timestamps = bucket.timestamps.filter((ts) => ts > windowStart);

  if (bucket.timestamps.length >= options.maxRequests) {
    const oldestInWindow = bucket.timestamps[0] || now;
    const retryAfterMs = Math.max(1000, options.windowMs - (now - oldestInWindow));
    const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds,
      limit: options.maxRequests,
    };
  }

  bucket.timestamps.push(now);

  // Periodic cleanup if map grows large
  if (buckets.size > 5000) {
    for (const [k, v] of buckets.entries()) {
      const active = v.timestamps.filter((ts) => ts > now - 3600_000);
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
    limit: options.maxRequests,
  };
}

/**
 * Applies rate-limit response headers to the HTTP response.
 */
export function applyRateLimitHeaders(res: ServerResponse, result: RateLimitResult): void {
  if (res.writableEnded || res.headersSent) return;
  res.setHeader('X-RateLimit-Limit', String(result.limit));
  res.setHeader('X-RateLimit-Remaining', String(result.remaining));
  if (!result.allowed && result.retryAfterSeconds > 0) {
    res.setHeader('Retry-After', String(result.retryAfterSeconds));
  }
}

/**
 * Clears all rate-limit buckets (used in automated tests).
 */
export function resetRateLimits(): void {
  buckets.clear();
}
