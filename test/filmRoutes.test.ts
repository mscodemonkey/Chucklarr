/**
 * Exercises film HTTP routes against local fake metadata and Radarr servers.
 * The suite owns an isolated SQLite database and disables background startup.
 * No test can reach a configured user library or modify real movie files.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import type { AddressInfo } from 'node:net';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'chucklarr-films-'));
process.env.DATABASE_PATH = path.join(temp, 'isolated.db');
process.env.NODE_ENV = 'test';
const db = await import('../src/server/db');
const { app } = await import('../src/server/index');
const comedian = db.createComedian({
  name: 'Avery Standup',
  tmdbPersonId: 5001,
  profilePath: null,
  placeOfBirth: null,
  countryCode: null,
  countryName: null
});
const noIdentity = db.createComedian({
  name: 'Unknown',
  tmdbPersonId: null,
  profilePath: null,
  placeOfBirth: null,
  countryCode: null,
  countryName: null
});
db.upsertCandidate({
  comedianId: comedian.id,
  tmdbMovieId: 101,
  title: 'Known special',
  year: 2026,
  overview: '',
  posterPath: null,
  releaseDate: '2026-01-01',
  confidence: 90,
  reasons: [],
  status: 'ignored',
  radarrMovieId: null
});
let metadataFailure = false;
let metadataDelay = 0;
let radarrFailure = false;
let duplicate = false;
let movies: Array<Record<string, unknown>> = [];
const writes: Array<Record<string, unknown>> = [];
const timers = new Set<ReturnType<typeof setTimeout>>();
function json(response: http.ServerResponse, body: unknown, status = 200) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}
const remote = http.createServer(async (request, response) => {
  if (request.url?.includes('/movie_credits')) {
    const send = () =>
      json(
        response,
        metadataFailure
          ? {}
          : {
              cast: [
                { id: 101, title: 'Known special' },
                { id: 102, title: 'A proper film', character: 'A friend', release_date: '2026-01-01' }
              ],
              crew: [{ id: 999, title: 'Crew only' }]
            },
        metadataFailure ? 503 : 200
      );
    if (metadataDelay) {
      const timer = setTimeout(() => {
        timers.delete(timer);
        send();
      }, metadataDelay);
      timers.add(timer);
    } else send();
    return;
  }
  if (radarrFailure) {
    json(response, { error: 'down' }, 503);
    return;
  }
  if (request.method === 'GET' && request.url === '/api/v3/movie') {
    json(response, movies);
    return;
  }
  if (request.method === 'GET' && request.url === '/api/v3/movie/42') {
    json(response, movies[0]);
    return;
  }
  if (request.method === 'POST' || request.method === 'PUT') {
    let body = '';
    for await (const chunk of request) body += chunk;
    const parsed = JSON.parse(body);
    writes.push(parsed);
    if (duplicate && request.method === 'POST') {
      movies = [
        { id: 42, tmdbId: null, title: 'A proper film', path: '/test-library/film', monitored: false }
      ];
      json(
        response,
        [{ propertyName: 'Path', errorCode: 'MoviePathValidator', attemptedValue: '/test-library/film' }],
        400
      );
      return;
    }
    movies = [{ ...parsed, id: 42, monitored: true }];
    json(response, movies[0]);
    return;
  }
  json(response, {}, 404);
});
remote.listen(0, '127.0.0.1');
await once(remote, 'listening');
const remoteUrl = `http://127.0.0.1:${(remote.address() as AddressInfo).port}`;
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const filmsPath = `/api/comedians/${comedian.id}/films`;
const request = (url: string, post = false) =>
  fetch(
    base + url,
    post
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'Untrusted browser title' })
        }
      : undefined
  );

test.beforeEach(() => {
  metadataFailure = false;
  metadataDelay = 0;
  radarrFailure = false;
  duplicate = false;
  movies = [];
  writes.length = 0;
  db.updateSettings({
    metadataSource: 'service',
    metadataServiceUrl: remoteUrl,
    radarrUrl: remoteUrl,
    radarrApiKey: 'synthetic',
    radarrRootFolderPath: '/test-library',
    radarrQualityProfileId: '7',
    radarrMinimumAvailability: 'announced'
  });
});
test.after(async () => {
  for (const timer of timers) clearTimeout(timer);
  await Promise.all([
    new Promise<void>((resolve) => server.close(() => resolve())),
    new Promise<void>((resolve) => remote.close(() => resolve()))
  ]);
  fs.rmSync(temp, { recursive: true, force: true });
});

test('film routes strictly validate IDs, membership and identity', async () => {
  for (const id of ['1e3', '0', '-1', 'abc', '0x10', '9007199254740993'])
    assert.equal((await request(`/api/comedians/${id}/films`)).status, 400);
  assert.equal((await request('/api/comedians/9999/films')).status, 404);
  assert.equal((await request(`/api/comedians/${noIdentity.id}/films`)).status, 400);
  assert.equal((await request(filmsPath + '/1e3/add', true)).status, 400);
  assert.equal((await request(filmsPath + '/999/add', true)).status, 404);
  assert.equal((await request(filmsPath + '/101/add', true)).status, 404);
  assert.equal(writes.length, 0);
});

test('film GET filters known specials and exposes only matched, path-free Radarr states', async () => {
  movies = [
    { id: 42, tmdbId: 102, title: 'A proper film', monitored: false, hasFile: true, path: '/private-path' },
    { id: 43, tmdbId: 999, path: '/unrelated' }
  ];
  const response = await request(filmsPath);
  const result = await response.json();
  assert.deepEqual(
    result.films.map((film: { tmdbMovieId: number }) => film.tmdbMovieId),
    [102]
  );
  assert.deepEqual(result.states, [{ tmdbId: 102, radarrId: 42, monitored: false, hasFile: true }]);
  assert.equal(result.statusAvailable, true);
  assert.doesNotMatch(JSON.stringify(result), /private-path|unrelated|synthetic|radarrApiKey/);
  assert.equal(writes.length, 0);
});

test('film GET distinguishes unavailable and unconfigured Radarr from an empty library', async () => {
  radarrFailure = true;
  assert.equal((await (await request(filmsPath)).json()).statusAvailable, false);
  radarrFailure = false;
  db.updateSettings({ radarrApiKey: '' });
  const result = await (await request(filmsPath)).json();
  assert.equal(result.statusAvailable, false);
  assert.equal(result.films.length, 1);
  assert.equal((await request(filmsPath + '/102/add', true)).status, 400);
});

test('metadata errors fail closed for reads and explicit adds', async () => {
  metadataFailure = true;
  assert.equal((await request(filmsPath)).status, 502);
  assert.equal((await request(filmsPath + '/102/add', true)).status, 502);
  assert.equal(writes.length, 0);
});

test('explicit film add uses saved Radarr options and never creates a special candidate', async () => {
  const count = db.listCandidates().length;
  assert.equal((await request(filmsPath + '/102/add', true)).status, 200);
  assert.equal(db.listCandidates().length, count);
  assert.equal(writes[0].title, 'A proper film');
  assert.equal(writes[0].tmdbId, 102);
  assert.equal(writes[0].qualityProfileId, 7);
  assert.equal(writes[0].rootFolderPath, '/test-library');
  assert.equal(writes[0].minimumAvailability, 'announced');
});

test('film add re-monitors existing films and retains duplicate-path recovery', async () => {
  movies = [{ id: 42, tmdbId: 102, title: 'A proper film', monitored: false }];
  assert.equal((await request(filmsPath + '/102/add', true)).status, 200);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].monitored, true);
  movies = [];
  writes.length = 0;
  duplicate = true;
  assert.equal((await request(filmsPath + '/102/add', true)).status, 200);
  assert.equal(writes.length, 2);
  assert.equal(writes[1].monitored, true);
});

test('concurrent duplicate film additions return 409 and release their lock afterwards', async () => {
  metadataDelay = 100;
  const first = request(filmsPath + '/102/add', true);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal((await request(filmsPath + '/102/add', true)).status, 409);
  assert.equal((await first).status, 200);
  assert.equal((await request(filmsPath + '/102/add', true)).status, 200);
});

test('film metadata timeout yields 502 with no external writes', async () => {
  metadataDelay = 10_200;
  assert.equal((await request(filmsPath)).status, 502);
  assert.equal(writes.length, 0);
});
