/**
 * Verifies a server restart for an explicit browser update. The initiating App
 * owns the attempt and reload; this boundary only reads uncached readiness data.
 */

import type { RuntimeHealth, UpdateStatus } from '../../shared/types';

/** Retains the target across verification retries without repeating installation. */
export interface UpdateAttempt {
  /** Null when the older server could not provide health before installation. */
  before: RuntimeHealth | null;

  /** Expected commit until an install response or completed status confirms it. */
  targetSha: string | null;

  /** A completed install confirmed the target, so status reconciliation can stop. */
  confirmed: boolean;
}

/**
 * Reports a failed verification attempt to App, which owns recovery and display.
 * A confirmed install failure allows reinstalling; a timeout only allows rechecking.
 */
export class UpdateRefreshError extends Error {
  constructor(public readonly kind: 'install' | 'timeout') {
    super(kind);
  }
}

/** Supplies bounded I/O and a clock so downtime and deadlines can be tested deterministically. */
export interface UpdateWaitOptions {
  readHealth?: (timeoutMs: number) => Promise<RuntimeHealth>;
  readStatus?: (timeoutMs: number) => Promise<UpdateStatus>;
  now?: () => number;
  delay?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  pollMs?: number;
}

function sha(value: unknown): string | null {
  return typeof value === 'string' && /^[a-f0-9]{40}$/i.test(value) ? value.toLowerCase() : null;
}

function identity(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256;
}

async function readJson<T>(url: string, timeoutMs: number): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error('Unavailable');
  return response.json() as Promise<T>;
}

/** Reads optional process identity from old or new servers without using cached health. */
export async function readRuntimeHealth(timeoutMs = 3000): Promise<RuntimeHealth> {
  const health = await readJson<RuntimeHealth>('/api/health', timeoutMs);
  if (!health || health.ok !== true || health.name !== 'Chucklarr') throw new Error('Unavailable');
  return health;
}

/**
 * Waits at most 90 seconds for a new process running the exact installed commit.
 * Transient failures are tolerated. Ambiguous POST outcomes are reconciled using
 * status reads, never another install. Discovered targets persist on the attempt.
 */
export async function waitForUpdatedRuntime(
  attempt: UpdateAttempt,
  options: UpdateWaitOptions = {}
): Promise<void> {
  const now = options.now ?? Date.now;
  const delay = options.delay ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const healthReader = options.readHealth ?? readRuntimeHealth;
  const statusReader = options.readStatus ?? ((ms) => readJson<UpdateStatus>('/api/update', ms));
  const deadline = now() + (options.timeoutMs ?? 90_000);
  const budget = () => Math.max(1, Math.min(3000, deadline - now()));
  while (now() < deadline) {
    try {
      const health = await healthReader(budget());
      if (
        now() < deadline &&
        health?.ok === true &&
        health.name === 'Chucklarr' &&
        identity(health.instanceId) &&
        health.instanceId !== attempt.before?.instanceId &&
        sha(health.buildSha) !== null &&
        sha(health.buildSha) === sha(attempt.targetSha)
      )
        return;
    } catch {
      // The supervisor may briefly leave no listener while restarting the server.
    }
    if (!attempt.confirmed && now() < deadline) {
      let status: UpdateStatus | null = null;
      try {
        status = await statusReader(budget());
      } catch {
        // A disconnected install response is reconciled after the server returns.
      }
      if (status && !status.updating) {
        if (status.error) throw new UpdateRefreshError('install');
        const installed = sha(status.currentSha);
        if (
          installed &&
          (installed === sha(attempt.targetSha) ||
            (sha(attempt.before?.buildSha) && installed !== sha(attempt.before?.buildSha)))
        ) {
          attempt.targetSha = installed;
          attempt.confirmed = true;
        }
      }
    }
    const remaining = deadline - now();
    if (remaining > 0) await delay(Math.min(options.pollMs ?? 1000, remaining));
  }
  throw new UpdateRefreshError('timeout');
}
