/**
 * Resolves the version of the code running in the current container. The build
 * marker travels with the application files, while the configured reference is
 * a fallback for builds that do not include that marker.
 */

import fs from 'node:fs';
import type { UpdateStatus } from '../shared/types';

/** Returns a validated Git commit SHA, or null when the value is not a full SHA. */
export function normaliseCommitSha(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return /^[a-f0-9]{40}$/i.test(trimmed) ? trimmed : null;
}

/**
 * Returns the commit represented by the current application files.
 *
 * The on-disk marker takes priority because an in-app update rewrites it along
 * with the application. A recreated container restores the marker from its
 * image, which prevents persisted update history from masking older code.
 */
export function resolveCurrentSha(
  buildMarker: string | undefined,
  configuredBuildRef: string | undefined
): string | null {
  return normaliseCommitSha(buildMarker) ?? normaliseCommitSha(configuredBuildRef);
}

/** Reads a running build marker once, falling back when it is absent or invalid. */
export function readRunningBuildSha(markerPath: string, configuredRef: string | undefined): string | null {
  let marker: string | undefined;
  try {
    marker = fs.readFileSync(markerPath, 'utf8');
  } catch {
    marker = undefined;
  }
  return resolveCurrentSha(marker, configuredRef)?.toLowerCase() ?? null;
}

/** Only completed changed-version installs may restart the process serving them. */
export function shouldRestartAfterUpdate(
  runningSha: string | null,
  status: Pick<UpdateStatus, 'updating' | 'currentSha' | 'error'>
): boolean {
  const installed = normaliseCommitSha(status.currentSha ?? undefined)?.toLowerCase();
  return !status.updating && !status.error && Boolean(installed && installed !== runningSha?.toLowerCase());
}
