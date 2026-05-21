import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { BackupData, RadarrMonitoredMovie } from '../src/shared/types';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chucklarr-db-test-'));
process.env.DATABASE_PATH = path.join(tempDir, 'chucklarr.db');

const db = await import('../src/server/db');

test.after(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('candidate upserts refresh metadata while preserving ignored review decisions', () => {
  const comedian = db.createComedian({
    name: 'Avery Standup',
    tmdbPersonId: 5001,
    profilePath: null,
    placeOfBirth: null,
    countryCode: null,
    countryName: null
  });

  const original = db.upsertCandidate({
    comedianId: comedian.id,
    tmdbMovieId: 9001,
    title: 'Avery Standup: First Pass',
    year: 2023,
    overview: 'Original overview',
    posterPath: null,
    releaseDate: '2023-01-01',
    confidence: 52,
    reasons: ['Original scan'],
    status: 'ignored',
    radarrMovieId: null
  });

  const rescanned = db.upsertCandidate({
    comedianId: comedian.id,
    tmdbMovieId: 9001,
    title: 'Avery Standup: Better Metadata',
    year: 2024,
    overview: 'Updated overview',
    posterPath: '/poster.jpg',
    releaseDate: '2024-02-03',
    confidence: 96,
    reasons: ['Stand-up language'],
    status: 'new',
    radarrMovieId: null
  });

  assert.equal(rescanned.id, original.id);
  assert.equal(rescanned.status, 'ignored');
  assert.equal(rescanned.title, 'Avery Standup: Better Metadata');
  assert.equal(rescanned.confidence, 96);
  assert.deepEqual(rescanned.reasons, ['Stand-up language']);
});

test('candidate upserts allow Radarr-backed statuses to replace preserved local decisions', () => {
  const comedian = db.createComedian({
    name: 'Riley Callback',
    tmdbPersonId: 5002,
    profilePath: null,
    placeOfBirth: null,
    countryCode: null,
    countryName: null
  });

  db.upsertCandidate({
    comedianId: comedian.id,
    tmdbMovieId: 9002,
    title: 'Riley Callback: Club Night',
    year: 2022,
    overview: '',
    posterPath: null,
    releaseDate: '2022-01-01',
    confidence: 45,
    reasons: ['Manual ignore'],
    status: 'ignored',
    radarrMovieId: null
  });

  const approved = db.upsertCandidate({
    comedianId: comedian.id,
    tmdbMovieId: 9002,
    title: 'Riley Callback: Club Night',
    year: 2022,
    overview: '',
    posterPath: null,
    releaseDate: '2022-01-01',
    confidence: 88,
    reasons: ['Already in Radarr'],
    status: 'approved',
    radarrMovieId: 321
  });

  assert.equal(approved.status, 'approved');
  assert.equal(approved.radarrMovieId, 321);
});

test('syncCandidatesWithRadarr mirrors external Radarr monitored, unmonitored, and removed states', () => {
  const comedian = db.createComedian({
    name: 'Jordan External',
    tmdbPersonId: 5003,
    profilePath: null,
    placeOfBirth: null,
    countryCode: null,
    countryName: null
  });

  db.upsertCandidate({
    comedianId: comedian.id,
    tmdbMovieId: 9100,
    title: 'Jordan External: Added Elsewhere',
    year: 2025,
    overview: '',
    posterPath: null,
    releaseDate: '2025-01-01',
    confidence: 90,
    reasons: ['Stand-up language'],
    status: 'new',
    radarrMovieId: null
  });
  db.upsertCandidate({
    comedianId: comedian.id,
    tmdbMovieId: 9101,
    title: 'Jordan External: Unmonitored Elsewhere',
    year: 2025,
    overview: '',
    posterPath: null,
    releaseDate: '2025-02-01',
    confidence: 90,
    reasons: ['Stand-up language'],
    status: 'approved',
    radarrMovieId: 901
  });
  db.upsertCandidate({
    comedianId: comedian.id,
    tmdbMovieId: 9102,
    title: 'Jordan External: Removed Elsewhere',
    year: 2025,
    overview: '',
    posterPath: null,
    releaseDate: '2025-03-01',
    confidence: 90,
    reasons: ['Stand-up language'],
    status: 'auto_added',
    radarrMovieId: 902
  });

  const movies: RadarrMonitoredMovie[] = [
    { id: 900, tmdbId: 9100, title: 'Jordan External: Added Elsewhere', year: 2025, monitored: true, hasFile: false, path: null },
    { id: 901, tmdbId: 9101, title: 'Jordan External: Unmonitored Elsewhere', year: 2025, monitored: false, hasFile: false, path: null }
  ];

  const synced = db.syncCandidatesWithRadarr(movies);
  assert.equal(synced.filter((candidate) => candidate.comedianId === comedian.id).length, 3);
  assert.equal(db.getCandidateByMovie(comedian.id, 9100)?.status, 'approved');
  assert.equal(db.getCandidateByMovie(comedian.id, 9101)?.status, 'ignored');
  assert.equal(db.getCandidateByMovie(comedian.id, 9102)?.status, 'rejected');
  assert.equal(db.getCandidateByMovie(comedian.id, 9100)?.radarrMovieId, 900);
  assert.equal(db.getCandidateByMovie(comedian.id, 9101)?.radarrMovieId, 901);
  assert.equal(db.getCandidateByMovie(comedian.id, 9102)?.radarrMovieId, null);
});

test('backup restore replaces the database and validates relational integrity', () => {
  const settings = {
    ...db.getSettings(),
    language: 'en-US',
    autoAddConfidenceThreshold: '90'
  };
  const backup: BackupData = {
    app: 'Chucklarr',
    schemaVersion: 1,
    exportedAt: '2026-05-14T00:00:00.000Z',
    settings,
    comedians: [
      {
        id: 42,
        name: 'Morgan Archive',
        tmdbPersonId: 4242,
        profilePath: null,
        homepage: 'https://example.com/morgan',
        placeOfBirth: 'Brisbane, Queensland, Australia',
        countryCode: 'AU',
        countryName: 'Australia',
        createdAt: '2026-05-14 00:00:00',
        lastScannedAt: null
      }
    ],
    candidates: [
      {
        id: 84,
        comedianId: 42,
        comedianName: 'Morgan Archive',
        tmdbMovieId: 8484,
        title: 'Morgan Archive: Restored',
        year: 2026,
        overview: 'Restored candidate',
        posterPath: null,
        releaseDate: '2026-05-14',
        confidence: 77,
        reasons: ['Backup fixture'],
        status: 'new',
        radarrMovieId: null,
        createdAt: '2026-05-14 00:00:00',
        updatedAt: '2026-05-14 00:00:00'
      }
    ]
  };

  assert.deepEqual(db.restoreBackup(backup), {
    settings: Object.keys(settings).length,
    comedians: 1,
    candidates: 1
  });
  assert.equal(db.getSettings().language, 'en-US');
  assert.equal(db.listComedians()[0]?.name, 'Morgan Archive');
  assert.equal(db.listCandidates()[0]?.title, 'Morgan Archive: Restored');

  assert.throws(
    () =>
      db.restoreBackup({
        ...backup,
        candidates: [{ ...backup.candidates[0], id: 85, comedianId: 999 }]
      }),
    /references a missing comedian/
  );
});
