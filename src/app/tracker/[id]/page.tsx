"use client";

// Renders at request time — post ids live in the local SQLite DB, not known
// at build time.
export const dynamic = "force-dynamic";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  ChevronLeft,
  Eye,
  FileText,
  LayoutList,
  Share2,
} from "lucide-react";

type Post = {
  id: string;
  sessionId: string | null;
  title: string;
  body: string;
  linkedinText: string;
  tags: string[];
  photoId: string;
  linkedInUrn: string | null;
  linkedinPostedAt: string | null;
  views: number;
  createdAt: string;
};

export default function TrackerPost({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [post, setPost] = useState<Post | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const recordView = useCallback(() => {
    void fetch(`/api/posts/${id}/view`, { method: "POST" }).catch(() => {
      /* analytics must never break the view */
    });
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/posts/${id}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("post"))))
      .then((json: { post?: Post }) => {
        if (!cancelled && json.post) {
          setPost(json.post);
          recordView();
        }
      })
      .catch(() => setError("Could not load this post."))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, recordView]);

  if (loading) return <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>;
  if (error || !post) {
    return (
      <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
        {error ?? "Post not found."}
      </div>
    );
  }

  const postedToLinkedIn = post.linkedInUrn != null;
  const memberName = post.linkedInUrn?.replace("urn:li:person:", "");

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-6 py-10 font-sans">
      <div className="flex items-center gap-3">
        <Link href="/tracker" className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100">
          <ChevronLeft aria-hidden size={18} />
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {post.title || "(untitled)"}
        </h1>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
        {/* Cover photo, large like the blog card shows it. */}
        <div className="flex-1 max-w-lg">
          <div className="rounded-xl border border-zinc-200 overflow-hidden dark:border-zinc-800 shadow-sm">
            <Image
              src={`/api/photos/${post.photoId}`}
              alt="Cover photo"
              width={900}
              height={500}
              className="w-full h-auto object-cover"
              sizes="(max-width: 768px) 100vw, 720px"
            />
          </div>
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
            Cover photo served from Secptile storage.
          </p>
        </div>

        {/* Thread / analytics column. */}
        <div className="flex-1 space-y-4">
          <section className="rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
            <div className="flex items-center gap-2 mb-3">
              <Eye aria-hidden className="h-5 w-5 text-zinc-500" />
              <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Views
              </h2>
            </div>
            <div className="text-4xl font-mono font-bold text-zinc-900 dark:text-zinc-100">
              {post.views}
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Counted each time the cover photo or this thread is opened.
            </p>
          </section>

          <section className="rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
            <div className="flex items-center gap-2 mb-3">
              <LayoutList aria-hidden className="h-5 w-5 text-zinc-500" />
              <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Details
              </h2>
            </div>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-zinc-500 dark:text-zinc-400">Published</dt>
                <dd className="font-mono text-zinc-800 dark:text-zinc-200">
                  {post.createdAt.slice(0, 10)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-zinc-500 dark:text-zinc-400">Type</dt>
                <dd className={`font-medium text-zinc-800 dark:text-zinc-200 ${
                  postedToLinkedIn ? "text-sky-700 dark:text-sky-400" : ""
                }`}>
                  {postedToLinkedIn ? "Blog + LinkedIn" : "Blog only"}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-zinc-500 dark:text-zinc-400">Tags</dt>
                <dd className="flex flex-wrap gap-1">
                  {post.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded border border-zinc-200 px-2 py-0.5 text-xs text-zinc-600 dark:border-zinc-800 dark:text-zinc-400"
                    >
                      #{tag}
                    </span>
                  ))}
                  {post.tags.length === 0 && <span className="text-zinc-400">—</span>}
                </dd>
              </div>
              {postedToLinkedIn && (
                <div className="flex justify-between">
                  <dt className="text-zinc-500 dark:text-zinc-400">LinkedIn</dt>
                  <dd className="flex items-center gap-2">
                    <Share2 aria-hidden size={14} className="text-sky-600" />
                    <span className="font-mono text-xs text-zinc-800 dark:text-zinc-200 truncate" title={memberName ?? ""}>
                      {memberName ?? post.linkedInUrn}
                    </span>
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      • posted {post.linkedinPostedAt?.slice(0, 10) ?? "—"}
                    </span>
                  </dd>
                </div>
              )}
            </dl>
          </section>

          <section className="rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
            <div className="flex items-center gap-2 mb-3">
              <FileText aria-hidden className="h-5 w-5 text-zinc-500" />
              <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Storage
              </h2>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Cover photo is served from Secptile storage ({post.photoId}).
              Views here are counted by Secptile; the portfolio site tracks
              its own views separately.
            </p>
          </section>
        </div>
      </div>

      {/* Body thread. */}
      <section className="rounded-xl border border-zinc-200 p-6 dark:border-zinc-800">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-3">
          Body
        </h2>
        <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-800 dark:text-zinc-200">
          {post.body}
        </div>
        {post.linkedinText && post.linkedinText !== post.body && (
          <div className="mt-5 pt-5 border-t border-zinc-200 dark:border-zinc-800">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-2">
              LinkedIn text
            </h2>
            <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-800 dark:text-zinc-200">
              {post.linkedinText}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
