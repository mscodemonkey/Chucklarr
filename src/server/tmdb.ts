/**
 * Adapts the configured TMDB source for server-side discovery. Each client owns
 * immutable connection configuration; scanners and film routes consume it.
 */

import type { AppSettings } from '../shared/types';

/** Search metadata used to disambiguate people before following them. */
export type TmdbPerson = {
  id: number;
  name: string;
  profile_path: string | null;
  known_for_department?: string;
  popularity?: number;
  known_for?: Array<{
    id?: number;
    title?: string;
    name?: string;
    media_type?: string;
  }>;
};

/** Movie title search evidence used by person discovery and scans. */
export type TmdbMovieSearchResult = {
  id: number;
  title: string;
  overview?: string;
  release_date?: string;
  popularity?: number;
};

/** Person profile metadata refreshed by the comedian API and scanner. */
export type TmdbPersonDetails = TmdbPerson & {
  homepage: string | null;
  place_of_birth: string | null;
};

/** A movie cast credit. Title-search scan records may omit every optional field. */
export type TmdbMovieCredit = {
  id: number;
  title: string;
  character?: string;
  release_date?: string;
  poster_path?: string | null;
  overview?: string;
  genre_ids?: number[];
  adult?: boolean;
};

/** Expanded movie evidence required by the stand-up classifier. */
export type TmdbMovieDetails = {
  id: number;
  title: string;
  overview: string;
  poster_path: string | null;
  release_date: string | null;
  runtime: number | null;
  genres: Array<{ id: number; name: string }>;
  keywords?: {
    keywords: Array<{ id: number; name: string }>;
  };
  credits?: {
    cast: Array<{
      id: number;
      name: string;
      profile_path?: string | null;
      character?: string;
    }>;
    crew?: Array<{
      id: number;
      name: string;
      profile_path?: string | null;
      job?: string;
      department?: string;
    }>;
  };
};

/**
 * Owns immutable server-only metadata connection settings for a caller operation.
 * Reads either TMDB or the configured proxy and never writes local review state.
 * Film callers may opt into a timeout; existing scanner requests are unchanged.
 */
export class TmdbClient {
  private readonly token: string;
  private readonly metadataSource: string;
  private readonly metadataServiceUrl: string;

  constructor(settings: AppSettings) {
    this.token = settings.tmdbBearerToken.trim();

    // "service" means Chucklarr talks to a metadata proxy; "tmdb" means this
    // server uses the user's bearer token directly. Metadata requests originate
    // here rather than in the browser.
    this.metadataSource = settings.metadataSource === 'tmdb' ? 'tmdb' : 'service';
    this.metadataServiceUrl = settings.metadataServiceUrl.trim().replace(/\/+$/, '');
  }

  /** Whether this client has the connection fields needed to attempt requests. */
  get configured(): boolean {
    return this.metadataSource === 'service' ? this.metadataServiceUrl.length > 0 : this.token.length > 0;
  }

  /** Returns the first person match, without making a follow decision. */
  async searchPerson(query: string): Promise<TmdbPerson | null> {
    const results = await this.searchPeople(query);
    return results[0] ?? null;
  }

  /** Searches one page of people for the disambiguation boundary. */
  async searchPeople(query: string, page = 1): Promise<TmdbPerson[]> {
    const data = await this.request<{ results: TmdbPerson[] }>(
      `/search/person?query=${encodeURIComponent(query)}&page=${encodeURIComponent(String(page))}`
    );
    return data.results ?? [];
  }

  /** Reads profile metadata without persisting it. */
  async personDetails(personId: number): Promise<TmdbPersonDetails> {
    return this.request<TmdbPersonDetails>(`/person/${personId}`);
  }

  /** Reads cast-only movie credits, excluding TV and crew-only work. */
  async personMovieCredits(personId: number, timeoutMs?: number): Promise<TmdbMovieCredit[]> {
    const data = await this.request<{ cast: TmdbMovieCredit[] }>(`/person/${personId}/movie_credits`, {
      timeoutMs
    });
    return data.cast ?? [];
  }

  /** Searches movie titles for scanner and person-ranking evidence. */
  async searchMovies(query: string): Promise<TmdbMovieSearchResult[]> {
    const data = await this.request<{ results: TmdbMovieSearchResult[] }>(
      `/search/movie?query=${encodeURIComponent(query)}`
    );
    return data.results ?? [];
  }

  /** Reads keywords and full credits with details for classification. */
  async movieDetails(movieId: number): Promise<TmdbMovieDetails> {

    // Keywords and credits are requested with movie details because the scorer
    // needs all three sets of signals for each candidate.
    return this.request<TmdbMovieDetails>(`/movie/${movieId}?append_to_response=keywords,credits`);
  }

  private async request<T>(path: string, options: { timeoutMs?: number } = {}): Promise<T> {
    if (!this.configured) {
      throw new Error('TMDB metadata source is not configured.');
    }

    const response =
      this.metadataSource === 'service'
        ? await fetch(`${this.metadataServiceUrl}/tmdb${path}`, {
            signal: options.timeoutMs ? AbortSignal.timeout(options.timeoutMs) : undefined,
            headers: {
              Accept: 'application/json',
              'X-Chucklarr-Client': 'chucklarr'
            }
          })
        : await fetch(`https://api.themoviedb.org/3${path}`, {
            signal: options.timeoutMs ? AbortSignal.timeout(options.timeoutMs) : undefined,
            headers: {
              Authorization: `Bearer ${this.token}`,
              Accept: 'application/json'
            }
          });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`TMDB request failed (${response.status}): ${text.slice(0, 200)}`);
    }

    return response.json() as Promise<T>;
  }
}
