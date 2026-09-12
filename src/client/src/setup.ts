/**
 * Defines first-run setup state for the client. The React application owns the
 * editable draft, while these helpers keep navigation tied to settings that the
 * server has confirmed were saved.
 */

import type { AppSettings } from '../../shared/types';

/** Returns whether settings contain every value required to use the library. */
export function isSetupComplete(settings: AppSettings): boolean {
  const metadataConfigured =
    settings.metadataSource === 'tmdb' ? settings.tmdbBearerToken.trim() : settings.metadataServiceUrl.trim();

  return Boolean(
    metadataConfigured &&
      settings.radarrUrl.trim() &&
      settings.radarrApiKey.trim() &&
      settings.radarrQualityProfileId.trim() &&
      settings.radarrRootFolderPath.trim()
  );
}

/**
 * Returns whether the settings page should replace the library.
 *
 * A complete editable draft does not count as completed setup until the server
 * has returned the saved values.
 */
export function shouldShowSettings(
  initialDataLoaded: boolean,
  settingsRequested: boolean,
  persistedSettings: AppSettings | null
): boolean {
  return initialDataLoaded && (settingsRequested || !persistedSettings || !isSetupComplete(persistedSettings));
}
