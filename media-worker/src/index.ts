/**
 * Cloudflare Worker: edge-cached R2 media delivery for media.channel-app.com
 *
 * Reads from R2 bucket directly, caches full responses at the edge via Cache API.
 * Range requests are served directly from R2 (not cached -- too many variants).
 *
 * Cache TTLs:
 * - HLS manifests (.m3u8): 1 second (live manifests change every ~2s)
 * - HLS segments (.ts):    60 seconds (immutable once written)
 * - Archive MP4 (.mp4):    1 hour (immutable recordings)
 * - Everything else:       60 seconds
 */

interface Env {
  BUCKET: R2Bucket;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const key = url.pathname.slice(1);

    if (!key) {
      return new Response('Not found', { status: 404 });
    }

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': 'Range',
        },
      });
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405 });
    }

    const rangeHeader = request.headers.get('Range');
    const cacheTtl = getCacheTtl(key);

    // For non-range GET requests, try edge cache first
    if (!rangeHeader && request.method === 'GET') {
      const cache = caches.default;
      const cacheKey = new Request(url.toString());
      const cached = await cache.match(cacheKey);
      if (cached) {
        return addHeaders(cached, 'HIT');
      }

      // Cache miss — fetch from R2
      const object = await env.BUCKET.get(key);
      if (!object) {
        return new Response('Not found', { status: 404 });
      }

      const response = buildResponse(object, key, 200);

      // Cache in background (don't block response)
      ctx.waitUntil(cache.put(cacheKey, response.clone()));

      return addHeaders(response, 'MISS');
    }

    // Range requests or HEAD — go direct to R2
    if (rangeHeader) {
      const range = parseRange(rangeHeader);
      const object = await env.BUCKET.get(key, range ? { range } : {});
      if (!object) {
        return new Response('Not found', { status: 404 });
      }

      const headers = new Headers();
      headers.set('Content-Type', object.httpMetadata?.contentType || getMimeType(key));
      headers.set('ETag', object.httpEtag);
      headers.set('Accept-Ranges', 'bytes');
      headers.set('Access-Control-Allow-Origin', '*');

      // R2 returns the range info in the object
      if (range && 'offset' in range) {
        const offset = range.offset ?? 0;
        const length = range.length ?? (object.size - offset);
        headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${object.size}`);
        headers.set('Content-Length', String(length));
      } else if (range && 'suffix' in range) {
        const length = range.suffix!;
        const offset = object.size - length;
        headers.set('Content-Range', `bytes ${offset}-${object.size - 1}/${object.size}`);
        headers.set('Content-Length', String(length));
      }

      return new Response(object.body, { status: 206, headers });
    }

    // HEAD request
    const object = await env.BUCKET.head(key);
    if (!object) {
      return new Response('Not found', { status: 404 });
    }

    const headers = new Headers();
    headers.set('Content-Type', object.httpMetadata?.contentType || getMimeType(key));
    headers.set('Content-Length', String(object.size));
    headers.set('ETag', object.httpEtag);
    headers.set('Accept-Ranges', 'bytes');
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Cache-Control', `public, max-age=${cacheTtl}`);

    return new Response(null, { status: 200, headers });
  },
} satisfies ExportedHandler<Env>;

function buildResponse(object: R2ObjectBody, key: string, status: number): Response {
  const headers = new Headers();
  headers.set('Content-Type', object.httpMetadata?.contentType || getMimeType(key));
  headers.set('Content-Length', String(object.size));
  headers.set('ETag', object.httpEtag);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Cache-Control', `public, max-age=${getCacheTtl(key)}`);

  return new Response(object.body, { status, headers });
}

function addHeaders(response: Response, cacheStatus: string): Response {
  const newResponse = new Response(response.body, response);
  newResponse.headers.set('X-Cache-Status', cacheStatus);
  newResponse.headers.set('Access-Control-Allow-Origin', '*');
  return newResponse;
}

function getCacheTtl(key: string): number {
  if (key.endsWith('.m3u8')) return 1;
  if (key.endsWith('.ts')) return 60;
  if (key.endsWith('.mp4')) return 3600;
  return 60;
}

function getMimeType(key: string): string {
  if (key.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl';
  if (key.endsWith('.ts')) return 'video/mp2t';
  if (key.endsWith('.mp4')) return 'video/mp4';
  return 'application/octet-stream';
}

function parseRange(header: string): R2Range | undefined {
  const match = header.match(/bytes=(\d*)-(\d*)/);
  if (!match) return undefined;

  const start = match[1] ? parseInt(match[1]) : undefined;
  const end = match[2] ? parseInt(match[2]) : undefined;

  if (start !== undefined && end !== undefined) {
    return { offset: start, length: end - start + 1 };
  } else if (start !== undefined) {
    return { offset: start };
  } else if (end !== undefined) {
    return { suffix: end };
  }
  return undefined;
}
