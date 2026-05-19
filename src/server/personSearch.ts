import { originFromPlaceOfBirth } from './origin';
import { TmdbClient, type TmdbMovieDetails, type TmdbMovieSearchResult, type TmdbPerson } from './tmdb';
import type { PersonSearchResult } from '../shared/types';

const maxPersonSearchPages = 3;
const searchResultLimit = 8;
const titleEvidenceLimit = 8;

const comedianTitleSignals = [
  'stand-up',
  'stand up',
  'standup',
  'comedian',
  'comedy special',
  'comedy',
  'live at',
  'live from',
  'tour',
  'audience',
  'crowd work',
  'crowdwork'
];

type RankedPerson = {
  person: TmdbPerson;
  index: number;
  evidenceTitles: string[];
  matchReasons: string[];
  score: number;
};

type TitleEvidencePerson = {
  person: TmdbPerson;
  evidenceTitle: string;
};

export async function searchComedianPeople(tmdb: TmdbClient, query: string): Promise<PersonSearchResult[]> {
  const [people, titleEvidencePeople] = await Promise.all([loadPersonSearchPages(tmdb, query), loadTitleEvidencePeople(tmdb, query)]);
  const rankedPeople = rankComedianSearchCandidates(mergeSearchPeople(people, titleEvidencePeople), query).slice(0, searchResultLimit);

  return Promise.all(
    rankedPeople.map(async (ranked) => {
      const details = await tmdb.personDetails(ranked.person.id).catch(() => null);
      const origin = originFromPlaceOfBirth(details?.place_of_birth ?? null);
      const knownFor = uniqueStrings([
        ...ranked.evidenceTitles,
        ...((ranked.person.known_for ?? []).map((knownFor) => knownFor.title ?? knownFor.name ?? '').filter(Boolean) as string[])
      ]).slice(0, 3);

      return {
        tmdbPersonId: ranked.person.id,
        name: details?.name ?? ranked.person.name,
        profilePath: details?.profile_path ?? ranked.person.profile_path,
        knownForDepartment: ranked.person.known_for_department ?? details?.known_for_department ?? null,
        placeOfBirth: details?.place_of_birth ?? null,
        countryCode: origin.countryCode,
        countryName: origin.countryName,
        knownFor,
        matchReasons: ranked.matchReasons
      };
    })
  );
}

async function loadPersonSearchPages(tmdb: TmdbClient, query: string): Promise<TmdbPerson[]> {
  const firstPage = await tmdb.searchPeople(query, 1);
  const extraPages = await Promise.all(
    Array.from({ length: maxPersonSearchPages - 1 }, (_, index) => tmdb.searchPeople(query, index + 2).catch(() => []))
  );
  return [firstPage, ...extraPages].flat();
}

async function loadTitleEvidencePeople(tmdb: TmdbClient, query: string): Promise<TitleEvidencePerson[]> {
  const movies = await tmdb.searchMovies(query).catch(() => []);
  const likelyComedianMovies = movies.filter((movie) => isLikelyComedianSearchMovie(movie, query)).slice(0, titleEvidenceLimit);
  const details = await Promise.all(likelyComedianMovies.map((movie) => tmdb.movieDetails(movie.id).catch(() => null)));
  return details.flatMap((movie) => (movie ? peopleFromComedianMovie(movie, query) : []));
}

function peopleFromComedianMovie(movie: TmdbMovieDetails, query: string): TitleEvidencePerson[] {
  const normalizedQuery = normalizeSearchText(query);
  const creditedPeople = [...(movie.credits?.cast ?? []), ...(movie.credits?.crew ?? [])];
  const matchingPeople = creditedPeople.filter((person) => normalizeSearchText(person.name) === normalizedQuery);

  return uniqueBy(
    matchingPeople.map((person) => ({
      person: {
        id: person.id,
        name: person.name,
        profile_path: person.profile_path ?? null,
        known_for_department: 'character' in person ? 'Acting' : undefined
      },
      evidenceTitle: movie.title
    })),
    (match) => match.person.id
  );
}

function mergeSearchPeople(people: TmdbPerson[], titleEvidencePeople: TitleEvidencePerson[]): RankedPerson[] {
  const merged = new Map<number, RankedPerson>();

  for (const [index, person] of people.entries()) {
    merged.set(person.id, {
      person,
      index,
      evidenceTitles: [],
      matchReasons: [],
      score: 0
    });
  }

  for (const match of titleEvidencePeople) {
    const existing = merged.get(match.person.id);
    if (existing) {
      existing.person = {
        ...existing.person,
        profile_path: existing.person.profile_path ?? match.person.profile_path,
        known_for_department: existing.person.known_for_department ?? match.person.known_for_department
      };
      existing.evidenceTitles = uniqueStrings([...existing.evidenceTitles, match.evidenceTitle]);
      existing.matchReasons = uniqueStrings([...existing.matchReasons, 'Stand-up title match']);
    } else {
      merged.set(match.person.id, {
        person: match.person,
        index: people.length + merged.size,
        evidenceTitles: [match.evidenceTitle],
        matchReasons: ['Stand-up title match'],
        score: 0
      });
    }
  }

  return Array.from(merged.values());
}

export function rankComedianSearchCandidates(candidates: RankedPerson[], query: string): RankedPerson[] {
  const normalizedQuery = normalizeSearchText(query);

  return candidates
    .map((candidate) => {
      const normalizedName = normalizeSearchText(candidate.person.name);
      const knownForTitles = (candidate.person.known_for ?? []).map((knownFor) => knownFor.title ?? knownFor.name ?? '').filter(Boolean);
      const knownForSurface = knownForTitles.map(normalizeSearchText).join(' ');
      const evidenceSurface = candidate.evidenceTitles.map(normalizeSearchText).join(' ');
      const matchReasons = [...candidate.matchReasons];
      let score = 0;

      if (normalizedName === normalizedQuery) score += 80;
      else if (nameContainsAllQueryTokens(normalizedName, normalizedQuery)) score += 20;

      if (candidate.person.known_for_department === 'Acting') score += 20;
      if (candidate.evidenceTitles.length > 0) score += 160 + candidate.evidenceTitles.length * 30;

      if (evidenceSurface.includes(normalizedQuery)) {
        score += 50;
      }

      if (knownForSurface.includes(normalizedQuery)) {
        if (hasComedySignal(knownForSurface)) {
          score += 60;
          if (!matchReasons.includes('Comedy known-for title')) {
            matchReasons.push('Comedy known-for title');
          }
        } else {
          score += 25;
        }
      }

      return {
        ...candidate,
        matchReasons,
        score
      };
    })
    .sort((first, second) => second.score - first.score || first.index - second.index);
}

export function isLikelyComedianSearchMovie(movie: TmdbMovieSearchResult, query: string): boolean {
  const normalizedQuery = normalizeSearchText(query);
  const title = normalizeSearchText(movie.title);
  const overview = normalizeSearchText(movie.overview ?? '');

  return title.includes(normalizedQuery) && hasComedySignal(`${title} ${overview}`);
}

function hasComedySignal(surface: string): boolean {
  return comedianTitleSignals.some((signal) => surface.includes(normalizeSearchText(signal)));
}

function nameContainsAllQueryTokens(name: string, query: string): boolean {
  const nameTokens = new Set(name.split(' ').filter(Boolean));
  return query
    .split(' ')
    .filter((token) => token.length > 1)
    .every((token) => nameTokens.has(token));
}

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function uniqueBy<T>(values: T[], keyFor: (value: T) => string | number): T[] {
  const seen = new Set<string | number>();
  return values.filter((value) => {
    const key = keyFor(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
