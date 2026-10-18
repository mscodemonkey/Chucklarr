/**
 * Renders the Chucklarr browser application. The App component owns transient
 * interface state, while the server remains responsible for persisted settings,
 * comedians, candidates, and Radarr interactions.
 */

import React, { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  MoreHorizontal,
  Library,
  Download,
  Eye,
  ExternalLink,
  Film,
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
  ScanResult,
  UpdateStatus
} from '../../shared/types';
import { createTranslator, normaliseLanguage, supportedLanguages } from './i18n';
import { isSetupComplete, shouldShowSettings } from './setup';
import { FilmAppearances } from './FilmAppearances';
import { isReleaseDate, isWeakRadarrOnlyMatch, localCalendarDate, upcomingSpecials } from './discovery';
import './styles.css';

const imageBase = 'https://image.tmdb.org/t/p/w342';
const radarrSyncIntervalMs = 60_000;
const emptyRadarrOptions: RadarrOptions = {
  connected: false,
  qualityProfiles: [],
  rootFolders: []
};
type DetailTab = 'review' | 'monitored' | 'notMonitored';
type UpcomingScanFeedback = 'idle' | 'success' | 'scanFailed' | 'refreshFailed' | 'bothFailed';
type Translator = ReturnType<typeof createTranslator>;
type RadarrSyncResult = {
  movies: RadarrMonitoredMovie[];
  updatedCandidates: Candidate[];
};

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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function titleWithoutComedianName(title: string, comedianName: string | null): string {
  if (!comedianName) {
    return title;
  }

  return (
    title.replace(new RegExp(`^\\s*${escapeRegExp(comedianName)}\\s*[:\\-–—]\\s*`, 'i'), '').trim() || title
  );
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
  const [showAddComedian, setShowAddComedian] = useState(false);
  const [libraryView, setLibraryView] = useState<'comedians' | 'upcoming'>('comedians');
  const [upcomingScanFeedback, setUpcomingScanFeedback] = useState<UpcomingScanFeedback>('idle');
  const scanAllInFlightRef = useRef(false);
  const candidateRefreshEpoch = useRef(0);
  const upcomingVisit = useRef(0);
  const [libraryFilter, setLibraryFilter] = useState('');
  const [today, setToday] = useState(localCalendarDate);
  const [radarrUnavailable, setRadarrUnavailable] = useState(false);
  const addDialogRef = useRef<HTMLDialogElement | null>(null);
  const runningRef = useRef(false);
  const searchControllerRef = useRef<AbortController | null>(null);
  const [personMatches, setPersonMatches] = useState<PersonSearchResult[]>([]);
  const [addingPersonId, setAddingPersonId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<DetailTab>('review');
  const [selectedComedianId, setSelectedComedianId] = useState<number | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [showSettingsPage, setShowSettingsPage] = useState(false);
  const [persistedSettings, setPersistedSettings] = useState<AppSettings | null>(null);
  const [initialDataLoaded, setInitialDataLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [radarrOptions, setRadarrOptions] = useState<RadarrOptions>(emptyRadarrOptions);
  const [radarrChecking, setRadarrChecking] = useState(false);
  const [radarrChecked, setRadarrChecked] = useState(false);
  const addingPersonIdRef = useRef<number | null>(null);
  const backupInputRef = useRef<HTMLInputElement | null>(null);
  const radarrSyncingRef = useRef(false);
  const _t = useMemo(() => createTranslator(settings.language), [settings.language]);
  const theme = settings.theme === 'light' || settings.theme === 'dark' ? settings.theme : 'system';

  const selectedComedian = useMemo(
    () => comedians.find((comedian) => comedian.id === selectedComedianId) ?? null,
    [comedians, selectedComedianId]
  );
  const selectedComedianScanning = selectedComedian ? busy === `scan-${selectedComedian.id}` : false;
  const monitoredRadarrIds = useMemo(
    () => new Set(monitoredMovies.map((movie) => movie.id)),
    [monitoredMovies]
  );
  const monitoredTmdbIds = useMemo(
    () => new Set(monitoredMovies.map((movie) => movie.tmdbId).filter((id): id is number => id != null)),
    [monitoredMovies]
  );
  const monitoredMovieByRadarrId = useMemo(
    () => new Map(monitoredMovies.map((movie) => [movie.id, movie])),
    [monitoredMovies]
  );
  const monitoredMovieByTmdbId = useMemo(
    () =>
      new Map(
        monitoredMovies
          .filter((movie) => movie.tmdbId != null)
          .map((movie) => [movie.tmdbId as number, movie])
      ),
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
  const reviewCandidateGroups = useMemo(
    () => (reviewCandidates.length > 0 ? [{ status: 'new' as const, candidates: reviewCandidates }] : []),
    [reviewCandidates]
  );
  const ignoredNotMonitoredCandidates = useMemo(
    () => notMonitoredCandidates.filter((candidate) => candidate.status !== 'new'),
    [notMonitoredCandidates]
  );
  const notWantedCandidateGroups = useMemo(() => {
    const statusOrder: Candidate['status'][] = ['ignored', 'rejected', 'approved', 'auto_added'];
    const groups = new Map<Candidate['status'], Candidate[]>();

    for (const candidate of ignoredNotMonitoredCandidates) {
      const group = groups.get(candidate.status) ?? [];
      group.push(candidate);
      groups.set(candidate.status, group);
    }

    return statusOrder
      .filter((status) => groups.has(status))
      .map((status) => ({ status, candidates: groups.get(status) ?? [] }));
  }, [ignoredNotMonitoredCandidates]);
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

    return new Map(
      [...grouped.entries()].map(([comedianId, comedianCandidates]) => [comedianId, comedianCandidates.size])
    );
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
  const availableMonitoredRows = useMemo(
    () => visibleMonitoredRows.filter(({ movie }) => Boolean(movie.hasFile)),
    [visibleMonitoredRows]
  );
  const pendingMonitoredRows = useMemo(
    () => visibleMonitoredRows.filter(({ movie }) => !movie.hasFile),
    [visibleMonitoredRows]
  );
  const upcoming = useMemo(() => upcomingSpecials(candidates, today), [candidates, today]);
  const filteredComedians = comedians.filter((comedian) =>
    comedian.name.toLocaleLowerCase().includes(libraryFilter.toLocaleLowerCase())
  );

  const persistedSetupComplete = persistedSettings ? isSetupComplete(persistedSettings) : false;
  const showingSettings = shouldShowSettings(initialDataLoaded, showSettingsPage, persistedSettings);

  async function syncRadarrState() {
    if (radarrSyncingRef.current || scanAllInFlightRef.current) {
      return;
    }

    radarrSyncingRef.current = true;
    const epoch = candidateRefreshEpoch.current;
    try {
      const [nextRadarrSync, nextCandidates] = await Promise.all([
        api<RadarrSyncResult>('/api/radarr/sync', { method: 'POST' }).catch(() => null),
        api<Candidate[]>('/api/candidates')
      ]);
      if (epoch !== candidateRefreshEpoch.current) return;
      const synced = new Map(
        nextRadarrSync?.updatedCandidates.map((candidate) => [candidate.id, candidate]) ?? []
      );
      setCandidates(nextCandidates.map((candidate) => synced.get(candidate.id) ?? candidate));
      setRadarrUnavailable(nextRadarrSync === null);
      if (nextRadarrSync) setMonitoredMovies(nextRadarrSync.movies);
    } finally {
      radarrSyncingRef.current = false;
    }
  }

  async function load(): Promise<AppSettings> {
    const [nextSettings, nextComedians] = await Promise.all([
      api<AppSettings>('/api/settings'),
      api<Comedian[]>('/api/comedians')
    ]);
    setSettings(nextSettings);
    setPersistedSettings(nextSettings);
    setComedians(nextComedians);
    setSelectedComedianId((current) =>
      nextComedians.some((comedian) => comedian.id === current) ? current : (nextComedians[0]?.id ?? null)
    );
    await syncRadarrState();
    return nextSettings;
  }

  async function run<T>(label: string, task: () => Promise<T>, success?: (result: T) => string) {
    if (runningRef.current) return;
    runningRef.current = true;
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
      if (!(caught instanceof DOMException && caught.name === 'AbortError')) {
        setError(caught instanceof Error ? caught.message : _t('error.generic'));
      }
    } finally {
      setBusy(null);
      runningRef.current = false;
    }
  }

  /** Refreshes scan-owned records after any outcome without replacing the settings draft. */
  async function scanAllComedians() {
    if (runningRef.current || busy || !comedians.some((comedian) => comedian.tmdbPersonId)) return;
    runningRef.current = true;
    scanAllInFlightRef.current = true;
    candidateRefreshEpoch.current++;
    const visit = upcomingVisit.current;
    setBusy('scan-all');
    setUpcomingScanFeedback('idle');
    let scanFailed = false;
    let refreshFailed = false;
    try {
      try {
        await api<ScanResult[]>('/api/scan', { method: 'POST' });
      } catch {
        scanFailed = true;
      }

      try {
        const [nextComedians, nextCandidates] = await Promise.all([
          api<Comedian[]>('/api/comedians'),
          api<Candidate[]>('/api/candidates')
        ]);
        setComedians(nextComedians);
        setCandidates(nextCandidates);
        setSelectedComedianId((current) =>
          nextComedians.some((comedian) => comedian.id === current) ? current : (nextComedians[0]?.id ?? null)
        );
      } catch {
        refreshFailed = true;
      }

      if (visit === upcomingVisit.current) {
        setUpcomingScanFeedback(
          scanFailed
            ? refreshFailed
              ? 'bothFailed'
              : 'scanFailed'
            : refreshFailed
              ? 'refreshFailed'
              : 'success'
        );
      }
    } finally {
      scanAllInFlightRef.current = false;
      runningRef.current = false;
      setBusy((current) => (current === 'scan-all' ? null : current));
    }
  }

  useEffect(() => {
    if (libraryView !== 'upcoming' || showingSettings) {
      upcomingVisit.current++;
      setUpcomingScanFeedback('idle');
    }
  }, [libraryView, showingSettings]);

  useEffect(() => {
    const updateDay = () => setToday(localCalendarDate());
    let midnight: ReturnType<typeof setTimeout>;
    const schedule = () => {
      updateDay();
      const now = new Date();
      const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      clearTimeout(midnight);
      midnight = setTimeout(schedule, next.getTime() - now.getTime() + 50);
    };
    schedule();
    window.addEventListener('focus', schedule);
    document.addEventListener('visibilitychange', schedule);
    return () => {
      clearTimeout(midnight);
      window.removeEventListener('focus', schedule);
      document.removeEventListener('visibilitychange', schedule);
    };
  }, []);

  useEffect(() => {
    const dialog = addDialogRef.current;
    if (!dialog) return;
    if (showAddComedian && !dialog.open) {
      dialog.showModal();
      dialog.querySelector('input')?.focus();
    }
    if (!showAddComedian && dialog.open) dialog.close();
  }, [showAddComedian]);

  function openAddComedian() {
    searchControllerRef.current?.abort();
    setName('');
    setPersonMatches([]);
    setError(null);
    setNotice(null);
    setShowAddComedian(true);
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
    if (!initialDataLoaded) {
      return;
    }

    api<UpdateStatus>('/api/update/check', { method: 'POST' })
      .then(setUpdateStatus)
      .catch(() => undefined);
  }, [initialDataLoaded]);

  useEffect(() => {
    if (!initialDataLoaded) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void syncRadarrState().catch(() => setRadarrUnavailable(true));
    }, radarrSyncIntervalMs);

    return () => window.clearInterval(intervalId);
  }, [initialDataLoaded]);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    function applyTheme() {
      document.documentElement.dataset.theme =
        theme === 'system' ? (mediaQuery.matches ? 'dark' : 'light') : theme;
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

    const timeout = window.setTimeout(
      () => {
        setNotice(null);
        setError(null);
      },
      error ? 7000 : 4500
    );

    return () => window.clearTimeout(timeout);
  }, [error, notice]);

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
      setPersistedSettings(savedSettings);
      if (options.notify !== false) {
        setNotice(_t('notice.settingsSaved'));
      }

      if (options.closeWhenSetupComplete !== false && isSetupComplete(savedSettings)) {
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
        const body = (await response.json().catch(() => ({ error: response.statusText }))) as {
          error?: string;
        };
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

  async function testRadarrConnection(settingsToTest = settings, options: { quiet?: boolean } = {}) {
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

    searchControllerRef.current?.abort();
    const controller = new AbortController();
    searchControllerRef.current = controller;
    await run(
      'search-comedian',
      () =>
        api<PersonSearchResult[]>(`/api/comedians/search?q=${encodeURIComponent(nextName)}`, {
          signal: controller.signal
        }),
      (matches) => {
        if (controller.signal.aborted) return '';
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
    setDetailOpen(true);

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
      setShowAddComedian(false);
      setLibraryView('comedians');
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

  async function installUpdate() {
    setBusy('app-update');
    setError(null);
    setNotice(null);
    try {
      const status = await api<UpdateStatus>('/api/update/apply', { method: 'POST' });
      setUpdateStatus(status);
      setNotice(_t('notice.updateRestarting'));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : _t('error.generic'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className={`shell${detailOpen ? ' isDetail' : ''}${showingSettings ? ' isSettings' : ''}`}>
      <header className="topbar">
        <div>
          <h1 className="brandTitle">
            <LaughMark />
            <span>Chucklarr</span>
          </h1>
          <p className="eyebrow brandSubtitle">{_t('app.subtitle')}</p>
        </div>
        {initialDataLoaded && persistedSetupComplete && (
          <nav className="appNav" aria-label={_t('nav.library')}>
            <button
              type="button"
              className={!showingSettings && libraryView === 'comedians' ? 'navItem selected' : 'navItem'}
              aria-current={!showingSettings && libraryView === 'comedians' ? 'page' : undefined}
              onClick={() => {
                setShowSettingsPage(false);
                setLibraryView('comedians');
                setDetailOpen(false);
              }}
            >
              <Library size={19} aria-hidden="true" />
              <span>{_t('nav.library')}</span>
            </button>
            <button
              type="button"
              className={!showingSettings && libraryView === 'upcoming' ? 'navItem selected' : 'navItem'}
              aria-current={!showingSettings && libraryView === 'upcoming' ? 'page' : undefined}
              onClick={() => {
                setShowSettingsPage(false);
                setLibraryView('upcoming');
                setDetailOpen(true);
              }}
            >
              <CalendarDays size={19} aria-hidden="true" />
              <span>{_t('nav.upcoming')}</span>
              {upcoming.length > 0 && <span className="navCount">{upcoming.length}</span>}
            </button>
            <button
              type="button"
              className={showingSettings ? 'navItem selected' : 'navItem'}
              aria-current={showingSettings ? 'page' : undefined}
              onClick={() => setShowSettingsPage(true)}
            >
              <Settings size={19} aria-hidden="true" />
              <span>{_t('nav.settings')}</span>
            </button>
          </nav>
        )}
        {!showingSettings && initialDataLoaded && (
          <button
            type="button"
            className="headerAdd iconButton"
            aria-label={_t('comedians.addNew')}
            onClick={openAddComedian}
          >
            <Plus size={23} aria-hidden="true" />
          </button>
        )}
      </header>

      {(notice || error) && (
        <div
          className={error ? 'toast error' : 'toast'}
          role={error ? 'alert' : 'status'}
          aria-live={error ? 'assertive' : 'polite'}
        >
          <span>{error ?? notice}</span>
          <button
            type="button"
            aria-label={_t('toast.dismiss')}
            title={_t('toast.dismiss')}
            onClick={() => (error ? setError(null) : setNotice(null))}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      )}

      {updateStatus?.updateAvailable && (
        <section className="updateBanner" role="status" aria-live="polite">
          <div>
            <strong>{_t('update.available')}</strong>
            <span>
              {_t('update.details', {
                current: updateStatus.currentSha?.slice(0, 7) ?? _t('update.unknownVersion'),
                latest: updateStatus.latestSha?.slice(0, 7) ?? _t('update.unknownVersion')
              })}
            </span>
          </div>
          <div className="updateActions">
            {updateStatus.latestUrl && (
              <a href={updateStatus.latestUrl} target="_blank" rel="noreferrer">
                <ExternalLink size={16} aria-hidden="true" />
                {_t('update.view')}
              </a>
            )}
            <button
              type="button"
              className="primary"
              disabled={!updateStatus.canAutoUpdate || busy === 'app-update' || updateStatus.updating}
              title={!updateStatus.canAutoUpdate ? _t('update.disabled') : _t('update.install')}
              onClick={installUpdate}
            >
              {busy === 'app-update' || updateStatus.updating ? (
                <RefreshCcw className="spin" size={16} aria-hidden="true" />
              ) : (
                <Download size={16} aria-hidden="true" />
              )}
              {_t(busy === 'app-update' || updateStatus.updating ? 'update.installing' : 'update.install')}
            </button>
          </div>
        </section>
      )}

      {radarrUnavailable && !showingSettings && (
        <p className="connectionWarning" role="status">
          {_t('radarr.statusUnavailable')}
        </p>
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
                  <span id="settings-language-help" className="settingsFieldHelp">
                    {_t('settings.help.language')}
                  </span>
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
                  <span id="settings-theme-help" className="settingsFieldHelp">
                    {_t('settings.help.theme')}
                  </span>
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
                  <span id="settings-metadata-source-help" className="settingsFieldHelp">
                    {_t('settings.help.metadataSource')}
                  </span>
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
                    <span id="settings-tmdb-token-help" className="settingsFieldHelp">
                      {_t('settings.help.tmdbToken')}
                    </span>
                  </label>
                ) : null}
                <div className="settingsCardActions">
                  <button
                    className="secondary"
                    type="submit"
                    disabled={busy === 'settings'}
                    title={_t('settings.save')}
                  >
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
                  <span id="settings-radarr-url-help" className="settingsFieldHelp">
                    {_t('settings.help.radarrUrl')}
                  </span>
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
                  <span id="settings-radarr-api-key-help" className="settingsFieldHelp">
                    {_t('settings.help.radarrApiKey')}
                  </span>
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
                <div
                  className={radarrOptions.connected ? 'connectionStatus connected' : 'connectionStatus'}
                  role="status"
                  aria-live="polite"
                >
                  {radarrOptions.connected && _t('settings.radarrConnected')}
                  {!radarrOptions.connected && radarrChecking && _t('settings.checkingRadarr')}
                  {!radarrOptions.connected &&
                    !radarrChecking &&
                    (radarrOptions.error ??
                      (radarrChecked ? _t('settings.testToChoose') : _t('settings.enterToTest')))}
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
                        onChange={(event) =>
                          setSettings({ ...settings, radarrQualityProfileId: event.target.value })
                        }
                      >
                        <option value="">{_t('settings.chooseQualityProfile')}</option>
                        {radarrOptions.qualityProfiles.map((profile) => (
                          <option key={profile.id} value={String(profile.id)}>
                            {profile.name}
                          </option>
                        ))}
                      </select>
                      <span id="settings-quality-profile-help" className="settingsFieldHelp">
                        {_t('settings.help.qualityProfile')}
                      </span>
                    </label>
                    <label>
                      {_t('settings.rootFolder')}
                      <select
                        aria-label={_t('settings.rootFolder')}
                        aria-describedby="settings-root-folder-help"
                        title={_t('settings.rootFolder')}
                        value={settings.radarrRootFolderPath}
                        onChange={(event) =>
                          setSettings({ ...settings, radarrRootFolderPath: event.target.value })
                        }
                      >
                        <option value="">{_t('settings.chooseRootFolder')}</option>
                        {radarrOptions.rootFolders.map((folder) => (
                          <option key={folder.path} value={folder.path}>
                            {folder.path}
                          </option>
                        ))}
                      </select>
                      <span id="settings-root-folder-help" className="settingsFieldHelp">
                        {_t('settings.help.rootFolder')}
                      </span>
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
                    onChange={(event) =>
                      setSettings({ ...settings, radarrMinimumAvailability: event.target.value })
                    }
                  >
                    <option value="announced">{_t('settings.availability.announced')}</option>
                    <option value="inCinemas">{_t('settings.availability.inCinemas')}</option>
                    <option value="released">{_t('settings.availability.released')}</option>
                  </select>
                  <span id="settings-minimum-availability-help" className="settingsFieldHelp">
                    {_t('settings.help.minimumAvailability')}
                  </span>
                </label>
                <div className="settingsCardActions">
                  <button
                    className="secondary"
                    type="submit"
                    disabled={busy === 'settings'}
                    title={_t('settings.save')}
                  >
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
                    onChange={(event) =>
                      setSettings({ ...settings, autoAddConfidenceThreshold: event.target.value })
                    }
                  />
                  <span id="settings-auto-add-help" className="settingsFieldHelp">
                    {_t('settings.help.autoAddAbove')}
                  </span>
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
                    onChange={(event) =>
                      setSettings({ ...settings, hideBelowConfidenceThreshold: event.target.value })
                    }
                  />
                  <span id="settings-auto-ignore-help" className="settingsFieldHelp">
                    {_t('settings.help.autoIgnoreBelow')}
                  </span>
                </label>
                <div className="settingsCardActions">
                  <button
                    className="secondary"
                    type="submit"
                    disabled={busy === 'settings'}
                    title={_t('settings.save')}
                  >
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
                    {busy === 'backup' ? (
                      <RefreshCcw className="spin" size={16} aria-hidden="true" />
                    ) : (
                      <Download size={16} aria-hidden="true" />
                    )}
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
                    {busy === 'restore' ? (
                      <RefreshCcw className="spin" size={16} aria-hidden="true" />
                    ) : (
                      <Upload size={16} aria-hidden="true" />
                    )}
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
            <aside className="comedianPanel" aria-label={_t('nav.comedians')}>
              <div className="libraryToolbar">
                <label className="librarySearch">
                  <Search size={16} aria-hidden="true" />
                  <span className="srOnly">{_t('library.filter')}</span>
                  <input
                    placeholder={_t('library.filter')}
                    value={libraryFilter}
                    onChange={(event) => setLibraryFilter(event.target.value)}
                  />
                </label>
              </div>
              <div className="listDivider">
                {_t('nav.comedians')}
                <span>{comedians.length}</span>
              </div>
              <div className="comedianList groupedList">
                {filteredComedians.map((comedian) => {
                  const count = comedianNewReviewCounts.get(comedian.id) ?? 0;
                  return (
                    <button
                      type="button"
                      className="comedianSelect"
                      key={comedian.id}
                      aria-current={
                        libraryView === 'comedians' && selectedComedianId === comedian.id ? 'true' : undefined
                      }
                      onClick={() => {
                        setSelectedComedianId(comedian.id);
                        setActiveTab('review');
                        setLibraryView('comedians');
                        setDetailOpen(true);
                      }}
                    >
                      <span className="avatar">
                        {comedian.profilePath ? (
                          <img src={`${imageBase}${comedian.profilePath}`} loading="lazy" alt="" />
                        ) : (
                          <span>{comedian.name.slice(0, 1)}</span>
                        )}
                      </span>
                      <span className="comedianCopy">
                        <strong>{comedian.name}</strong>
                        <span>
                          {busy === `scan-${comedian.id}`
                            ? _t('comedians.scanningBadge')
                            : count
                              ? _t('library.reviewCount', { count })
                              : _t('library.upToDate')}
                        </span>
                      </span>
                      {count > 0 && <span className="reviewCount">{count}</span>}
                      <ChevronRight size={15} className="rowChevron" aria-hidden="true" />
                    </button>
                  );
                })}
                {comedians.length === 0 && <p className="empty">{_t('comedians.empty')}</p>}
                {comedians.length > 0 && filteredComedians.length === 0 && (
                  <p className="empty">{_t('library.emptyFilter')}</p>
                )}
              </div>
              <button type="button" className="addComedianButton" onClick={openAddComedian}>
                <Plus size={17} aria-hidden="true" />
                {_t('comedians.addNew')}
              </button>
              <p className="sidebarFootnote">{_t('detail.footer')}</p>
            </aside>

            <section
              className="detailPanel"
              aria-label={
                libraryView === 'upcoming'
                  ? _t('upcoming.title')
                  : (selectedComedian?.name ?? _t('detail.noSelectionTitle'))
              }
            >
              {libraryView === 'upcoming' ? (
                <>
                  <button
                    type="button"
                    className="mobileBack textButton"
                    onClick={() => {
                      setDetailOpen(false);
                      setLibraryView('comedians');
                    }}
                  >
                    <ChevronLeft size={18} aria-hidden="true" />
                    {_t('nav.comedians')}
                  </button>
                  <div className="detailHeading">
                    <span className="eyebrow">{_t('library.title')}</span>
                    <h2>{_t('upcoming.title')}</h2>
                    <p>{_t('upcoming.help')}</p>
                  </div>
                  <div className="upcomingActions">
                    <button
                      type="button"
                      className="glassAction"
                      disabled={
                        Boolean(busy) ||
                        scanAllInFlightRef.current ||
                        !initialDataLoaded ||
                        !comedians.some((comedian) => comedian.tmdbPersonId)
                      }
                      aria-busy={scanAllInFlightRef.current}
                      onClick={() => void scanAllComedians()}
                    >
                      <RefreshCcw
                        size={17}
                        className={scanAllInFlightRef.current ? 'spin' : undefined}
                        aria-hidden="true"
                      />
                      {_t(scanAllInFlightRef.current ? 'upcoming.scanning' : 'upcoming.scanAll')}
                    </button>
                    <p className={scanAllInFlightRef.current ? 'srOnly' : 'inlineStatus'} role="status">
                      {scanAllInFlightRef.current
                        ? _t('upcoming.scanning')
                        : upcomingScanFeedback === 'success'
                          ? _t('upcoming.scanSuccess')
                          : ''}
                    </p>
                    <div className="inlineError" role="alert">
                      {upcomingScanFeedback === 'scanFailed'
                        ? _t('upcoming.scanFailed')
                        : upcomingScanFeedback === 'refreshFailed'
                          ? _t('upcoming.refreshFailed')
                          : upcomingScanFeedback === 'bothFailed'
                            ? _t('upcoming.bothFailed')
                            : ''}
                    </div>
                    {!comedians.some((comedian) => comedian.tmdbPersonId) && (
                      <p className="footnote">{_t('upcoming.noScannable')}</p>
                    )}
                  </div>
                  {upcoming.length === 0 ? (
                    <div className="detailEmptyState">
                      <CalendarDays size={35} aria-hidden="true" />
                      <p>{_t('upcoming.empty')}</p>
                    </div>
                  ) : (
                    <div className="groupedList">
                      {upcoming.map((candidate) => {
                        const movie = monitoredMovieByTmdbId.get(candidate.tmdbMovieId);
                        return movie ? (
                          <MonitoredMovieRow
                            key={candidate.id}
                            movie={movie}
                            candidate={candidate}
                            comedianName={candidate.comedianName}
                            busy={busy}
                            run={run}
                            _t={_t}
                          />
                        ) : (
                          <CandidateCard
                            key={candidate.id}
                            candidate={candidate}
                            busy={busy}
                            run={run}
                            _t={_t}
                            upcoming
                          />
                        );
                      })}
                    </div>
                  )}
                </>
              ) : !selectedComedian ? (
                <div className="detailEmptyState">
                  <Film size={42} aria-hidden="true" />
                  <strong>{_t('detail.noSelectionTitle')}</strong>
                  <span>{_t('detail.noSelectionHint')}</span>
                </div>
              ) : (
                <>
                  <div className="detailToolbar">
                    <button
                      type="button"
                      className="mobileBack textButton"
                      onClick={() => setDetailOpen(false)}
                    >
                      <ChevronLeft size={18} aria-hidden="true" />
                      {_t('nav.comedians')}
                    </button>
                    <details className="comedianMenu">
                      <summary aria-label={_t('detail.more')}>
                        <MoreHorizontal size={21} aria-hidden="true" />
                      </summary>
                      <div className="comedianMenuContent">
                        {selectedComedian.tmdbPersonId && (
                          <a
                            href={`https://www.themoviedb.org/person/${selectedComedian.tmdbPersonId}`}
                            target="_blank"
                            rel="noreferrer"
                          >
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
                        <button
                          type="button"
                          className="dangerText"
                          disabled={Boolean(busy)}
                          onClick={() => {
                            if (
                              !window.confirm(_t('comedians.deleteConfirm', { name: selectedComedian.name }))
                            )
                              return;
                            void run(`delete-${selectedComedian.id}`, async () => {
                              await api<void>(`/api/comedians/${selectedComedian.id}`, { method: 'DELETE' });
                              setSelectedComedianId(null);
                              setDetailOpen(false);
                            });
                          }}
                        >
                          <Trash2 size={14} aria-hidden="true" />
                          {_t('comedians.delete', { name: selectedComedian.name })}
                        </button>
                      </div>
                    </details>
                  </div>
                  <div className="detailHeading personHeading">
                    <span className="headingAvatar">
                      {selectedComedian.profilePath ? (
                        <img src={`${imageBase}${selectedComedian.profilePath}`} alt="" />
                      ) : (
                        <LaughMark />
                      )}
                    </span>
                    <div>
                      <h2>{selectedComedian.name}</h2>
                      <p>
                        {selectedComedianScanning
                          ? _t('detail.scanning')
                          : selectedComedian.lastScannedAt
                            ? _t('detail.scanned', {
                                date: new Date(
                                  selectedComedian.lastScannedAt.replace(' ', 'T') +
                                    (selectedComedian.lastScannedAt.includes('Z') ? '' : 'Z')
                                ).toLocaleDateString(settings.language)
                              })
                            : _t('detail.notScanned')}
                      </p>
                    </div>
                  </div>
                  <div
                    className="tabs"
                    role="tablist"
                    aria-label={_t('detail.resultCategories', { name: selectedComedian.name })}
                    onKeyDown={(event) => {
                      if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
                      event.preventDefault();
                      const order: DetailTab[] = ['review', 'monitored', 'notMonitored'];
                      const index = order.indexOf(activeTab);
                      const next =
                        event.key === 'Home'
                          ? 0
                          : event.key === 'End'
                            ? 2
                            : (index + (event.key === 'ArrowRight' ? 1 : 2)) % 3;
                      setActiveTab(order[next]);
                      document.getElementById(`tab-${order[next]}`)?.focus();
                    }}
                  >
                    {(['review', 'monitored', 'notMonitored'] as const).map((tab) => (
                      <button
                        type="button"
                        role="tab"
                        key={tab}
                        id={`tab-${tab}`}
                        aria-controls="specials-panel"
                        aria-selected={activeTab === tab}
                        tabIndex={activeTab === tab ? 0 : -1}
                        className={activeTab === tab ? 'tab active' : 'tab'}
                        onClick={() => setActiveTab(tab)}
                      >
                        {_t(`tabs.${tab}`)}
                        <span className="tabCount">
                          {tab === 'review'
                            ? reviewCandidates.length
                            : tab === 'monitored'
                              ? visibleMonitoredRows.length
                              : ignoredNotMonitoredCandidates.length}
                        </span>
                      </button>
                    ))}
                  </div>
                  <div id="specials-panel" role="tabpanel" aria-labelledby={`tab-${activeTab}`}>
                    {activeTab === 'review' &&
                      (reviewCandidates.length ? (
                        <CandidateStatusGroups groups={reviewCandidateGroups} busy={busy} run={run} _t={_t} />
                      ) : (
                        <p className="empty">{_t('empty.noReview')}</p>
                      ))}
                    {activeTab === 'monitored' &&
                      (visibleMonitoredRows.length ? (
                        <MonitoredRowsList
                          availableRows={availableMonitoredRows}
                          monitoredRows={pendingMonitoredRows}
                          comedianName={selectedComedian.name}
                          busy={busy}
                          run={run}
                          _t={_t}
                        />
                      ) : (
                        <p className="empty">{_t('empty.noMonitored')}</p>
                      ))}
                    {activeTab === 'notMonitored' &&
                      (ignoredNotMonitoredCandidates.length ? (
                        <CandidateStatusGroups
                          groups={notWantedCandidateGroups}
                          busy={busy}
                          run={run}
                          _t={_t}
                        />
                      ) : (
                        <p className="empty">{_t('empty.noNotMonitored')}</p>
                      ))}
                  </div>
                  <FilmAppearances
                    key={selectedComedian.id}
                    comedianId={selectedComedian.id}
                    language={settings.language}
                  />
                  <div className="scanFooter">
                    <span>{_t('detail.footer')}</span>
                    <button
                      type="button"
                      className="glassAction"
                      disabled={Boolean(busy) || !selectedComedian.tmdbPersonId}
                      onClick={() =>
                        void run(
                          `scan-${selectedComedian.id}`,
                          () =>
                            api<ScanResult>(`/api/comedians/${selectedComedian.id}/scan`, { method: 'POST' }),
                          (result) =>
                            _t('notice.candidatesSaved', { name: result.comedian.name, count: result.saved })
                        )
                      }
                    >
                      <RefreshCcw
                        size={17}
                        className={selectedComedianScanning ? 'spin' : ''}
                        aria-hidden="true"
                      />
                      {_t(selectedComedianScanning ? 'detail.scanning' : 'detail.scanForSpecials')}
                    </button>
                  </div>
                </>
              )}
            </section>
          </section>
        )}
      </section>
      <dialog
        ref={addDialogRef}
        className="addDialog"
        aria-labelledby="add-title"
        onCancel={(event) => {
          if (addingPersonId !== null) event.preventDefault();
          else setShowAddComedian(false);
        }}
        onClose={() => {
          searchControllerRef.current?.abort();
          setShowAddComedian(false);
        }}
      >
        <div className="sheetHeading">
          <h2 id="add-title">{_t('comedians.addNew')}</h2>
          <button
            type="button"
            className="iconButton"
            aria-label={_t('actions.close')}
            disabled={addingPersonId !== null}
            onClick={() => setShowAddComedian(false)}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <form className="addComedianForm" onSubmit={addComedian}>
          <label htmlFor="comedian-search" className="srOnly">
            {_t('comedians.searchLabel')}
          </label>
          <div className="addRow">
            <input
              id="comedian-search"
              placeholder={_t('comedians.searchPlaceholder')}
              value={name}
              autoComplete="off"
              disabled={addingPersonId !== null}
              onChange={(event) => {
                setName(event.target.value);
                setPersonMatches([]);
              }}
            />
            <button className="primary" type="submit" disabled={Boolean(busy) || !name.trim()}>
              <Search size={17} aria-hidden="true" />
              {_t('comedians.search')}
            </button>
          </div>
        </form>
        {busy === 'search-comedian' && (
          <p role="status" className="inlineStatus">
            {_t('comedians.search')}…
          </p>
        )}
        <div className="personMatches" aria-live="polite">
          {personMatches.map((match) => {
            const saved = comedians.find((comedian) => comedian.tmdbPersonId === match.tmdbPersonId);
            return (
              <article className="personMatch" key={match.tmdbPersonId}>
                <span className="avatar">
                  {match.profilePath ? (
                    <img loading="lazy" src={`${imageBase}${match.profilePath}`} alt="" />
                  ) : (
                    match.name.slice(0, 1)
                  )}
                </span>
                <div className="personMatchCopy">
                  <strong>{match.name}</strong>
                  <span>{match.knownFor.join(' · ')}</span>
                  {Boolean(match.matchReasons?.length) && <small>{_t('comedians.likelyComedian')}</small>}
                </div>
                <button
                  type="button"
                  className="glassAction"
                  disabled={Boolean(busy)}
                  onClick={() => {
                    if (saved) {
                      setSelectedComedianId(saved.id);
                      setActiveTab('review');
                      setLibraryView('comedians');
                      setDetailOpen(true);
                      setShowAddComedian(false);
                    } else void addComedianMatch(match);
                  }}
                >
                  {addingPersonId === match.tmdbPersonId
                    ? _t('comedians.adding')
                    : _t(saved ? 'comedians.show' : 'actions.add')}
                </button>
              </article>
            );
          })}
        </div>
        {error && (
          <p className="inlineError" role="alert">
            {error}
          </p>
        )}
        {notice && !error && (
          <p className="inlineStatus" role="status">
            {notice}
          </p>
        )}
        <div className="sheetFooter">
          <button type="button" disabled={addingPersonId !== null} onClick={() => setShowAddComedian(false)}>
            {_t('actions.cancel')}
          </button>
        </div>
      </dialog>
    </main>
  );
}

type RunFn = <T>(label: string, task: () => Promise<T>, success?: (result: T) => string) => Promise<void>;

type MonitoredRow = { movie: RadarrMonitoredMovie; candidate: Candidate | null };
type CandidateStatusGroup = { status: Candidate['status']; candidates: Candidate[] };

function TmdbMovieMetaLink({ tmdbMovieId }: { tmdbMovieId: number }) {
  return (
    <a
      href={`https://www.themoviedb.org/movie/${tmdbMovieId}`}
      target="_blank"
      rel="noreferrer"
      className="tmdbMetaLink"
    >
      TMDB
      <ExternalLink size={12} aria-hidden="true" />
    </a>
  );
}

function MonitoredRowsList({
  availableRows,
  monitoredRows,
  comedianName,
  busy,
  run,
  _t
}: {
  availableRows: MonitoredRow[];
  monitoredRows: MonitoredRow[];
  comedianName: string | null;
  busy: string | null;
  run: RunFn;
  _t: Translator;
}) {
  return (
    <div className="mediaGroups">
      {[
        { rows: availableRows, label: 'sections.availableWithCount' as const },
        { rows: monitoredRows, label: 'sections.monitoredWithCount' as const }
      ]
        .filter((group) => group.rows.length)
        .map((group) => (
          <section className="mediaGroup" key={group.label}>
            <h3 className="mediaGroupTitle">{_t(group.label, { count: group.rows.length })}</h3>
            <div className="groupedList">
              {group.rows.map(({ movie, candidate }) => (
                <MonitoredMovieRow
                  key={movie.id}
                  movie={movie}
                  candidate={candidate}
                  comedianName={comedianName}
                  busy={busy}
                  run={run}
                  _t={_t}
                />
              ))}
            </div>
          </section>
        ))}
    </div>
  );
}

function CandidateStatusGroups({
  groups,
  busy,
  run,
  _t
}: {
  groups: CandidateStatusGroup[];
  busy: string | null;
  run: RunFn;
  _t: Translator;
}) {
  return (
    <div className="mediaGroups">
      {groups.map((group) => (
        <section className="mediaGroup" key={group.status}>
          {group.status !== 'new' && (
            <h3 className="mediaGroupTitle">
              {_t('sections.statusWithCount', {
                status: _t(`status.${group.status}`),
                count: group.candidates.length
              })}
            </h3>
          )}
          <div className="groupedList">
            {group.candidates.map((candidate) => (
              <CandidateCard key={candidate.id} candidate={candidate} busy={busy} run={run} _t={_t} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function AcknowledgeButton({
  candidate,
  busy,
  run,
  _t
}: {
  candidate: Candidate;
  busy: string | null;
  run: RunFn;
  _t: Translator;
}) {
  return (
    <button
      type="button"
      className="glassAction"
      disabled={Boolean(busy)}
      aria-label={_t('candidate.acknowledge', { title: candidate.title })}
      onClick={() =>
        void run(
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
      <Check size={15} aria-hidden="true" />
      {_t('candidate.ok')}
    </button>
  );
}

function MonitoredMovieRow({
  movie,
  candidate,
  comedianName,
  busy,
  run,
  _t
}: {
  movie: RadarrMonitoredMovie;
  candidate: Candidate | null;
  comedianName: string | null;
  busy: string | null;
  run: RunFn;
  _t: Translator;
}) {
  const displayTitle = titleWithoutComedianName(
    candidate?.title ?? movie.title,
    candidate?.comedianName ?? comedianName
  );
  const posterPath = candidate?.posterPath;
  return (
    <article className="mediaRow monitoredRow">
      <div className="mediaPoster">
        {posterPath ? (
          <img loading="lazy" src={`${imageBase}${posterPath}`} alt="" />
        ) : (
          <Film size={24} aria-hidden="true" />
        )}
      </div>
      <div className="mediaDetails">
        <strong className="mediaTitle">{displayTitle}</strong>
        <span className="mediaByline">
          {[candidate?.comedianName ?? comedianName, movie.year ?? candidate?.year]
            .filter(Boolean)
            .join(' · ')}
        </span>
        <span className="rowStatus">
          {movie.hasFile ? <Check size={12} aria-hidden="true" /> : <Eye size={12} aria-hidden="true" />}
          {_t(movie.hasFile ? 'radarr.downloaded' : 'radarr.monitored')}
        </span>
        {candidate && isReleaseDate(candidate.releaseDate) && candidate.releaseDate > localCalendarDate() && (
          <span className="mediaByline">
            {_t('detail.releaseDate', {
              date: new Date(`${candidate.releaseDate}T12:00:00`).toLocaleDateString()
            })}
          </span>
        )}
        <details className="matchDisclosure">
          <summary>{_t('detail.matchDetails')}</summary>
          <p>{candidate?.overview || _t('candidate.noOverview')}</p>
          {movie.tmdbId && <TmdbMovieMetaLink tmdbMovieId={movie.tmdbId} />}
        </details>
      </div>
      <div className="mediaActions">
        {candidate?.status === 'auto_added' && (
          <AcknowledgeButton candidate={candidate} busy={busy} run={run} _t={_t} />
        )}
        {candidate?.radarrMovieId && !movie.hasFile && (
          <button
            type="button"
            className="textButton"
            disabled={Boolean(busy)}
            aria-label={_t('radarr.remove', { title: movie.title })}
            onClick={() =>
              void run(
                `remove-radarr-${candidate.id}`,
                () =>
                  api<Candidate>(`/api/candidates/${candidate.id}/remove-from-radarr`, { method: 'POST' }),
                () => _t('notice.removed', { title: movie.title })
              )
            }
          >
            <Trash2 size={16} aria-hidden="true" />
          </button>
        )}
      </div>
    </article>
  );
}

function CandidateCard({
  candidate,
  busy,
  run,
  _t,
  upcoming = false
}: {
  candidate: Candidate;
  busy: string | null;
  run: RunFn;
  _t: Translator;
  upcoming?: boolean;
}) {
  const canAdd = upcoming ? candidate.status === 'new' : candidate.status !== 'auto_added';
  return (
    <article className="mediaRow candidateRow">
      <div className="mediaPoster">
        {candidate.posterPath ? (
          <img loading="lazy" src={`${imageBase}${candidate.posterPath}`} alt="" />
        ) : (
          <Film size={24} aria-hidden="true" />
        )}
      </div>
      <div className="mediaDetails">
        <strong className="mediaTitle">
          {titleWithoutComedianName(candidate.title, candidate.comedianName)}
        </strong>
        <span className="mediaByline">
          {candidate.comedianName}
          {candidate.year ? ` · ${candidate.year}` : ''}
        </span>
        {upcoming && candidate.releaseDate && (
          <span className="releaseDate">
            {_t('detail.releaseDate', {
              date: new Date(`${candidate.releaseDate}T12:00:00`).toLocaleDateString()
            })}
          </span>
        )}
        {upcoming && candidate.status !== 'new' && (
          <span className="rowStatus">{_t('radarr.monitored')}</span>
        )}
        <details className="matchDisclosure">
          <summary>{_t('detail.matchDetails')}</summary>
          <p>{_t('detail.confidence', { score: candidate.confidence })}</p>
          <ul>
            {candidate.reasons.map((reason, index) => (
              <li key={index}>{reason}</li>
            ))}
          </ul>
          <p>{candidate.overview || _t('candidate.noOverview')}</p>
          <TmdbMovieMetaLink tmdbMovieId={candidate.tmdbMovieId} />
        </details>
      </div>
      <div className="mediaActions">
        {canAdd && (
          <button
            type="button"
            className="glassAction"
            disabled={Boolean(busy)}
            aria-label={_t('candidate.addToRadarr', { title: candidate.title })}
            onClick={() =>
              void run(
                `approve-${candidate.id}`,
                () => api<Candidate>(`/api/candidates/${candidate.id}/approve`, { method: 'POST' }),
                () => _t('notice.sentToRadarr', { title: candidate.title })
              )
            }
          >
            {busy === `approve-${candidate.id}` ? (
              <RefreshCcw className="spin" size={15} aria-hidden="true" />
            ) : (
              <Plus size={15} aria-hidden="true" />
            )}
            {_t('actions.add')}
          </button>
        )}
        {candidate.status === 'auto_added' && (
          <AcknowledgeButton candidate={candidate} busy={busy} run={run} _t={_t} />
        )}
        {candidate.status === 'new' && (
          <button
            type="button"
            className="textButton"
            disabled={Boolean(busy)}
            aria-label={_t('candidate.ignore', { title: candidate.title })}
            onClick={() =>
              void run(`ignore-${candidate.id}`, () =>
                api<Candidate>(`/api/candidates/${candidate.id}`, {
                  method: 'PATCH',
                  body: JSON.stringify({ status: 'ignored' })
                })
              )
            }
          >
            {_t('candidate.ignoreButton')}
          </button>
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
