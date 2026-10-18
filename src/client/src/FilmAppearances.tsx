/**
 * Renders opt-in film discovery beneath a comedian's specials. This component
 * owns transient request and pending state; the API validates film membership
 * and Radarr owns additions. Nothing here changes the specials review queue.
 */

import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Film, Plus, RefreshCcw } from 'lucide-react';
import type { FilmAppearance, FilmAppearancesResult } from '../../shared/types';
import { createTranslator } from './i18n';

/**
 * Lazily loads a single comedian's film credits. The parent keys this component
 * by comedian ID so selection changes discard pending display state. GETs are
 * abortable; explicit external writes finish independently of navigation.
 */
export function FilmAppearances({ comedianId, language }: { comedianId: number; language: string }) {
  const t = createTranslator(language);
  const [open, setOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<FilmAppearancesResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<'films.error' | 'films.refreshError' | 'films.addError' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<Set<number>>(new Set());
  const pendingIds = useRef(new Set<number>());
  const generation = useRef(0);
  const loadedRevision = useRef<number | null>(null);
  const alive = useRef(true);
  const hasAdded = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (!open || loadedRevision.current === revision) return;
    const controller = new AbortController();
    const token = ++generation.current;
    setLoading(true);
    setError(null);
    fetch(`/api/comedians/${comedianId}/films`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('metadata');
        return response.json() as Promise<FilmAppearancesResult>;
      })
      .then((data) => {
        if (token === generation.current && !controller.signal.aborted) {
          loadedRevision.current = revision;
          setResult(data);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted && token === generation.current)
          setError(hasAdded.current ? 'films.refreshError' : 'films.error');
      })
      .finally(() => {
        if (!controller.signal.aborted && token === generation.current) setLoading(false);
      });
    return () => {
      controller.abort();
      generation.current++;
    };
  }, [open, comedianId, revision]);

  async function add(film: FilmAppearance, monitor: boolean) {
    if (pendingIds.current.has(film.tmdbMovieId)) return;
    pendingIds.current.add(film.tmdbMovieId);
    setPending(new Set(pendingIds.current));
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/comedians/${comedianId}/films/${film.tmdbMovieId}/add`, {
        method: 'POST'
      });
      if (!response.ok) throw new Error('radarr');
      const added = (await response.json()) as { radarrMovieId: number | null };
      if (!alive.current) return;
      if (added.radarrMovieId != null) {
        setResult((previous) =>
          previous
            ? {
                ...previous,
                states: [
                  ...previous.states.filter((state) => state.tmdbId !== film.tmdbMovieId),
                  {
                    tmdbId: film.tmdbMovieId,
                    radarrId: added.radarrMovieId!,
                    monitored: true,
                    hasFile:
                      previous.states.find((state) => state.tmdbId === film.tmdbMovieId)?.hasFile ?? false
                  }
                ]
              }
            : previous
        );
      }
      hasAdded.current = true;
      setMessage(t(monitor ? 'films.monitoredNotice' : 'films.added', { title: film.title }));
      setRevision((value) => value + 1);
    } catch {
      if (alive.current) setError('films.addError');
    } finally {
      pendingIds.current.delete(film.tmdbMovieId);
      if (alive.current) setPending(new Set(pendingIds.current));
    }
  }

  return (
    <details className="filmDiscovery" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        <span>{t('films.title')}</span>
        <span className="disclosureHint">{t('films.hint')}</span>
      </summary>
      {open && (
        <div className="filmContent">
          {loading && (
            <p className="inlineStatus" role="status">
              <RefreshCcw className="spin" size={14} aria-hidden="true" />
              {t(result ? 'films.refreshing' : 'films.loading')}
            </p>
          )}
          {message && (
            <p className="inlineStatus" role="status">
              {message}
            </p>
          )}
          {error && (
            <div className="inlineError" role="alert">
              <p>{t(error)}</p>
              <button type="button" disabled={loading} onClick={() => setRevision((value) => value + 1)}>
                {t('films.retry')}
              </button>
            </div>
          )}
          {result && (
            <>
              {!result.statusAvailable && <p className="inlineStatus">{t('films.statusUnavailable')}</p>}
              {result.films.length === 0 ? (
                <p className="empty">{t('films.empty')}</p>
              ) : (
                <div className="groupedList">
                  {result.films.map((film) => {
                    const state = result.states.find((item) => item.tmdbId === film.tmdbMovieId);
                    const owned = state?.monitored || state?.hasFile;
                    const saving = pending.has(film.tmdbMovieId);
                    return (
                      <article className="mediaRow filmRow" key={film.tmdbMovieId}>
                        <div className="mediaPoster">
                          {film.posterPath ? (
                            <img
                              loading="lazy"
                              src={`https://image.tmdb.org/t/p/w185${film.posterPath}`}
                              alt=""
                            />
                          ) : (
                            <Film size={22} aria-hidden="true" />
                          )}
                        </div>
                        <div className="mediaDetails">
                          <strong className="mediaTitle">{film.title}</strong>
                          <span className="mediaByline">
                            {[film.releaseDate?.slice(0, 4), film.character].filter(Boolean).join(' · ')}
                          </span>
                          <details className="matchDisclosure">
                            <summary>{t('detail.matchDetails')}</summary>
                            <p>{film.overview || t('candidate.noOverview')}</p>
                            <a
                              href={`https://www.themoviedb.org/movie/${film.tmdbMovieId}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              TMDB <ExternalLink size={12} aria-hidden="true" />
                            </a>
                          </details>
                        </div>
                        <div className="mediaActions">
                          {owned ? (
                            <span className="rowStatus">
                              {t(state?.hasFile ? 'radarr.downloaded' : 'radarr.monitored')}
                            </span>
                          ) : (
                            <button
                              type="button"
                              className="glassAction"
                              disabled={saving || !result.statusAvailable || loading}
                              onClick={() => void add(film, Boolean(state))}
                              aria-label={`${t(state ? 'films.monitor' : 'actions.add')} ${film.title}`}
                            >
                              {saving ? (
                                <RefreshCcw className="spin" size={15} aria-hidden="true" />
                              ) : (
                                <Plus size={15} aria-hidden="true" />
                              )}
                              {t(saving ? 'films.working' : state ? 'films.monitor' : 'actions.add')}
                            </button>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </>
          )}
          <p className="footnote">{t('films.disclaimer')}</p>
        </div>
      )}
    </details>
  );
}
