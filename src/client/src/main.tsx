import React, { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Check,
  ChevronLeft,
  Film,
  Play,
  Plus,
  Radar,
  RefreshCcw,
  Save,
  Search,
  Settings,
  Trash2,
  X
} from 'lucide-react';
import type {
  AppSettings,
  Candidate,
  Comedian,
  PersonSearchResult,
  RadarrMonitoredMovie,
  RadarrOptions,
  ScanResult
} from '../../shared/types';
import './styles.css';

const imageBase = 'https://image.tmdb.org/t/p/w342';
const emptyRadarrOptions: RadarrOptions = {
  connected: false,
  qualityProfiles: [],
  rootFolders: []
};
type DetailTab = 'review' | 'monitored' | 'notMonitored';

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers ?? {})
    }
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({ error: response.statusText }))) as { error?: string };
    throw new Error(body.error ?? response.statusText);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

function waitForNextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function countryFlag(countryCode: string | null): string | null {
  if (!countryCode || !/^[A-Z]{2}$/.test(countryCode)) {
    return null;
  }

  return String.fromCodePoint(...[...countryCode].map((letter) => 127397 + letter.charCodeAt(0)));
}

function LaughMark() {
  return (
    <svg className="laughMark" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <circle cx="32" cy="32" r="27" fill="none" stroke="currentColor" strokeWidth="5" />
      <path
        d="M19 23l8 7-8 7M45 23l-8 7 8 7"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="5"
      />
      <path
        d="M18 39h28c-2.4 8.8-8.1 13.2-14 13.2S20.4 47.8 18 39z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="5"
      />
    </svg>
  );
}

function App() {
  const [settings, setSettings] = useState<AppSettings>({
    tmdbBearerToken: '',
    radarrUrl: 'http://localhost:7878',
    radarrApiKey: '',
    radarrQualityProfileId: '',
    radarrRootFolderPath: '',
    radarrMinimumAvailability: 'released',
    autoAddConfidenceThreshold: '95',
    hideBelowConfidenceThreshold: '60'
  });
  const [comedians, setComedians] = useState<Comedian[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [monitoredMovies, setMonitoredMovies] = useState<RadarrMonitoredMovie[]>([]);
  const [name, setName] = useState('');
  const [personMatches, setPersonMatches] = useState<PersonSearchResult[]>([]);
  const [addingPersonId, setAddingPersonId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<DetailTab>('review');
  const [selectedComedianId, setSelectedComedianId] = useState<number | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [showSettingsPage, setShowSettingsPage] = useState(false);
  const [initialDataLoaded, setInitialDataLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [radarrOptions, setRadarrOptions] = useState<RadarrOptions>(emptyRadarrOptions);
  const [radarrChecking, setRadarrChecking] = useState(false);
  const [radarrChecked, setRadarrChecked] = useState(false);
  const addingPersonIdRef = useRef<number | null>(null);

  const selectedComedian = useMemo(
    () => comedians.find((comedian) => comedian.id === selectedComedianId) ?? null,
    [comedians, selectedComedianId]
  );
  const selectedComedianScanning = selectedComedian ? busy === `scan-${selectedComedian.id}` : false;
  const monitoredRadarrIds = useMemo(() => new Set(monitoredMovies.map((movie) => movie.id)), [monitoredMovies]);
  const monitoredTmdbIds = useMemo(
    () => new Set(monitoredMovies.map((movie) => movie.tmdbId).filter((id): id is number => id != null)),
    [monitoredMovies]
  );
  const monitoredMovieByRadarrId = useMemo(
    () => new Map(monitoredMovies.map((movie) => [movie.id, movie])),
    [monitoredMovies]
  );
  const monitoredMovieByTmdbId = useMemo(
    () => new Map(monitoredMovies.filter((movie) => movie.tmdbId != null).map((movie) => [movie.tmdbId as number, movie])),
    [monitoredMovies]
  );
  const notMonitoredCandidates = useMemo(() => {
    if (!selectedComedianId) {
      return [];
    }

    const visible = candidates.filter(
      (candidate) =>
        candidate.comedianId === selectedComedianId &&
        !monitoredTmdbIds.has(candidate.tmdbMovieId) &&
        (candidate.radarrMovieId == null || !monitoredRadarrIds.has(candidate.radarrMovieId))
    );
    return visible.sort((first, second) => second.confidence - first.confidence);
  }, [candidates, monitoredRadarrIds, monitoredTmdbIds, selectedComedianId]);
  const reviewCandidates = useMemo(
    () => notMonitoredCandidates.filter((candidate) => candidate.status === 'new'),
    [notMonitoredCandidates]
  );
  const ignoredNotMonitoredCandidates = useMemo(
    () => notMonitoredCandidates.filter((candidate) => candidate.status !== 'new'),
    [notMonitoredCandidates]
  );
  const comedianResultCounts = useMemo(() => {
    const grouped = new Map<number, Map<number, boolean>>();

    for (const candidate of candidates) {
      const comedianCandidates = grouped.get(candidate.comedianId) ?? new Map<number, boolean>();
      const alreadyMonitored = comedianCandidates.get(candidate.tmdbMovieId) ?? false;
      const isMonitored =
        alreadyMonitored ||
        monitoredTmdbIds.has(candidate.tmdbMovieId) ||
        (candidate.radarrMovieId != null && monitoredRadarrIds.has(candidate.radarrMovieId));

      comedianCandidates.set(candidate.tmdbMovieId, isMonitored);
      grouped.set(candidate.comedianId, comedianCandidates);
    }

    return new Map(
      [...grouped.entries()].map(([comedianId, comedianCandidates]) => [
        comedianId,
        {
          monitored: [...comedianCandidates.values()].filter(Boolean).length,
          total: comedianCandidates.size
        }
      ])
    );
  }, [candidates, monitoredRadarrIds, monitoredTmdbIds]);
  const comedianNewReviewCounts = useMemo(() => {
    const grouped = new Map<number, Set<number>>();

    for (const candidate of candidates) {
      const isMonitored =
        monitoredTmdbIds.has(candidate.tmdbMovieId) ||
        (candidate.radarrMovieId != null && monitoredRadarrIds.has(candidate.radarrMovieId));

      if (candidate.status !== 'new' || isMonitored) {
        continue;
      }

      const comedianCandidates = grouped.get(candidate.comedianId) ?? new Set<number>();
      comedianCandidates.add(candidate.tmdbMovieId);
      grouped.set(candidate.comedianId, comedianCandidates);
    }

    return new Map([...grouped.entries()].map(([comedianId, comedianCandidates]) => [comedianId, comedianCandidates.size]));
  }, [candidates, monitoredRadarrIds, monitoredTmdbIds]);
  const visibleMonitoredRows = useMemo(() => {
    if (!selectedComedianId) {
      return [];
    }

    const seenMovieIds = new Set<number>();
    return candidates
      .filter((candidate) => candidate.comedianId === selectedComedianId)
      .flatMap((candidate) => {
        const movie =
          (candidate.radarrMovieId == null ? null : monitoredMovieByRadarrId.get(candidate.radarrMovieId)) ??
          monitoredMovieByTmdbId.get(candidate.tmdbMovieId);

        if (!movie || seenMovieIds.has(movie.id)) {
          return [];
        }

        seenMovieIds.add(movie.id);
        return [{ movie, candidate }];
      })
      .sort((first, second) => first.movie.title.localeCompare(second.movie.title));
  }, [candidates, monitoredMovieByRadarrId, monitoredMovieByTmdbId, selectedComedianId]);
  const hasReviewCandidates = reviewCandidates.length > 0;
  const hasMonitoredRows = visibleMonitoredRows.length > 0;
  const hasNotMonitoredCandidates = ignoredNotMonitoredCandidates.length > 0;
  const preferredDetailTab: DetailTab = hasReviewCandidates
    ? 'review'
    : hasMonitoredRows
      ? 'monitored'
      : hasNotMonitoredCandidates
        ? 'notMonitored'
        : 'monitored';
  const activeDetailTab =
    activeTab === 'review' && !hasReviewCandidates
      ? preferredDetailTab
      : activeTab === 'monitored' && !hasReviewCandidates && !hasMonitoredRows && hasNotMonitoredCandidates
        ? 'notMonitored'
        : activeTab;
  const setupComplete = Boolean(
    settings.tmdbBearerToken.trim() &&
      settings.radarrUrl.trim() &&
      settings.radarrApiKey.trim() &&
      settings.radarrQualityProfileId.trim() &&
      settings.radarrRootFolderPath.trim()
  );
  const showingSettings = initialDataLoaded && (showSettingsPage || !setupComplete);

  async function load(): Promise<AppSettings> {
    const [nextSettings, nextComedians, nextCandidates, nextMonitoredMovies] = await Promise.all([
      api<AppSettings>('/api/settings'),
      api<Comedian[]>('/api/comedians'),
      api<Candidate[]>('/api/candidates'),
      api<RadarrMonitoredMovie[]>('/api/radarr/movies').catch(() => [])
    ]);
    setSettings(nextSettings);
    setComedians(nextComedians);
    setCandidates(nextCandidates);
    setMonitoredMovies(nextMonitoredMovies);
    return nextSettings;
  }

  async function run<T>(label: string, task: () => Promise<T>, success?: (result: T) => string) {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      const result = await task();
      if (success) {
        setNotice(success(result));
      }
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong.');
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    async function loadInitialData() {
      try {
        const nextSettings = await load();
        setInitialDataLoaded(true);
        await testRadarrConnection(nextSettings, { quiet: true });
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Unable to load Chucklarr.');
        setInitialDataLoaded(true);
      }
    }

    loadInitialData();
  }, []);

  useEffect(() => {
    if (selectedComedianId == null && comedians.length > 0) {
      setSelectedComedianId(comedians[0].id);
      setActiveTab('review');
    }
  }, [comedians, selectedComedianId]);

  useEffect(() => {
    if (!notice && !error) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setNotice(null);
      setError(null);
    }, error ? 7000 : 4500);

    return () => window.clearTimeout(timeout);
  }, [error, notice]);

  useEffect(() => {
    if (selectedComedianId == null) {
      return;
    }

    setActiveTab(preferredDetailTab);
  }, [preferredDetailTab, selectedComedianId]);

  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    const nextSetupComplete = Boolean(
      settings.tmdbBearerToken.trim() &&
        settings.radarrUrl.trim() &&
        settings.radarrApiKey.trim() &&
        settings.radarrQualityProfileId.trim() &&
        settings.radarrRootFolderPath.trim()
    );

    await run(
      'settings',
      () =>
        api<AppSettings>('/api/settings', {
          method: 'PUT',
          body: JSON.stringify(settings)
      }),
      () => 'Settings saved.'
    );

    if (nextSetupComplete) {
      setShowSettingsPage(false);
    }
  }

  async function testRadarrConnection(
    settingsToTest = settings,
    options: { quiet?: boolean } = {}
  ) {
    if (!settingsToTest.radarrUrl.trim() || !settingsToTest.radarrApiKey.trim()) {
      return;
    }

    if (!options.quiet) {
      setBusy('radarr-test');
      setError(null);
      setNotice(null);
    }
    setRadarrChecking(true);
    setRadarrChecked(true);
    setRadarrOptions(emptyRadarrOptions);

    try {
      const nextRadarrOptions = await api<RadarrOptions>('/api/radarr/options', {
        method: 'POST',
        body: JSON.stringify(settingsToTest)
      });

      if (nextRadarrOptions.connected) {
        setRadarrOptions(nextRadarrOptions);
      } else if (!options.quiet) {
        setRadarrOptions({
          ...emptyRadarrOptions,
          error: 'Could not connect to Radarr. Check the URL and API key, then try again.'
        });
      }

      if (nextRadarrOptions.connected && !options.quiet) {
        setNotice('Radarr connected. Choose a quality profile and root folder.');
      }
    } catch (caught) {
      if (!options.quiet) {
        setRadarrOptions({
          ...emptyRadarrOptions,
          error: caught instanceof Error ? caught.message : 'Unable to connect to Radarr.'
        });
      }
    } finally {
      setRadarrChecking(false);
      if (!options.quiet) {
        setBusy(null);
      }
    }
  }

  function updateRadarrConnectionSetting(update: Partial<AppSettings>) {
    setSettings({
      ...settings,
      ...update,
      radarrQualityProfileId: '',
      radarrRootFolderPath: ''
    });
    setRadarrOptions(emptyRadarrOptions);
    setRadarrChecked(false);
  }

  async function addComedian(event: FormEvent) {
    event.preventDefault();
    const nextName = name.trim();
    if (!nextName) return;

    await run(
      'search-comedian',
      () => api<PersonSearchResult[]>(`/api/comedians/search?q=${encodeURIComponent(nextName)}`),
      (matches) => {
        setPersonMatches(matches);
        return matches.length === 0 ? `No TMDB people found for ${nextName}.` : `Found ${matches.length} possible matches.`;
      }
    );
  }

  async function addComedianMatch(match: PersonSearchResult) {
    if (addingPersonIdRef.current !== null) {
      return;
    }

    addingPersonIdRef.current = match.tmdbPersonId;
    setAddingPersonId(match.tmdbPersonId);
    setBusy('add-comedian');
    setError(null);
    setNotice(null);

    try {
      const comedian = await api<Comedian>('/api/comedians', {
        method: 'POST',
        body: JSON.stringify({
          name: match.name,
          tmdbPersonId: match.tmdbPersonId,
          profilePath: match.profilePath
        })
      });

      setNotice(`Added ${comedian.name}.`);
      setSelectedComedianId(comedian.id);
      setActiveTab('review');
      setDetailOpen(true);
      setName('');
      setPersonMatches([]);
      await load();
      await waitForNextPaint();

      if ((comedian.tmdbPersonId || match.tmdbPersonId) && !comedian.lastScannedAt) {
        setBusy(`scan-${comedian.id}`);
        const result = await api<ScanResult>(`/api/comedians/${comedian.id}/scan`, { method: 'POST' });
        setNotice(`${result.comedian.name}: ${result.saved} candidates saved.`);
        await load();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong.');
    } finally {
      addingPersonIdRef.current = null;
      setAddingPersonId(null);
      setBusy(null);
    }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <h1 className="brandTitle">
            <LaughMark />
            <span>Chucklarr</span>
          </h1>
          <p className="eyebrow brandSubtitle">A Radarr companion</p>
        </div>
        <div className="topbarActions">
          {!initialDataLoaded ? null : showingSettings ? (
            setupComplete && (
              <button onClick={() => setShowSettingsPage(false)}>
                <Film size={16} />
                Library
              </button>
            )
          ) : (
            <>
              <button onClick={() => setShowSettingsPage(true)}>
                <Settings size={16} />
                Settings
              </button>
              <button
                className="primary"
                disabled={busy === 'scan-all' || comedians.length === 0}
                onClick={() =>
                  run(
                    'scan-all',
                    () => api<ScanResult[]>('/api/scan', { method: 'POST' }),
                    (results) => `Scanned ${results.length} comedians.`
                  )
                }
              >
                <Radar size={18} />
                Scan all
              </button>
            </>
          )}
        </div>
      </header>

      {(notice || error) && (
        <div className={error ? 'toast error' : 'toast'} role={error ? 'alert' : 'status'} aria-live={error ? 'assertive' : 'polite'}>
          <span>{error ?? notice}</span>
          <button aria-label="Dismiss" onClick={() => (error ? setError(null) : setNotice(null))}>
            <X size={16} />
          </button>
        </div>
      )}

      <section className={showingSettings ? 'workspace settingsWorkspace' : 'workspace libraryWorkspace'}>
        {!initialDataLoaded && (
          <div className="panel loadingPanel">
            <RefreshCcw className="spin" size={18} />
            <span>Loading Chucklarr</span>
          </div>
        )}
        {showingSettings && (
        <aside className="panel settingsPanel">
          <div className="panelHeader">
            <Settings size={18} />
            <h2>Settings</h2>
          </div>
          <form className="settingsGrid" onSubmit={saveSettings}>
            <label>
              TMDB bearer token
              <input
                type="password"
                value={settings.tmdbBearerToken}
                onChange={(event) => setSettings({ ...settings, tmdbBearerToken: event.target.value })}
              />
            </label>
            <label>
              Radarr URL
              <input
                value={settings.radarrUrl}
                onChange={(event) => updateRadarrConnectionSetting({ radarrUrl: event.target.value })}
              />
            </label>
            <label>
              Radarr API key
              <input
                type="password"
                value={settings.radarrApiKey}
                onChange={(event) => updateRadarrConnectionSetting({ radarrApiKey: event.target.value })}
              />
            </label>
            {!radarrOptions.connected && (
              <button
                type="button"
                disabled={
                  busy === 'radarr-test' ||
                  radarrChecking ||
                  !settings.radarrUrl.trim() ||
                  !settings.radarrApiKey.trim()
                }
                onClick={() => testRadarrConnection()}
              >
                <Radar size={16} />
                Test connection
              </button>
            )}
            <div className={radarrOptions.connected ? 'connectionStatus connected' : 'connectionStatus'}>
              {radarrOptions.connected && 'Radarr connected'}
              {!radarrOptions.connected && radarrChecking && 'Checking Radarr connection...'}
              {!radarrOptions.connected &&
                !radarrChecking &&
                (radarrOptions.error ??
                  (radarrChecked
                    ? 'Test Radarr connection to choose a profile and root folder.'
                    : 'Enter Radarr URL and API key to test connection.'))}
            </div>
            {radarrOptions.connected && (
              <>
                <label>
                  Quality profile
                  <select
                    value={settings.radarrQualityProfileId}
                    onChange={(event) => setSettings({ ...settings, radarrQualityProfileId: event.target.value })}
                  >
                    <option value="">Choose a quality profile</option>
                    {radarrOptions.qualityProfiles.map((profile) => (
                      <option key={profile.id} value={String(profile.id)}>
                        {profile.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Root folder
                  <select
                    value={settings.radarrRootFolderPath}
                    onChange={(event) => setSettings({ ...settings, radarrRootFolderPath: event.target.value })}
                  >
                    <option value="">Choose a root folder</option>
                    {radarrOptions.rootFolders.map((folder) => (
                      <option key={folder.path} value={folder.path}>
                        {folder.path}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            <label>
              Minimum availability
              <select
                value={settings.radarrMinimumAvailability}
                onChange={(event) => setSettings({ ...settings, radarrMinimumAvailability: event.target.value })}
              >
                <option value="announced">Announced</option>
                <option value="inCinemas">In cinemas</option>
                <option value="released">Released</option>
              </select>
            </label>
            <label>
              Auto-add above
              <input
                type="number"
                min="0"
                max="100"
                value={settings.autoAddConfidenceThreshold}
                onChange={(event) => setSettings({ ...settings, autoAddConfidenceThreshold: event.target.value })}
              />
            </label>
            <label>
              Auto-ignore below
              <input
                type="number"
                min="0"
                max="100"
                value={settings.hideBelowConfidenceThreshold}
                onChange={(event) => setSettings({ ...settings, hideBelowConfidenceThreshold: event.target.value })}
              />
            </label>
            <button className="secondary" disabled={busy === 'settings'}>
              <Save size={16} />
              Save
            </button>
          </form>
        </aside>
        )}

        {initialDataLoaded && !showingSettings && (
        <section className={detailOpen ? 'mainColumn detailOpen' : 'mainColumn'}>
          <div className="panel comedianPanel">
            <div className="panelHeader">
              <Search size={18} />
              <h2>Comedians</h2>
            </div>
            <form className="addRow" onSubmit={addComedian}>
              <input
                placeholder="Bill Burr, Taylor Tomlinson, Hannah Gadsby..."
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setPersonMatches([]);
                }}
              />
              <button className="primary" disabled={busy === 'search-comedian'}>
                <Search size={18} />
                Search
              </button>
            </form>
            {personMatches.length > 0 && (
              <div className="personMatches">
                <div className="searchResultsHeader">
                  <strong>Search results</strong>
                  <span>{personMatches.length} {personMatches.length === 1 ? 'match' : 'matches'}</span>
                </div>
                {personMatches.map((match) => (
                  <article className="personMatch" key={match.tmdbPersonId}>
                    <div className="avatar">
                      {match.profilePath ? (
                        <img src={`${imageBase}${match.profilePath}`} alt="" />
                      ) : (
                        <span>{match.name.slice(0, 1).toUpperCase()}</span>
                      )}
                    </div>
                    <div>
                      <strong>{match.name}</strong>
                      <span>{match.knownFor.length > 0 ? match.knownFor.join(' · ') : `TMDB ${match.tmdbPersonId}`}</span>
                    </div>
                    <button
                      type="button"
                      className="primary"
                      disabled={busy === 'add-comedian' || addingPersonId !== null}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        addComedianMatch(match);
                      }}
                    >
                      {addingPersonId === match.tmdbPersonId ? (
                        <RefreshCcw className="spin" size={16} />
                      ) : (
                        <Plus size={16} />
                      )}
                      {addingPersonId === match.tmdbPersonId ? 'Adding' : 'Select'}
                    </button>
                  </article>
                ))}
              </div>
            )}
            <div className="listDivider">
              <span>Saved comedians</span>
            </div>
            <div className="comedianList">
              {comedians.map((comedian) => {
                const isScanning = busy === `scan-${comedian.id}`;
                const selected = selectedComedianId === comedian.id;
                const resultCount = comedianResultCounts.get(comedian.id) ?? { monitored: 0, total: 0 };
                const newReviewCount = comedianNewReviewCounts.get(comedian.id) ?? 0;
                const flag = countryFlag(comedian.countryCode);

                return (
                  <article
                    className={selected ? 'comedianItem selected' : 'comedianItem'}
                    key={comedian.id}
                    onClick={() => {
                      setSelectedComedianId(comedian.id);
                      setActiveTab('review');
                      setDetailOpen(true);
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="avatar">
                      {comedian.profilePath ? (
                        <img src={`${imageBase}${comedian.profilePath}`} alt="" />
                      ) : (
                        <span>{comedian.name.slice(0, 1).toUpperCase()}</span>
                      )}
                    </div>
                    <div>
                      <div className="comedianTitle">
                        <strong>{comedian.name}</strong>
                        {flag && (
                          <span className="originFlag" title={comedian.countryName ?? comedian.placeOfBirth ?? undefined}>
                            {flag}
                          </span>
                        )}
                      </div>
                      <div className="comedianMeta">
                        {isScanning && <span className="scanBadge">Scanning</span>}
                        {newReviewCount > 0 && (
                          <span className="newReviewBadge" title={`${newReviewCount} new ${newReviewCount === 1 ? 'candidate' : 'candidates'} to review`}>
                            NEW {newReviewCount}
                          </span>
                        )}
                        <span className="resultCounter" title={`${resultCount.monitored} monitored out of ${resultCount.total} possible results`}>
                          {resultCount.monitored} / {resultCount.total} monitored
                        </span>
                      </div>
                    </div>
                    <div className="rowActions">
                      <button
                        title={isScanning ? 'Scanning now' : 'Scan comedian'}
                        aria-label={isScanning ? 'Scanning now' : 'Scan comedian'}
                        disabled={isScanning || !comedian.tmdbPersonId}
                        onClick={(event) => {
                          event.stopPropagation();
                          run(
                            `scan-${comedian.id}`,
                            () => api<ScanResult>(`/api/comedians/${comedian.id}/scan`, { method: 'POST' }),
                            (result) => `${result.comedian.name}: ${result.saved} candidates saved.`
                          );
                        }}
                      >
                        <RefreshCcw className={isScanning ? 'spin' : undefined} size={16} />
                      </button>
                      <button
                        title="Delete comedian"
                        onClick={(event) => {
                          event.stopPropagation();
                          run(`delete-${comedian.id}`, () =>
                            api<void>(`/api/comedians/${comedian.id}`, { method: 'DELETE' })
                          );
                        }}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </article>
                );
              })}
              {comedians.length === 0 && <p className="empty">Add a comedian to start tracking specials.</p>}
            </div>
          </div>

          <div className="panel detailPanel">
            <div className="panelHeader spread">
              <div>
                <div className="inlineTitle">
                  <button className="mobileBack" onClick={() => setDetailOpen(false)} aria-label="Back to comedians">
                    <ChevronLeft size={16} />
                  </button>
                  <Film size={18} />
                  <h2>
                    {selectedComedian ? selectedComedian.name : 'Select a comedian'}
                    {selectedComedian && countryFlag(selectedComedian.countryCode) && (
                      <span className="headingFlag" title={selectedComedian.countryName ?? selectedComedian.placeOfBirth ?? undefined}>
                        {countryFlag(selectedComedian.countryCode)}
                      </span>
                    )}
                  </h2>
                </div>
                <p>
                  {selectedComedian ? 'Review possible specials and current Radarr matches.' : 'Choose a comedian to review matches.'}
                </p>
              </div>
            </div>
            {selectedComedianScanning && (
              <div className="scanNotice">
                <RefreshCcw className="spin" size={17} />
                <span>Scanning for new content</span>
              </div>
            )}
            <div className="tabs desktopTabs">
              {hasReviewCandidates && (
                <button className={activeDetailTab === 'review' ? 'tab active' : 'tab'} onClick={() => setActiveTab('review')}>
                  <span>To review</span>
                  <span className="tabCount">{reviewCandidates.length}</span>
                </button>
              )}
              <button className={activeDetailTab === 'monitored' ? 'tab active' : 'tab'} onClick={() => setActiveTab('monitored')}>
                <span>Monitored</span>
                <span className="tabCount">{visibleMonitoredRows.length}</span>
              </button>
              <button className={activeDetailTab === 'notMonitored' ? 'tab active' : 'tab'} onClick={() => setActiveTab('notMonitored')}>
                <span>Not monitored</span>
                <span className="tabCount">{ignoredNotMonitoredCandidates.length}</span>
              </button>
            </div>
            <div className="desktopTabPanels">
              {activeDetailTab === 'review' && (
                <div className="candidateGrid">
                  {reviewCandidates.map((candidate) => (
                    <CandidateCard key={candidate.id} candidate={candidate} busy={busy} run={run} />
                  ))}
                  {reviewCandidates.length === 0 && !selectedComedianScanning && (
                    <p className="empty">
                      {selectedComedian ? 'No new items to review for this comedian.' : 'Choose a comedian to review possible specials.'}
                    </p>
                  )}
                </div>
              )}
              {activeDetailTab === 'monitored' && (
                <div className="monitoredList">
                  {visibleMonitoredRows.map(({ movie, candidate }) => (
                    <MonitoredMovieRow key={movie.id} movie={movie} candidate={candidate} busy={busy} run={run} />
                  ))}
                  {visibleMonitoredRows.length === 0 && !selectedComedianScanning && (
                    <p className="empty">
                      {selectedComedian ? 'No monitored Radarr items matched this comedian yet.' : 'Choose a comedian to see monitored Radarr items.'}
                    </p>
                  )}
                </div>
              )}
              {activeDetailTab === 'notMonitored' && (
                <div className="candidateGrid">
                  {ignoredNotMonitoredCandidates.map((candidate) => (
                    <CandidateCard key={candidate.id} candidate={candidate} busy={busy} run={run} />
                  ))}
                  {ignoredNotMonitoredCandidates.length === 0 && !selectedComedianScanning && (
                    <p className="empty">
                      {selectedComedian ? 'No ignored or unmonitored candidates for this comedian.' : 'Choose a comedian to see not monitored candidates.'}
                    </p>
                  )}
                </div>
              )}
            </div>
            <div className="detailSections">
              {hasReviewCandidates && (
                <section className="detailSection">
                  <div className="detailSectionHeader">
                    <h3>To review</h3>
                    <span className="sectionCount">{reviewCandidates.length}</span>
                  </div>
                  <div className="candidateGrid">
                    {reviewCandidates.map((candidate) => (
                      <CandidateCard key={candidate.id} candidate={candidate} busy={busy} run={run} />
                    ))}
                  </div>
                </section>
              )}

              {(hasMonitoredRows || !hasNotMonitoredCandidates) && (
                <section className="detailSection">
                  <div className="detailSectionHeader">
                    <h3>Monitored</h3>
                    <span className="sectionCount">{visibleMonitoredRows.length}</span>
                  </div>
                  <div className="monitoredList">
                    {visibleMonitoredRows.map(({ movie, candidate }) => (
                      <MonitoredMovieRow key={movie.id} movie={movie} candidate={candidate} busy={busy} run={run} />
                    ))}
                    {visibleMonitoredRows.length === 0 && !selectedComedianScanning && (
                      <p className="empty">
                        {selectedComedian ? 'No monitored Radarr items matched this comedian yet.' : 'Choose a comedian to see monitored Radarr items.'}
                      </p>
                    )}
                  </div>
                </section>
              )}

              {hasNotMonitoredCandidates && (
                <section className="detailSection">
                  <div className="detailSectionHeader">
                    <h3>Not monitored</h3>
                    <span className="sectionCount">{ignoredNotMonitoredCandidates.length}</span>
                  </div>
                  <div className="candidateGrid">
                    {ignoredNotMonitoredCandidates.map((candidate) => (
                      <CandidateCard key={candidate.id} candidate={candidate} busy={busy} run={run} />
                    ))}
                    {ignoredNotMonitoredCandidates.length === 0 && !selectedComedianScanning && (
                      <p className="empty">
                        {selectedComedian ? 'No ignored or unmonitored candidates for this comedian.' : 'Choose a comedian to see not monitored candidates.'}
                      </p>
                    )}
                  </div>
                </section>
              )}
            </div>
          </div>
        </section>
        )}
      </section>
    </main>
  );
}

type RunFn = <T>(label: string, task: () => Promise<T>, success?: (result: T) => string) => Promise<void>;

function MonitoredMovieRow({
  movie,
  candidate,
  busy,
  run
}: {
  movie: RadarrMonitoredMovie;
  candidate: Candidate | null;
  busy: string | null;
  run: RunFn;
}) {
  const canManageRadarr = Boolean(candidate?.radarrMovieId && !movie.hasFile);
  const unmonitoring = candidate ? busy === `unmonitor-radarr-${candidate.id}` : false;
  const removing = candidate ? busy === `remove-radarr-${candidate.id}` : false;

  return (
    <article className="monitoredItem">
      <div
        className={movie.hasFile ? 'monitoredStatus downloaded' : 'monitoredStatus'}
        title={movie.hasFile ? 'Downloaded' : 'Monitored'}
        aria-label={movie.hasFile ? 'Downloaded' : 'Monitored'}
      >
        {movie.hasFile ? <Check size={17} /> : <Radar size={17} />}
      </div>
      <div>
        <strong>{movie.title}</strong>
        <span>
          {movie.year ? `${movie.year} · ` : ''}
          {movie.hasFile ? 'Downloaded' : 'Monitored'}
          {movie.tmdbId ? ` · TMDB ${movie.tmdbId}` : ''}
        </span>
      </div>
      <span className="monitoredPath">{movie.path ?? 'No path'}</span>
      {canManageRadarr && candidate && (
        <div className="monitoredActions">
          <button
            title="Unmonitor"
            aria-label={`Unmonitor ${movie.title}`}
            disabled={unmonitoring}
            onClick={() =>
              run(
                `unmonitor-radarr-${candidate.id}`,
                () => api<Candidate>(`/api/candidates/${candidate.id}/unmonitor-radarr`, { method: 'POST' }),
                () => `${movie.title} unmonitored in Radarr.`
              )
            }
          >
            {unmonitoring ? <RefreshCcw className="spin" size={16} /> : <Radar size={16} />}
          </button>
          <button
            title="Remove from Radarr"
            aria-label={`Remove ${movie.title} from Radarr`}
            disabled={removing}
            onClick={() =>
              run(
                `remove-radarr-${candidate.id}`,
                () => api<Candidate>(`/api/candidates/${candidate.id}/remove-from-radarr`, { method: 'POST' }),
                () => `${movie.title} removed from Radarr.`
              )
            }
          >
            {removing ? <RefreshCcw className="spin" size={16} /> : <Trash2 size={16} />}
          </button>
        </div>
      )}
    </article>
  );
}

function CandidateCard({ candidate, busy, run }: { candidate: Candidate; busy: string | null; run: RunFn }) {
  const autoAdded = candidate.status === 'auto_added';
  const canAddToRadarr = candidate.status === 'new' || candidate.status === 'ignored' || (candidate.status === 'approved' && candidate.radarrMovieId != null);
  const canIgnore = candidate.status === 'new';
  const actionable = canAddToRadarr || autoAdded || canIgnore;
  const acking = busy === `ack-${candidate.id}`;
  const approving = busy === `approve-${candidate.id}`;
  const ignoring = busy === `ignore-${candidate.id}`;

  return (
    <article className="candidate">
      <div className="poster">
        {candidate.posterPath ? <img src={`${imageBase}${candidate.posterPath}`} alt="" /> : <Film size={30} />}
      </div>
      <div className="candidateBody">
        <div className="candidateTop">
          <div>
            <h3>{candidate.title}</h3>
            <p>{candidate.comedianName}{candidate.year ? ` · ${candidate.year}` : ''}</p>
          </div>
          <strong className={candidate.confidence >= 70 ? 'score high' : 'score'}>{candidate.confidence}</strong>
        </div>
        <p className="overview">{candidate.overview || 'No overview available.'}</p>
        <p className="candidateStatus">{candidate.status.replace('_', ' ')}</p>
        {actionable && (
          <div className="candidateActions">
            {autoAdded && (
              <button
                className="primary"
                disabled={acking}
                onClick={() =>
                  run(
                    `ack-${candidate.id}`,
                    () =>
                      api<Candidate>(`/api/candidates/${candidate.id}`, {
                        method: 'PATCH',
                        body: JSON.stringify({ status: 'approved' })
                      }),
                    () => `${candidate.title} acknowledged.`
                  )
                }
              >
                {acking ? <RefreshCcw className="spin" size={16} /> : <Check size={16} />}
                {acking ? 'Saving' : 'OK'}
              </button>
            )}
            {canAddToRadarr && (
              <button
                className="primary"
                disabled={approving}
                onClick={() =>
                  run(
                    `approve-${candidate.id}`,
                    () => api<Candidate>(`/api/candidates/${candidate.id}/approve`, { method: 'POST' }),
                    () => `${candidate.title} sent to Radarr.`
                  )
                }
              >
                {approving ? <RefreshCcw className="spin" size={16} /> : <Play size={16} />}
                {approving ? 'Adding to Radarr' : 'Add to Radarr'}
              </button>
            )}
            {canIgnore && (
              <button
                disabled={ignoring}
                onClick={() =>
                  run(`ignore-${candidate.id}`, () =>
                    api<Candidate>(`/api/candidates/${candidate.id}`, {
                      method: 'PATCH',
                      body: JSON.stringify({ status: 'ignored' })
                    })
                  )
                }
              >
                {ignoring ? <RefreshCcw className="spin" size={16} /> : <Check size={16} />}
                {ignoring ? 'Ignoring' : 'Ignore'}
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
