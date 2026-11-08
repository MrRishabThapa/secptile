"use client";

import { useMemo } from "react";
import {
  Globe,
  Heart,
  MessageSquare,
  Repeat2,
  ThumbsUp,
  TrendingUp,
} from "lucide-react";
import {
  LINKEDIN_TEXT_LIMIT,
  stripTrailingHashtags,
  tagsToHashtags,
} from "@/lib/linkedin/linkedin-text";

type Props = {
  /** The exact LinkedIn text that will post (already plain, hook-first). */
  text: string;
  tags: string[];
  /** Cover photo, top of the card like the real feed shows it. */
  photoUrl: string | null;
};

export function LinkedInPreview({ text, tags, photoUrl }: Props) {
  const hashtags = useMemo(() => tagsToHashtags(tags), [tags]);
  // Legacy drafts may carry their own trailing tag line — strip it so the
  // app-owned hashtag block below renders exactly once.
  const display = useMemo(() => stripTrailingHashtags(text), [text]);
  const chars = display.length + (hashtags ? `\n${hashtags}`.length : 0);
  const overLimit = chars > LINKEDIN_TEXT_LIMIT;

  return (
    <section className="flex w-full flex-col gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        LinkedIn preview
      </h2>

      <article className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-[#1d1f1e]">
        <div className="p-4 pb-3">
          {/* header */}
          <div className="flex items-start gap-3">
            <span
              aria-hidden
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#0a66c2] to-[#004182] text-sm font-bold text-white"
            >
              RT
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Rishab Thapa
              </p>
              <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                Founder · just now · <Globe aria-hidden className="inline h-3 w-3 align-[-1px]" />
              </p>
            </div>
          </div>

          {/* hook + body */}
          <div className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-800 dark:text-zinc-200">
            {display}
            {hashtags && (
              <span className="text-[#0a66c2] dark:text-[#4b9ce8]">{`\n${hashtags}`}</span>
            )}
          </div>
        </div>

        {/* cover photo — sits between the text and the feed card body */}
        {photoUrl && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={photoUrl}
            alt="Cover photo preview"
            className="max-h-80 w-full border-y border-zinc-200 object-cover dark:border-zinc-800"
          />
        )}

        {/* engagement bar placeholders */}
        <div className="flex items-center gap-4 border-t border-zinc-200 px-4 py-2 text-xs text-zinc-400 dark:border-zinc-700 dark:text-zinc-600">
          <span className="flex items-center gap-1">
            <ThumbsUp aria-hidden size={13} />
            <TrendingUp aria-hidden size={13} />
            <Heart aria-hidden size={13} /> 0
          </span>
          <span className="flex items-center gap-1">
            <MessageSquare aria-hidden size={13} /> 0
          </span>
          <span className="flex items-center gap-1">
            <Repeat2 aria-hidden size={13} /> 0
          </span>
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
        This is the exact text and the exact photo that would go out.
      </p>
    </section>
  );
}
