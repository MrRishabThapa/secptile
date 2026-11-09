"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowUp, Loader2, Lock, Mic, Square } from "lucide-react";
import { useVoiceRecorder } from "@/features/voice/hooks/use-voice-recorder";

type Props = {
  value: string;
  onChange: (value: string) => void;
  /** A finished browser-mic recording. It goes in the box to edit, not straight out. */
  onVoiceText: (text: string) => void;
  onSubmit: (privateNotes: string | undefined) => void;
  busy: boolean;
  placeholder: string;
  /** Notes only make sense at the start of a day's journal. */
  allowPrivateNotes: boolean;
};

function formatElapsed(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function ChatComposer({
  value,
  onChange,
  onVoiceText,
  onSubmit,
  busy,
  placeholder,
  allowPrivateNotes,
}: Props) {
  const [privateNotes, setPrivateNotes] = useState("");
  const [notesOpen, setNotesOpen] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);

  const mic = useVoiceRecorder({
    onTranscript: onVoiceText,
    onError: setMicError,
  });

  const recording = mic.state === "recording";
  const transcribing = mic.state === "transcribing";
  const canSend = value.trim().length > 0 && !busy && mic.state === "idle";
  const showNotes = notesOpen && allowPrivateNotes;

  function submit() {
    if (!canSend) return;
    onSubmit(showNotes ? privateNotes.trim() || undefined : undefined);
    setPrivateNotes("");
    setNotesOpen(false);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    submit();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      {micError && (
        <p role="alert" className="px-1 text-xs text-red-700 dark:text-red-400">
          {micError}
        </p>
      )}

      {showNotes && (
        <textarea
          value={privateNotes}
          onChange={(event) => setPrivateNotes(event.target.value)}
          rows={2}
          aria-label="Private notes, never published"
          placeholder="Context for me only. Excluded from the public post."
          className="w-full resize-none rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-2 text-sm text-zinc-900 placeholder-zinc-500 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-300/50 dark:border-amber-800 dark:bg-amber-950/40 dark:text-zinc-100 dark:placeholder-zinc-500"
        />
      )}

      <div className="flex items-end gap-1 rounded-2xl border border-zinc-200 bg-white p-1.5 shadow-sm transition-colors focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-500/20 dark:border-zinc-700 dark:bg-zinc-900">
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          disabled={recording || transcribing}
          rows={1}
          aria-label="Your message to Secptile"
          placeholder={
            recording
              ? `Recording ${formatElapsed(mic.elapsed)}. Press stop when you're done.`
              : transcribing
                ? "Transcribing your voice…"
                : placeholder
          }
          className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2.5 py-1.5 text-sm leading-relaxed text-zinc-900 placeholder-zinc-500 [field-sizing:content] focus:outline-none disabled:cursor-not-allowed dark:text-zinc-100 dark:placeholder-zinc-400"
        />

        {allowPrivateNotes && (
          <button
            type="button"
            onClick={() => setNotesOpen(!notesOpen)}
            aria-pressed={notesOpen}
            aria-label={notesOpen ? "Hide private notes" : "Add private notes, never published"}
            title={notesOpen ? "Hide private notes" : "Add private notes (never published)"}
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
              notesOpen
                ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            }`}
          >
            <Lock aria-hidden className="h-4 w-4" />
          </button>
        )}

        <button
          type="button"
          onClick={() => {
            setMicError(null);
            mic.toggle();
          }}
          disabled={transcribing || (busy && !recording)}
          aria-pressed={recording}
          aria-label={recording ? "Stop recording" : transcribing ? "Transcribing" : "Talk instead of typing"}
          title={recording ? "Stop recording" : "Talk instead of typing"}
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-40 ${
            recording
              ? "bg-red-600 text-white hover:bg-red-500 motion-safe:animate-pulse"
              : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          }`}
        >
          {recording ? (
            <Square aria-hidden className="h-3.5 w-3.5 fill-current" />
          ) : transcribing ? (
            <Loader2 aria-hidden className="h-4 w-4 motion-safe:animate-spin" />
          ) : (
            <Mic aria-hidden className="h-4 w-4" />
          )}
        </button>

        <button
          type="submit"
          disabled={!canSend}
          aria-label="Send"
          title="Send (Enter). Shift+Enter adds a new line."
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white shadow-sm transition-colors hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-400 disabled:shadow-none dark:focus-visible:ring-offset-zinc-900 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-600"
        >
          <ArrowUp aria-hidden className="h-4 w-4" />
        </button>
      </div>
    </form>
  );
}
