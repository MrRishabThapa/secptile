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

type Store = {
  status: AssistantStatus | null;
  pending: AssistantTranscript | null;
};

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
  return store().pending;
}

export function daemonAuthorized(headers: Headers): boolean {
  const expected = process.env.SECPTILE_ASSISTANT_SECRET?.trim();
  if (!expected) return false;
  return headers.get("x-secptile-daemon-secret")?.trim() === expected;
}
