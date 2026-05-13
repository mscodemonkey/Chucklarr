type Env = {
  TMDB_BEARER_TOKEN: string;
  CACHE_TTL_SECONDS?: string;
  ALLOWED_ORIGIN?: string;
};

const tmdbBaseUrl = 'https://api.themoviedb.org/3';
const defaultCacheTtlSeconds = 60 * 60 * 24;

export default {
  async fetch(request: Request, env: Env, context: ExecutionContext): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return corsResponse(null, env);
    }

    if (request.method !== 'GET') {
      return json({ error: 'Method not allowed.' }, 405, env);
    }

    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return json({ ok: true, name: 'chucklarr-metadata' }, 200, env);
    }

    const tmdbPath = allowedTmdbPath(url);
    if (!tmdbPath) {
      return json({ error: 'Not found.' }, 404, env);
    }

    if (!env.TMDB_BEARER_TOKEN) {
      return json({ error: 'TMDB bearer token is not configured.' }, 500, env);
    }

    const cacheKey = new Request(url.toString(), request);
    const cached = await caches.default.match(cacheKey);
    if (cached) {
      return withCors(cached, env);
    }

    const tmdbUrl = new URL(`${tmdbBaseUrl}${tmdbPath}`);
    for (const [key, value] of url.searchParams) {
      tmdbUrl.searchParams.set(key, value);
    }

    const tmdbResponse = await fetch(tmdbUrl, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${env.TMDB_BEARER_TOKEN}`
      }
    });

    const headers = new Headers(tmdbResponse.headers);
    headers.set('Cache-Control', `public, max-age=${cacheTtl(env)}`);
    headers.set('X-Chucklarr-Metadata', 'tmdb');
    setCors(headers, env);

    const response = new Response(tmdbResponse.body, {
      status: tmdbResponse.status,
      statusText: tmdbResponse.statusText,
      headers
    });

    if (tmdbResponse.ok) {
      context.waitUntil(caches.default.put(cacheKey, response.clone()));
    }

    return response;
  }
};

function allowedTmdbPath(url: URL): string | null {
  const match = url.pathname.match(/^\/tmdb\/(.+)$/);
  if (!match) {
    return null;
  }

  const path = `/${match[1]}`;

  if (path === '/search/person') {
    return url.searchParams.has('query') ? path : null;
  }

  if (/^\/person\/\d+$/.test(path)) {
    return path;
  }

  if (/^\/person\/\d+\/movie_credits$/.test(path)) {
    return path;
  }

  if (/^\/movie\/\d+$/.test(path)) {
    const append = url.searchParams.get('append_to_response');
    return append === 'keywords,credits' ? path : null;
  }

  return null;
}

function cacheTtl(env: Env): number {
  const ttl = Number(env.CACHE_TTL_SECONDS);
  return Number.isFinite(ttl) && ttl > 0 ? Math.round(ttl) : defaultCacheTtlSeconds;
}

function json(body: unknown, status: number, env: Env): Response {
  return corsResponse(JSON.stringify(body), env, {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8'
    }
  });
}

function corsResponse(body: BodyInit | null, env: Env, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  setCors(headers, env);
  return new Response(body, { ...init, headers });
}

function withCors(response: Response, env: Env): Response {
  const headers = new Headers(response.headers);
  headers.set('X-Chucklarr-Cache', 'HIT');
  setCors(headers, env);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function setCors(headers: Headers, env: Env): void {
  headers.set('Access-Control-Allow-Origin', env.ALLOWED_ORIGIN || '*');
  headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Accept, Content-Type, X-Chucklarr-Client');
}
