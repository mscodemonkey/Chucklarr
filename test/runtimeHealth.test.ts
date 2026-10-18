/**
 * Checks real HTTP readiness and response completion against an isolated app.
 * This process owns a temporary build marker and database, never product data.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { readRunningBuildSha, shouldRestartAfterUpdate } from '../src/server/updateVersion';

const oldSha = 'a'.repeat(40);
const newSha = 'b'.repeat(40);

test('health captures process identity and startup SHA, HTML is never cached', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'chucklarr-health-'));
  const original = process.cwd();
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_PATH = path.join(temporary, 'test.sqlite');
  fs.writeFileSync(path.join(temporary, 'build-ref'), oldSha);
  try {
    process.chdir(temporary);
    const { app, afterUpdateResponse } = await import('../src/server/index');
    process.chdir(original);
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    try {
      const address = server.address();
      assert(address && typeof address !== 'string');
      const base = `http://127.0.0.1:${address.port}`;
      const response = await fetch(`${base}/api/health`);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const health = await response.json();
      assert.deepEqual(Object.keys(health).sort(), ['buildSha', 'instanceId', 'name', 'ok']);
      assert.equal(health.buildSha, oldSha);
      assert.match(health.instanceId, /^[0-9a-f-]{36}$/);
      fs.writeFileSync(path.join(temporary, 'build-ref'), newSha);
      assert.deepEqual(await (await fetch(`${base}/api/health`)).json(), health);
      for (const url of ['/', '/upcoming', '/api/update']) {
        const result = await fetch(base + url);
        assert.equal(result.status, 200);
        assert.equal(result.headers.get('cache-control'), 'no-store');
      }
      let restarts = 0;
      const responseEvents = Object.assign(new EventEmitter(), { destroyed: false });
      afterUpdateResponse(responseEvents, () => restarts++);
      responseEvents.emit('finish');
      responseEvents.emit('close');
      assert.equal(restarts, 1);
      afterUpdateResponse(Object.assign(new EventEmitter(), { destroyed: true }), () => restarts++);
      assert.equal(restarts, 2);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  } finally {
    process.chdir(original);
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('startup reference reader falls back safely and restart requires a changed completed install', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'chucklarr-marker-'));
  const marker = path.join(temporary, 'build-ref');
  try {
    assert.equal(readRunningBuildSha(marker, oldSha.toUpperCase()), oldSha);
    fs.writeFileSync(marker, newSha);
    assert.equal(readRunningBuildSha(marker, oldSha), newSha);
    for (const status of [
      { updating: true, currentSha: newSha, error: null },
      { updating: false, currentSha: oldSha, error: null },
      { updating: false, currentSha: newSha, error: 'failed' },
      { updating: false, currentSha: 'local', error: null }
    ])
      assert.equal(shouldRestartAfterUpdate(oldSha, status), false);
    assert.equal(
      shouldRestartAfterUpdate(oldSha, { updating: false, currentSha: newSha, error: null }),
      true
    );
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
