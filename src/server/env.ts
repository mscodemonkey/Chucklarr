import type { AppSettings } from '../shared/types';

export const env = {
  port: Number(process.env.PORT ?? 3333),
  databasePath: process.env.DATABASE_PATH ?? './data/chucklarr.db'
};

export function settingsFromEnv(): Partial<AppSettings> {
  const tmdbBearerToken = process.env.TMDB_BEARER_TOKEN ?? '';

  return {
    language: process.env.CHUCKLARR_LANGUAGE ?? 'en-GB',
    theme: process.env.CHUCKLARR_THEME ?? 'system',
    metadataSource: process.env.CHUCKLARR_METADATA_SOURCE ?? (tmdbBearerToken ? 'tmdb' : 'service'),
    metadataServiceUrl: process.env.CHUCKLARR_METADATA_SERVICE_URL ?? 'https://chucklarr-metadata.martinjsteven.workers.dev',
    tmdbBearerToken,
    radarrUrl: process.env.RADARR_URL ?? 'http://localhost:7878',
    radarrApiKey: process.env.RADARR_API_KEY ?? '',
    radarrQualityProfileId: process.env.RADARR_QUALITY_PROFILE_ID ?? '',
    radarrRootFolderPath: process.env.RADARR_ROOT_FOLDER_PATH ?? '',
    radarrMinimumAvailability: process.env.RADARR_MINIMUM_AVAILABILITY ?? 'released',
    autoAddConfidenceThreshold: process.env.AUTO_ADD_CONFIDENCE_THRESHOLD ?? '95',
    hideBelowConfidenceThreshold: process.env.HIDE_BELOW_CONFIDENCE_THRESHOLD ?? '60',
    automaticDailyScanTime: process.env.AUTOMATIC_DAILY_SCAN_TIME ?? '',
    automaticDailyScanLastRunDate: ''
  };
}
