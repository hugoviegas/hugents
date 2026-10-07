const PLACEHOLDER = "[redacted]";
// Long mixed-case strings containing a digit: JWTs, API keys, session ids. Plain hyphenated words stay.
const TOKEN_LIKE =
  /\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Z])(?=[A-Za-z0-9_-]*[a-z])[A-Za-z0-9_-]{24,}(?:\.[A-Za-z0-9_-]{10,}){0,2}\b/g;
const SENSITIVE_PARAM =
  /([?&;](?:key|token|auth|access_token|id_token|apikey|api_key|sid|session|code|secret)=)[^&#\s"']*/gi;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const URL_RE = /https?:\/\/[^\s"'<>)]+/g;

/** Drops query string and fragment from every URL in a string. */
function stripUrlQueries(text: string): string {
  return text.replace(URL_RE, (url) => url.replace(/[?#].*$/, ""));
}

/**
 * Removes known secret values plus token-like, e-mail and query-string content.
 * Known secrets are replaced first so partial matches cannot leak a suffix.
 */
export function redact(text: string, secrets: readonly string[] = []): string {
  let out = text;
  const known = secrets.filter((s) => s.length >= 3).sort((a, b) => b.length - a.length);
  for (const secret of known) out = out.split(secret).join(PLACEHOLDER);
  out = out.replace(SENSITIVE_PARAM, `$1${PLACEHOLDER}`);
  out = stripUrlQueries(out);
  out = out.replace(BEARER, `$1 ${PLACEHOLDER}`);
  out = out.replace(EMAIL, PLACEHOLDER);
  return out.replace(TOKEN_LIKE, PLACEHOLDER);
}
