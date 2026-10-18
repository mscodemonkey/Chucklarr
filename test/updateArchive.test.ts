/**
 * Verifies pinned archive requests using a temporary updater root and mocked HTTP.
 * Downloads deliberately fail before extraction, builds or replacement can run.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('installation downloads the confirmed SHA and rejects branch archive targets', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'chucklarr-archive-'));
  const original = process.cwd();
  const originalFetch = globalThis.fetch;
  const current = 'a'.repeat(40);
  const target = 'b'.repeat(40);
  const urls: string[] = [];
  process.env.DATABASE_PATH = path.join(temporary, 'test.sqlite');
  process.env.CHUCKLARR_ALLOW_AUTO_UPDATE = 'true';
  fs.writeFileSync(path.join(temporary, 'build-ref'), current);
  globalThis.fetch = async (input) => {
    const url = String(input);
    urls.push(url);
    return url.includes('/commits/')
      ? new Response(JSON.stringify({ sha: target }), { headers: { 'Content-Type': 'application/json' } })
      : new Response('Synthetic download failure', { status: 503 });
  };
  try {
    process.chdir(temporary);
    const { applyUpdate, getUpdateStatus, tarballUrl } = await import('../src/server/updater');
    assert.throws(() => tarballUrl('owner/repo', 'main'));
    assert.equal(
      tarballUrl('owner/repo', target.toUpperCase()),
      `https://api.github.com/repos/owner/repo/tarball/${target}`
    );
    await assert.rejects(applyUpdate());
    assert.equal(urls.length, 2);
    assert(urls[1].endsWith(`/tarball/${target}`));
    assert.equal(fs.readFileSync(path.join(temporary, 'build-ref'), 'utf8'), current);
    assert.equal(getUpdateStatus().updating, false);
    assert(getUpdateStatus().error);
  } finally {
    process.chdir(original);
    globalThis.fetch = originalFetch;
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
