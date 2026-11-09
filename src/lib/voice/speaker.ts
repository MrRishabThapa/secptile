/**
 * Secptile's voice in the browser: fetches speech from /api/tts
 * (Qwen3-TTS-Flash through the app's own proxy) and plays it via WebAudio.
 *
 * One utterance at a time — a new speak() cancels whatever was playing.
 * Muting persists in localStorage, and subscribers (e.g. the mute toggle)
 * mirror speaking/muted state for the UI.
 */

export type SpeakerState = {
  /** An utterance is being fetched or is audible right now. */
  speaking: boolean;
  /** Wake-response/answers audio is suppressed; text is still shown. */
  muted: boolean;
};

const MUTED_KEY = "secptile:speak:muted";

let state: SpeakerState = { speaking: false, muted: false };
let context: AudioContext | null = null;
let source: AudioBufferSourceNode | null = null;
let aborter: AbortController | null = null;

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
export async function speak(text: string): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed || getSpeakerState().muted) return;

  // Speak one thing at a time: interrupt the previous utterance.
  cancelSpeech();
  const mine = generation;
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
