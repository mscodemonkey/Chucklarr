/**
 * Hosts the Chucklarr HTTP boundary. Routes own explicit external writes while
 * database and service adapters own state. Production startup owns scheduling
 * and update checks; tests import the app without starting background work.
 */

import express from 'express';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createComedian,
  createBackup,
  deleteComedian,
  getCandidate,
  getComedian,
  getSettings,
  listCandidates,
  listComedians,
  markCandidateRemovedFromRadarr,
  restoreBackup,
  syncCandidatesWithRadarr,
  updateComedianOrigin,
  updateCandidateStatus,
  updateSettings
} from './db';
import { env } from './env';
import { selectFilmAppearances } from './appearances';
import { originFromPlaceOfBirth } from './origin';
import { searchComedianPeople } from './personSearch';
import { RadarrClient } from './radarr';
import { scanAllComedians, scanComedian } from './scanner';
import { startDailyScanScheduler } from './scheduler';
import { TmdbClient } from './tmdb';
import { applyUpdate, getUpdateStatus, refreshUpdateStatus } from './updater';
import { readRunningBuildSha, shouldRestartAfterUpdate } from './updateVersion';
import type { AppSettings, CandidateStatus } from '../shared/types';

/** Express application consumed by production startup and isolated HTTP tests. */
export const app = express();
const dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(dirname, '../client');
const instanceId = randomUUID();
const runningSha = readRunningBuildSha(path.join(process.cwd(), 'build-ref'), env.updateBuildRef);
let restartScheduled = false;

app.use(express.json({ limit: '25mb' }));

// Express 5 handles returned promises in many cases, but keeping a tiny wrapper
// makes route intent explicit and ensures all async failures flow through the
// JSON error handler below.
function asyncRoute(handler: express.RequestHandler): express.RequestHandler {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

/** Runs a restart callback once after a response finishes, closes, or has already disconnected. */
export function afterUpdateResponse(
  response: { once(event: 'finish' | 'close', callback: () => void): unknown; readonly destroyed: boolean },
  restart: () => void
): void {
  let completed = false;
  const finish = () => {
    if (completed) return;
    completed = true;
    restart();
  };
  response.once('finish', finish);
  response.once('close', finish);
  if (response.destroyed) finish();
}

app.get('/api/health', (_request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.json({ ok: true, name: 'Chucklarr', instanceId, buildSha: runningSha });
});

app.use('/api/update', (_request, response, next) => {
  response.setHeader('Cache-Control', 'no-store');
  next();
});

app.get('/api/update', (_request, response) => {
  response.json(getUpdateStatus());
});

app.post(
  '/api/update/check',
  asyncRoute(async (_request, response) => {
    response.json(await refreshUpdateStatus());
  })
);

app.post(
  '/api/update/apply',
  asyncRoute(async (_request, response) => {
    const status = await applyUpdate();
    if (shouldRestartAfterUpdate(runningSha, status)) {
      afterUpdateResponse(response, () => {
        if (restartScheduled) return;
        restartScheduled = true;
        setTimeout(() => process.exit(0), 500);
      });
    }
    if (!response.destroyed) response.json(status);
  })
);

app.get('/api/settings', (_request, response) => {
  response.json(getSettings());
});

app.put('/api/settings', (request, response) => {
  response.json(updateSettings(request.body));
});

app.get('/api/backup', (_request, response) => {
  const backup = createBackup();
  const timestamp = backup.exportedAt.replace(/[:.]/g, '-');
  response.setHeader('Content-Disposition', `attachment; filename="chucklarr-backup-${timestamp}.json"`);
  response.json(backup);
});

app.post('/api/backup/restore', (request, response) => {
  try {
    response.json(restoreBackup(request.body));
  } catch (caught) {
    response.status(400).json({ error: caught instanceof Error ? caught.message : 'Invalid backup file.' });
  }
});

app.get(
  '/api/radarr/options',
  asyncRoute(async (_request, response) => {
    response.json(await new RadarrClient(getSettings()).options());
  })
);

app.post(
  '/api/radarr/options',
  asyncRoute(async (request, response) => {
    const settings = { ...getSettings(), ...request.body } as AppSettings;
    response.json(await new RadarrClient(settings).options());
  })
);

app.get(
  '/api/radarr/movies',
  asyncRoute(async (_request, response) => {
    response.json(await new RadarrClient(getSettings()).monitoredMovies());
  })
);

app.post(
  '/api/radarr/sync',
  asyncRoute(async (_request, response) => {
    const radarr = new RadarrClient(getSettings());
    if (!radarr.connectionConfigured) {
      response.json({ movies: [], updatedCandidates: [] });
      return;
    }

    const movies = await radarr.movies();
    response.json({
      movies: movies.filter((movie) => movie.monitored),
      updatedCandidates: syncCandidatesWithRadarr(movies)
    });
  })
);

app.get(
  '/api/comedians',
  asyncRoute(async (_request, response) => {
    response.json(await comediansWithOrigin());
  })
);

app.get(
  '/api/comedians/search',
  asyncRoute(async (request, response) => {
    const query = String(request.query.q ?? '').trim();
    if (!query) {
      response.status(400).json({ error: 'Search query is required.' });
      return;
    }

    const tmdb = new TmdbClient(getSettings());
    if (!tmdb.configured) {
      response.status(400).json({ error: 'TMDB bearer token is not configured.' });
      return;
    }

    response.json(await searchComedianPeople(tmdb, query));
  })
);

app.post(
  '/api/comedians',
  asyncRoute(async (request, response) => {
    const name = String(request.body.name ?? '').trim();
    if (!name) {
      response.status(400).json({ error: 'Name is required.' });
      return;
    }

    const tmdb = new TmdbClient(getSettings());
    const requestedTmdbPersonId = Number(request.body.tmdbPersonId);
    const person =
      Number.isFinite(requestedTmdbPersonId) && requestedTmdbPersonId > 0
        ? {
            id: requestedTmdbPersonId,
            name,
            profile_path: request.body.profilePath == null ? null : String(request.body.profilePath)
          }
        : tmdb.configured
          ? await tmdb.searchPerson(name)
          : null;
    const details =
      person?.id && tmdb.configured ? await tmdb.personDetails(person.id).catch(() => null) : null;
    const origin = originFromPlaceOfBirth(details?.place_of_birth ?? null);
    const comedian = createComedian({
      name: details?.name ?? person?.name ?? name,
      tmdbPersonId: details?.id ?? person?.id ?? null,
      profilePath: details?.profile_path ?? person?.profile_path ?? null,
      homepage: normaliseHomepage(details?.homepage ?? null),
      placeOfBirth: details?.place_of_birth ?? null,
      countryCode: origin.countryCode,
      countryName: origin.countryName
    });

    response.status(201).json(comedian);
  })
);

async function comediansWithOrigin() {
  const comedians = listComedians();
  const missingOrigin = comedians.filter((comedian) => comedian.tmdbPersonId && !comedian.countryCode);
  if (missingOrigin.length === 0) {
    return comedians;
  }

  const tmdb = new TmdbClient(getSettings());
  if (!tmdb.configured) {
    return comedians;
  }

  // Older databases may have comedians saved before country fields existed.
  // Backfill origin lazily when the library loads instead of forcing a blocking
  // migration that calls the external metadata service on startup.
  await Promise.all(
    missingOrigin.map(async (comedian) => {
      if (!comedian.tmdbPersonId) return;
      const details = await tmdb.personDetails(comedian.tmdbPersonId).catch(() => null);
      if (!details?.place_of_birth) return;
      const origin = originFromPlaceOfBirth(details.place_of_birth);
      updateComedianOrigin(comedian.id, {
        homepage: normaliseHomepage(details.homepage),
        placeOfBirth: details.place_of_birth,
        countryCode: origin.countryCode,
        countryName: origin.countryName
      });
    })
  );

  return listComedians();
}

function normaliseHomepage(homepage: string | null): string | null {
  const trimmed = homepage?.trim() ?? '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : null;
}

const filmAddsInFlight = new Set<number>();

function positiveId(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

function filmComedian(request: express.Request, response: express.Response) {
  const id = positiveId(String(request.params.id));
  if (!id) {
    response.status(400).json({ error: 'A positive integer comedian ID is required.' });
    return null;
  }
  const comedian = getComedian(id);
  if (!comedian) {
    response.status(404).json({ error: 'Comedian not found.' });
    return null;
  }
  if (!comedian.tmdbPersonId) {
    response.status(400).json({ error: 'This comedian has no TMDB person ID.' });
    return null;
  }
  return comedian;
}

async function filmsForComedian(comedian: NonNullable<ReturnType<typeof filmComedian>>) {
  const known = new Set(
    listCandidates()
      .filter((candidate) => candidate.comedianId === comedian.id)
      .map((candidate) => candidate.tmdbMovieId)
  );
  const credits = await new TmdbClient(getSettings()).personMovieCredits(comedian.tmdbPersonId!, 10_000);
  return selectFilmAppearances(comedian.name, credits, known);
}

app.get(
  '/api/comedians/:id/films',
  asyncRoute(async (request, response) => {
    const comedian = filmComedian(request, response);
    if (!comedian) return;
    let films;
    try {
      films = await filmsForComedian(comedian);
    } catch {
      response.status(502).json({ error: 'Film metadata is unavailable. Please try again.' });
      return;
    }
    const radarr = new RadarrClient(getSettings());
    if (!radarr.connectionConfigured) {
      response.json({ films, states: [], statusAvailable: false });
      return;
    }
    try {
      const filmIds = new Set(films.map((film) => film.tmdbMovieId));
      const states = (await radarr.movies()).flatMap((movie) =>
        movie.tmdbId != null && filmIds.has(movie.tmdbId)
          ? [{ tmdbId: movie.tmdbId, radarrId: movie.id, monitored: movie.monitored, hasFile: movie.hasFile }]
          : []
      );
      response.json({ films, states, statusAvailable: true });
    } catch {
      response.json({ films, states: [], statusAvailable: false });
    }
  })
);

app.post(
  '/api/comedians/:id/films/:movieId/add',
  asyncRoute(async (request, response) => {
    const comedian = filmComedian(request, response);
    if (!comedian) return;
    const movieId = positiveId(String(request.params.movieId));
    if (!movieId) {
      response.status(400).json({ error: 'A positive integer movie ID is required.' });
      return;
    }
    const radarr = new RadarrClient(getSettings());
    if (!radarr.configured) {
      response
        .status(400)
        .json({ error: 'Configure Radarr, a quality profile and a root folder in Settings first.' });
      return;
    }
    if (filmAddsInFlight.has(movieId)) {
      response.status(409).json({ error: 'This film is already being added. Please wait.' });
      return;
    }
    filmAddsInFlight.add(movieId);
    try {
      let films;
      try {
        films = await filmsForComedian(comedian);
      } catch {
        response.status(502).json({ error: 'Film metadata is unavailable. Nothing was added.' });
        return;
      }
      const film = films.find((item) => item.tmdbMovieId === movieId);
      if (!film) {
        response
          .status(404)
          .json({ error: 'This movie is not an eligible film appearance for this comedian.' });
        return;
      }
      try {
        const movie = await radarr.addMovie(film);
        response.json({ ok: true, radarrMovieId: movie.id ?? null });
      } catch {
        response
          .status(502)
          .json({ error: 'Radarr could not add this film. Please check the connection and try again.' });
      }
    } finally {
      filmAddsInFlight.delete(movieId);
    }
  })
);

app.delete('/api/comedians/:id', (request, response) => {
  deleteComedian(Number(request.params.id));
  response.status(204).end();
});

app.post(
  '/api/comedians/:id/scan',
  asyncRoute(async (request, response) => {
    response.json(await scanComedian(Number(request.params.id)));
  })
);

app.post(
  '/api/scan',
  asyncRoute(async (_request, response) => {
    response.json(await scanAllComedians());
  })
);

app.get('/api/candidates', (request, response) => {
  const status = request.query.status ? String(request.query.status) : undefined;
  response.json(listCandidates(status as CandidateStatus | undefined));
});

app.patch('/api/candidates/:id', (request, response) => {
  const status = String(request.body.status ?? '') as CandidateStatus;
  if (!['new', 'auto_added', 'approved', 'ignored', 'rejected'].includes(status)) {
    response.status(400).json({ error: 'Invalid candidate status.' });
    return;
  }

  response.json(updateCandidateStatus(Number(request.params.id), status));
});

app.post(
  '/api/candidates/:id/approve',
  asyncRoute(async (request, response) => {
    const candidate = getCandidate(Number(request.params.id));
    if (!candidate) {
      response.status(404).json({ error: 'Candidate not found.' });
      return;
    }

    const radarr = new RadarrClient(getSettings());
    const radarrMovie = candidate.radarrMovieId
      ? await radarr.setMovieMonitored(candidate.radarrMovieId, true)
      : await radarr.addMovie(candidate);
    response.json(updateCandidateStatus(candidate.id, 'approved', radarrMovie.id));
  })
);

app.post(
  '/api/candidates/:id/unmonitor-radarr',
  asyncRoute(async (request, response) => {
    const candidate = getCandidate(Number(request.params.id));
    if (!candidate) {
      response.status(404).json({ error: 'Candidate not found.' });
      return;
    }

    if (!candidate.radarrMovieId) {
      response.status(400).json({ error: 'Candidate does not have a Radarr movie id.' });
      return;
    }

    await new RadarrClient(getSettings()).setMovieMonitored(candidate.radarrMovieId, false);
    response.json(updateCandidateStatus(candidate.id, 'ignored'));
  })
);

app.post(
  '/api/candidates/:id/remove-from-radarr',
  asyncRoute(async (request, response) => {
    const candidate = getCandidate(Number(request.params.id));
    if (!candidate) {
      response.status(404).json({ error: 'Candidate not found.' });
      return;
    }

    if (!candidate.radarrMovieId) {
      response.status(400).json({ error: 'Candidate does not have a Radarr movie id.' });
      return;
    }

    await new RadarrClient(getSettings()).removeMovie(candidate.radarrMovieId);
    response.json(markCandidateRemovedFromRadarr(candidate.id));
  })
);

app.use(
  express.static(clientDist, {
    setHeaders: (response, filePath) => {
      if (filePath.endsWith('.html')) response.setHeader('Cache-Control', 'no-store');
    }
  })
);
app.get(/.*/, (_request, response) => {
  response.sendFile(path.join(clientDist, 'index.html'), { headers: { 'Cache-Control': 'no-store' } });
});

app.use(
  (error: Error, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    response.status(500).json({ error: error.message });
  }
);

if (process.env.NODE_ENV !== 'test') {
  app.listen(env.port, () => {
    console.log(`Chucklarr listening on http://localhost:${env.port}`);
    void refreshUpdateStatus().catch((caught) => {
      console.warn(
        caught instanceof Error ? `Update check skipped: ${caught.message}` : 'Update check skipped.'
      );
    });
    startDailyScanScheduler();
  });
}
