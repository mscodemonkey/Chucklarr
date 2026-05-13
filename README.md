# Chucklarr

Chucklarr is a small Radarr companion for stand-up comedy. Follow comedians, scan TMDB for likely specials, review matches, then send approved titles to Radarr.

## What Works

- Add comedians by name.
- Resolve and store their TMDB person identity.
- Scan each comedian's movie credits.
- Score likely stand-up specials with simple heuristics.
- Review candidates in a compact web UI.
- Approve a candidate into Radarr with your quality profile and root folder.

## Run Locally

```bash
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:5173`.

The API runs on `http://localhost:3333`.

## Configuration

You can configure Chucklarr from the UI or with environment variables:

- `TMDB_BEARER_TOKEN`
- `RADARR_URL`
- `RADARR_API_KEY`
- `RADARR_QUALITY_PROFILE_ID`
- `RADARR_ROOT_FOLDER_PATH`
- `RADARR_MINIMUM_AVAILABILITY`

## Docker

```bash
docker compose up --build
```

The container serves the app on `http://localhost:3333`.

## Notes

Stand-up is not modeled consistently in movie databases, so Chucklarr uses a confidence score rather than blindly adding every credit. The first version keeps that queue visible and easy to correct.
