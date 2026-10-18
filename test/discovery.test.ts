/**
 * Verifies upcoming-special selection with an injected local calendar day.
 * These fixtures exercise display policy independently of React and Radarr.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { isReleaseDate, localCalendarDate, upcomingSpecials } from '../src/client/src/discovery';
import type { Candidate } from '../src/shared/types';

const candidate = (id: number, extra: Partial<Candidate> = {}): Candidate => ({
  id,
  comedianId: id,
  comedianName: `Comedian ${id}`,
  tmdbMovieId: id,
  title: `Special ${id}`,
  year: 2026,
  overview: '',
  posterPath: null,
  releaseDate: '2026-10-19',
  confidence: 90,
  reasons: ['Credited as self'],
  status: 'new',
  radarrMovieId: null,
  createdAt: '',
  updatedAt: '',
  ...extra
});

test('upcoming excludes today, past, invalid, dismissed and weak Radarr-only candidates', () => {
  const rows = upcomingSpecials(
    [
      candidate(1),
      candidate(2, { releaseDate: '2026-10-18' }),
      candidate(3, { releaseDate: '2026-02-30' }),
      candidate(4, { releaseDate: null }),
      candidate(5, { releaseDate: '2025-10-20' }),
      candidate(6, { status: 'ignored' }),
      candidate(7, { status: 'rejected' }),
      candidate(8, { status: 'approved', reasons: ['Already in Radarr'] }),
      candidate(9, { status: 'auto_added' }),
      candidate(10, { status: 'approved' })
    ],
    '2026-10-18'
  );
  assert.deepEqual(
    rows.map((item) => item.id),
    [1, 10, 9]
  );
  assert.equal(isReleaseDate('2024-02-29'), true);
  assert.equal(isReleaseDate('2026-02-29'), false);
  assert.equal(isReleaseDate('2026-1-01'), false);
});

test('upcoming deduplicates shared specials, keeps the strongest action identity and stable ties', () => {
  const rows = upcomingSpecials(
    [
      candidate(5, { title: 'Beta', tmdbMovieId: 50 }),
      candidate(6, { title: 'Alpha', tmdbMovieId: 60, confidence: 80 }),
      candidate(7, { title: 'Alpha', tmdbMovieId: 60, confidence: 98 }),
      candidate(8, { title: 'Alpha', tmdbMovieId: 70, releaseDate: '2026-10-20' })
    ],
    '2026-10-18'
  );
  assert.deepEqual(
    rows.map((item) => item.id),
    [7, 5, 8]
  );
  assert.equal(rows[0].comedianName, 'Comedian 6, Comedian 7');
});

test('upcoming rolls over with the local calendar rather than UTC conversion', () => {
  const before = localCalendarDate(new Date(2026, 9, 18, 23, 59));
  const after = localCalendarDate(new Date(2026, 9, 19, 0, 0));
  assert.equal(before, '2026-10-18');
  assert.equal(after, '2026-10-19');
  assert.equal(upcomingSpecials([candidate(1)], before).length, 1);
  assert.equal(upcomingSpecials([candidate(1)], after).length, 0);
});
