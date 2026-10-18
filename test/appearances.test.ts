/**
 * Verifies cast-only film selection with synthetic metadata. Tests own fixtures;
 * neither remote services nor the persisted specials database are touched.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { selectFilmAppearances } from '../src/server/appearances';
import type { TmdbMovieCredit } from '../src/server/tmdb';

const film = (id: number, extra: Partial<TmdbMovieCredit> = {}): TmdbMovieCredit => ({
  id,
  title: `Film ${id}`,
  character: 'A friend',
  release_date: '2026-01-01',
  ...extra
});

test('film selection excludes known specials, explicit stand-up, adult and invalid records', () => {
  const results = selectFilmAppearances(
    'Avery Comic',
    [
      film(1),
      film(2, { overview: 'A stand-up comedy special.' }),
      film(3, { adult: true }),
      film(4, { title: ' ' }),
      film(-1),
      film(NaN),
      film(1.2),
      film(5, { title: 'Avery Comic: Live', character: 'Self' }),
      film(6, { overview: 'A one-woman show.' }),
      film(7),
      film(8, { title: 'Avery Comic Live', character: 'Himself' })
    ],
    new Set([1])
  );
  assert.deepEqual(
    results.map((item) => item.tmdbMovieId),
    [7]
  );
});

test('film selection keeps film roles, special forces and unrelated self credits', () => {
  const results = selectFilmAppearances(
    'Avery Comic',
    [
      film(1, {
        overview: 'Special forces live at the base, on stage for a concert. They stand up to corruption.',
        character: 'Agent (voice)'
      }),
      film(2, { character: 'Self (archive footage)' }),
      film(3, { character: 'Guest cameo' })
    ],
    new Set()
  );
  assert.deepEqual(
    results.map((item) => item.character),
    ['Agent (voice)', 'Self (archive footage)', 'Guest cameo']
  );
});

test('film selection deduplicates before sorting dates and sanitises untrusted fields', () => {
  const results = selectFilmAppearances(
    'Avery Comic',
    [
      film(2, { title: 'Zebra', release_date: '2026-02-30', poster_path: '//other.test/img' }),
      film(3, { title: 'Alpha', release_date: '', poster_path: '/poster.jpg' }),
      film(1, { title: '  First  ', release_date: '2027-01-01', poster_path: '/../../x' }),
      film(1, { title: 'Wrong duplicate', release_date: '2028-01-01' }),
      film(4, { title: 4 as unknown as string }),
      film(5, {
        title: 'B'.repeat(600),
        overview: 'o'.repeat(6000),
        release_date: undefined,
        character: null as unknown as string
      })
    ],
    new Set()
  );
  assert.deepEqual(
    results.map((item) => item.tmdbMovieId),
    [1, 3, 5, 2]
  );
  assert.equal(results[0].title, 'First');
  assert.equal(results[0].posterPath, null);
  assert.equal(results[1].posterPath, '/poster.jpg');
  assert.equal(results[2].title.length, 500);
  assert.equal(results[2].overview.length, 5000);
  assert.equal(results[2].character, '');
  assert.equal(results[3].releaseDate, null);
});

test('film timeout is opt-in and does not change ordinary scanner requests', async () => {
  const { TmdbClient } = await import('../src/server/tmdb');
  const signals: Array<AbortSignal | null | undefined> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (_input, init) => {
    signals.push(init?.signal);
    return new Response(JSON.stringify({ cast: [], id: 1 }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }) as typeof fetch;
  try {
    const client = new TmdbClient({
      metadataSource: 'service',
      metadataServiceUrl: 'https://metadata.test',
      tmdbBearerToken: ''
    } as import('../src/shared/types').AppSettings);
    await client.personMovieCredits(1);
    await client.movieDetails(1);
    await client.personMovieCredits(1, 10_000);
    assert.equal(signals[0], undefined);
    assert.equal(signals[1], undefined);
    assert.ok(signals[2] instanceof AbortSignal);
  } finally {
    globalThis.fetch = original;
  }
});
