/**
 * Secptile's voice in the browser: fetches speech from /api/tts
 * (Qwen3-TTS-Flash through the app's own proxy) and plays it via WebAudio.
 *
 * One utterance at a time — a new speak() cancels whatever was playing.
 * Muting persists in localStorage, and subscribers (e.g. the mute toggle)
 * mirror speaking/muted state for the UI.
 *
 * When the desktop daemon is running, the text goes to the daemon instead: it
 * plays the speech itself so you can interrupt it, and it hears your reply.
 */

export type SpeakerState = {
  /** An utterance is being fetched or is audible right now. */
  speaking: boolean;
  /** Wake-response/answers audio is suppressed; text is still shown. */
  muted: boolean;
};

export type SpeakOptions = {
  /** The daemon listens for a spoken answer afterwards, with no wake phrase. */
  expectReply?: boolean;
};

const MUTED_KEY = "secptile:speak:muted";
const DAEMON_SPEECH_URL = "/api/assistant/speech";

let state: SpeakerState = { speaking: false, muted: false };
let context: AudioContext | null = null;
let source: AudioBufferSourceNode | null = null;
let aborter: AbortController | null = null;
/** The utterance the daemon is currently holding, so it can be withdrawn. */
let daemonSpeechId: string | null = null;

/** Increments on every cancel; stale async steps check it and lose. */
let generation = 0;
const listeners = new Set<(state: SpeakerState) => void>();

try {
  state.muted = window.localStorage.getItem(MUTED_KEY) === "1";
} catch {
  /* private mode — default to unmuted */
}

function setState(next: Partial<SpeakerState>) {
  state = { ...state, ...next };
  for (const listener of listeners) listener(state);
}

export function getSpeakerState(): SpeakerState {
  return state;
}

export function subscribeSpeaker(listener: (state: SpeakerState) => void): () => void {
  listeners.add(listener);
  listener(state);
  return () => {
    listeners.delete(listener);
  };
}

export function setSpeechMuted(muted: boolean) {
  try {
    window.localStorage.setItem(MUTED_KEY, muted ? "1" : "0");
  } catch {
    /* private mode — mute still applies for this page */
  }
  if (muted) cancelSpeech();
  setState({ muted });
}

/** Stops the current utterance and drops anything queued behind it. */
export function cancelSpeech() {
  withdrawDaemonSpeech(daemonSpeechId);
  daemonSpeechId = null;
  stopLocalSpeech();
}

function withdrawDaemonSpeech(id: string | null) {
  if (!id) return;
  void fetch(`${DAEMON_SPEECH_URL}?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
    keepalive: true,
  }).catch(() => undefined);
}

/** Returns the daemon's id for this speech, or null if the browser should speak. */
async function routeToDaemon(text: string, expectReply: boolean): Promise<string | null> {
  try {
    const response = await fetch(DAEMON_SPEECH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, expectReply }),
    });
    if (!response.ok) return null;
    const payload: unknown = await response.json();
    const { routed, id } = (payload ?? {}) as { routed?: unknown; id?: unknown };
    return routed === true && typeof id === "string" ? id : null;
  } catch {
    return null;
  }
}

/**
 * Hands the daemon a line that should outlive this page, such as the "draft
 * is ready" line said while navigating away. Does nothing if the daemon is off.
 */
export function announceThroughDaemon(text: string) {
  if (getSpeakerState().muted) return;
  void routeToDaemon(text, false);
}

function stopLocalSpeech() {
  generation += 1;
  aborter?.abort();
  aborter = null;
  if (source) {
    try {
      source.stop();
    } catch {
      /* already stopped */
    }
    source = null;
  }
  setState({ speaking: false });
}

function getContext(): AudioContext {
  if (!context) context = new AudioContext();
  if (context.state === "suspended") void context.resume();
  return context;
}

/**
 * Speaks one utterance. Resolves when playback finishes (or the utterance
 * was cut short by a newer speak/cancel/mute — also resolves, silently).
 * Failures are logged, not thrown: the text is always on screen anyway.
 */
export async function speak(text: string, options: SpeakOptions = {}): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed || getSpeakerState().muted) return;

  // Speak one thing at a time: interrupt the previous utterance. The daemon
  // needs no withdrawal here, because new speech replaces the old on arrival.
  stopLocalSpeech();
  daemonSpeechId = null;
  const mine = generation;

  const routedId = await routeToDaemon(trimmed, options.expectReply ?? false);
  if (mine !== generation) {
    withdrawDaemonSpeech(routedId);
    return;
  }
  if (routedId) {
    daemonSpeechId = routedId;
    return;
  }

  const audioContext = getContext();
  aborter = new AbortController();
  setState({ speaking: true });

  try {
    const response = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: trimmed }),
      signal: aborter.signal,
    });
    if (mine !== generation) return;
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      const message =
        payload && typeof payload.error === "string" ? payload.error : `Speech failed (${response.status}).`;
      throw new Error(message);
    }

    const bytes = await response.arrayBuffer();
    if (mine !== generation) return;
    const audio = await audioContext.decodeAudioData(bytes);
    if (mine !== generation) return;

    const clip = audioContext.createBufferSource();
    clip.buffer = audio;
    clip.connect(audioContext.destination);
    source = clip;
    await new Promise<void>((resolve) => {
      clip.onended = () => resolve();
      clip.start();
    });
    source = null;
  } catch (error) {
    if (mine !== generation) return;
    if (error instanceof Error && error.name === "AbortError") return;
    console.warn("[voice] speech failed:", error);
  } finally {
    if (mine === generation) {
      aborter = null;
      setState({ speaking: false });
    }
  }
}
