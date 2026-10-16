// Shared by the auth pages (Login, Register, and any page that resumes a flow
// after sign-in, e.g. the MCP OAuth consent page). Keep the redirect
// validation in one place — it is security-sensitive and easy to drift.

// Resolve ?returnTo= to a safe same-origin path, else the authenticated app.
//
// The same-origin check alone is not enough: a value like /.//evil.com or
// /\evil.com parses same-origin but normalizes to a protocol-relative
// //evil.com when assigned to location.href — an open redirect. So require the
// resolved path to be exactly one leading slash (no "//" prefix, no backslash).
export function resolveSafeReturnTo(raw, origin) {
  if (!raw) return "/f7probusiness";
  try {
    const base = new URL(origin);
    const url = new URL(raw, base);
    if (url.origin !== base.origin) return "/f7probusiness";
    // Only access_token/clear_access_token are still URL-read by app-params.js, but the
    // whole bootstrap set stays stripped: one going back to a URL read must not silently
    // become injectable again. Normal app-flow params (e.g. the OAuth consent ctx) are kept.
    for (const p of ["access_token", "clear_access_token", "app_id", "app_base_url", "functions_version", "from_url"]) {
      url.searchParams.delete(p);
    }
    const path = url.pathname + url.search;
    if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return "/f7probusiness";
    return path;
  } catch {
    return "/f7probusiness";
  }
}

export function safeReturnTo() {
  const raw = new URLSearchParams(window.location.search).get("returnTo");
  return resolveSafeReturnTo(raw, window.location.origin);
}

// Supabase email confirmation returns to the same Preview origin, then the
// authenticated login route resumes the original same-origin destination.
export function emailConfirmationRedirect(origin, returnTo) {
  const base = new URL(origin);
  if (!['http:', 'https:'].includes(base.protocol)) throw new Error('INVALID_AUTH_ORIGIN');
  const callback = new URL('/login', base.origin);
  callback.searchParams.set('returnTo', resolveSafeReturnTo(returnTo, base.origin));
  return callback.toString();
}
