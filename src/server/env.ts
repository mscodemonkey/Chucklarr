import type { AppSettings } from '../shared/types';

export const env = {
  port: Number(process.env.PORT ?? 3333),
  databasePath: process.env.DATABASE_PATH ?? './data/chucklarr.db'
};

export function settingsFromEnv(): Partial<AppSettings> {
  return {
    tmdbBearerToken: process.env.TMDB_BEARER_TOKEN ?? '',
    radarrUrl: process.env.RADARR_URL ?? 'http://localhost:7878',
    radarrApiKey: process.env.RADARR_API_KEY ?? '',
    radarrQualityProfileId: process.env.RADARR_QUALITY_PROFILE_ID ?? '',
    radarrRootFolderPath: process.env.RADARR_ROOT_FOLDER_PATH ?? '',
    radarrMinimumAvailability: process.env.RADARR_MINIMUM_AVAILABILITY ?? 'released',
    autoAddConfidenceThreshold: process.env.AUTO_ADD_CONFIDENCE_THRESHOLD ?? '95',
    hideBelowConfidenceThreshold: process.env.HIDE_BELOW_CONFIDENCE_THRESHOLD ?? '60'
  };
}
