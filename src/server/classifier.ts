import type { TmdbMovieCredit, TmdbMovieDetails } from './tmdb';

// TMDB does not have a clean "stand-up special" media type. These phrases are
// the strongest text signals we have across titles, overviews, characters,
// genres, and keywords.
const positivePhrases = [
  'stand-up',
  'standup',
  'stand up',
  'comedy special',
  'comedy club',
  'one-man show',
  'one woman show',
  'full show',
  'live at',
  'live from',
  'on stage',
  'special'
];

// These words often appear on credits for comedy-adjacent material where the
// comedian appears, but the movie is probably not a traditional special.
const negativePhrases = [
  'documentary about',
  'biopic',
  'animated',
  'voice',
  'short film',
  'behind the scenes'
];

/**
 * Scores one TMDB movie credit as a possible stand-up special.
 *
 * The score is intentionally heuristic rather than absolute. Public movie
 * metadata is inconsistent: a special might be a "movie", a "documentary", a
 * live show, or just a self credit. Each signal nudges the confidence up or
 * down, and the scanner decides how much confidence is enough to save, hide, or
 * auto-add the candidate.
 */
export function scoreStandupCandidate(
  comedianName: string,
  credit: TmdbMovieCredit,
  details: TmdbMovieDetails
): { confidence: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  // A single lowercase search surface keeps the phrase checks easy to audit and
  // lets contributors add new TMDB fields later without changing every rule.
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
  // Short name fragments like "de" or "jo" create noisy title matches, so only
  // meaningful tokens are allowed to influence the score.
  const comedianTokens = comedianName.toLowerCase().split(/\s+/).filter((token) => token.length > 2);
  const normalizedTitle = normalizeSearchText(details.title);
  const normalizedComedianName = normalizeSearchText(comedianName);

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

  if (normalizedComedianName && normalizedTitle.includes(normalizedComedianName)) {
    score += 30;
    reasons.push('Comedian name in title');
  } else if (comedianTokens.some((token) => title.includes(token))) {
    score += 20;
    reasons.push('Partial comedian name in title');
  }

  if ((credit.character ?? '').toLowerCase().includes('self')) {
    score += 15;
    reasons.push('Credited as self');
  }

  // Stand-up specials usually have one primary self credit. Ensemble
  // documentaries, galas, and behind-the-scenes projects tend to have many.
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

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
