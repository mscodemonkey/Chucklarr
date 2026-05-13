// TMDB place_of_birth values are free text, usually "City, Region, Country".
// The aliases below cover the common country names and UK constituent countries
// that appear in comedian records.
const countryAliases = new Map<string, { code: string; name: string }>([
  ['australia', { code: 'AU', name: 'Australia' }],
  ['canada', { code: 'CA', name: 'Canada' }],
  ['denmark', { code: 'DK', name: 'Denmark' }],
  ['england', { code: 'GB', name: 'United Kingdom' }],
  ['finland', { code: 'FI', name: 'Finland' }],
  ['france', { code: 'FR', name: 'France' }],
  ['germany', { code: 'DE', name: 'Germany' }],
  ['india', { code: 'IN', name: 'India' }],
  ['ireland', { code: 'IE', name: 'Ireland' }],
  ['japan', { code: 'JP', name: 'Japan' }],
  ['netherlands', { code: 'NL', name: 'Netherlands' }],
  ['new zealand', { code: 'NZ', name: 'New Zealand' }],
  ['norway', { code: 'NO', name: 'Norway' }],
  ['northern ireland', { code: 'GB', name: 'United Kingdom' }],
  ['scotland', { code: 'GB', name: 'United Kingdom' }],
  ['south africa', { code: 'ZA', name: 'South Africa' }],
  ['sweden', { code: 'SE', name: 'Sweden' }],
  ['united kingdom', { code: 'GB', name: 'United Kingdom' }],
  ['uk', { code: 'GB', name: 'United Kingdom' }],
  ['united states', { code: 'US', name: 'United States' }],
  ['united states of america', { code: 'US', name: 'United States' }],
  ['usa', { code: 'US', name: 'United States' }],
  ['u.s.', { code: 'US', name: 'United States' }],
  ['u.s.a.', { code: 'US', name: 'United States' }],
  ['wales', { code: 'GB', name: 'United Kingdom' }]
]);

// TMDB often ends US birthplaces with a state abbreviation instead of
// "United States", so the origin parser treats those abbreviations as US.
const stateCodes = new Set([
  'al', 'ak', 'az', 'ar', 'ca', 'co', 'ct', 'de', 'fl', 'ga', 'hi', 'id', 'il', 'in', 'ia', 'ks', 'ky', 'la', 'me',
  'md', 'ma', 'mi', 'mn', 'ms', 'mo', 'mt', 'ne', 'nv', 'nh', 'nj', 'nm', 'ny', 'nc', 'nd', 'oh', 'ok', 'or', 'pa',
  'ri', 'sc', 'sd', 'tn', 'tx', 'ut', 'vt', 'va', 'wa', 'wv', 'wi', 'wy'
]);

export function originFromPlaceOfBirth(placeOfBirth: string | null): {
  countryCode: string | null;
  countryName: string | null;
} {
  if (!placeOfBirth) {
    return { countryCode: null, countryName: null };
  }

  const parts = placeOfBirth
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  // Work from the right because the country is normally the last component.
  // This also lets "Boston, MA" resolve through the US state fallback.
  for (const part of [...parts].reverse()) {
    const normalized = part.toLowerCase().replace(/\.$/, '');
    const alias = countryAliases.get(normalized);
    if (alias) {
      return { countryCode: alias.code, countryName: alias.name };
    }

    if (stateCodes.has(normalized)) {
      return { countryCode: 'US', countryName: 'United States' };
    }
  }

  return { countryCode: null, countryName: null };
}
