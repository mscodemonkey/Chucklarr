import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AppSettings, BackupData, Candidate, CandidateStatus, Comedian, RestoreSummary } from '../shared/types';
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
  language: 'en-GB',
  theme: 'system',
  metadataSource: 'service',
  metadataServiceUrl: 'https://chucklarr-metadata.martinjsteven.workers.dev',
  tmdbBearerToken: '',
  radarrUrl: 'http://localhost:7878',
  radarrApiKey: '',
  radarrQualityProfileId: '',
  radarrRootFolderPath: '',
  radarrMinimumAvailability: 'released',
  autoAddConfidenceThreshold: '95',
  hideBelowConfidenceThreshold: '60',
  automaticDailyScanTime: '',
  automaticDailyScanLastRunDate: '',
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
        WHEN candidates.status IN ('ignored', 'rejected', 'approved', 'auto_added') THEN candidates.status
        WHEN candidates.status = 'new' THEN excluded.status
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

export function createBackup(): BackupData {
  return {
    app: 'Chucklarr',
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    settings: getSettings(),
    comedians: listComedians(),
    candidates: listCandidates()
  };
}

export function restoreBackup(input: unknown): RestoreSummary {
  const backup = parseBackup(input);
  const settingKeys = Object.keys(defaultSettings) as Array<keyof AppSettings>;

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('DELETE FROM candidates').run();
    db.prepare('DELETE FROM comedians').run();
    db.prepare('DELETE FROM settings').run();

    const insertSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
    for (const key of settingKeys) {
      insertSetting.run(key, backup.settings[key]);
    }

    const insertComedian = db.prepare(`
      INSERT INTO comedians (
        id,
        name,
        tmdb_person_id,
        profile_path,
        place_of_birth,
        country_code,
        country_name,
        created_at,
        last_scanned_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const comedian of backup.comedians) {
      insertComedian.run(
        comedian.id,
        comedian.name,
        comedian.tmdbPersonId,
        comedian.profilePath,
        comedian.placeOfBirth,
        comedian.countryCode,
        comedian.countryName,
        comedian.createdAt,
        comedian.lastScannedAt
      );
    }

    const insertCandidate = db.prepare(`
      INSERT INTO candidates (
        id,
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
        radarr_movie_id,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const candidate of backup.candidates) {
      insertCandidate.run(
        candidate.id,
        candidate.comedianId,
        candidate.tmdbMovieId,
        candidate.title,
        candidate.year,
        candidate.overview,
        candidate.posterPath,
        candidate.releaseDate,
        candidate.confidence,
        JSON.stringify(candidate.reasons),
        candidate.status,
        candidate.radarrMovieId,
        candidate.createdAt,
        candidate.updatedAt
      );
    }

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return {
    settings: settingKeys.length,
    comedians: backup.comedians.length,
    candidates: backup.candidates.length
  };
}

function parseBackup(input: unknown): BackupData {
  const record = requireRecord(input, 'Backup file');
  if (record.app !== 'Chucklarr') {
    throw new Error('Backup file is not a Chucklarr backup.');
  }
  if (record.schemaVersion !== 1) {
    throw new Error('Unsupported backup version.');
  }

  const settingKeys = Object.keys(defaultSettings) as Array<keyof AppSettings>;
  const settingsRecord = requireRecord(record.settings, 'Backup settings');
  const settings = { ...defaultSettings };
  for (const key of settingKeys) {
    const value = settingsRecord[key];
    if (value !== undefined) {
      settings[key] = requireString(value, `settings.${key}`);
    }
  }

  const comediansInput = requireArray(record.comedians, 'Backup comedians');
  const comedianIds = new Set<number>();
  const tmdbPersonIds = new Set<number>();
  const comedians = comediansInput.map((value, index): Comedian => {
    const comedian = requireRecord(value, `comedians[${index}]`);
    const id = requirePositiveInteger(comedian.id, `comedians[${index}].id`);
    if (comedianIds.has(id)) {
      throw new Error(`Duplicate comedian id in backup: ${id}.`);
    }
    comedianIds.add(id);

    const tmdbPersonId = requireNullablePositiveInteger(comedian.tmdbPersonId, `comedians[${index}].tmdbPersonId`);
    if (tmdbPersonId != null) {
      if (tmdbPersonIds.has(tmdbPersonId)) {
        throw new Error(`Duplicate TMDB person id in backup: ${tmdbPersonId}.`);
      }
      tmdbPersonIds.add(tmdbPersonId);
    }

    return {
      id,
      name: requireString(comedian.name, `comedians[${index}].name`),
      tmdbPersonId,
      profilePath: requireNullableString(comedian.profilePath, `comedians[${index}].profilePath`),
      placeOfBirth: requireNullableString(comedian.placeOfBirth, `comedians[${index}].placeOfBirth`),
      countryCode: requireNullableString(comedian.countryCode, `comedians[${index}].countryCode`),
      countryName: requireNullableString(comedian.countryName, `comedians[${index}].countryName`),
      createdAt: requireString(comedian.createdAt, `comedians[${index}].createdAt`),
      lastScannedAt: requireNullableString(comedian.lastScannedAt, `comedians[${index}].lastScannedAt`)
    };
  });

  const candidatesInput = requireArray(record.candidates, 'Backup candidates');
  const candidateIds = new Set<number>();
  const candidateKeys = new Set<string>();
  const candidates = candidatesInput.map((value, index): Candidate => {
    const candidate = requireRecord(value, `candidates[${index}]`);
    const id = requirePositiveInteger(candidate.id, `candidates[${index}].id`);
    if (candidateIds.has(id)) {
      throw new Error(`Duplicate candidate id in backup: ${id}.`);
    }
    candidateIds.add(id);

    const comedianId = requirePositiveInteger(candidate.comedianId, `candidates[${index}].comedianId`);
    if (!comedianIds.has(comedianId)) {
      throw new Error(`Candidate ${id} references a missing comedian.`);
    }

    const tmdbMovieId = requirePositiveInteger(candidate.tmdbMovieId, `candidates[${index}].tmdbMovieId`);
    const candidateKey = `${comedianId}:${tmdbMovieId}`;
    if (candidateKeys.has(candidateKey)) {
      throw new Error(`Duplicate candidate movie for comedian ${comedianId}: ${tmdbMovieId}.`);
    }
    candidateKeys.add(candidateKey);

    const status = requireString(candidate.status, `candidates[${index}].status`) as CandidateStatus;
    if (!['new', 'auto_added', 'approved', 'ignored', 'rejected'].includes(status)) {
      throw new Error(`Invalid candidate status in backup: ${status}.`);
    }

    return {
      id,
      comedianId,
      comedianName:
        typeof candidate.comedianName === 'string'
          ? candidate.comedianName
          : comedians.find((comedian) => comedian.id === comedianId)?.name ?? '',
      tmdbMovieId,
      title: requireString(candidate.title, `candidates[${index}].title`),
      year: requireNullableInteger(candidate.year, `candidates[${index}].year`),
      overview: requireString(candidate.overview, `candidates[${index}].overview`),
      posterPath: requireNullableString(candidate.posterPath, `candidates[${index}].posterPath`),
      releaseDate: requireNullableString(candidate.releaseDate, `candidates[${index}].releaseDate`),
      confidence: requireConfidence(candidate.confidence, `candidates[${index}].confidence`),
      reasons: requireStringArray(candidate.reasons, `candidates[${index}].reasons`),
      status,
      radarrMovieId: requireNullablePositiveInteger(candidate.radarrMovieId, `candidates[${index}].radarrMovieId`),
      createdAt: requireString(candidate.createdAt, `candidates[${index}].createdAt`),
      updatedAt: requireString(candidate.updatedAt, `candidates[${index}].updatedAt`)
    };
  });

  return {
    app: 'Chucklarr',
    schemaVersion: 1,
    exportedAt: requireString(record.exportedAt, 'exportedAt'),
    settings,
    comedians,
    candidates
  };
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string.`);
  }
  return value;
}

function requireNullableString(value: unknown, label: string): string | null {
  if (value == null) {
    return null;
  }
  return requireString(value, label);
}

function requirePositiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return Number(value);
}

function requireNullablePositiveInteger(value: unknown, label: string): number | null {
  if (value == null) {
    return null;
  }
  return requirePositiveInteger(value, label);
}

function requireNullableInteger(value: unknown, label: string): number | null {
  if (value == null) {
    return null;
  }
  if (!Number.isInteger(value)) {
    throw new Error(`${label} must be an integer.`);
  }
  return Number(value);
}

function requireConfidence(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 100) {
    throw new Error(`${label} must be an integer from 0 to 100.`);
  }
  return Number(value);
}

function requireStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${label} must be an array of strings.`);
  }
  return value;
}
