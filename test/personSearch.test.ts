import test from 'node:test';
import assert from 'node:assert/strict';
import { isLikelyComedianSearchMovie, searchComedianPeople } from '../src/server/personSearch';
import type { TmdbClient, TmdbMovieDetails, TmdbPerson, TmdbPersonDetails } from '../src/server/tmdb';

test('adds stand-up movie credit people ahead of noisy person-search matches', async () => {
  const peopleByPage = new Map<number, TmdbPerson[]>([
    [
      1,
      [
        {
          id: 4475382,
          name: 'Paul Smith',
          profile_path: null,
          known_for_department: 'Acting',
          known_for: [{ title: 'The Henderson Kids' }]
        },
        {
          id: 1727672,
          name: 'Paul Smith',
          profile_path: null,
          known_for_department: 'Camera',
          known_for: [{ title: 'A Close Shave' }]
        }
      ]
    ],
    [
      3,
      [
        {
          id: 6123370,
          name: 'paul smith',
          profile_path: null,
          known_for_department: 'Acting',
          known_for: [{ title: 'Paul Smith - Following' }]
        }
      ]
    ]
  ]);
  const details = new Map<number, TmdbPersonDetails>([
    [3569901, personDetails(3569901, 'Paul Smith')],
    [4475382, personDetails(4475382, 'Paul Smith')],
    [1727672, personDetails(1727672, 'Paul Smith')],
    [6123370, personDetails(6123370, 'paul smith')]
  ]);
  const tmdb = {
    searchPeople: async (_query: string, page = 1) => peopleByPage.get(page) ?? [],
    searchMovies: async () => [
      {
        id: 1646221,
        title: 'Paul Smith: Pablo Live',
        overview: 'From one of the UK’s most viral stand-up comedians, in his debut special.'
      },
      {
        id: 363116,
        title: 'Paul Smith: Gentleman Designer',
        overview: 'A portrait of the designer and businessman.'
      }
    ],
    movieDetails: async (movieId: number) => {
      assert.equal(movieId, 1646221);
      return {
        id: 1646221,
        title: 'Paul Smith: Pablo Live',
        overview: 'From one of the UK’s most viral stand-up comedians, in his debut special.',
        poster_path: null,
        release_date: '2026-04-17',
        runtime: 60,
        genres: [{ id: 35, name: 'Comedy' }],
        credits: {
          cast: [{ id: 3569901, name: 'Paul Smith', profile_path: null, character: 'Self' }],
          crew: [{ id: 3569901, name: 'Paul Smith', profile_path: null, job: 'Writer' }]
        }
      } satisfies TmdbMovieDetails;
    },
    personDetails: async (personId: number) => details.get(personId) ?? personDetails(personId, 'Paul Smith')
  } as unknown as TmdbClient;

  const results = await searchComedianPeople(tmdb, 'Paul Smith');

  assert.equal(results[0].tmdbPersonId, 3569901);
  assert.deepEqual(results[0].knownFor, ['Paul Smith: Pablo Live']);
  assert.deepEqual(results[0].matchReasons, ['Stand-up title match']);
});

test('recognises comedy title evidence without matching non-comedy namesakes', () => {
  assert.equal(
    isLikelyComedianSearchMovie(
      {
        id: 1646221,
        title: 'Paul Smith: Pablo Live',
        overview: 'A filmed stand-up comedy special.'
      },
      'Paul Smith'
    ),
    true
  );
  assert.equal(
    isLikelyComedianSearchMovie(
      {
        id: 363116,
        title: 'Paul Smith: Gentleman Designer',
        overview: 'An intimate portrait of a fashion designer.'
      },
      'Paul Smith'
    ),
    false
  );
});

function personDetails(id: number, name: string): TmdbPersonDetails {
  return {
    id,
    name,
    profile_path: null,
    known_for_department: 'Acting',
    known_for: [],
    homepage: null,
    place_of_birth: null
  };
}
