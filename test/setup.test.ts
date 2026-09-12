/**
 * Verifies the client-side first-run boundary without mounting the React UI.
 * Test data owns no external state and exercises only persisted-versus-draft
 * setup decisions.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { AppSettings } from '../src/shared/types';
import { isSetupComplete, shouldShowSettings } from '../src/client/src/setup';

const completeSettings: AppSettings = {
  language: 'en-GB',
  theme: 'system',
  metadataSource: 'service',
  metadataServiceUrl: 'https://metadata.example.com',
  tmdbBearerToken: '',
  radarrUrl: 'http://radarr:7878',
  radarrApiKey: 'radarr-api-key',
  radarrQualityProfileId: '1',
  radarrRootFolderPath: '/movies',
  radarrMinimumAvailability: 'released',
  autoAddConfidenceThreshold: '95',
  hideBelowConfidenceThreshold: '60',
  automaticDailyScanTime: '',
  automaticDailyScanLastRunDate: ''
};

test('setup remains visible until complete settings have been persisted', () => {
  assert.equal(isSetupComplete(completeSettings), true);
  assert.equal(shouldShowSettings(true, false, null), true);
  assert.equal(shouldShowSettings(true, false, completeSettings), false);
});

test('explicitly opening settings overrides persisted setup completion', () => {
  assert.equal(shouldShowSettings(true, true, completeSettings), true);
});

test('an incomplete persisted setup cannot open the library', () => {
  const incompleteSettings = { ...completeSettings, radarrRootFolderPath: '' };

  assert.equal(isSetupComplete(incompleteSettings), false);
  assert.equal(shouldShowSettings(true, false, incompleteSettings), true);
});
