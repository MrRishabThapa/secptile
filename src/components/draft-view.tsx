"use client";

import Markdown from "react-markdown";
import type { Draft } from "@/lib/schema";

type Props = {
  draft: Draft;
  onRestart: () => void;
};

const markdownComponents = {
  h1: (props: React.ComponentProps<"h2">) => (
    <h2 className="mb-2 mt-5 text-lg font-semibold text-zinc-900 dark:text-zinc-50" {...props} />
  ),
  h2: (props: React.ComponentProps<"h3">) => (
    <h3 className="mb-1.5 mt-4 text-base font-semibold text-zinc-900 dark:text-zinc-50" {...props} />
  ),
  h3: (props: React.ComponentProps<"h4">) => (
    <h4 className="mb-1.5 mt-4 text-sm font-semibold text-zinc-900 dark:text-zinc-50" {...props} />
  ),
  p: (props: React.ComponentProps<"p">) => (
    <p className="my-2 leading-relaxed text-zinc-700 dark:text-zinc-300" {...props} />
  ),
  ul: (props: React.ComponentProps<"ul">) => (
    <ul className="my-2 list-disc space-y-1 pl-5 text-zinc-700 dark:text-zinc-300" {...props} />
  ),
  ol: (props: React.ComponentProps<"ol">) => (
    <ol className="my-2 list-decimal space-y-1 pl-5 text-zinc-700 dark:text-zinc-300" {...props} />
  ),
  strong: (props: React.ComponentProps<"strong">) => (
    <strong className="font-semibold text-zinc-900 dark:text-zinc-100" {...props} />
  ),
  blockquote: (props: React.ComponentProps<"blockquote">) => (
    <blockquote
      className="my-2 border-l-2 border-zinc-300 pl-3 italic text-zinc-600 dark:border-zinc-600 dark:text-zinc-400"
      {...props}
    />
  ),
};

export function DraftView({ draft, onRestart }: Props) {
  return (
    <section className="flex w-full flex-col gap-4">
      <article className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {draft.title}
        </h2>

        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {draft.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
            >
              {tag}
            </span>
          ))}
        </div>

        <hr className="my-4 border-zinc-200 dark:border-zinc-800" />

        <Markdown components={markdownComponents}>{draft.body}</Markdown>
      </article>

      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Draft only — nothing is published. Edit &amp; approve flow arrives in Phase 3.
      </p>

      <button
        type="button"
        onClick={onRestart}
        className="w-fit rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        Start over
      </button>
    </section>
  );
}
