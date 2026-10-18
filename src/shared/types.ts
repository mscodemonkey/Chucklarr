/**
 * Defines server/browser contracts. Servers own persistence and external effects;
 * the React client consumes these records without owning credentials or files.
 */

/** Persisted review decisions, independent of live Radarr file availability. */
export type CandidateStatus = 'new' | 'auto_added' | 'approved' | 'ignored' | 'rejected';

/** Server-persisted configuration shared with the settings editor. Backups contain credentials and must stay private. */
export type AppSettings = {
  language: string;
  theme: string;
  metadataSource: string;
  metadataServiceUrl: string;
  tmdbBearerToken: string;
  radarrUrl: string;
  radarrApiKey: string;
  radarrQualityProfileId: string;
  radarrRootFolderPath: string;
  radarrMinimumAvailability: string;
  autoAddConfidenceThreshold: string;
  hideBelowConfidenceThreshold: string;
  automaticDailyScanTime: string;
  automaticDailyScanLastRunDate: string;
};

/** An existing Radarr quality policy available for new movie additions. */
export type RadarrQualityProfile = {
  id: number;
  name: string;
};

/** A Radarr-managed destination. Chucklarr does not create or own its files. */
export type RadarrRootFolder = {
  id: number | null;
  path: string;
  freeSpace: number | null;
  accessible: boolean | null;
};

/** Connection-test result and choices supplied by the configured Radarr server. */
export type RadarrOptions = {
  connected: boolean;
  qualityProfiles: RadarrQualityProfile[];
  rootFolders: RadarrRootFolder[];
  error?: string;
};

/** Live Radarr movie state, including unmonitored entries when requested by the server. */
export type RadarrMonitoredMovie = {
  id: number;
  tmdbId: number | null;
  title: string;
  year: number | null;
  monitored: boolean;
  hasFile: boolean | null;
  path: string | null;
};

/** A disambiguated TMDB person the user may choose to follow. */
export type PersonSearchResult = {
  tmdbPersonId: number;
  name: string;
  profilePath: string | null;
  knownForDepartment: string | null;
  placeOfBirth: string | null;
  countryCode: string | null;
  countryName: string | null;
  knownFor: string[];
  matchReasons?: string[];
};

/** A followed person owned by the local database; TMDB metadata may be absent. */
export type Comedian = {
  id: number;
  name: string;
  tmdbPersonId: number | null;
  profilePath: string | null;
  homepage: string | null;
  placeOfBirth: string | null;
  countryCode: string | null;
  countryName: string | null;
  createdAt: string;
  lastScannedAt: string | null;
};

/** A persisted likely special and review decision. Radarr sync owns its external membership state. */
export type Candidate = {
  id: number;
  comedianId: number;
  comedianName: string;
  tmdbMovieId: number;
  title: string;
  year: number | null;
  overview: string;
  posterPath: string | null;
  releaseDate: string | null;
  confidence: number;
  reasons: string[];
  status: CandidateStatus;
  radarrMovieId: number | null;
  createdAt: string;
  updatedAt: string;
};

/** A completed single-comedian scan and the records it saved. */
export type ScanResult = {
  comedian: Comedian;
  found: number;
  saved: number;
  candidates: Candidate[];
};

/** Portable private snapshot of local settings and review data. Version one remains backwards compatible. */
export type BackupData = {
  app: 'Chucklarr';
  schemaVersion: 1;
  exportedAt: string;
  settings: AppSettings;
  comedians: Comedian[];
  candidates: Candidate[];
};

/** Counts returned after a validated backup replaces local state transactionally. */
export type RestoreSummary = {
  settings: number;
  comedians: number;
  candidates: number;
};

/** Updater-owned running-build comparison and installation capability for the UI. */
export type UpdateStatus = {
  enabled: boolean;
  checking: boolean;
  updating: boolean;
  updateAvailable: boolean;
  canAutoUpdate: boolean;
  repository: string;
  branch: string;
  currentSha: string | null;
  latestSha: string | null;
  latestUrl: string | null;
  checkedAt: string | null;
  message: string | null;
  error: string | null;
};

/** Failure response consumed by browser request handlers. */
export type ApiError = {
  error: string;
};

/** A movie cast credit discovered separately from the persisted specials queue. */
export type FilmAppearance = {
  tmdbMovieId: number;
  title: string;
  overview: string;
  posterPath: string | null;
  releaseDate: string | null;
  character: string;
};

/** Minimal Radarr state for a displayed film, with no library paths or credentials. */
export type FilmRadarrState = {
  tmdbId: number;
  radarrId: number;
  monitored: boolean;
  hasFile: boolean | null;
};

/** On-demand film results. Unavailable Radarr status must never imply absence. */
export type FilmAppearancesResult = {
  films: FilmAppearance[];
  states: FilmRadarrState[];
  statusAvailable: boolean;
};
