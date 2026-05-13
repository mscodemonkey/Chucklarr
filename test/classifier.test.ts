import assert from 'node:assert/strict';
import test from 'node:test';
import { scoreStandupCandidate } from '../src/server/classifier';
import type { TmdbMovieCredit, TmdbMovieDetails } from '../src/server/tmdb';

function movieDetails(overrides: Partial<TmdbMovieDetails> = {}): TmdbMovieDetails {
  return {
    id: 100,
    title: 'Untitled',
    overview: '',
    poster_path: null,
    release_date: '2024-01-01',
    runtime: 70,
    genres: [],
    keywords: { keywords: [] },
    credits: { cast: [] },
    ...overrides
  };
}

function credit(overrides: Partial<TmdbMovieCredit> = {}): TmdbMovieCredit {
  return {
    id: 100,
    title: 'Untitled',
    character: undefined,
    release_date: '2024-01-01',
    ...overrides
  };
}

test('scores obvious stand-up specials with high confidence and useful reasons', () => {
  const result = scoreStandupCandidate(
    'Taylor Tomlinson',
    credit({
      title: 'Taylor Tomlinson: Have It All',
      character: 'Self'
    }),
    movieDetails({
      title: 'Taylor Tomlinson: Have It All',
      overview: 'A stand-up comedy special filmed live at a theatre.',
      genres: [{ id: 35, name: 'Comedy' }],
      keywords: { keywords: [{ id: 9716, name: 'stand-up comedy' }] },
      credits: { cast: [{ id: 1, name: 'Taylor Tomlinson', character: 'Self' }] }
    })
  );

  assert.equal(result.confidence, 100);
  assert.deepEqual(result.reasons, [
    'Comedy genre',
    'Stand-up language',
    'Comedian name in title',
    'Credited as self',
    'Special-length runtime'
  ]);
});

test('down-ranks documentaries and ensemble self-credit matches', () => {
  const result = scoreStandupCandidate(
    'Alex Example',
    credit({
      title: 'The Making of Funny People',
      character: 'Self'
    }),
    movieDetails({
      title: 'The Making of Funny People',
      overview: 'A documentary about animated voice work and behind the scenes material.',
      genres: [{ id: 99, name: 'Documentary' }],
      credits: {
        cast: [
          { id: 1, name: 'Alex Example', character: 'Self' },
          { id: 2, name: 'Another Comic', character: 'Self' }
        ]
      }
    })
  );

  assert.equal(result.confidence, 0);
  assert.match(result.reasons.join(', '), /Documentary genre/);
  assert.match(result.reasons.join(', '), /Multiple self credits/);
  assert.match(result.reasons.join(', '), /Possible non-special wording/);
});

test('returns a weak metadata reason when no scoring signals are present', () => {
  const result = scoreStandupCandidate(
    'Casey Quiet',
    credit({ title: 'A Very Normal Movie' }),
    movieDetails({
      title: 'A Very Normal Movie',
      overview: 'A low-key drama with no useful metadata.',
      runtime: null
    })
  );

  assert.equal(result.confidence, 0);
  assert.deepEqual(result.reasons, ['Weak metadata match']);
});

test('recognises exact-name comedy club title matches as likely specials', () => {
  const result = scoreStandupCandidate(
    'Gary Delaney',
    credit({ title: 'Gary Delaney: Comedy Club Classics 2000-2013' }),
    movieDetails({
      title: 'Gary Delaney: Comedy Club Classics 2000-2013',
      overview: 'A compilation of club material.',
      runtime: 53
    })
  );

  assert.equal(result.confidence, 75);
  assert.deepEqual(result.reasons, ['Stand-up language', 'Comedian name in title', 'Special-length runtime']);
});
