/**
 * Adapts Radarr movie operations for server routes and scans. Clients own their
 * settings snapshot; Radarr owns monitoring, downloads and filesystem paths.
 */

import type {
  AppSettings,
  Candidate,
  RadarrMonitoredMovie,
  RadarrOptions,
  RadarrQualityProfile,
  RadarrRootFolder
} from '../shared/types';

type RadarrMovie = {
  id?: number;
  title?: string;
  tmdbId?: number;
  year?: number;
  monitored?: boolean;
  hasFile?: boolean;
  path?: string;
};

type RadarrQualityProfileResponse = {
  id?: number;
  name?: string;
};

type RadarrRootFolderResponse = {
  id?: number;
  path?: string;
  freeSpace?: number;
  accessible?: boolean;
};

type RadarrValidationFailure = {
  propertyName?: string;
  errorMessage?: string;
  attemptedValue?: unknown;
  errorCode?: string;
};

/** Carries upstream validation evidence for duplicate-path recovery within one request. */
class RadarrRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
    readonly validationFailures: RadarrValidationFailure[]
  ) {
    super(message);
  }
}

/**
 * Performs server-side Radarr operations with an immutable settings snapshot.
 * Routes and scans own its short lifecycle. This client never deletes files,
 * and add operations reuse existing movies before creating a monitored entry.
 */
export class RadarrClient {
  constructor(private readonly settings: AppSettings) {}

  /** Whether library reads can be attempted, independently of add configuration. */
  get connectionConfigured(): boolean {
    return Boolean(this.settings.radarrUrl.trim() && this.settings.radarrApiKey.trim());
  }

  /** Whether additions have a destination and quality policy as well as credentials. */
  get configured(): boolean {
    return Boolean(
      this.connectionConfigured &&
      this.settings.radarrQualityProfileId.trim() &&
      this.settings.radarrRootFolderPath.trim()
    );
  }

  /** Tests the connection and returns selectable quality profiles and destinations. */
  async options(): Promise<RadarrOptions> {
    if (!this.connectionConfigured) {
      return {
        connected: false,
        qualityProfiles: [],
        rootFolders: [],
        error: 'Radarr URL and API key are required.'
      };
    }

    try {
      const [qualityProfiles, rootFolders] = await Promise.all([
        this.get<RadarrQualityProfileResponse[]>('/api/v3/qualityprofile'),
        this.get<RadarrRootFolderResponse[]>('/api/v3/rootfolder')
      ]);

      return {
        connected: true,
        qualityProfiles: qualityProfiles
          .filter((profile): profile is RadarrQualityProfile => Boolean(profile.id && profile.name))
          .map((profile) => ({ id: profile.id, name: profile.name })),
        rootFolders: rootFolders
          .filter((folder) => Boolean(folder.path))
          .map<RadarrRootFolder>((folder) => ({
            id: folder.id ?? null,
            path: folder.path as string,
            freeSpace: folder.freeSpace ?? null,
            accessible: folder.accessible ?? null
          }))
      };
    } catch (caught) {
      return {
        connected: false,
        qualityProfiles: [],
        rootFolders: [],
        error: caught instanceof Error ? caught.message : 'Unable to connect to Radarr.'
      };
    }
  }

  /** Adds or re-monitors a movie using saved settings, recovering duplicate IDs and paths. */
  async addMovie<T extends Pick<Candidate, 'tmdbMovieId' | 'title'>>(candidate: T): Promise<RadarrMovie> {
    if (!this.configured) {
      throw new Error('Radarr URL, API key, quality profile, and root folder must be configured.');
    }

    const existingMovie = (await this.existingMoviesByTmdbId()).get(candidate.tmdbMovieId);
    if (existingMovie?.id) {
      return this.setMovieMonitored(existingMovie.id, true);
    }

    try {
      const response = await this.request('/api/v3/movie', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title: candidate.title,
          tmdbId: candidate.tmdbMovieId,
          qualityProfileId: Number(this.settings.radarrQualityProfileId),
          rootFolderPath: this.settings.radarrRootFolderPath,
          monitored: true,
          minimumAvailability: this.settings.radarrMinimumAvailability || 'released',
          addOptions: {
            searchForMovie: true
          }
        })
      });

      return response.json() as Promise<RadarrMovie>;
    } catch (caught) {
      const duplicatePath =
        caught instanceof RadarrRequestError ? duplicateMoviePath(caught.validationFailures) : null;
      if (!duplicatePath) {
        throw caught;
      }

      const movie = await this.existingMovieByPath(duplicatePath);
      if (movie?.id) {
        return this.setMovieMonitored(movie.id, true);
      }

      throw new Error(
        `Radarr already has a movie configured at ${duplicatePath}, but Chucklarr could not find it in Radarr's movie list.`
      );
    }
  }

  /** Changes monitoring in Radarr without changing local review decisions. */
  async setMovieMonitored(movieId: number, monitored: boolean): Promise<RadarrMovie> {
    if (!this.connectionConfigured) {
      throw new Error('Radarr URL and API key must be configured.');
    }

    const movie = await this.get<RadarrMovie>(`/api/v3/movie/${movieId}`);
    const response = await this.request(`/api/v3/movie/${movieId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ...movie,
        monitored
      })
    });

    return response.json() as Promise<RadarrMovie>;
  }

  /** Indexes the remote library by stable metadata ID, including unmonitored movies. */
  async existingMoviesByTmdbId(): Promise<Map<number, RadarrMovie>> {
    if (!this.connectionConfigured) {
      return new Map();
    }

    const movies = await this.get<RadarrMovie[]>('/api/v3/movie');

    // TMDB IDs are the stable cross-service identifier. Titles and years can be
    // localised or corrected independently in TMDB and Radarr.
    return new Map(
      movies
        .filter((movie): movie is RadarrMovie & { tmdbId: number } => Boolean(movie.id && movie.tmdbId))
        .map((movie) => [movie.tmdbId, movie])
    );
  }

  /** Finds an existing entry for duplicate-path recovery without altering its files. */
  async existingMovieByPath(path: string): Promise<RadarrMovie | null> {
    if (!this.connectionConfigured) {
      return null;
    }

    const normalisedPath = normaliseRadarrPath(path);
    const movies = await this.get<RadarrMovie[]>('/api/v3/movie');
    return movies.find((movie) => normaliseRadarrPath(movie.path) === normalisedPath) ?? null;
  }

  /** Reads monitored entries only; downloaded state is supplied by Radarr. */
  async monitoredMovies(): Promise<RadarrMonitoredMovie[]> {
    if (!this.connectionConfigured) {
      return [];
    }

    return (await this.movies()).filter((movie) => movie.monitored);
  }

  /** Reads all remote movie states. Missing connection fields yield an empty list. */
  async movies(): Promise<RadarrMonitoredMovie[]> {
    if (!this.connectionConfigured) {
      return [];
    }

    const movies = await this.get<RadarrMovie[]>('/api/v3/movie');
    return movies
      .filter((movie) => movie.id)
      .map((movie) => ({
        id: movie.id as number,
        tmdbId: movie.tmdbId ?? null,
        title: movie.title ?? 'Untitled',
        year: movie.year ?? null,
        monitored: Boolean(movie.monitored),
        hasFile: movie.hasFile ?? null,
        path: movie.path ?? null
      }))
      .sort((first, second) => first.title.localeCompare(second.title));
  }

  /** Removes the Radarr entry while explicitly retaining downloaded files. */
  async removeMovie(movieId: number): Promise<void> {
    if (!this.connectionConfigured) {
      throw new Error('Radarr URL and API key must be configured.');
    }

    await this.request(`/api/v3/movie/${movieId}?deleteFiles=false&addImportExclusion=false`, {
      method: 'DELETE'
    });
  }

  private async get<T>(path: string): Promise<T> {
    const response = await this.request(path);
    return response.json() as Promise<T>;
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    const url = `${this.settings.radarrUrl.replace(/\/$/, '')}${path}`;
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(5000),
      headers: {
        'X-Api-Key': this.settings.radarrApiKey,
        ...(init?.headers ?? {})
      }
    });

    if (!response.ok) {
      const text = await response.text();
      const message = `Radarr request failed (${response.status}): ${text.slice(0, 300)}`;
      throw new RadarrRequestError(message, response.status, text, parseRadarrValidationFailures(text));
    }

    return response;
  }
}

function parseRadarrValidationFailures(text: string): RadarrValidationFailure[] {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(
      (failure): failure is RadarrValidationFailure => typeof failure === 'object' && failure !== null
    );
  } catch {
    return [];
  }
}

function duplicateMoviePath(failures: RadarrValidationFailure[]): string | null {
  const pathFailure = failures.find(
    (failure) =>
      failure.propertyName?.toLowerCase() === 'path' &&
      failure.errorCode === 'MoviePathValidator' &&
      typeof failure.attemptedValue === 'string'
  );

  const attemptedValue = pathFailure?.attemptedValue;
  return typeof attemptedValue === 'string' ? attemptedValue.trim() || null : null;
}

function normaliseRadarrPath(path: string | undefined): string {
  return (path ?? '')
    .trim()
    .replace(/[\\/]+$/, '')
    .toLowerCase();
}
