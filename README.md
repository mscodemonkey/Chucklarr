# Chucklarr

Chucklarr is a stand-up comedy companion for Radarr.

It lets you build a watchlist of comedians, scan TheMovieDB for likely stand-up specials, review the matches, and send the ones you want to Radarr with the correct quality profile, root folder, and minimum availability.

Movie databases are not especially tidy about stand-up. Specials can be listed as films, TV movies, documentaries, live shows, charity events, or credits buried under "Self". Chucklarr does the boring truffle-hunting: it checks each comedian's TMDB credits, scores likely specials, shows you what it found, and keeps your manual decisions for future scans.

## Highlights

- Search TMDB for the right comedian before adding them.
- Automatically scan when a comedian is added.
- Scan individual comedians manually, with daily automatic rescans in the background.
- Score likely stand-up specials using title, credit, genre, keyword, runtime, and Radarr-match signals.
- Split each comedian into `To review`, `Monitored`, and `Not monitored`.
- Show whether Radarr already has a candidate.
- Add candidates to Radarr.
- Unmonitor or remove Radarr items when they have not been downloaded yet.
- Auto-add candidates above a configurable score.
- Auto-ignore candidates below a configurable score.
- Remember ignored/rejected items across rescans.
- Backup and restore everything, including settings and review decisions.
- Light, dark, and system themes.
- Interface languages: English (UK), English (US), and French (AI translated, sorry if any errors!).
- Can use a hosted metadata service for easy setup, or your own TMDB API key for the most reliable long-term install.

## How It Works

1. Add a comedian by name.
2. Chucklarr asks TMDB for matching people and lets you choose the correct one.
3. Chucklarr scans that person's movie credits.
4. Each credit is scored as a likely stand-up special.
5. Chucklarr checks Radarr for existing monitored/downloaded movies with the same TMDB ID.
6. You review new candidates, ignore weak matches, or add good matches to Radarr.

The score is intentionally conservative. Stand-up metadata is messy, so Chucklarr prefers a review queue over blindly filling Radarr with every panel show, documentary, or charity gala a comedian has appeared in.

## Requirements

- Docker and Docker Compose, recommended for normal installs.
- A running Radarr instance.
- A Radarr API key.
- A Radarr quality profile for stand-up specials.
- A Radarr root folder for stand-up specials.

For local development without Docker:

- Node.js `24` or newer.

## Quick Start With Docker

Clone the repo, create your environment file, then start the app:

```bash
git clone https://github.com/mscodemonkey/Chucklarr.git
cd Chucklarr
cp .env.example .env
docker compose up --build -d
```

Open:

```text
http://localhost:3333
```

On first run, Chucklarr opens Settings until the required Radarr setup is complete.

## First-Run Setup

### 1. Open Settings

If this is a fresh install, Settings should appear automatically. If not, use the settings button in the header.

### 2. Choose Language and Theme

Pick:

- Language: English (UK), English (US), or French.
- Theme: light, dark, or follow system.

These only affect the Chucklarr interface.

### 3. Configure TheMovieDB

For the quickest first run, leave this set to:

```text
Chucklarr metadata service
```

That uses the small hosted metadata proxy and avoids needing a TMDB API key during setup.

For the best long-term setup, create your own TMDB API key and use it directly. That is better for everyone: your install will not depend on the shared Chucklarr metadata service, and the shared service is less likely to hit rate limits or availability problems for new users.

To use your own key, choose:

```text
Custom TMDB token
```

Then paste a TMDB bearer token into the TMDB token field.

You can create a TMDB API key from your TMDB account settings:

```text
https://www.themoviedb.org/settings/api
```

### 4. Configure Radarr

Enter:

- Radarr URL
- Radarr API key

Then click:

```text
Test connection
```

After a successful test, Chucklarr loads Radarr dropdowns for:

- Quality profile
- Root folder
- Minimum availability

Save the settings after choosing those values.

### 5. Add a Comedian

Use `Add a new comedian`, search by name, and choose the correct TMDB person from the results. Chucklarr adds the comedian to your list first, then scans automatically.

## Radarr URL Tips

The correct Radarr URL depends on where Chucklarr is running.

If Radarr runs directly on the same machine and Chucklarr runs outside Docker:

```text
http://localhost:7878
```

If Chucklarr runs in Docker Desktop and Radarr runs on the host machine:

```text
http://host.docker.internal:7878
```

If Radarr is another container on the same Docker network, use the service/container name:

```text
http://radarr:7878
```

If Radarr is on another machine, use its LAN address:

```text
http://192.168.1.10:7878
```

The Radarr API key is in Radarr under:

```text
Settings -> General -> Security -> API Key
```

## Automatic Processing

Chucklarr has two score thresholds:

- `Auto-add above`: candidates at or above this score are sent to Radarr automatically.
- `Auto-ignore below`: candidates below this score are ignored automatically.

Defaults:

```text
Auto-add above: 95
Auto-ignore below: 60
```

Auto-added items are still shown once so you can see what happened. Ignored items stay in `Not monitored`, and rescans preserve manual ignored/rejected decisions.

## Daily Automatic Scans

Chucklarr scans automatically once a day.

On first startup, each install is assigned a random local time between 02:00 and 05:00. That time is saved in the database and reused, so not every Chucklarr install wakes up and hits the metadata service at the same moment.

During the daily scan, Chucklarr loops through saved comedians one at a time. It also waits briefly between comedians, with a little random jitter, so a large local library does not make one tight burst of requests.

You can override the assigned time with:

```text
AUTOMATIC_DAILY_SCAN_TIME=03:30
```

The value must be between `02:00` and `04:59`. If it is blank or invalid, Chucklarr chooses a random time in that window.

Docker containers use the container's local timezone. If you care exactly when the daily scan runs, set `TZ` for the container or host environment.

## Backup and Restore

Settings includes Backup and Restore.

Backups include:

- App settings
- Saved comedians
- Candidate results
- Review decisions
- Radarr API key and metadata credentials, if configured

Keep backup files private. They are intended for moving machines or recovering an install, not for sharing.

## Updating

Docker builds check GitHub for newer Chucklarr commits when the app starts. If a newer build is available, Chucklarr shows an update banner with a link to the commit and, for Docker images that allow it, an `Update now` button. The button downloads the configured GitHub branch, rebuilds the app inside the container, installs the new build, and restarts Chucklarr.

You can still update manually by pulling the latest code and rebuilding:

```bash
git pull
docker compose up --build -d
```

Your data lives in:

```text
./data/chucklarr.db
```

That directory is mounted into the container by `docker-compose.yml`, so it survives container rebuilds.

## Changelog

### 2026-05-19

- Improved comedian search ranking for common names by combining TMDB person search with stand-up-like movie title matches and credited cast/crew evidence. This surfaces the correct Paul Smith record through `Paul Smith: Pablo Live` instead of relying only on noisy person-search results.
- Added a `Likely comedian` badge for search results that have comedian-specific evidence.
- Added Docker startup update checks against GitHub, plus an in-app update banner and explicit `Update now` action for eligible Docker builds.
- Fixed candidate card layout so long titles and metadata truncate inside the card instead of pushing the confidence score out of bounds.
- Added Chucklarr app icons and web manifest metadata so mobile home-screen shortcuts use the face mark instead of a generated letter tile.

## Local Development

Install dependencies:

```bash
npm install
cp .env.example .env
```

Run the API and Vite dev server:

```bash
npm run dev
```

Open:

```text
http://localhost:5173
```

The API runs on:

```text
http://localhost:3333
```

Build production assets:

```bash
npm run build
```

Run the production server after building:

```bash
npm start
```

Type-check only:

```bash
npm run typecheck
```

Run the unit tests:

```bash
npm test
```

The tests use Node's built-in test runner. Database tests create a temporary
SQLite database through `DATABASE_PATH`, so they will not touch your local
Chucklarr data.

## Environment Variables

Most settings can be changed in the UI. Environment variables are useful for first boot, Docker, or automation.

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `3333` | HTTP port used by the production server. |
| `DATABASE_PATH` | `./data/chucklarr.db` | SQLite database path. |
| `TZ` | `Etc/UTC` | Container timezone. Affects the daily automatic scan time. |
| `CHUCKLARR_LANGUAGE` | `en-GB` | `en-GB`, `en-US`, or `fr-FR`. |
| `CHUCKLARR_THEME` | `system` | `system`, `light`, or `dark`. |
| `CHUCKLARR_METADATA_SOURCE` | `service` | Use `service` or `tmdb`. |
| `CHUCKLARR_METADATA_SERVICE_URL` | See `.env.example` | Hosted metadata proxy URL. |
| `CHUCKLARR_UPDATE_REPOSITORY` | `mscodemonkey/Chucklarr` | GitHub repository checked for Docker update banners. |
| `CHUCKLARR_UPDATE_BRANCH` | `main` | GitHub branch checked for Docker update banners. |
| `CHUCKLARR_ALLOW_AUTO_UPDATE` | `true` in Docker | Enables the in-app Docker update button. |
| `CHUCKLARR_BUILD_REF` | Docker build ref | Commit SHA used to compare the running build with GitHub. Docker normally writes this automatically. |
| `TMDB_BEARER_TOKEN` | empty | Only needed when metadata source is `tmdb`. |
| `RADARR_URL` | `http://localhost:7878` | Base Radarr URL. |
| `RADARR_API_KEY` | empty | Radarr API key. |
| `RADARR_QUALITY_PROFILE_ID` | empty | Normally selected in the UI after testing Radarr. |
| `RADARR_ROOT_FOLDER_PATH` | empty | Normally selected in the UI after testing Radarr. |
| `RADARR_MINIMUM_AVAILABILITY` | `released` | Sent to Radarr when adding movies. |
| `AUTO_ADD_CONFIDENCE_THRESHOLD` | `95` | Initial auto-add score threshold. |
| `HIDE_BELOW_CONFIDENCE_THRESHOLD` | `60` | Initial auto-ignore score threshold. |
| `AUTOMATIC_DAILY_SCAN_TIME` | random `02:00`-`04:59` | Optional daily scan time in local `HH:MM` format. |

## Metadata Service

Chucklarr can use either:

- The hosted Chucklarr metadata service.
- A direct TMDB bearer token.
- Your own metadata proxy.

The hosted metadata service exists to make first-run setup easy and to avoid shipping a TMDB bearer token in the browser. It is shared infrastructure, so it may be rate limited, changed, or unavailable.

For a dependable personal install, use your own TMDB bearer token. This keeps your scans independent of the shared service and helps keep that shared service available for people trying Chucklarr for the first time.

A Cloudflare Worker scaffold is included in:

```text
metadata-worker/
```

Deploy your own Worker:

```bash
cd metadata-worker
npm install
npx wrangler login
npx wrangler secret put TMDB_BEARER_TOKEN
npm run deploy
```

Then set:

```text
CHUCKLARR_METADATA_SOURCE=service
CHUCKLARR_METADATA_SERVICE_URL=https://your-worker.your-account.workers.dev
```

The Worker only proxies the small subset of TMDB endpoints Chucklarr needs.

## Troubleshooting

### Docker says `.env` is missing

Create it from the example:

```bash
cp .env.example .env
```

Then run Docker again:

```bash
docker compose up --build -d
```

### Radarr connection test fails

Check:

- The Radarr URL is reachable from where Chucklarr is running.
- The API key is correct.
- Radarr does not require an auth flow that blocks API access.
- Docker installs are not using `localhost` when they need `host.docker.internal`, a Docker service name, or a LAN IP.

### Quality profile or root folder is missing

Run `Test connection` again in Settings. Chucklarr only shows those dropdowns after Radarr responds successfully.

### A scan finds too much

Raise `Auto-ignore below`, or manually ignore weak results. Manual ignores are preserved on future scans.

### A scan misses something

Lower `Auto-ignore below`, search TMDB for how the special is represented, and rescan the comedian. Some specials are not listed as movie credits on TMDB, so Chucklarr may not see them yet.

### A title is already in Radarr but appears under the wrong comedian

Chucklarr filters weak Radarr-only matches from the monitored list unless the candidate has direct comedian evidence, such as the comedian name in the title or a self credit. If you still see a bad match, ignore it or rescan after updating.

## Data and Privacy

Chucklarr stores data locally in SQLite.

By default with Docker:

```text
./data/chucklarr.db
```

Your Radarr API key is stored in the local database after setup. Backup files include that key too. Keep both private.

Chucklarr talks to:

- Your Radarr instance.
- The configured metadata source.
- TMDB, either through the hosted metadata service, your own metadata service, or your direct TMDB token.

## TMDB Attribution

This product uses the TMDB API but is not endorsed or certified by TMDB.

Learn more at:

```text
https://www.themoviedb.org/
```

## Project Status

Chucklarr is early public software. It is useful, but stand-up metadata is inconsistent and some review judgement is still expected.

Please open issues for bad matches, missing setup guidance, confusing UI, or Radarr behaviour that does not match your setup.

## Disclaimer

Chucklarr is not affiliated with Radarr or TMDB. Use it with your own Radarr library and review automation thresholds before relying on auto-add.
