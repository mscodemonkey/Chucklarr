import assert from 'node:assert/strict';
import test from 'node:test';
import { originFromPlaceOfBirth } from '../src/server/origin';

test('maps country aliases from the final place-of-birth component', () => {
  assert.deepEqual(originFromPlaceOfBirth('Sydney, New South Wales, Australia'), {
    countryCode: 'AU',
    countryName: 'Australia'
  });
  assert.deepEqual(originFromPlaceOfBirth('Cardiff, Wales'), {
    countryCode: 'GB',
    countryName: 'United Kingdom'
  });
});

test('treats US state abbreviations as United States origins', () => {
  assert.deepEqual(originFromPlaceOfBirth('Boston, MA'), {
    countryCode: 'US',
    countryName: 'United States'
  });
});

test('returns null origin values when the country cannot be inferred', () => {
  assert.deepEqual(originFromPlaceOfBirth(null), {
    countryCode: null,
    countryName: null
  });
  assert.deepEqual(originFromPlaceOfBirth('Unknown filming location'), {
    countryCode: null,
    countryName: null
  });
});
