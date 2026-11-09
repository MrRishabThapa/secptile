/**
 * Assistant state (Phase 6, server-only): a tiny in-memory bridge between
 * the desktop daemon and the browser UI. No database, no premises on
 * persistence — it's a live-status board plus a single pending transcript.
 *
 * The daemon authenticates every POST with `X-Secptile-Daemon-Secret`
 * (SECPTILE_ASSISTANT_SECRET in .env.local). GETs stay unauthenticated —
 * localhost only, and nothing here is a secret.
 */

export type AssistantStatus = {
  id: string;
  /** listening | transcribing | sent | error | muted | stopped */
  state: string;
  detail: string;
  at: string; // ISO
};

export type AssistantTranscript = {
  id: string;
  text: string;
  at: string; // ISO
};

/** Text the Chat page wants the daemon to say out loud. */
export type AssistantSpeech = {
  id: string;
  text: string;
  /** After speaking, the daemon listens for an answer with no wake phrase. */
  expectReply: boolean;
  at: string; // ISO
};

type Store = {
  status: AssistantStatus | null;
  pending: AssistantTranscript | null;
  speech?: AssistantSpeech | null;
};

/** The daemon reports every 5 s; silence for longer means it is gone. */
const DAEMON_ONLINE_MS = 15_000;
/** The mic is closed in these states, so the browser should speak instead. */
const OFFLINE_STATES = new Set(["stopped", "muted"]);
/** An unclaimed transcript this old must not start a journal on a later visit. */
const PENDING_TRANSCRIPT_MS = 10 * 60_000;

/** Survives dev-server HMR reimports (module-level singleton). */
function store(): Store {
  const ref = globalThis as typeof globalThis & {
    __secptileAssistantStore?: Store;
  };
  ref.__secptileAssistantStore ??= { status: null, pending: null };
  return ref.__secptileAssistantStore;
}

export function publishStatus(event: AssistantStatus): void {
  store().status = event;
}

export function publishTranscript(transcript: AssistantTranscript): void {
  store().pending = transcript;
}

export function readStatus(): AssistantStatus | null {
  return store().status;
}

export function readPendingTranscript(): AssistantTranscript | null {
  const pending = store().pending;
  if (!pending) return null;
  return Date.now() - Date.parse(pending.at) <= PENDING_TRANSCRIPT_MS ? pending : null;
}

export function daemonOnline(): boolean {
  const status = store().status;
  if (!status || OFFLINE_STATES.has(status.state)) return false;
  return Date.now() - Date.parse(status.at) <= DAEMON_ONLINE_MS;
}

export function publishSpeech(speech: AssistantSpeech): void {
  store().speech = speech;
}

export function readSpeech(): AssistantSpeech | null {
  return store().speech ?? null;
}

/** Withdraws speech, but only if it is still this one, not a newer one. */
export function clearSpeech(id: string): void {
  if (store().speech?.id === id) store().speech = null;
}

/** Browser-only routes: refuse requests that other websites could trigger. */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function daemonAuthorized(headers: Headers): boolean {
  const expected = process.env.SECPTILE_ASSISTANT_SECRET?.trim();
  if (!expected) return false;
  return headers.get("x-secptile-daemon-secret")?.trim() === expected;
}
