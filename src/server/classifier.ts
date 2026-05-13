import type { TmdbMovieCredit, TmdbMovieDetails } from './tmdb';

const positivePhrases = [
  'stand-up',
  'standup',
  'stand up',
  'comedy special',
  'one-man show',
  'one woman show',
  'live at',
  'live from',
  'on stage',
  'special'
];

const negativePhrases = [
  'documentary about',
  'biopic',
  'animated',
  'voice',
  'short film',
  'behind the scenes'
];

export function scoreStandupCandidate(
  comedianName: string,
  credit: TmdbMovieCredit,
  details: TmdbMovieDetails
): { confidence: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const haystack = [
    details.title,
    details.overview,
    credit.character ?? '',
    ...details.genres.map((genre) => genre.name),
    ...(details.keywords?.keywords.map((keyword) => keyword.name) ?? [])
  ]
    .join(' ')
    .toLowerCase();
  const title = details.title.toLowerCase();
  const comedianTokens = comedianName.toLowerCase().split(/\s+/).filter((token) => token.length > 2);

  if (details.genres.some((genre) => genre.name.toLowerCase() === 'comedy')) {
    score += 20;
    reasons.push('Comedy genre');
  }

  if (details.genres.some((genre) => genre.name.toLowerCase() === 'documentary')) {
    score += 8;
    reasons.push('Documentary genre');
  }

  if (positivePhrases.some((phrase) => haystack.includes(phrase))) {
    score += 35;
    reasons.push('Stand-up language');
  }

  if (comedianTokens.some((token) => title.includes(token))) {
    score += 20;
    reasons.push('Comedian name in title');
  }

  if ((credit.character ?? '').toLowerCase().includes('self')) {
    score += 15;
    reasons.push('Credited as self');
  }

  const selfCreditCount =
    details.credits?.cast.filter((castMember) => (castMember.character ?? '').toLowerCase().includes('self')).length ?? 0;

  if (selfCreditCount > 1) {
    score -= 25;
    reasons.push('Multiple self credits');
  }

  if (details.runtime && details.runtime >= 35 && details.runtime <= 130) {
    score += 10;
    reasons.push('Special-length runtime');
  }

  if (negativePhrases.some((phrase) => haystack.includes(phrase))) {
    score -= 20;
    reasons.push('Possible non-special wording');
  }

  if (!details.release_date) {
    score -= 5;
    reasons.push('No release date');
  }

  return {
    confidence: Math.max(0, Math.min(100, score)),
    reasons: reasons.length > 0 ? reasons : ['Weak metadata match']
  };
}
