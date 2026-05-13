import type { CandidateStatus, ScanResult } from '../shared/types';
import { getCandidateByMovie, getComedian, getSettings, listComedians, markComedianScanned, upsertCandidate } from './db';
import { scoreStandupCandidate } from './classifier';
import { RadarrClient } from './radarr';
import { TmdbClient } from './tmdb';

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

    if (score.confidence < 35) {
      continue;
    }

    const radarrMovie = radarrMoviesByTmdbId.get(details.id);
    const alreadyInRadarr = Boolean(radarrMovie?.id);
    const existingCandidate = getCandidateByMovie(comedian.id, details.id);
    let status: CandidateStatus = alreadyInRadarr ? 'approved' : 'new';
    let radarrMovieId = radarrMovie?.id ?? null;
    let reasons = alreadyInRadarr ? [...score.reasons, 'Already in Radarr'] : score.reasons;

    if (!alreadyInRadarr && existingCandidate?.status === 'ignored') {
      status = 'ignored';
      reasons = [...reasons, 'Previously ignored'];
    }

    if (!alreadyInRadarr && existingCandidate?.status === 'rejected') {
      status = 'rejected';
      reasons = [...reasons, 'Previously rejected'];
    }

    if (!alreadyInRadarr && status === 'new' && score.confidence < hideBelowThreshold) {
      status = 'ignored';
      reasons = [...reasons, `Below ${hideBelowThreshold} hide threshold`];
    }

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
