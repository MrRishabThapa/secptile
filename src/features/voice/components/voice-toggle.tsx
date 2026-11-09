"use client";

import { useEffect, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import {
  getSpeakerState,
  setSpeechMuted,
  subscribeSpeaker,
  type SpeakerState,
} from "@/lib/voice/speaker";

/**
 * Voice controls for Secptile's spoken responses: a mute toggle that also
 * pulses while Secptile is speaking (Phase 6 privacy habit — the mic and
 * speaker states stay visible, never hidden).
 */
export function VoiceToggle() {
  const [state, setState] = useState<SpeakerState>(() => getSpeakerState());

  useEffect(() => subscribeSpeaker(setState), []);

  return (
    <button
      type="button"
      onClick={() => setSpeechMuted(!state.muted)}
      aria-pressed={!state.muted}
      aria-label={state.muted ? "Turn voice responses on" : "Turn voice responses off"}
      title={
        state.muted
          ? "Voice responses are muted"
          : state.speaking
            ? "Secptile is speaking — click to mute"
            : "Secptile will speak responses — click to mute"
      }
      className="rounded-lg border border-zinc-300 p-2 text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
    >
      {state.muted ? (
        <VolumeX aria-hidden className="h-5 w-5" />
      ) : (
        <Volume2
          aria-hidden
          className={`h-5 w-5 ${state.speaking ? "animate-pulse text-emerald-600 dark:text-emerald-400" : ""}`}
        />
      )}
    </button>
  );
}
