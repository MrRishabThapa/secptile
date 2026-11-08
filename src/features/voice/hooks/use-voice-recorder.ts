"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type RecorderState = "idle" | "recording" | "transcribing";

type UseVoiceRecorderOptions = {
  onTranscript: (text: string) => void;
  onError: (message: string) => void;
};

/** Preferred audio types (Chromium/Firefox on Linux use webm/opus). */
const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const type of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return "";
}

/**
 * Mic capture + local STT round-trip.
 * Records with MediaRecorder, then POSTs the clip to /api/transcribe
 * (which proxies the local whisper.cpp server), and returns text.
 */
export function useVoiceRecorder({ onTranscript, onError }: UseVoiceRecorderOptions) {
  const [state, setState] = useState<RecorderState>("idle");
  const [elapsed, setElapsed] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);

  const cleanup = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setElapsed(0);
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const transcribe = useCallback(
    async (blob: Blob) => {
      setState("transcribing");
      try {
        const form = new FormData();
        form.append("file", blob, "clip.webm");
        const response = await fetch("/api/transcribe", { method: "POST", body: form });
        const json: unknown = await response.json();
        if (!response.ok || typeof json !== "object" || json === null || !("text" in json)) {
          const message =
            typeof json === "object" && json !== null && "error" in json
              ? String((json as { error: unknown }).error)
              : "Transcription failed.";
          throw new Error(message);
        }
        const text = (json as { text: unknown }).text;
        if (typeof text !== "string") throw new Error("Transcription returned no text.");
        onTranscript(text.trim());
      } catch (cause) {
        onError(cause instanceof Error ? cause.message : "Transcription failed.");
      } finally {
        setState("idle");
      }
    },
    [onTranscript, onError],
  );

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
        cleanup();
        void transcribe(blob);
      };
      recorderRef.current = recorder;
      recorder.start();
      setState("recording");
      const startedAt = Date.now();
      timerRef.current = window.setInterval(() => {
        setElapsed(Math.floor((Date.now() - startedAt) / 1000));
      }, 1000);
    } catch {
      onError("Could not access the microphone. Check browser permissions.");
      cleanup();
      setState("idle");
    }
  }, [cleanup, onError, transcribe]);

  const stop = useCallback(() => {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    } else {
      cleanup();
      setState("idle");
    }
  }, [cleanup]);

  const toggle = useCallback(() => {
    if (state === "recording") stop();
    else if (state === "idle") void start();
  }, [state, start, stop]);

  return { state, elapsed, toggle, stop };
}
