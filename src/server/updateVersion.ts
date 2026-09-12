/**
 * Resolves the version of the code running in the current container. The build
 * marker travels with the application files, while the configured reference is
 * a fallback for builds that do not include that marker.
 */

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
export function resolveCurrentSha(buildMarker: string | undefined, configuredBuildRef: string | undefined): string | null {
  return normaliseCommitSha(buildMarker) ?? normaliseCommitSha(configuredBuildRef);
}
