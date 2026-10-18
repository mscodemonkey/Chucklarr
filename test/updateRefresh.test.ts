/**
 * Exercises browser readiness using a virtual clock and synthetic server reads.
 * These tests own no browser, network, installation or runtime state.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  waitForUpdatedRuntime,
  UpdateRefreshError,
  type UpdateAttempt
} from '../src/client/src/updateRefresh';
import type { RuntimeHealth, UpdateStatus } from '../src/shared/types';

const oldSha = 'a'.repeat(40);
const newSha = 'b'.repeat(40);
const before = { ok: true, name: 'Chucklarr', instanceId: 'old', buildSha: oldSha };
const ready = { ...before, instanceId: 'new', buildSha: newSha };

function clock() {
  let time = 0;
  return {
    now: () => time,
    delay: async (ms: number) => {
      time += ms;
    },
    timeoutMs: 50,
    pollMs: 10
  };
}

function attempt(): UpdateAttempt {
  return { before, targetSha: newSha, confirmed: true };
}

test('waits through outages, wrong builds and the old process before readiness', async () => {
  const sequence: Array<RuntimeHealth | Error> = [
    new Error('offline'),
    { ...ready, buildSha: oldSha },
    { ...ready, instanceId: 'old' },
    ready
  ];
  let reads = 0;
  await waitForUpdatedRuntime(attempt(), {
    ...clock(),
    readHealth: async () => {
      const next = sequence[reads++];
      if (next instanceof Error) throw next;
      return next;
    }
  });
  assert.equal(reads, 4);
});

test('accepts new-server identity when old health had no identity or was unavailable', async () => {
  for (const previous of [null, { ok: true, name: 'Chucklarr' }]) {
    await waitForUpdatedRuntime(
      { before: previous, targetSha: newSha.toUpperCase(), confirmed: true },
      { ...clock(), readHealth: async () => ready }
    );
  }
});

test('times out on malformed, wrong-product or unchanged health', async () => {
  for (const health of [
    before,
    { ...ready, instanceId: '' },
    { ...ready, name: 'Other' },
    { ...ready, buildSha: 'local' }
  ]) {
    await assert.rejects(
      waitForUpdatedRuntime(attempt(), { ...clock(), readHealth: async () => health }),
      (error: unknown) => error instanceof UpdateRefreshError && error.kind === 'timeout'
    );
  }
});

test('a dropped POST reconciles status and retains the authoritative installed target', async () => {
  const pending = { before, targetSha: 'c'.repeat(40), confirmed: false };
  let reads = 0;
  let statuses = 0;
  await waitForUpdatedRuntime(pending, {
    ...clock(),
    readHealth: async () => (++reads < 3 ? before : ready),
    readStatus: async () => ({ updating: ++statuses === 1, currentSha: newSha, error: null }) as UpdateStatus
  });
  assert.equal(statuses, 2);
  assert.equal(pending.targetSha, newSha);
  assert.equal(pending.confirmed, true);
});

test('health proof succeeds even when the new server update check is unavailable', async () => {
  await waitForUpdatedRuntime(
    { before, targetSha: newSha, confirmed: false },
    {
      ...clock(),
      readHealth: async () => ready,
      readStatus: async () => {
        throw new Error('Must not read');
      }
    }
  );
});

test('confirmed install failure permits a distinct recovery while unchanged status cannot prove a no-op', async () => {
  await assert.rejects(
    waitForUpdatedRuntime(
      { before, targetSha: newSha, confirmed: false },
      {
        ...clock(),
        readHealth: async () => before,
        readStatus: async () => ({ updating: false, error: 'private raw error' }) as UpdateStatus
      }
    ),
    (error: unknown) =>
      error instanceof UpdateRefreshError && error.kind === 'install' && !error.message.includes('private')
  );
  await assert.rejects(
    waitForUpdatedRuntime(
      { before, targetSha: newSha, confirmed: false },
      {
        ...clock(),
        readHealth: async () => before,
        readStatus: async () => ({ updating: false, currentSha: oldSha }) as UpdateStatus
      }
    ),
    (error: unknown) => error instanceof UpdateRefreshError && error.kind === 'timeout'
  );
});

test('verification retry preserves its target without reading install status again', async () => {
  const pending = attempt();
  await assert.rejects(waitForUpdatedRuntime(pending, { ...clock(), readHealth: async () => before }));
  await waitForUpdatedRuntime(pending, {
    ...clock(),
    readHealth: async () => ready,
    readStatus: async () => {
      throw new Error('Must not read');
    }
  });
});

test('missing pre-update health cannot turn unchanged status into a successful install', async () => {
  await assert.rejects(
    waitForUpdatedRuntime(
      { before: null, targetSha: newSha, confirmed: false },
      {
        ...clock(),
        readHealth: async () => before,
        readStatus: async () => ({ updating: false, currentSha: oldSha }) as UpdateStatus
      }
    ),
    (error: unknown) => error instanceof UpdateRefreshError && error.kind === 'timeout'
  );
});
