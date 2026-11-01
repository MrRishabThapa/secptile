"use client";

import { useMemo } from "react";
import {
  LINKEDIN_TEXT_LIMIT,
  stripMarkdown,
  tagsToHashtags,
} from "@/lib/linkedin-text";

type Props = {
  body: string;
  tags: string[];
};

export function LinkedInPreview({ body, tags }: Props) {
  const text = useMemo(() => stripMarkdown(body), [body]);
  const hashtags = useMemo(() => tagsToHashtags(tags), [tags]);
  const chars = text.length + (hashtags ? ` ${hashtags}`.length : 0);
  const overLimit = chars > LINKEDIN_TEXT_LIMIT;

  return (
    <section className="flex w-full flex-col gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        LinkedIn preview
      </h2>

      <article className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-[#1d1f1e]">
        {/* header */}
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm bg-gradient-to-br from-[#0a66c2] to-[#004182] text-sm font-bold text-white"
          >
            RT
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-[#0a66c2] dark:text-[#4b9ce8]">
              Rishab Thapa
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Founder · just now · 🌐
            </p>
          </div>
        </div>

        {/* body */}
        <div className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-zinc-800 dark:text-zinc-200">
          {text}
          {hashtags && (
            <span className="text-[#0a66c2] dark:text-[#4b9ce8]"> {hashtags}</span>
          )}
        </div>

        {/* engagement bar placeholders */}
        <div className="mt-3 border-t border-zinc-200 pt-2 text-xs text-zinc-400 dark:border-zinc-700 dark:text-zinc-600">
          👍 📈 ❤️ 0 · 💬 0 · 🔁 0
        </div>
      </article>

      <p
        className={`text-xs tabular-nums ${
          overLimit ? "text-red-600 dark:text-red-400" : "text-zinc-400 dark:text-zinc-600"
        }`}
      >
        {chars.toLocaleString()} / {LINKEDIN_TEXT_LIMIT.toLocaleString()} characters
        {overLimit && " — over LinkedIn's limit, trim the post"}
      </p>
      <p className="text-xs text-zinc-400 dark:text-zinc-600">
        Approximation: markdown is flattened to plain text the way a LinkedIn post reads.
      </p>
    </section>
  );
}
