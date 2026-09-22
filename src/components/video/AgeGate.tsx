'use client';

/**
 * ============================================================================
 * WASMO — Age Gate (client layer of the two-layer verification flow)
 * ============================================================================
 * Layer 1 (this component): UX gate — modal before any content interaction.
 * Layer 2 (worker.js): the edge checks the `wv_age_ok` cookie on every HTML
 *   route and every /media + /api request; media is additionally protected by
 *   signed tokens, so a forged cookie alone never unlocks video content.
 * When the viewer is signed in, the attestation is also persisted to
 * profiles.age_verified for compliance record-keeping.
 *
 * Implementation note: the cookie is read through useSyncExternalStore so the
 * server renders the content (crawlable — the edge is the real gate) while the
 * client picks up the cookie state without hydration mismatches or effects
 * that synchronously setState.
 * ============================================================================
 */

import { useCallback, useSyncExternalStore } from 'react';
import { supabase } from '@/lib/supabase';

const AGE_COOKIE = 'wv_age_ok';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

/* ── Minimal external store over document.cookie ─────────────────────────── */

const cookieListeners = new Set<() => void>();

function subscribeCookie(listener: () => void) {
  cookieListeners.add(listener);
  return () => {
    cookieListeners.delete(listener);
  };
}

function notifyCookieChanged() {
  for (const listener of cookieListeners) listener();
}

function hasAgeCookie(): boolean {
  if (typeof document === 'undefined') return false;
  return document.cookie.split(/;\s*/).some((c) => c.startsWith(`${AGE_COOKIE}=1`));
}

function setAgeCookie() {
  const secure = typeof location !== 'undefined' && location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${AGE_COOKIE}=1; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
}

/** Best-effort server-side attestation (sets the edge cookie authoritatively). */
async function attestAtEdge() {
  try {
    await fetch('/api/age-verify', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `redirect=${encodeURIComponent(typeof location !== 'undefined' ? location.pathname : '/')}`,
    });
  } catch {
    /* demo mode: no worker deployed — client cookie below is the gate */
  }
}

/** Persist attestation for signed-in users (compliance trail). */
async function persistToProfile() {
  if (!supabase) return;
  try {
    const { data } = await supabase.auth.getUser();
    if (!data.user) return;
    await supabase
      .from('profiles')
      .update({ age_verified: true, age_verified_at: new Date().toISOString() })
      .eq('id', data.user.id);
  } catch {
    /* non-fatal */
  }
}

export interface AgeGateProps {
  children?: React.ReactNode;
}

export default function AgeGate({ children }: AgeGateProps) {
  // Server snapshot = verified (content SSRs for crawlers; edge enforces for
  // real). Client snapshot = live cookie state. No effects, no mismatches.
  const verified = useSyncExternalStore(
    subscribeCookie,
    hasAgeCookie,
    () => true
  );

  const confirm = useCallback(() => {
    setAgeCookie();
    notifyCookieChanged();
    void attestAtEdge();
    void persistToProfile();
  }, []);

  const decline = useCallback(() => {
    // Politely eject
    if (typeof window !== 'undefined') window.location.href = 'https://www.google.com';
  }, []);

  // Content stays in the DOM (crawlable — the edge worker is the real gate in
  // production) but is made inert + aria-hidden until attestation.
  return (
    <>
      <div inert={verified ? undefined : true} aria-hidden={!verified}>
        {children}
      </div>
      {!verified && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="age-gate-title"
          aria-describedby="age-gate-desc"
        >
          <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-8 text-center shadow-2xl">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-rose-600/15 text-rose-500">
              <svg viewBox="0 0 24 24" className="h-7 w-7 fill-current" aria-hidden="true">
                <path d="M12 2 1 21h22L12 2zm0 6 7.53 13H4.47L12 8zm-1 5v2h2v-2h-2zm0 4v2h2v-2h-2z" />
              </svg>
            </div>
            <h2 id="age-gate-title" className="text-xl font-bold text-zinc-50">
              Age Verification Required
            </h2>
            <p id="age-gate-desc" className="mt-3 text-sm leading-relaxed text-zinc-400">
              This website contains age-restricted material. By entering, you confirm that you are
              at least 18 years old (or the age of majority in your jurisdiction), that such
              material is legal in your location, and that you wish to view it.
            </p>
            <div className="mt-6 space-y-3">
              <button
                onClick={confirm}
                className="w-full rounded-xl bg-rose-600 px-5 py-3.5 text-base font-semibold text-white transition hover:bg-rose-500 focus-visible:outline-2 focus-visible:outline-rose-400"
              >
                I am 18 or older — Enter
              </button>
              <button
                onClick={decline}
                className="w-full rounded-xl border border-zinc-700 px-5 py-3.5 text-base font-medium text-zinc-300 transition hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-zinc-500"
              >
                Leave this site
              </button>
            </div>
            <p className="mt-4 text-xs text-zinc-600">
              Your attestation is stored in a first-party cookie and verified again at the network
              edge.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
