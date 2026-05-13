export type CandidateStatus = 'new' | 'auto_added' | 'approved' | 'ignored' | 'rejected';

export type AppSettings = {
  tmdbBearerToken: string;
  radarrUrl: string;
  radarrApiKey: string;
  radarrQualityProfileId: string;
  radarrRootFolderPath: string;
  radarrMinimumAvailability: string;
  autoAddConfidenceThreshold: string;
  hideBelowConfidenceThreshold: string;
};

export type RadarrQualityProfile = {
  id: number;
  name: string;
};

export type RadarrRootFolder = {
  id: number | null;
  path: string;
  freeSpace: number | null;
  accessible: boolean | null;
};

export type RadarrOptions = {
  connected: boolean;
  qualityProfiles: RadarrQualityProfile[];
  rootFolders: RadarrRootFolder[];
  error?: string;
};

export type RadarrMonitoredMovie = {
  id: number;
  tmdbId: number | null;
  title: string;
  year: number | null;
  monitored: boolean;
  hasFile: boolean | null;
  path: string | null;
};

export type PersonSearchResult = {
  tmdbPersonId: number;
  name: string;
  profilePath: string | null;
  knownFor: string[];
};

export type Comedian = {
  id: number;
  name: string;
  tmdbPersonId: number | null;
  profilePath: string | null;
  placeOfBirth: string | null;
  countryCode: string | null;
  countryName: string | null;
  createdAt: string;
  lastScannedAt: string | null;
};

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

export type ScanResult = {
  comedian: Comedian;
  found: number;
  saved: number;
  candidates: Candidate[];
};

export type ApiError = {
  error: string;
};
