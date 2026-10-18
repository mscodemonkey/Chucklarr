/**
 * Selects upcoming specials for the browser's discovery view. React owns the
 * clock and source records; these pure helpers never fetch or persist data.
 */

import type { Candidate } from '../../shared/types';

/** Uses the viewer's local calendar day, without shifting it through UTC. */
export function localCalendarDate(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Rejects incomplete and calendar-invalid metadata dates, including rollover. */
export function isReleaseDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Radarr membership alone does not establish a meaningful comedian credit. */
export function isWeakRadarrOnlyMatch(candidate: Candidate): boolean {
  return (
    candidate.status === 'approved' &&
    candidate.reasons.includes('Already in Radarr') &&
    !candidate.reasons.some((reason) => reason === 'Comedian name in title' || reason === 'Credited as self')
  );
}

/**
 * Finds strictly future, non-dismissed specials. Shared specials use the highest
 * confidence record for actions and combine comedian names for display. Dates
 * describe TMDB releases, not when Radarr can download a file.
 */
export function upcomingSpecials(candidates: Candidate[], today: string): Candidate[] {
  const movies = new Map<number, { candidate: Candidate; names: Set<string> }>();

  for (const candidate of candidates) {
    if (candidate.status === 'ignored' || candidate.status === 'rejected' || isWeakRadarrOnlyMatch(candidate))
      continue;
    if (!isReleaseDate(candidate.releaseDate) || candidate.releaseDate <= today) continue;
    const existing = movies.get(candidate.tmdbMovieId);
    if (!existing) {
      movies.set(candidate.tmdbMovieId, { candidate, names: new Set([candidate.comedianName]) });
    } else {
      existing.names.add(candidate.comedianName);
      if (
        candidate.confidence > existing.candidate.confidence ||
        (candidate.confidence === existing.candidate.confidence && candidate.id < existing.candidate.id)
      )
        existing.candidate = candidate;
    }
  }

  return [...movies.values()]
    .map(({ candidate, names }) => ({ ...candidate, comedianName: [...names].sort().join(', ') }))
    .sort(
      (a, b) =>
        a.releaseDate!.localeCompare(b.releaseDate!) ||
        a.title.localeCompare(b.title) ||
        a.tmdbMovieId - b.tmdbMovieId
    );
}
