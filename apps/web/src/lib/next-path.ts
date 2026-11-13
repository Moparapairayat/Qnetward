/**
 * Where to go after signing in. A link like /signup?next=/workspace/billing
 * remembers its destination for this tab, so it survives email verification
 * and the Google round trip, and the console opens there instead of the
 * overview.
 *
 * Only paths on this site are accepted. Anything else, such as
 * "//evil.example", "https://…", or "/\evil", is ignored, so a crafted link
 * can't send someone to another site after they sign in (an open redirect).
 */

const KEY = "qnw-next";
const MAX_AGE_MS = 30 * 60 * 1000;
const FALLBACK = "/overview";

/** A same-site path, or null. */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (!raw || raw.length > 512) return null;
  // Must be a path: one leading slash, not "//" or "/\" (both mean another host).
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return null;
  // No control characters, which browsers strip and could turn into "//".
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return null;
  }
  try {
    const base = "https://qnetward.invalid";
    const url = new URL(raw, base);
    if (url.origin !== base) return null;
    // The auth pages themselves would loop.
    if (/^\/(login|signup|verify-email|forgot-password|reset-password)(\/|$)/.test(url.pathname)) return null;
    return url.pathname + url.search + url.hash;
  } catch {
    return null;
  }
}

/** Keeps ?next= from the current URL for this tab, if it's a safe path. */
export function rememberNextFromURL() {
  const next = safeNextPath(new URLSearchParams(window.location.search).get("next"));
  if (!next) return;
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ path: next, at: Date.now() }));
  } catch {
    // Storage blocked: the visitor simply lands on the overview.
  }
}

/** The remembered destination, or null, without using it up. */
export function peekNext(): string | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as { path?: string; at?: number } | null;
    if (!saved?.path || !saved.at || Date.now() - saved.at > MAX_AGE_MS) return null;
    return safeNextPath(saved.path);
  } catch {
    return null;
  }
}

/**
 * Where to go now that the visitor is signed in. Reading doesn't forget it:
 * sign-in can ask more than once at the same moment (the form and the
 * signed-in check both navigate), and each must get the same answer. The
 * console forgets it once the visitor arrives (clearNext).
 */
export function takeNext(): string {
  return peekNext() ?? FALLBACK;
}

/** Forgets the remembered destination. */
export function clearNext() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to clean up.
  }
}
