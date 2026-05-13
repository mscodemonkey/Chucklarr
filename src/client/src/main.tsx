import React, { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Check,
  ChevronLeft,
  Download,
  Eye,
  ExternalLink,
  Film,
  Play,
  Plus,
  Radar,
  RefreshCcw,
  Save,
  Search,
  Settings,
  Trash2,
  Upload,
  X
} from 'lucide-react';
import type {
  AppSettings,
  Candidate,
  Comedian,
  PersonSearchResult,
  RadarrMonitoredMovie,
  RadarrOptions,
  RestoreSummary,
  ScanResult
} from '../../shared/types';
import { createTranslator, normaliseLanguage, supportedLanguages } from './i18n';
import './styles.css';

const imageBase = 'https://image.tmdb.org/t/p/w342';
const emptyRadarrOptions: RadarrOptions = {
  connected: false,
  qualityProfiles: [],
  rootFolders: []
};
type DetailTab = 'review' | 'monitored' | 'notMonitored';
type Translator = ReturnType<typeof createTranslator>;

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

function backupFilename(disposition: string | null): string {
  const match = disposition?.match(/filename="?([^"]+)"?/);
  return match?.[1] ?? `chucklarr-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
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
    automaticDailyScanLastRunDate: ''
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
  const backupInputRef = useRef<HTMLInputElement | null>(null);
  const _t = useMemo(() => createTranslator(settings.language), [settings.language]);
  const theme = settings.theme === 'light' || settings.theme === 'dark' ? settings.theme : 'system';

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
      if (isWeakRadarrOnlyMatch(candidate)) {
        continue;
      }

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
      if (isWeakRadarrOnlyMatch(candidate)) {
        continue;
      }

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
      .filter((candidate) => candidate.comedianId === selectedComedianId && !isWeakRadarrOnlyMatch(candidate))
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
  const metadataConfigured =
    settings.metadataSource === 'tmdb' ? settings.tmdbBearerToken.trim() : settings.metadataServiceUrl.trim();
  const setupComplete = Boolean(
    metadataConfigured &&
      settings.radarrUrl.trim() &&
      settings.radarrApiKey.trim() &&
      settings.radarrQualityProfileId.trim() &&
      settings.radarrRootFolderPath.trim()
  );

  function setupCompleteFor(nextSettings: AppSettings) {
    const nextMetadataConfigured =
      nextSettings.metadataSource === 'tmdb' ? nextSettings.tmdbBearerToken.trim() : nextSettings.metadataServiceUrl.trim();
    return Boolean(
      nextMetadataConfigured &&
        nextSettings.radarrUrl.trim() &&
        nextSettings.radarrApiKey.trim() &&
        nextSettings.radarrQualityProfileId.trim() &&
        nextSettings.radarrRootFolderPath.trim()
    );
  }
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
      setError(caught instanceof Error ? caught.message : _t('error.generic'));
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
        setError(caught instanceof Error ? caught.message : _t('error.load'));
        setInitialDataLoaded(true);
      }
    }

    loadInitialData();
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    function applyTheme() {
      document.documentElement.dataset.theme = theme === 'system' ? (mediaQuery.matches ? 'dark' : 'light') : theme;
      document.documentElement.style.colorScheme = theme === 'system' ? 'light dark' : theme;
    }

    applyTheme();
    mediaQuery.addEventListener('change', applyTheme);
    return () => mediaQuery.removeEventListener('change', applyTheme);
  }, [theme]);

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

  async function persistSettings(
    nextSettings: AppSettings,
    options: { closeWhenSetupComplete?: boolean; notify?: boolean } = {}
  ) {
    setBusy('settings');
    setError(null);
    try {
      const savedSettings = await api<AppSettings>('/api/settings', {
        method: 'PUT',
        body: JSON.stringify(nextSettings)
      });
      setSettings(savedSettings);
      if (options.notify !== false) {
        setNotice(_t('notice.settingsSaved'));
      }

      if (options.closeWhenSetupComplete !== false && setupCompleteFor(savedSettings)) {
        setShowSettingsPage(false);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : _t('error.generic'));
    } finally {
      setBusy(null);
    }
  }

  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    await persistSettings(settings, { notify: true });
  }

  async function downloadBackup() {
    setBusy('backup');
    setError(null);
    setNotice(null);

    try {
      const response = await fetch('/api/backup');
      if (!response.ok) {
        const body = (await response.json().catch(() => ({ error: response.statusText }))) as { error?: string };
        throw new Error(body.error ?? response.statusText);
      }

      const url = window.URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = backupFilename(response.headers.get('Content-Disposition'));
      document.body.append(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      setNotice(_t('notice.backupDownloaded'));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : _t('error.generic'));
    } finally {
      setBusy(null);
    }
  }

  async function restoreBackupFromFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) {
      return;
    }

    setBusy('restore');
    setError(null);
    setNotice(null);

    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await file.text()) as unknown;
      } catch {
        throw new Error(_t('error.invalidBackupJson'));
      }

      const summary = await api<RestoreSummary>('/api/backup/restore', {
        method: 'POST',
        body: JSON.stringify(parsed)
      });
      const nextSettings = await load();
      await testRadarrConnection(nextSettings, { quiet: true });
      setSelectedComedianId(null);
      setDetailOpen(false);
      setActiveTab('review');
      setName('');
      setPersonMatches([]);
      setNotice(_t('notice.backupRestored', summary));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : _t('error.generic'));
    } finally {
      setBusy(null);
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
          error: _t('error.radarrConnect')
        });
      }

      if (nextRadarrOptions.connected && !options.quiet) {
        setNotice(_t('notice.radarrConnected'));
      }
    } catch (caught) {
      if (!options.quiet) {
        setRadarrOptions({
          ...emptyRadarrOptions,
          error: caught instanceof Error ? caught.message : _t('error.radarrUnable')
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
        return matches.length === 0
          ? _t('notice.noPeopleFound', { name: nextName })
          : _t('notice.peopleFound', { count: matches.length });
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

      setNotice(_t('notice.addedComedian', { name: comedian.name }));
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
        setNotice(_t('notice.candidatesSaved', { name: result.comedian.name, count: result.saved }));
        await load();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : _t('error.generic'));
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
          <p className="eyebrow brandSubtitle">{_t('app.subtitle')}</p>
        </div>
        <div className="topbarActions">
          {!initialDataLoaded ? null : showingSettings ? (
            setupComplete && (
              <button type="button" aria-label={_t('nav.openLibrary')} title={_t('nav.openLibrary')} onClick={() => setShowSettingsPage(false)}>
                <Film size={16} aria-hidden="true" />
                <span className="actionLabel">{_t('nav.library')}</span>
              </button>
            )
          ) : (
            <button type="button" aria-label={_t('nav.openSettings')} title={_t('nav.openSettings')} onClick={() => setShowSettingsPage(true)}>
              <Settings size={16} aria-hidden="true" />
              <span className="actionLabel">{_t('nav.settings')}</span>
            </button>
          )}
        </div>
      </header>

      {(notice || error) && (
        <div className={error ? 'toast error' : 'toast'} role={error ? 'alert' : 'status'} aria-live={error ? 'assertive' : 'polite'}>
          <span>{error ?? notice}</span>
          <button type="button" aria-label={_t('toast.dismiss')} title={_t('toast.dismiss')} onClick={() => (error ? setError(null) : setNotice(null))}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      )}

      <section className={showingSettings ? 'workspace settingsWorkspace' : 'workspace libraryWorkspace'}>
        {!initialDataLoaded && (
          <div className="panel loadingPanel" role="status" aria-live="polite">
            <RefreshCcw className="spin" size={18} aria-hidden="true" />
            <span>{_t('loading.app')}</span>
          </div>
        )}
        {showingSettings && (
        <aside className="settingsPanel">
          <div className="panelHeader">
            <Settings size={18} aria-hidden="true" />
            <h2>{_t('settings.title')}</h2>
          </div>
          <form className="settingsGrid" onSubmit={saveSettings}>
            <fieldset className="settingsCard">
              <legend>{_t('settings.group.language')}</legend>
              <label>
                {_t('settings.language')}
                <select
                  aria-label={_t('settings.language')}
                  aria-describedby="settings-language-help"
                  title={_t('settings.language')}
                  value={normaliseLanguage(settings.language)}
                  onChange={(event) => {
                    const nextSettings = { ...settings, language: normaliseLanguage(event.target.value) };
                    setSettings(nextSettings);
                    void persistSettings(nextSettings, { closeWhenSetupComplete: false, notify: false });
                  }}
                >
                  {supportedLanguages.map((language) => (
                    <option key={language.code} value={language.code}>
                      {language.label}
                    </option>
                  ))}
                </select>
                <span id="settings-language-help" className="settingsFieldHelp">{_t('settings.help.language')}</span>
              </label>
            </fieldset>

            <fieldset className="settingsCard">
              <legend>{_t('settings.group.appearance')}</legend>
              <label>
                {_t('settings.theme')}
                <select
                  aria-label={_t('settings.theme')}
                  aria-describedby="settings-theme-help"
                  title={_t('settings.theme')}
                  value={theme}
                  onChange={(event) => {
                    const nextSettings = { ...settings, theme: event.target.value };
                    setSettings(nextSettings);
                    void persistSettings(nextSettings, { closeWhenSetupComplete: false, notify: false });
                  }}
                >
                  <option value="system">{_t('settings.theme.system')}</option>
                  <option value="light">{_t('settings.theme.light')}</option>
                  <option value="dark">{_t('settings.theme.dark')}</option>
                </select>
                <span id="settings-theme-help" className="settingsFieldHelp">{_t('settings.help.theme')}</span>
              </label>
            </fieldset>

            <fieldset className="settingsCard">
              <legend>{_t('settings.group.tmdb')}</legend>
              <p className="settingsCardHelp">{_t('settings.group.tmdbHelp')}</p>
              <label>
                {_t('settings.metadataSource')}
                <select
                  aria-label={_t('settings.metadataSource')}
                  aria-describedby="settings-metadata-source-help"
                  title={_t('settings.metadataSource')}
                  value={settings.metadataSource === 'tmdb' ? 'tmdb' : 'service'}
                  onChange={(event) => setSettings({ ...settings, metadataSource: event.target.value })}
                >
                  <option value="service">{_t('settings.metadataSource.service')}</option>
                  <option value="tmdb">{_t('settings.metadataSource.tmdb')}</option>
                </select>
                <span id="settings-metadata-source-help" className="settingsFieldHelp">{_t('settings.help.metadataSource')}</span>
              </label>
              {settings.metadataSource === 'tmdb' ? (
                <label>
                  {_t('settings.tmdbToken')}
                  <input
                    aria-label={_t('settings.tmdbToken')}
                    aria-describedby="settings-tmdb-token-help"
                    title={_t('settings.tmdbToken')}
                    type="password"
                    value={settings.tmdbBearerToken}
                    onChange={(event) => setSettings({ ...settings, tmdbBearerToken: event.target.value })}
                  />
                  <span id="settings-tmdb-token-help" className="settingsFieldHelp">{_t('settings.help.tmdbToken')}</span>
                </label>
              ) : (
                null
              )}
              <div className="settingsCardActions">
                <button className="secondary" type="submit" disabled={busy === 'settings'} title={_t('settings.save')}>
                  <Save size={16} aria-hidden="true" />
                  {_t('settings.save')}
                </button>
              </div>
            </fieldset>

            <fieldset className="settingsCard">
              <legend>{_t('settings.group.radarr')}</legend>
              <p className="settingsCardHelp">{_t('settings.group.radarrHelp')}</p>
              <label>
                {_t('settings.radarrUrl')}
                <input
                  aria-label={_t('settings.radarrUrl')}
                  aria-describedby="settings-radarr-url-help"
                  title={_t('settings.radarrUrl')}
                  value={settings.radarrUrl}
                  onChange={(event) => updateRadarrConnectionSetting({ radarrUrl: event.target.value })}
                />
                <span id="settings-radarr-url-help" className="settingsFieldHelp">{_t('settings.help.radarrUrl')}</span>
              </label>
              <label>
                {_t('settings.radarrApiKey')}
                <input
                  aria-label={_t('settings.radarrApiKey')}
                  aria-describedby="settings-radarr-api-key-help"
                  title={_t('settings.radarrApiKey')}
                  type="password"
                  value={settings.radarrApiKey}
                  onChange={(event) => updateRadarrConnectionSetting({ radarrApiKey: event.target.value })}
                />
                <span id="settings-radarr-api-key-help" className="settingsFieldHelp">{_t('settings.help.radarrApiKey')}</span>
              </label>
              {!radarrOptions.connected && (
                <button
                  type="button"
                  aria-label={_t('settings.testRadarrConnection')}
                  title={_t('settings.testRadarrConnection')}
                  disabled={
                    busy === 'radarr-test' ||
                    radarrChecking ||
                    !settings.radarrUrl.trim() ||
                    !settings.radarrApiKey.trim()
                  }
                  onClick={() => testRadarrConnection()}
                >
                  <Radar size={16} aria-hidden="true" />
                  {_t('settings.testConnection')}
                </button>
              )}
              <div className={radarrOptions.connected ? 'connectionStatus connected' : 'connectionStatus'} role="status" aria-live="polite">
                {radarrOptions.connected && _t('settings.radarrConnected')}
                {!radarrOptions.connected && radarrChecking && _t('settings.checkingRadarr')}
                {!radarrOptions.connected &&
                  !radarrChecking &&
                  (radarrOptions.error ??
                    (radarrChecked
                      ? _t('settings.testToChoose')
                      : _t('settings.enterToTest')))}
              </div>
              {radarrOptions.connected && (
                <>
                  <label>
                    {_t('settings.qualityProfile')}
                    <select
                      aria-label={_t('settings.qualityProfile')}
                      aria-describedby="settings-quality-profile-help"
                      title={_t('settings.qualityProfile')}
                      value={settings.radarrQualityProfileId}
                      onChange={(event) => setSettings({ ...settings, radarrQualityProfileId: event.target.value })}
                    >
                      <option value="">{_t('settings.chooseQualityProfile')}</option>
                      {radarrOptions.qualityProfiles.map((profile) => (
                        <option key={profile.id} value={String(profile.id)}>
                          {profile.name}
                        </option>
                      ))}
                    </select>
                    <span id="settings-quality-profile-help" className="settingsFieldHelp">{_t('settings.help.qualityProfile')}</span>
                  </label>
                  <label>
                    {_t('settings.rootFolder')}
                    <select
                      aria-label={_t('settings.rootFolder')}
                      aria-describedby="settings-root-folder-help"
                      title={_t('settings.rootFolder')}
                      value={settings.radarrRootFolderPath}
                      onChange={(event) => setSettings({ ...settings, radarrRootFolderPath: event.target.value })}
                    >
                      <option value="">{_t('settings.chooseRootFolder')}</option>
                      {radarrOptions.rootFolders.map((folder) => (
                        <option key={folder.path} value={folder.path}>
                          {folder.path}
                        </option>
                      ))}
                    </select>
                    <span id="settings-root-folder-help" className="settingsFieldHelp">{_t('settings.help.rootFolder')}</span>
                  </label>
                </>
              )}
              <label>
                {_t('settings.minimumAvailability')}
                <select
                  aria-label={_t('settings.minimumAvailability')}
                  aria-describedby="settings-minimum-availability-help"
                  title={_t('settings.minimumAvailability')}
                  value={settings.radarrMinimumAvailability}
                  onChange={(event) => setSettings({ ...settings, radarrMinimumAvailability: event.target.value })}
                >
                  <option value="announced">{_t('settings.availability.announced')}</option>
                  <option value="inCinemas">{_t('settings.availability.inCinemas')}</option>
                  <option value="released">{_t('settings.availability.released')}</option>
                </select>
                <span id="settings-minimum-availability-help" className="settingsFieldHelp">{_t('settings.help.minimumAvailability')}</span>
              </label>
              <div className="settingsCardActions">
                <button className="secondary" type="submit" disabled={busy === 'settings'} title={_t('settings.save')}>
                  <Save size={16} aria-hidden="true" />
                  {_t('settings.save')}
                </button>
              </div>
            </fieldset>

            <fieldset className="settingsCard">
              <legend>{_t('settings.group.automation')}</legend>
              <p className="settingsCardHelp">{_t('settings.group.automationHelp')}</p>
              <label>
                {_t('settings.autoAddAbove')}
                <input
                  aria-label={_t('settings.autoAddAbove')}
                  aria-describedby="settings-auto-add-help"
                  title={_t('settings.autoAddAbove')}
                  type="number"
                  min="0"
                  max="100"
                  value={settings.autoAddConfidenceThreshold}
                  onChange={(event) => setSettings({ ...settings, autoAddConfidenceThreshold: event.target.value })}
                />
                <span id="settings-auto-add-help" className="settingsFieldHelp">{_t('settings.help.autoAddAbove')}</span>
              </label>
              <label>
                {_t('settings.autoIgnoreBelow')}
                <input
                  aria-label={_t('settings.autoIgnoreBelow')}
                  aria-describedby="settings-auto-ignore-help"
                  title={_t('settings.autoIgnoreBelow')}
                  type="number"
                  min="0"
                  max="100"
                  value={settings.hideBelowConfidenceThreshold}
                  onChange={(event) => setSettings({ ...settings, hideBelowConfidenceThreshold: event.target.value })}
                />
                <span id="settings-auto-ignore-help" className="settingsFieldHelp">{_t('settings.help.autoIgnoreBelow')}</span>
              </label>
              <div className="settingsCardActions">
                <button className="secondary" type="submit" disabled={busy === 'settings'} title={_t('settings.save')}>
                  <Save size={16} aria-hidden="true" />
                  {_t('settings.save')}
                </button>
              </div>
            </fieldset>

            <fieldset className="settingsCard">
              <legend>{_t('settings.group.backupRestore')}</legend>
              <p className="settingsCardHelp">{_t('settings.group.backupRestoreHelp')}</p>
              <p className="settingsHint">{_t('settings.backupPrivacy')}</p>
              <div className="backupActions">
                <button
                  type="button"
                  disabled={busy === 'backup' || busy === 'restore'}
                  aria-label={_t('settings.downloadBackup')}
                  title={_t('settings.downloadBackup')}
                  onClick={() => void downloadBackup()}
                >
                  {busy === 'backup' ? <RefreshCcw className="spin" size={16} aria-hidden="true" /> : <Download size={16} aria-hidden="true" />}
                  {_t('settings.downloadBackup')}
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy === 'backup' || busy === 'restore'}
                  aria-label={_t('settings.restoreBackup')}
                  title={_t('settings.restoreBackup')}
                  onClick={() => backupInputRef.current?.click()}
                >
                  {busy === 'restore' ? <RefreshCcw className="spin" size={16} aria-hidden="true" /> : <Upload size={16} aria-hidden="true" />}
                  {_t('settings.restoreBackup')}
                </button>
              </div>
              <input
                ref={backupInputRef}
                className="fileInputHidden"
                type="file"
                accept="application/json,.json"
                title={_t('settings.restoreBackupFile')}
                onChange={restoreBackupFromFile}
              />
            </fieldset>

            <p className="tmdbAttribution">
              {_t('settings.tmdbAttribution')}{' '}
              <a href="https://www.themoviedb.org/" target="_blank" rel="noreferrer">
                {_t('settings.tmdbAttributionLink')}
              </a>
            </p>

          </form>
        </aside>
        )}

        {initialDataLoaded && !showingSettings && (
        <section className={detailOpen ? 'mainColumn detailOpen' : 'mainColumn'}>
          <div className="comedianPanel">
            <div className="panelHeader">
              <h2>{_t('comedians.title')}</h2>
            </div>
            <section className="librarySection">
              <div className="listDivider">
                <span>{_t('comedians.addNew')}</span>
              </div>
              <div className="libraryCard searchCard">
                <form className="addComedianForm" onSubmit={addComedian}>
                  <div className="addRow">
                    <input
                      id="comedian-search"
                      aria-label={_t('comedians.searchLabel')}
                      title={_t('comedians.searchLabel')}
                      placeholder={_t('comedians.searchPlaceholder')}
                      value={name}
                      onChange={(event) => {
                        setName(event.target.value);
                        setPersonMatches([]);
                      }}
                    />
                    <button
                      className="primary"
                      type="submit"
                      disabled={busy === 'search-comedian'}
                      aria-label={_t('comedians.search')}
                      title={_t('comedians.search')}
                    >
                      <Search size={18} aria-hidden="true" />
                      {_t('comedians.search')}
                    </button>
                  </div>
                </form>
                {personMatches.length > 0 && (
                  <div className="personMatches">
                    <div className="searchResultsHeader">
                      <strong>{_t('comedians.searchResults')}</strong>
                      <span>
                        {_t(personMatches.length === 1 ? 'comedians.matchCount' : 'comedians.matchCount_plural', {
                          count: personMatches.length
                        })}
                      </span>
                    </div>
                    {personMatches.map((match) => {
                      const savedComedian = comedians.find((comedian) => comedian.tmdbPersonId === match.tmdbPersonId);
                      const isSaved = Boolean(savedComedian);
                      const buttonLabel = isSaved ? _t('comedians.show') : _t('comedians.select');
                      const flag = countryFlag(match.countryCode);
                      return (
                        <article className="personMatch" key={match.tmdbPersonId}>
                          <div className="avatar">
                            {match.profilePath ? (
                              <img src={`${imageBase}${match.profilePath}`} alt="" />
                            ) : (
                              <span>{match.name.slice(0, 1).toUpperCase()}</span>
                            )}
                          </div>
                          <div>
                            <div className="personMatchTitle">
                              <strong>{match.name}</strong>
                              {flag && (
                                <span
                                  className="originFlag"
                                  title={match.countryName ?? match.placeOfBirth ?? undefined}
                                  aria-label={match.countryName ? _t('comedians.country', { country: match.countryName }) : undefined}
                                >
                                  {flag}
                                </span>
                              )}
                            </div>
                            <span>{match.knownFor.length > 0 ? match.knownFor.join(' · ') : `TMDB ${match.tmdbPersonId}`}</span>
                          </div>
                          <button
                            type="button"
                            className={isSaved ? 'secondary' : 'primary'}
                            aria-label={`${buttonLabel} ${match.name}`}
                            title={`${buttonLabel} ${match.name}`}
                            disabled={!isSaved && (busy === 'add-comedian' || addingPersonId !== null)}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              if (savedComedian) {
                                setSelectedComedianId(savedComedian.id);
                                setActiveTab('review');
                                setDetailOpen(true);
                                setName('');
                                setPersonMatches([]);
                                return;
                              }
                              addComedianMatch(match);
                            }}
                          >
                            {addingPersonId === match.tmdbPersonId ? (
                              <RefreshCcw className="spin" size={16} aria-hidden="true" />
                            ) : isSaved ? (
                              <Eye size={16} aria-hidden="true" />
                            ) : (
                              <Plus size={16} aria-hidden="true" />
                            )}
                            {addingPersonId === match.tmdbPersonId ? _t('comedians.adding') : buttonLabel}
                          </button>
                        </article>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>
            <section className="librarySection savedLibrarySection">
              <div className="listDivider">
                <span>{_t('comedians.savedWithCount', { count: comedians.length })}</span>
              </div>
              <div className="libraryCard savedComediansCard">
                <div className="comedianList">
                  {comedians.map((comedian) => {
                    const isScanning = busy === `scan-${comedian.id}`;
                    const selected = selectedComedianId === comedian.id;
                    const resultCount = comedianResultCounts.get(comedian.id) ?? { monitored: 0, total: 0 };
                    const newReviewCount = comedianNewReviewCounts.get(comedian.id) ?? 0;
                    const flag = countryFlag(comedian.countryCode);
                    const reviewSuffix =
                      newReviewCount > 0
                        ? _t('comedians.reviewSuffix', {
                            count: newReviewCount,
                            item: _t(newReviewCount === 1 ? 'comedians.candidateSingular' : 'comedians.candidatePlural')
                          })
                        : '';
                    const selectComedian = () => {
                      setSelectedComedianId(comedian.id);
                      setActiveTab('review');
                      setDetailOpen(true);
                    };

                    return (
                      <article
                        className={selected ? 'comedianItem selected' : 'comedianItem'}
                        key={comedian.id}
                      >
                        <button
                          type="button"
                          className="comedianSelect"
                          aria-label={_t('comedians.openRow', {
                            name: comedian.name,
                            monitored: resultCount.monitored,
                            total: resultCount.total,
                            reviewSuffix
                          })}
                          aria-pressed={selected}
                          onClick={selectComedian}
                        >
                          <span className="avatar">
                            {comedian.profilePath ? (
                              <img src={`${imageBase}${comedian.profilePath}`} alt="" />
                            ) : (
                              <span>{comedian.name.slice(0, 1).toUpperCase()}</span>
                            )}
                          </span>
                          <span>
                            <span className="comedianTitle">
                              <strong>{comedian.name}</strong>
                              {flag && (
                                <span
                                  className="originFlag"
                                  title={comedian.countryName ?? comedian.placeOfBirth ?? undefined}
                                  aria-label={comedian.countryName ? _t('comedians.country', { country: comedian.countryName }) : undefined}
                                >
                                  {flag}
                                </span>
                              )}
                            </span>
                            <span className="comedianMeta">
                              {isScanning && <span className="scanBadge">{_t('comedians.scanningBadge')}</span>}
                              {newReviewCount > 0 && (
                                <span
                                  className="newReviewBadge"
                                  title={_t('comedians.newReviewTitle', {
                                    count: newReviewCount,
                                    item: _t(newReviewCount === 1 ? 'comedians.candidateSingular' : 'comedians.candidatePlural')
                                  })}
                                >
                                  {_t('comedians.newBadge', { count: newReviewCount })}
                                </span>
                              )}
                              <span
                                className="resultCounter"
                                title={_t('comedians.resultCounterTitle', { monitored: resultCount.monitored, total: resultCount.total })}
                              >
                                {_t('comedians.resultCounter', { monitored: resultCount.monitored, total: resultCount.total })}
                              </span>
                            </span>
                          </span>
                        </button>
                        <div className="rowActions">
                          <button
                            type="button"
                            title={isScanning ? _t('comedians.scanning', { name: comedian.name }) : _t('comedians.scan', { name: comedian.name })}
                            aria-label={isScanning ? _t('comedians.scanning', { name: comedian.name }) : _t('comedians.scan', { name: comedian.name })}
                            disabled={isScanning || !comedian.tmdbPersonId}
                            onClick={(event) => {
                              event.stopPropagation();
                              run(
                                `scan-${comedian.id}`,
                                () => api<ScanResult>(`/api/comedians/${comedian.id}/scan`, { method: 'POST' }),
                                (result) => _t('notice.candidatesSaved', { name: result.comedian.name, count: result.saved })
                              );
                            }}
                          >
                            <RefreshCcw className={isScanning ? 'spin' : undefined} size={16} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            title={_t('comedians.delete', { name: comedian.name })}
                            aria-label={_t('comedians.delete', { name: comedian.name })}
                            onClick={(event) => {
                              event.stopPropagation();
                              run(`delete-${comedian.id}`, () =>
                                api<void>(`/api/comedians/${comedian.id}`, { method: 'DELETE' })
                              );
                            }}
                          >
                            <Trash2 size={16} aria-hidden="true" />
                          </button>
                        </div>
                      </article>
                    );
                  })}
                  {comedians.length === 0 && <p className="empty">{_t('comedians.empty')}</p>}
                </div>
              </div>
            </section>
          </div>

          <div className="detailPanel">
            {selectedComedian && (
            <div className="panelHeader spread">
              <div>
                <div className="inlineTitle">
                  <button type="button" className="mobileBack" onClick={() => setDetailOpen(false)} aria-label={_t('detail.back')} title={_t('detail.back')}>
                    <ChevronLeft size={16} aria-hidden="true" />
                  </button>
                  <h2>
                    {selectedComedian.name}
                    {countryFlag(selectedComedian.countryCode) && (
                      <span className="headingFlag" title={selectedComedian.countryName ?? selectedComedian.placeOfBirth ?? undefined}>
                        {countryFlag(selectedComedian.countryCode)}
                      </span>
                    )}
                  </h2>
                </div>
                <div className="detailLinks" aria-label={_t('detail.linksLabel', { name: selectedComedian.name })}>
                  {selectedComedian.tmdbPersonId && (
                    <a href={`https://www.themoviedb.org/person/${selectedComedian.tmdbPersonId}`} target="_blank" rel="noreferrer">
                      {_t('detail.viewTmdb')}
                      <ExternalLink size={14} aria-hidden="true" />
                    </a>
                  )}
                  {selectedComedian.homepage && (
                    <a href={selectedComedian.homepage} target="_blank" rel="noreferrer">
                      {_t('detail.viewHomepage')}
                      <ExternalLink size={14} aria-hidden="true" />
                    </a>
                  )}
                </div>
              </div>
            </div>
            )}
            {!selectedComedian ? (
              <div className="detailEmptyState">
                <Film size={56} strokeWidth={1.8} aria-hidden="true" />
                <strong>{_t('detail.noSelectionTitle')}</strong>
                <span>{_t('detail.noSelectionHint')}</span>
              </div>
            ) : (
            <>
            {selectedComedianScanning && (
              <div className="scanNotice" role="status" aria-live="polite">
                <RefreshCcw className="spin" size={17} aria-hidden="true" />
                <span>{_t('detail.scanning')}</span>
              </div>
            )}
            <div className="tabs desktopTabs" role="tablist" aria-label={_t('detail.resultCategories', { name: selectedComedian.name })}>
              {hasReviewCandidates && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeDetailTab === 'review'}
                  className={activeDetailTab === 'review' ? 'tab active' : 'tab'}
                  onClick={() => setActiveTab('review')}
                >
                  <span>{_t('tabs.review')}</span>
                  <span className="tabCount">{reviewCandidates.length}</span>
                </button>
              )}
              <button
                type="button"
                role="tab"
                aria-selected={activeDetailTab === 'monitored'}
                className={activeDetailTab === 'monitored' ? 'tab active' : 'tab'}
                onClick={() => setActiveTab('monitored')}
              >
                <span>{_t('tabs.monitored')}</span>
                <span className="tabCount">{visibleMonitoredRows.length}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeDetailTab === 'notMonitored'}
                className={activeDetailTab === 'notMonitored' ? 'tab active' : 'tab'}
                onClick={() => setActiveTab('notMonitored')}
              >
                <span>{_t('tabs.notMonitored')}</span>
                <span className="tabCount">{ignoredNotMonitoredCandidates.length}</span>
              </button>
            </div>
            <div className="desktopTabPanels">
              {activeDetailTab === 'review' && (
                <div className="candidateGrid">
                  {reviewCandidates.map((candidate) => (
                    <CandidateCard key={candidate.id} candidate={candidate} busy={busy} run={run} _t={_t} />
                  ))}
                  {reviewCandidates.length === 0 && !selectedComedianScanning && (
                    <p className="empty">
                      {selectedComedian ? _t('empty.noReview') : _t('empty.chooseReview')}
                    </p>
                  )}
                </div>
              )}
              {activeDetailTab === 'monitored' && (
                <div className="monitoredList">
                  {visibleMonitoredRows.map(({ movie, candidate }) => (
                    <MonitoredMovieRow key={movie.id} movie={movie} candidate={candidate} busy={busy} run={run} _t={_t} />
                  ))}
                  {visibleMonitoredRows.length === 0 && !selectedComedianScanning && (
                    <p className="empty">
                      {selectedComedian ? _t('empty.noMonitored') : _t('empty.chooseMonitored')}
                    </p>
                  )}
                </div>
              )}
              {activeDetailTab === 'notMonitored' && (
                <div className="candidateGrid">
                  {ignoredNotMonitoredCandidates.map((candidate) => (
                    <CandidateCard key={candidate.id} candidate={candidate} busy={busy} run={run} _t={_t} />
                  ))}
                  {ignoredNotMonitoredCandidates.length === 0 && !selectedComedianScanning && (
                    <p className="empty">
                      {selectedComedian ? _t('empty.noNotMonitored') : _t('empty.chooseNotMonitored')}
                    </p>
                  )}
                </div>
              )}
            </div>
            <div className="detailSections">
              {hasReviewCandidates && (
                <section className="detailSection">
                  <div className="detailSectionHeader">
                    <h3>{_t('tabs.review')}</h3>
                    <span className="sectionCount">{reviewCandidates.length}</span>
                  </div>
                  <div className="candidateGrid">
                    {reviewCandidates.map((candidate) => (
                      <CandidateCard key={candidate.id} candidate={candidate} busy={busy} run={run} _t={_t} />
                    ))}
                  </div>
                </section>
              )}

              {(hasMonitoredRows || !hasNotMonitoredCandidates) && (
                <section className="detailSection">
                  <div className="detailSectionHeader">
                    <h3>{_t('tabs.monitored')}</h3>
                    <span className="sectionCount">{visibleMonitoredRows.length}</span>
                  </div>
                  <div className="monitoredList">
                    {visibleMonitoredRows.map(({ movie, candidate }) => (
                      <MonitoredMovieRow key={movie.id} movie={movie} candidate={candidate} busy={busy} run={run} _t={_t} />
                    ))}
                    {visibleMonitoredRows.length === 0 && !selectedComedianScanning && (
                      <p className="empty">
                        {selectedComedian ? _t('empty.noMonitored') : _t('empty.chooseMonitored')}
                      </p>
                    )}
                  </div>
                </section>
              )}

              {hasNotMonitoredCandidates && (
                <section className="detailSection">
                  <div className="detailSectionHeader">
                    <h3>{_t('tabs.notMonitored')}</h3>
                    <span className="sectionCount">{ignoredNotMonitoredCandidates.length}</span>
                  </div>
                  <div className="candidateGrid">
                    {ignoredNotMonitoredCandidates.map((candidate) => (
                      <CandidateCard key={candidate.id} candidate={candidate} busy={busy} run={run} _t={_t} />
                    ))}
                    {ignoredNotMonitoredCandidates.length === 0 && !selectedComedianScanning && (
                      <p className="empty">
                        {selectedComedian ? _t('empty.noNotMonitored') : _t('empty.chooseNotMonitored')}
                      </p>
                    )}
                  </div>
                </section>
              )}
            </div>
            </>
            )}
          </div>
        </section>
        )}
      </section>
    </main>
  );
}

type RunFn = <T>(label: string, task: () => Promise<T>, success?: (result: T) => string) => Promise<void>;

function hasDirectComedianEvidence(candidate: Candidate) {
  return candidate.reasons.includes('Comedian name in title') || candidate.reasons.includes('Credited as self');
}

// Radarr can prove a movie is already monitored, but it cannot prove that the
// selected comedian is meaningfully attached to that movie. Hide approved
// Radarr-only matches from the monitored counts unless the scanner found direct
// comedian evidence too.
function isWeakRadarrOnlyMatch(candidate: Candidate) {
  return candidate.status === 'approved' && candidate.reasons.includes('Already in Radarr') && !hasDirectComedianEvidence(candidate);
}

function TmdbMovieTitleLink({ tmdbMovieId, title }: { tmdbMovieId: number | null; title: string }) {
  if (!tmdbMovieId) {
    return <>{title}</>;
  }

  return (
    <a className="tmdbTitleLink" href={`https://www.themoviedb.org/movie/${tmdbMovieId}`} target="_blank" rel="noreferrer">
      <span className="tmdbTitleText">{title}</span>
      <ExternalLink size={13} aria-hidden="true" />
    </a>
  );
}

function MonitoredMovieRow({
  movie,
  candidate,
  busy,
  run,
  _t
}: {
  movie: RadarrMonitoredMovie;
  candidate: Candidate | null;
  busy: string | null;
  run: RunFn;
  _t: Translator;
}) {
  const canManageRadarr = Boolean(candidate?.radarrMovieId && !movie.hasFile);
  const unmonitoring = candidate ? busy === `unmonitor-radarr-${candidate.id}` : false;
  const removing = candidate ? busy === `remove-radarr-${candidate.id}` : false;
  const tmdbMovieId = candidate?.tmdbMovieId ?? movie.tmdbId;

  return (
    <article className="monitoredItem">
      <div
        className={movie.hasFile ? 'monitoredStatus downloaded' : 'monitoredStatus'}
        title={movie.hasFile ? _t('radarr.downloaded') : _t('radarr.monitored')}
        aria-label={movie.hasFile ? _t('radarr.downloaded') : _t('radarr.monitored')}
        role="img"
      >
        {movie.hasFile ? <Check size={17} aria-hidden="true" /> : <Radar size={17} aria-hidden="true" />}
      </div>
      <div>
        <strong>
          <TmdbMovieTitleLink tmdbMovieId={tmdbMovieId} title={movie.title} />
        </strong>
        <span>
          {movie.year ? `${movie.year} · ` : ''}
          {movie.hasFile ? _t('radarr.downloaded') : _t('radarr.monitored')}
          {movie.tmdbId ? ` · TMDB ${movie.tmdbId}` : ''}
        </span>
      </div>
      {canManageRadarr && candidate && (
        <div className="monitoredActions">
          <button
            type="button"
            title={unmonitoring ? _t('radarr.unmonitoring', { title: movie.title }) : _t('radarr.unmonitor', { title: movie.title })}
            aria-label={unmonitoring ? _t('radarr.unmonitoring', { title: movie.title }) : _t('radarr.unmonitor', { title: movie.title })}
            disabled={unmonitoring}
            onClick={() =>
              run(
                `unmonitor-radarr-${candidate.id}`,
                () => api<Candidate>(`/api/candidates/${candidate.id}/unmonitor-radarr`, { method: 'POST' }),
                () => _t('notice.unmonitored', { title: movie.title })
              )
            }
          >
            {unmonitoring ? <RefreshCcw className="spin" size={16} aria-hidden="true" /> : <Radar size={16} aria-hidden="true" />}
            <span className="buttonText">{unmonitoring ? _t('radarr.unmonitoringButton') : _t('radarr.unmonitorButton')}</span>
          </button>
          <button
            type="button"
            title={removing ? _t('radarr.removing', { title: movie.title }) : _t('radarr.remove', { title: movie.title })}
            aria-label={removing ? _t('radarr.removing', { title: movie.title }) : _t('radarr.remove', { title: movie.title })}
            disabled={removing}
            onClick={() =>
              run(
                `remove-radarr-${candidate.id}`,
                () => api<Candidate>(`/api/candidates/${candidate.id}/remove-from-radarr`, { method: 'POST' }),
                () => _t('notice.removed', { title: movie.title })
              )
            }
          >
            {removing ? <RefreshCcw className="spin" size={16} aria-hidden="true" /> : <Trash2 size={16} aria-hidden="true" />}
            <span className="buttonText">{removing ? _t('radarr.removingButton') : _t('radarr.removeButton')}</span>
          </button>
        </div>
      )}
    </article>
  );
}

function CandidateCard({ candidate, busy, run, _t }: { candidate: Candidate; busy: string | null; run: RunFn; _t: Translator }) {
  const autoAdded = candidate.status === 'auto_added';
  const canAddToRadarr = candidate.status === 'new' || candidate.status === 'ignored' || (candidate.status === 'approved' && candidate.radarrMovieId != null);
  const canIgnore = candidate.status === 'new';
  const actionable = canAddToRadarr || autoAdded || canIgnore;
  const acking = busy === `ack-${candidate.id}`;
  const approving = busy === `approve-${candidate.id}`;
  const ignoring = busy === `ignore-${candidate.id}`;
  const actionControls = actionable ? (
    <div className="candidateActions">
      {autoAdded && (
        <button
          type="button"
          className="primary"
          disabled={acking}
          aria-label={acking ? _t('candidate.savingAck', { title: candidate.title }) : _t('candidate.acknowledge', { title: candidate.title })}
          title={acking ? _t('candidate.savingAck', { title: candidate.title }) : _t('candidate.acknowledge', { title: candidate.title })}
          onClick={() =>
            run(
              `ack-${candidate.id}`,
              () =>
                api<Candidate>(`/api/candidates/${candidate.id}`, {
                  method: 'PATCH',
                  body: JSON.stringify({ status: 'approved' })
                }),
              () => _t('notice.candidateAcknowledged', { title: candidate.title })
            )
          }
        >
          {acking ? <RefreshCcw className="spin" size={16} aria-hidden="true" /> : <Check size={16} aria-hidden="true" />}
          {acking ? _t('candidate.saving') : _t('candidate.ok')}
        </button>
      )}
      {canAddToRadarr && (
        <button
          type="button"
          className="primary"
          disabled={approving}
          aria-label={approving ? _t('candidate.addingToRadarr', { title: candidate.title }) : _t('candidate.addToRadarr', { title: candidate.title })}
          title={approving ? _t('candidate.addingToRadarr', { title: candidate.title }) : _t('candidate.addToRadarr', { title: candidate.title })}
          onClick={() =>
            run(
              `approve-${candidate.id}`,
              () => api<Candidate>(`/api/candidates/${candidate.id}/approve`, { method: 'POST' }),
              () => _t('notice.sentToRadarr', { title: candidate.title })
            )
          }
        >
          {approving ? <RefreshCcw className="spin" size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
          {approving ? _t('candidate.addingToRadarrButton') : _t('candidate.addToRadarrButton')}
        </button>
      )}
      {canIgnore && (
        <button
          type="button"
          disabled={ignoring}
          aria-label={ignoring ? _t('candidate.ignoring', { title: candidate.title }) : _t('candidate.ignore', { title: candidate.title })}
          title={ignoring ? _t('candidate.ignoring', { title: candidate.title }) : _t('candidate.ignore', { title: candidate.title })}
          onClick={() =>
            run(`ignore-${candidate.id}`, () =>
              api<Candidate>(`/api/candidates/${candidate.id}`, {
                method: 'PATCH',
                body: JSON.stringify({ status: 'ignored' })
              })
            )
          }
        >
          {ignoring ? <RefreshCcw className="spin" size={16} aria-hidden="true" /> : <Check size={16} aria-hidden="true" />}
          {ignoring ? _t('candidate.ignoringButton') : _t('candidate.ignoreButton')}
        </button>
      )}
    </div>
  ) : null;

  return (
    <article className="candidate">
      <div className="poster">
        {candidate.posterPath ? (
          <img src={`${imageBase}${candidate.posterPath}`} alt={_t('candidate.posterAlt', { title: candidate.title })} />
        ) : (
          <Film size={30} aria-hidden="true" />
        )}
      </div>
      <div className="candidateBody">
        <div className="candidateTop">
          <div>
            <h3>
              <TmdbMovieTitleLink tmdbMovieId={candidate.tmdbMovieId} title={candidate.title} />
            </h3>
            <p>{candidate.comedianName}{candidate.year ? ` · ${candidate.year}` : ''}</p>
          </div>
          <strong className={candidate.confidence >= 70 ? 'score high' : 'score'}>{candidate.confidence}</strong>
        </div>
        <p className="overview">{candidate.overview || _t('candidate.noOverview')}</p>
        <p className="candidateStatus">{_t(`status.${candidate.status}`)}</p>
      </div>
      {actionControls}
    </article>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
