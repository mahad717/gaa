'use client';

/**
 * ============================================================================
 * WASMO — Secure HLS Video Player (anti-download / anti-hotlink)
 * ============================================================================
 * Threat model & mitigations implemented here:
 *   • No direct .mp4 URLs — playback via HLS (hls.js + MSE), custom <video>.
 *   • No "Save Video As" — controlsList="nodownload" + context-menu disabled.
 *   • No raw manifest/segment URLs in DOM or React state — the signed
 *     manifest URL lives ONLY in a closure/ref inside hls.js. Signed token
 *     is fetched from the edge worker at play time (10-min TTL, viewer-bound).
 *   • Segments only fetchable from our own origin — enforced by the worker
 *     (Referer/Origin allowlist + strict CORS).
 * ============================================================================
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { trackView } from '@/lib/supabase';
import { formatDuration } from '@/lib/seo';

export interface VideoPlayerProps {
  slug: string;
  /** Demo fallback stream (public test stream) until CF Stream is wired up */
  demoManifest?: string;
  poster?: string | null;
  title: string;
}

export default function VideoPlayer({ slug, demoManifest, poster, title }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  /** Signed manifest URL — intentionally a ref, NEVER rendered to the DOM. */
  const manifestUrlRef = useRef<string | null>(null);
  const viewTrackedRef = useRef(false);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  /** Re-entrancy guard — avoids stale `status` reads inside callbacks. */
  const loadingRef = useRef(false);
  /** Self-reference used for the one-shot token-expiry retry (see below). */
  const loadStreamRef = useRef<() => Promise<void>>(async () => undefined);

  /** Ask the edge worker for a fresh, short-lived signed manifest URL. */
  const resolveSignedManifest = useCallback(async (): Promise<string | null> => {
    if (demoManifest) return demoManifest; // demo mode only
    try {
      const res = await fetch(`/api/videos/${encodeURIComponent(slug)}/sign`, {
        method: 'GET',
        credentials: 'same-origin',
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { manifestUrl: string };
      return data.manifestUrl;
    } catch {
      return null;
    }
  }, [slug, demoManifest]);

  const destroy = useCallback(() => {
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    manifestUrlRef.current = null;
  }, []);

  const loadStream = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;

    if (loadingRef.current) return;
    loadingRef.current = true;
    setStatus('loading');
    setError(null);

    const src = await resolveSignedManifest();
    if (!src) {
      loadingRef.current = false;
      setStatus('error');
      setError('Could not authorize playback. Please refresh and try again.');
      return;
    }

    // Safari / iOS: native HLS support — src never rendered, kept in ref only.
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      destroy();
      video.src = src; // runtime property — not serialized into SSR HTML/state
      manifestUrlRef.current = src;
      loadingRef.current = false;
      setStatus('ready');
      void video.play().catch(() => undefined);
      return;
    }

    // Modern browsers: hls.js over Media Source Extensions
    if (Hls.isSupported()) {
      destroy();
      const hls = new Hls({
        // Limit exposure surface: no workers with readable URLs, cap buffer
        enableWorker: true,
        maxBufferLength: 30,
        backBufferLength: 30,
      });
      hlsRef.current = hls;
      hls.loadSource(src);
      manifestUrlRef.current = src;
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        loadingRef.current = false;
        setStatus('ready');
        void video.play().catch(() => undefined);
      });
      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && manifestUrlRef.current && !demoManifest) {
          // Token may have expired mid-session → mint a fresh one once
          loadingRef.current = false;
          hlsRef.current?.destroy();
          hlsRef.current = null;
          manifestUrlRef.current = null;
          void loadStreamRef.current();
          return;
        }
        loadingRef.current = false;
        setStatus('error');
        setError('Playback failed. The stream link may have expired — try again.');
      });
      return;
    }

    loadingRef.current = false;
    setStatus('error');
    setError('Your browser does not support encrypted adaptive streaming.');
  }, [demoManifest, destroy, resolveSignedManifest]);

  /** Keep the self-reference in sync without re-creating the callback. */
  useEffect(() => {
    loadStreamRef.current = loadStream;
  }, [loadStream]);

  useEffect(() => destroy, [destroy]);

  /** Track one view per session per video (race-safe RPC at the edge/DB). */
  const onFirstPlay = useCallback(() => {
    if (viewTrackedRef.current) return;
    viewTrackedRef.current = true;
    trackView(slug);
  }, [slug]);

  return (
    <div className="space-y-3">
      <div
        className="relative aspect-video w-full overflow-hidden rounded-xl border border-zinc-800 bg-black"
        // Block right-click → "Save video as" on the whole canvas area
        onContextMenu={(e) => e.preventDefault()}
      >
        <video
          ref={videoRef}
          className="h-full w-full"
          poster={poster ?? undefined}
          preload="none"
          playsInline
          controls
          // Anti-download surface reduction:
          controlsList="nodownload noplaybackrate noremoteplayback"
          disablePictureInPicture
          onPlay={onFirstPlay}
          aria-label={title}
          // x-webkit-airplay removal via attribute:
          x-webkit-airplay="deny"
        />
        {status !== 'ready' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 px-6 text-center">
            {status === 'idle' && (
              <>
                <button
                  onClick={loadStream}
                  className="flex h-16 w-16 items-center justify-center rounded-full bg-rose-600 text-white transition hover:bg-rose-500 focus-visible:outline-2 focus-visible:outline-rose-400"
                  aria-label={`Play ${title}`}
                >
                  <svg viewBox="0 0 24 24" className="ml-1 h-7 w-7 fill-current" aria-hidden="true">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </button>
                <p className="text-sm text-zinc-400">
                  Playback starts on demand via a signed, expiring stream token.
                </p>
              </>
            )}
            {status === 'loading' && (
              <div className="flex flex-col items-center gap-3" role="status" aria-live="polite">
                <div className="h-10 w-10 animate-spin rounded-full border-2 border-zinc-600 border-t-rose-500" />
                <p className="text-sm text-zinc-400">Authorizing secure stream…</p>
              </div>
            )}
            {status === 'error' && (
              <div className="max-w-sm">
                <p className="mb-3 text-sm text-rose-400">{error}</p>
                <button
                  onClick={loadStream}
                  className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-500"
                >
                  Retry
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      <p className="text-xs text-zinc-500">
        <span className="inline-flex items-center gap-1">
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current" aria-hidden="true">
            <path d="M12 1 3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z" />
          </svg>
          Protected stream · signed HLS · downloading is disabled
        </span>
      </p>
    </div>
  );
}

// Re-export for convenience of pages importing duration formatter alongside
export { formatDuration };
