import { redact } from "../redact.js";

const PLACEHOLDER = "[redacted]";
const URL_RE = /https?:\/\/[^\s"'<>)]+/g;
// A word that looks like an id (UID, session, long hash): 20+ alphanumerics containing a digit.
const ID_LIKE = /\b(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{20,}\b/g;
// "Código da sala: abc123", "room code abc123": a 6-char code close after a room word.
// Bare "code" is not a trigger on purpose ("error code ..." would over-redact plain words).
const ROOM_CODE = /\b(sala|room|c[oó]digo)\b[^\n]{0,24}?\b[A-Za-z0-9]{6}\b/gi;

// 6-character path words that are known route/RPC names. Any other 6-character segment may be
// a room code (the runner generates 6-char base36 codes), so it is masked.
const SIX_CHAR_ROUTES = new Set(["online", "ranked", "battle", "listen"]);
const isIdSegment = (s: string) =>
  (s.length >= 16 && !s.includes(".")) || /\d{4,}/.test(s) || (/^[A-Za-z0-9]{6}$/.test(s) && !SIX_CHAR_ROUTES.has(s.toLowerCase()));

/** Host + shape only: no query, no origin of the Preview, ids collapsed. Never a full URL. */
export function safeUrlLabel(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return PLACEHOLDER;
  }
  const host = url.hostname.endsWith(".vercel.app") ? "preview" : url.hostname;
  const segments = url.pathname
    .split("/")
    .filter(Boolean)
    .slice(0, 4)
    .map((s) => (isIdSegment(s) ? ":id" : s.slice(0, 40)));
  return `${host}/${segments.join("/")}`;
}

/**
 * Defence in depth on top of the runner's own redaction: the observer cannot know the
 * runtime secrets, so it also strips URLs down to a label, e-mails, token/id-like strings
 * and room-code-looking text before anything reaches findings.json or the dashboard.
 */
export function sanitizeText(text: string, max = 300): string {
  let out = redact(text);
  out = out.replace(URL_RE, (u) => safeUrlLabel(u));
  out = out.replace(ROOM_CODE, (m) => m.replace(/[A-Za-z0-9]{6}$/, PLACEHOLDER));
  out = out.replace(ID_LIKE, PLACEHOLDER);
  return out.replace(/\s+/g, " ").trim().slice(0, max);
}

/** Stable key for "the same message": case, digits and spacing differences are ignored. */
export function normalizeForFingerprint(text: string): string {
  return text.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
}
