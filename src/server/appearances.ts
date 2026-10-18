/**
 * Selects other film appearances from TMDB cast credits. This stateless boundary
 * is consumed by the film API; it never changes the scanner or review database.
 */

import type { FilmAppearance } from '../shared/types';
import type { TmdbMovieCredit } from './tmdb';

const specialLanguage =
  /\b(?:stand-up|standup|stand up comedy|comedy special|one[ -]man show|one[ -]woman show)\b/i;

function text(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

function normalise(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function releaseDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}

/**
 * Keeps cast-only films outside this comedian's known specials, including ignored
 * specials. Metadata is heuristic: future scans can independently reclassify it.
 * Input order decides duplicate IDs; invalid dates become undated rather than
 * invented release dates. No title search or remote requests occur here.
 */
export function selectFilmAppearances(
  comedianName: string,
  credits: TmdbMovieCredit[],
  knownMovieIds: ReadonlySet<number>
): FilmAppearance[] {
  const seen = new Set<number>();
  const name = normalise(comedianName);
  const films: FilmAppearance[] = [];

  for (const credit of credits) {
    if (!Number.isSafeInteger(credit.id) || credit.id <= 0 || seen.has(credit.id)) continue;
    seen.add(credit.id);
    const title = text(credit.title, 500);
    const overview = text(credit.overview, 5000);
    const character = text(credit.character, 500);
    if (!title || credit.adult === true || knownMovieIds.has(credit.id)) continue;
    if (specialLanguage.test(`${title} ${overview} ${character}`)) continue;
    if (
      name.split(' ').length >= 2 &&
      /\b(?:self|himself|herself|themselves|themself)\b/i.test(character) &&
      ` ${normalise(title)} `.includes(` ${name} `)
    )
      continue;
    const poster = text(credit.poster_path, 200);
    films.push({
      tmdbMovieId: credit.id,
      title,
      overview,
      character,
      posterPath: /^\/[\w.-]+$/.test(poster) ? poster : null,
      releaseDate: releaseDate(credit.release_date)
    });
  }

  return films.sort(
    (a, b) =>
      (b.releaseDate ?? '').localeCompare(a.releaseDate ?? '') ||
      a.title.localeCompare(b.title) ||
      a.tmdbMovieId - b.tmdbMovieId
  );
}
