"use client";

import { useState } from "react";
import { MicButton } from "./mic-button";
import { useVoiceRecorder } from "../hooks/use-voice-recorder";

export type TranscriptInput = {
  transcript: string;
  privateNotes?: string;
};

type Props = {
  busy: boolean;
  transcript: string;
  onTranscriptChange: (value: string) => void;
  onSubmit: (input: TranscriptInput) => void;
};

export function TranscriptForm({
  busy,
  transcript,
  onTranscriptChange,
  onSubmit,
}: Props) {
  const [privateNotes, setPrivateNotes] = useState("");
  const [showPrivate, setShowPrivate] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);

  const mic = useVoiceRecorder({
    onTranscript: (text) => onTranscriptChange(text),
    onError: (message) => setMicError(message),
  });

  const canSend = transcript.trim().length > 0 && !busy && mic.state === "idle";

  return (
    <form
      className="flex w-full flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({
          transcript: transcript.trim(),
          privateNotes: privateNotes.trim() || undefined,
        });
      }}
    >
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          How was your day?
        </span>
        <textarea
          value={transcript}
          onChange={(event) => onTranscriptChange(event.target.value)}
          disabled={busy || mic.state !== "idle"}
          rows={8}
          placeholder="Talk it out or type it — brain-dump everything: what you did, who you talked to, what broke, what you learned…"
          className="w-full resize-y rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-300/50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder-zinc-600 dark:focus:border-zinc-500 dark:focus:ring-zinc-600/40"
        />
      </label>

      <div className="flex flex-col gap-2">
        <MicButton
          state={mic.state}
          elapsed={mic.elapsed}
          onToggle={mic.toggle}
          disabled={busy}
        />
        {micError && (
          <div
            role="alert"
            className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300"
          >
            {micError}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => setShowPrivate(!showPrivate)}
        className="w-fit text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300"
      >
        {showPrivate ? "Hide private notes" : "Add private notes (never published)"}
      </button>
      {showPrivate && (
        <textarea
          value={privateNotes}
          onChange={(event) => setPrivateNotes(event.target.value)}
          disabled={busy || mic.state !== "idle"}
          rows={3}
          aria-label="Private notes, never published"
          placeholder="Context for me only — headlines, feelings, confidential bits. Excluded from the public post."
          className="w-full resize-y rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-amber-500 focus:outline-none dark:border-amber-800 dark:bg-amber-950/40 dark:text-zinc-100 dark:placeholder-zinc-600"
        />
      )}

      <button
        type="submit"
        disabled={!canSend}
        className="w-fit rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {busy ? "Working…" : "Start the journal"}
      </button>
    </form>
  );
}
