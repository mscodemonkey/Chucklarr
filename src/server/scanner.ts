import type { CandidateStatus, ScanResult } from '../shared/types';
import { getCandidateByMovie, getComedian, getSettings, listComedians, markComedianScanned, upsertCandidate } from './db';
import { scoreStandupCandidate } from './classifier';
import { RadarrClient } from './radarr';
import { TmdbClient } from './tmdb';

/**
 * Scan one comedian's TMDB movie credits and persist the likely stand-up
 * candidates.
 *
 * The scanner is the policy layer that sits between raw metadata and local
 * review state. It asks TMDB for credits, scores each movie, checks Radarr for
 * existing library matches, preserves prior user decisions, and optionally
 * auto-adds high-confidence specials.
 */
export async function scanComedian(comedianId: number): Promise<ScanResult> {
  const comedian = getComedian(comedianId);
  if (!comedian) {
    throw new Error('Comedian not found.');
  }

  if (!comedian.tmdbPersonId) {
    throw new Error(`${comedian.name} does not have a TMDB person id.`);
  }

  const settings = getSettings();
  const tmdb = new TmdbClient(settings);
  const radarr = new RadarrClient(settings);
  const radarrMoviesByTmdbId = await loadRadarrMovieIndex(radarr);
  const autoAddThreshold = confidenceThreshold(settings.autoAddConfidenceThreshold, 95);
  const hideBelowThreshold = confidenceThreshold(settings.hideBelowConfidenceThreshold, 60);
  const credits = await tmdb.personMovieCredits(comedian.tmdbPersonId);
  const saved = [];

  for (const credit of credits) {
    const details = await tmdb.movieDetails(credit.id);
    const score = scoreStandupCandidate(comedian.name, credit, details);

    // Very weak matches are not saved at all. This keeps noisy credits out of
    // the local database while still allowing borderline matches to be reviewed
    // or auto-hidden according to the configured threshold.
    if (score.confidence < 35) {
      continue;
    }

    const radarrMovie = radarrMoviesByTmdbId.get(details.id);
    const alreadyInRadarr = Boolean(radarrMovie?.id);
    const existingCandidate = getCandidateByMovie(comedian.id, details.id);
    let status: CandidateStatus = alreadyInRadarr ? 'approved' : 'new';
    let radarrMovieId = radarrMovie?.id ?? null;
    let reasons = alreadyInRadarr ? [...score.reasons, 'Already in Radarr'] : score.reasons;

    // Manual review decisions are sticky across rescans. TMDB metadata can
    // improve over time, but a user who ignored or rejected a title should not
    // have to dismiss the same candidate again unless Radarr now owns it.
    if (!alreadyInRadarr && existingCandidate?.status === 'ignored') {
      status = 'ignored';
      reasons = [...reasons, 'Previously ignored'];
    }

    if (!alreadyInRadarr && existingCandidate?.status === 'rejected') {
      status = 'rejected';
      reasons = [...reasons, 'Previously rejected'];
    }

    // Auto-ignore happens after sticky decisions are applied. It only affects
    // fresh candidates, which means contributors can tune the threshold without
    // rewriting historical user choices.
    if (!alreadyInRadarr && status === 'new' && score.confidence < hideBelowThreshold) {
      status = 'ignored';
      reasons = [...reasons, `Below ${hideBelowThreshold} hide threshold`];
    }

    // Auto-add is deliberately gated by both confidence and complete Radarr
    // configuration. If Radarr is only partially set up, the candidate remains
    // reviewable instead of failing the scan.
    if (!alreadyInRadarr && status === 'new' && score.confidence >= autoAddThreshold && radarr.configured) {
      try {
        const addedMovie = await radarr.addMovie({
          id: 0,
          comedianId: comedian.id,
          comedianName: comedian.name,
          tmdbMovieId: details.id,
          title: details.title,
          year: details.release_date ? Number(details.release_date.slice(0, 4)) : null,
          overview: details.overview ?? '',
          posterPath: details.poster_path,
          releaseDate: details.release_date,
          confidence: score.confidence,
          reasons,
          status: 'new',
          radarrMovieId: null,
          createdAt: '',
          updatedAt: ''
        });
        status = 'auto_added';
        radarrMovieId = addedMovie.id ?? null;
        reasons = [...reasons, `Auto-added at ${autoAddThreshold}+ confidence`];
      } catch (caught) {
        reasons = [...reasons, 'Auto-add failed'];
        console.warn(caught instanceof Error ? `Radarr auto-add failed: ${caught.message}` : 'Radarr auto-add failed.');
      }
    }

    saved.push(
      upsertCandidate({
        comedianId: comedian.id,
        tmdbMovieId: details.id,
        title: details.title,
        year: details.release_date ? Number(details.release_date.slice(0, 4)) : null,
        overview: details.overview ?? '',
        posterPath: details.poster_path,
        releaseDate: details.release_date,
        confidence: score.confidence,
        reasons,
        status,
        radarrMovieId
      })
    );
  }

  markComedianScanned(comedian.id);

  return {
    comedian: getComedian(comedian.id) ?? comedian,
    found: credits.length,
    saved: saved.length,
    candidates: saved
  };
}

function confidenceThreshold(value: string, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(0, Math.min(100, Math.round(parsed)));
}

async function loadRadarrMovieIndex(radarr: RadarrClient) {
  try {
    return await radarr.existingMoviesByTmdbId();
  } catch (caught) {
    // A Radarr outage should not block TMDB discovery. The scan can still save
    // candidates; they simply will not be marked as already present this time.
    console.warn(caught instanceof Error ? `Radarr library check skipped: ${caught.message}` : 'Radarr library check skipped.');
    return new Map<number, { id?: number; tmdbId?: number }>();
  }
}

export async function scanAllComedians(): Promise<ScanResult[]> {
  const results: ScanResult[] = [];

  for (const comedian of listComedians()) {
    if (comedian.tmdbPersonId) {
      results.push(await scanComedian(comedian.id));
    }
  }

  return results;
}
