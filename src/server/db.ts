import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AppSettings, Candidate, CandidateStatus, Comedian } from '../shared/types';
import { env, settingsFromEnv } from './env';

fs.mkdirSync(path.dirname(env.databasePath), { recursive: true });

const db = new DatabaseSync(env.databasePath);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS comedians (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    tmdb_person_id INTEGER UNIQUE,
    profile_path TEXT,
    place_of_birth TEXT,
    country_code TEXT,
    country_name TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_scanned_at TEXT
  );

  CREATE TABLE IF NOT EXISTS candidates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    comedian_id INTEGER NOT NULL REFERENCES comedians(id) ON DELETE CASCADE,
    tmdb_movie_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    year INTEGER,
    overview TEXT NOT NULL DEFAULT '',
    poster_path TEXT,
    release_date TEXT,
    confidence INTEGER NOT NULL,
    reasons_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new',
    radarr_movie_id INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(comedian_id, tmdb_movie_id)
  );
`);

const comedianColumns = new Set(
  (db.prepare('PRAGMA table_info(comedians)').all() as Array<{ name: string }>).map((column) => column.name)
);
if (!comedianColumns.has('place_of_birth')) {
  db.exec('ALTER TABLE comedians ADD COLUMN place_of_birth TEXT');
}
if (!comedianColumns.has('country_code')) {
  db.exec('ALTER TABLE comedians ADD COLUMN country_code TEXT');
}
if (!comedianColumns.has('country_name')) {
  db.exec('ALTER TABLE comedians ADD COLUMN country_name TEXT');
}

const defaultSettings: AppSettings = {
  tmdbBearerToken: '',
  radarrUrl: 'http://localhost:7878',
  radarrApiKey: '',
  radarrQualityProfileId: '',
  radarrRootFolderPath: '',
  radarrMinimumAvailability: 'released',
  autoAddConfidenceThreshold: '95',
  hideBelowConfidenceThreshold: '60',
  ...settingsFromEnv()
};
const envSettings = settingsFromEnv();

for (const [key, value] of Object.entries(defaultSettings)) {
  db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

for (const [key, value] of Object.entries(envSettings)) {
  if (value) {
    db.prepare('UPDATE settings SET value = ? WHERE key = ? AND value = ?').run(value, key, '');
  }
}

function mapComedian(row: Record<string, unknown>): Comedian {
  return {
    id: Number(row.id),
    name: String(row.name),
    tmdbPersonId: row.tmdb_person_id == null ? null : Number(row.tmdb_person_id),
    profilePath: row.profile_path == null ? null : String(row.profile_path),
    placeOfBirth: row.place_of_birth == null ? null : String(row.place_of_birth),
    countryCode: row.country_code == null ? null : String(row.country_code),
    countryName: row.country_name == null ? null : String(row.country_name),
    createdAt: String(row.created_at),
    lastScannedAt: row.last_scanned_at == null ? null : String(row.last_scanned_at)
  };
}

function mapCandidate(row: Record<string, unknown>): Candidate {
  return {
    id: Number(row.id),
    comedianId: Number(row.comedian_id),
    comedianName: String(row.comedian_name),
    tmdbMovieId: Number(row.tmdb_movie_id),
    title: String(row.title),
    year: row.year == null ? null : Number(row.year),
    overview: String(row.overview ?? ''),
    posterPath: row.poster_path == null ? null : String(row.poster_path),
    releaseDate: row.release_date == null ? null : String(row.release_date),
    confidence: Number(row.confidence),
    reasons: JSON.parse(String(row.reasons_json)) as string[],
    status: String(row.status) as CandidateStatus,
    radarrMovieId: row.radarr_movie_id == null ? null : Number(row.radarr_movie_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export function getSettings(): AppSettings {
  const rows = db.prepare('SELECT key, value FROM settings').all() as Record<string, unknown>[];
  return rows.reduce<AppSettings>((settings, row) => {
    settings[String(row.key) as keyof AppSettings] = String(row.value);
    return settings;
  }, { ...defaultSettings });
}

export function updateSettings(settings: Partial<AppSettings>): AppSettings {
  const allowedKeys = Object.keys(defaultSettings) as Array<keyof AppSettings>;
  const write = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');

  for (const key of allowedKeys) {
    if (settings[key] !== undefined) {
      write.run(key, String(settings[key] ?? ''));
    }
  }

  return getSettings();
}

export function listComedians(): Comedian[] {
  const rows = db.prepare('SELECT * FROM comedians ORDER BY name COLLATE NOCASE').all() as Record<string, unknown>[];
  return rows.map(mapComedian);
}

export function getComedian(id: number): Comedian | null {
  const row = db.prepare('SELECT * FROM comedians WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? mapComedian(row) : null;
}

export function createComedian(input: {
  name: string;
  tmdbPersonId: number | null;
  profilePath: string | null;
  placeOfBirth?: string | null;
  countryCode?: string | null;
  countryName?: string | null;
}): Comedian {
  const existing = input.tmdbPersonId
    ? (db.prepare('SELECT * FROM comedians WHERE tmdb_person_id = ?').get(input.tmdbPersonId) as Record<string, unknown> | undefined)
    : undefined;

  if (existing) {
    const comedian = mapComedian(existing);
    if (!comedian.countryCode && (input.placeOfBirth || input.countryCode || input.countryName)) {
      updateComedianOrigin(comedian.id, {
        placeOfBirth: input.placeOfBirth ?? null,
        countryCode: input.countryCode ?? null,
        countryName: input.countryName ?? null
      });
      return getComedian(comedian.id) as Comedian;
    }
    return comedian;
  }

  const result = db
    .prepare(`
      INSERT INTO comedians (name, tmdb_person_id, profile_path, place_of_birth, country_code, country_name)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    .run(input.name, input.tmdbPersonId, input.profilePath, input.placeOfBirth ?? null, input.countryCode ?? null, input.countryName ?? null);
  return getComedian(Number(result.lastInsertRowid)) as Comedian;
}

export function updateComedianOrigin(
  id: number,
  input: { placeOfBirth: string | null; countryCode: string | null; countryName: string | null }
): Comedian | null {
  db.prepare(`
    UPDATE comedians
    SET place_of_birth = ?, country_code = ?, country_name = ?
    WHERE id = ?
  `).run(input.placeOfBirth, input.countryCode, input.countryName, id);
  return getComedian(id);
}

export function deleteComedian(id: number): void {
  db.prepare('DELETE FROM comedians WHERE id = ?').run(id);
}

export function markComedianScanned(id: number): void {
  db.prepare('UPDATE comedians SET last_scanned_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
}

export function upsertCandidate(input: {
  comedianId: number;
  tmdbMovieId: number;
  title: string;
  year: number | null;
  overview: string;
  posterPath: string | null;
  releaseDate: string | null;
  confidence: number;
  reasons: string[];
  status?: CandidateStatus;
  radarrMovieId?: number | null;
}): Candidate {
  db.prepare(`
    INSERT INTO candidates (
      comedian_id,
      tmdb_movie_id,
      title,
      year,
      overview,
      poster_path,
      release_date,
      confidence,
      reasons_json,
      status,
      radarr_movie_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(comedian_id, tmdb_movie_id) DO UPDATE SET
      title = excluded.title,
      year = excluded.year,
      overview = excluded.overview,
      poster_path = excluded.poster_path,
      release_date = excluded.release_date,
      confidence = excluded.confidence,
      reasons_json = excluded.reasons_json,
      status = CASE
        WHEN excluded.radarr_movie_id IS NOT NULL THEN excluded.status
        WHEN candidates.status IN ('new', 'ignored') THEN excluded.status
        ELSE candidates.status
      END,
      radarr_movie_id = COALESCE(excluded.radarr_movie_id, candidates.radarr_movie_id),
      updated_at = CURRENT_TIMESTAMP
  `).run(
    input.comedianId,
    input.tmdbMovieId,
    input.title,
    input.year,
    input.overview,
    input.posterPath,
    input.releaseDate,
    input.confidence,
    JSON.stringify(input.reasons),
    input.status ?? 'new',
    input.radarrMovieId ?? null
  );

  return getCandidateByMovie(input.comedianId, input.tmdbMovieId) as Candidate;
}

export function listCandidates(status?: CandidateStatus): Candidate[] {
  const sql = `
    SELECT candidates.*, comedians.name AS comedian_name
    FROM candidates
    JOIN comedians ON comedians.id = candidates.comedian_id
    ${status ? 'WHERE candidates.status = ?' : ''}
    ORDER BY candidates.status = 'new' DESC, candidates.confidence DESC, candidates.release_date DESC
  `;
  const rows = (status ? db.prepare(sql).all(status) : db.prepare(sql).all()) as Record<string, unknown>[];
  return rows.map(mapCandidate);
}

export function getCandidate(id: number): Candidate | null {
  const row = db.prepare(`
    SELECT candidates.*, comedians.name AS comedian_name
    FROM candidates
    JOIN comedians ON comedians.id = candidates.comedian_id
    WHERE candidates.id = ?
  `).get(id) as Record<string, unknown> | undefined;
  return row ? mapCandidate(row) : null;
}

export function getCandidateByMovie(comedianId: number, tmdbMovieId: number): Candidate | null {
  const row = db.prepare(`
    SELECT candidates.*, comedians.name AS comedian_name
    FROM candidates
    JOIN comedians ON comedians.id = candidates.comedian_id
    WHERE candidates.comedian_id = ? AND candidates.tmdb_movie_id = ?
  `).get(comedianId, tmdbMovieId) as Record<string, unknown> | undefined;
  return row ? mapCandidate(row) : null;
}

export function updateCandidateStatus(id: number, status: CandidateStatus, radarrMovieId?: number): Candidate | null {
  db.prepare(`
    UPDATE candidates
    SET status = ?, radarr_movie_id = COALESCE(?, radarr_movie_id), updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(status, radarrMovieId ?? null, id);
  return getCandidate(id);
}

export function markCandidateRemovedFromRadarr(id: number): Candidate | null {
  db.prepare(`
    UPDATE candidates
    SET status = 'rejected', radarr_movie_id = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(id);
  return getCandidate(id);
}
