# Chucklarr Metadata Worker

Cloudflare Worker proxy for the small subset of TMDB endpoints Chucklarr needs.

## Setup

```bash
cd metadata-worker
npm install
npx wrangler secret put TMDB_BEARER_TOKEN
npm run deploy
```

Point Chucklarr at the deployed URL with:

```env
CHUCKLARR_METADATA_SOURCE=service
CHUCKLARR_METADATA_SERVICE_URL=https://{your-worker-name}.{your-cloudflare-account}.workers.dev
```

## Endpoints

- `GET /health`
- `GET /tmdb/search/person?query=...`
- `GET /tmdb/person/:id`
- `GET /tmdb/person/:id/movie_credits`
- `GET /tmdb/movie/:id?append_to_response=keywords,credits`

The Worker only forwards these routes, caches successful TMDB responses, and keeps the TMDB bearer token in Cloudflare secrets.
