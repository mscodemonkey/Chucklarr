/**
 * Verifies how the updater identifies the application files in the current
 * container. These tests own no filesystem or network state.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { normaliseCommitSha, resolveCurrentSha } from '../src/server/updateVersion';

const imageSha = '1111111111111111111111111111111111111111';
const installedSha = '2222222222222222222222222222222222222222';

test('the application build marker identifies the running code', () => {
  assert.equal(resolveCurrentSha(installedSha, imageSha), installedSha);
});

test('a recreated container reports the image build marker', () => {
  assert.equal(resolveCurrentSha(imageSha, installedSha), imageSha);
});

test('the configured build reference is used when the marker is unavailable', () => {
  assert.equal(resolveCurrentSha(undefined, imageSha), imageSha);
});

test('invalid build references are rejected', () => {
  assert.equal(normaliseCommitSha('local'), null);
  assert.equal(resolveCurrentSha('local', ''), null);
});
