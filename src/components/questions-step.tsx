"use client";

import { useState } from "react";

type Props = {
  questions: string[];
  busy: boolean;
  onSubmit: (answers: string[]) => void;
  onRestart: () => void;
};

export function QuestionsStep({ questions, busy, onSubmit, onRestart }: Props) {
  const [answers, setAnswers] = useState<string[]>(() =>
    questions.map(() => ""),
  );

  const allAnswered = answers.every((answer) => answer.trim().length > 0);
  const canSend = allAnswered && !busy;

  return (
    <form
      className="flex w-full flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(answers.map((answer) => answer.trim()));
      }}
    >
      <div className="flex flex-col gap-4">
        {questions.map((question, index) => (
          <label key={index} className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
              <span className="mr-1.5 text-zinc-400">{index + 1}.</span>
              {question}
            </span>
            <textarea
              value={answers[index]}
              onChange={(event) => {
                const next = [...answers];
                next[index] = event.target.value;
                setAnswers(next);
              }}
              disabled={busy}
              rows={2}
              placeholder="Your answer…"
              className="w-full resize-y rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-300/50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder-zinc-600"
            />
          </label>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={!canSend}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {busy ? "Working…" : "Send answers"}
        </button>
        <button
          type="button"
          onClick={onRestart}
          disabled={busy}
          className="text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300"
        >
          Start over
        </button>
      </div>
    </form>
  );
}
