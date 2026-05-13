import type { AppSettings } from '../shared/types';

export type TmdbPerson = {
  id: number;
  name: string;
  profile_path: string | null;
  known_for_department?: string;
  known_for?: Array<{
    title?: string;
    name?: string;
    media_type?: string;
  }>;
};

export type TmdbMovieSearchResult = {
  id: number;
  title: string;
  overview?: string;
  release_date?: string;
};

export type TmdbPersonDetails = TmdbPerson & {
  homepage: string | null;
  place_of_birth: string | null;
};

export type TmdbMovieCredit = {
  id: number;
  title: string;
  character?: string;
  release_date?: string;
};

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
      character?: string;
    }>;
  };
};

export class TmdbClient {
  private readonly token: string;
  private readonly metadataSource: string;
  private readonly metadataServiceUrl: string;

  constructor(settings: AppSettings) {
    this.token = settings.tmdbBearerToken.trim();
    // "service" means Chucklarr talks to a metadata proxy; "tmdb" means this
    // server uses the user's bearer token directly. The browser never receives
    // either credential.
    this.metadataSource = settings.metadataSource === 'tmdb' ? 'tmdb' : 'service';
    this.metadataServiceUrl = settings.metadataServiceUrl.trim().replace(/\/+$/, '');
  }

  get configured(): boolean {
    return this.metadataSource === 'service' ? this.metadataServiceUrl.length > 0 : this.token.length > 0;
  }

  async searchPerson(query: string): Promise<TmdbPerson | null> {
    const results = await this.searchPeople(query);
    return results[0] ?? null;
  }

  async searchPeople(query: string): Promise<TmdbPerson[]> {
    const data = await this.request<{ results: TmdbPerson[] }>(`/search/person?query=${encodeURIComponent(query)}`);
    return data.results ?? [];
  }

  async personDetails(personId: number): Promise<TmdbPersonDetails> {
    return this.request<TmdbPersonDetails>(`/person/${personId}`);
  }

  async personMovieCredits(personId: number): Promise<TmdbMovieCredit[]> {
    const data = await this.request<{ cast: TmdbMovieCredit[] }>(`/person/${personId}/movie_credits`);
    return data.cast ?? [];
  }

  async searchMovies(query: string): Promise<TmdbMovieSearchResult[]> {
    const data = await this.request<{ results: TmdbMovieSearchResult[] }>(`/search/movie?query=${encodeURIComponent(query)}`);
    return data.results ?? [];
  }

  async movieDetails(movieId: number): Promise<TmdbMovieDetails> {
    // Keywords and credits are requested with movie details because the scorer
    // needs all three sets of signals for each candidate.
    return this.request<TmdbMovieDetails>(`/movie/${movieId}?append_to_response=keywords,credits`);
  }

  private async request<T>(path: string): Promise<T> {
    if (!this.configured) {
      throw new Error('TMDB metadata source is not configured.');
    }

    const response =
      this.metadataSource === 'service'
        ? await fetch(`${this.metadataServiceUrl}/tmdb${path}`, {
            headers: {
              Accept: 'application/json',
              'X-Chucklarr-Client': 'chucklarr'
            }
          })
        : await fetch(`https://api.themoviedb.org/3${path}`, {
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
