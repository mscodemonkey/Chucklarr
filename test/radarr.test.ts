import assert from 'node:assert/strict';
import test from 'node:test';
import { RadarrClient } from '../src/server/radarr';
import type { AppSettings, Candidate } from '../src/shared/types';

const settings: AppSettings = {
  language: 'en-GB',
  theme: 'system',
  metadataSource: 'service',
  metadataServiceUrl: 'https://example.test',
  tmdbBearerToken: '',
  radarrUrl: 'http://radarr.test',
  radarrApiKey: 'radarr-key',
  radarrQualityProfileId: '1',
  radarrRootFolderPath: '/standup',
  radarrMinimumAvailability: 'released',
  autoAddConfidenceThreshold: '95',
  hideBelowConfidenceThreshold: '60',
  automaticDailyScanTime: '',
  automaticDailyScanLastRunDate: ''
};

const candidate: Candidate = {
  id: 7,
  comedianId: 3,
  comedianName: 'Matt Rife',
  tmdbMovieId: 1567881,
  title: 'Matt Rife: Walking Red Flag',
  year: 2023,
  overview: '',
  posterPath: null,
  releaseDate: '2023-01-01',
  confidence: 95,
  reasons: [],
  status: 'new',
  radarrMovieId: null,
  createdAt: '',
  updatedAt: ''
};

test('addMovie monitors an existing Radarr movie matched by TMDB id', async () => {
  const calls: Array<{ method: string; url: string; body?: unknown }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    calls.push({ method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(String(init.body)) : undefined });

    if (url === 'http://radarr.test/api/v3/movie' && !init?.method) {
      return jsonResponse([{ id: 42, title: candidate.title, tmdbId: candidate.tmdbMovieId, monitored: false }]);
    }

    if (url === 'http://radarr.test/api/v3/movie/42' && !init?.method) {
      return jsonResponse({ id: 42, title: candidate.title, tmdbId: candidate.tmdbMovieId, monitored: false });
    }

    if (url === 'http://radarr.test/api/v3/movie/42' && init?.method === 'PUT') {
      return jsonResponse({ id: 42, title: candidate.title, tmdbId: candidate.tmdbMovieId, monitored: true });
    }

    throw new Error(`Unexpected fetch ${init?.method ?? 'GET'} ${url}`);
  }) as typeof fetch;

  try {
    const movie = await new RadarrClient(settings).addMovie(candidate);
    assert.equal(movie.id, 42);
    assert.equal(movie.monitored, true);
    assert.equal(calls.some((call) => call.method === 'POST'), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('addMovie recovers from Radarr duplicate-path validation by monitoring the existing movie', async () => {
  const calls: Array<{ method: string; url: string; body?: unknown }> = [];
  const duplicatePath = '/standup/Matt Rife - Walking Red Flag (2023)';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    calls.push({ method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(String(init.body)) : undefined });

    if (url === 'http://radarr.test/api/v3/movie' && !init?.method) {
      return jsonResponse(
        calls.filter((call) => call.url === url && call.method === 'GET').length === 1
          ? []
          : [{ id: 84, title: candidate.title, tmdbId: null, path: duplicatePath, monitored: false }]
      );
    }

    if (url === 'http://radarr.test/api/v3/movie' && init?.method === 'POST') {
      return jsonResponse(
        [
          {
            propertyName: 'Path',
            errorMessage: `Path '${duplicatePath}' is already configured for an existing movie`,
            attemptedValue: duplicatePath,
            severity: 'error',
            errorCode: 'MoviePathValidator'
          }
        ],
        400
      );
    }

    if (url === 'http://radarr.test/api/v3/movie/84' && !init?.method) {
      return jsonResponse({ id: 84, title: candidate.title, tmdbId: null, path: duplicatePath, monitored: false });
    }

    if (url === 'http://radarr.test/api/v3/movie/84' && init?.method === 'PUT') {
      return jsonResponse({ id: 84, title: candidate.title, tmdbId: null, path: duplicatePath, monitored: true });
    }

    throw new Error(`Unexpected fetch ${init?.method ?? 'GET'} ${url}`);
  }) as typeof fetch;

  try {
    const movie = await new RadarrClient(settings).addMovie(candidate);
    assert.equal(movie.id, 84);
    assert.equal(movie.monitored, true);
    assert.equal(calls.filter((call) => call.method === 'POST').length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json'
    }
  });
}
