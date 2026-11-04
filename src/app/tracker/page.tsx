"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import {
  Eye,
  FileText,
  RefreshCw,
  Search,
  Share2,
  Trash2,
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

type Filter = "all" | "blog" | "linkedin";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "Everything" },
  { value: "blog", label: "Blog only" },
  { value: "linkedin", label: "Posted to LinkedIn" },
];

export default function TrackerPage() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const [removeId, setRemoveId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dedupeBusy, setDedupeBusy] = useState(false);
  const [dedupeResult, setDedupeResult] = useState<{
    deleted: number;
    kept: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/posts")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("posts"))))
      .then((json: { posts?: Post[] }) => {
        if (!cancelled && Array.isArray(json.posts)) setPosts(json.posts);
      })
      .catch(() => setPosts([]))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const visible = useMemo(() => {
    const q = search.toLowerCase();
    const from = dateFrom;
    const to = dateTo;
    return posts.filter((post) => {
      const day = post.createdAt.slice(0, 10);
      if (from && day < from) return false;
      if (to && day > to) return false;
      const haystack =
        `${post.title} ${post.body} ${post.tags.join(" ")}`.toLowerCase();
      if (q && !haystack.includes(q)) return false;
      const postedToLinkedIn = post.linkedInUrn != null;
      if (filter === "blog" && postedToLinkedIn) return false;
      if (filter === "linkedin" && !postedToLinkedIn) return false;
      return true;
    });
  }, [posts, dateFrom, dateTo, search, filter]);

  async function refresh() {
    setError(null);
    try {
      const response = await fetch("/api/posts");
      const json: unknown = await response.json();
      const postsData =
        typeof json === "object" && json !== null && "posts" in json
          ? (json as { posts?: unknown }).posts
          : undefined;
      if (Array.isArray(postsData)) setPosts(postsData);
    } catch {
      setPosts([]);
    }
  }

  async function remove(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const response = await fetch(`/api/posts/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error(`Delete failed (${response.status})`);
      setPosts((list) => list.filter((post) => post.id !== id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Delete failed.");
    } finally {
      setBusyId(null);
      setRemoveId(null);
    }
  }

  async function cleanupDuplicates() {
    setDedupeBusy(true);
    setError(null);
    setDedupeResult(null);
    try {
      const response = await fetch("/api/posts/cleanup-duplicates", {
        method: "POST",
      });
      const json: unknown = await response.json();
      if (!response.ok) {
        const message =
          typeof json === "object" && json !== null && "error" in json
            ? String((json as { error: unknown }).error)
            : `Cleanup failed (${response.status})`;
        throw new Error(message);
      }
      const result = json as { deleted: number; kept: number };
      setDedupeResult(result);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Cleanup failed.");
    } finally {
      setDedupeBusy(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-10 font-sans">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Tracker
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Every post published through Secptile — blog and LinkedIn — with
          views and filters.
        </p>
      </div>

      <div className="rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          <div className="relative">
            <Search aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
            <input
              type="text"
              placeholder="Search title, body, tags…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-zinc-300 bg-white pl-9 pr-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-300/50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder-zinc-600"
            />
          </div>
          <div className="flex gap-2">
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="rounded-lg border border-zinc-300 bg-white pl-3 pr-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-300/50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="rounded-lg border border-zinc-300 bg-white pl-3 pr-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-300/50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />
          </div>
          <div className="flex items-end">
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as Filter)}
              className="rounded-lg border border-zinc-300 bg-white pl-3 pr-8 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-300/50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 appearance-none"
            >
              {FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            disabled={dedupeBusy}
            onClick={() => void cleanupDuplicates()}
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {dedupeBusy ? "Cleaning up…" : "Clean up duplicates"}
          </button>
          <button
            type="button"
            onClick={() => void refresh()}
            className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            title="Refresh"
          >
            <RefreshCw aria-hidden size={16} />
          </button>
          {dedupeResult && (
            <span className="text-xs text-zinc-500 dark:text-zinc-400 ml-3">
              Removed {dedupeResult.deleted} duplicate{"s"}
              {dedupeResult.deleted !== 1 ? "s" : ""}; {dedupeResult.kept}
              post{"s"}
              {dedupeResult.kept !== 1 ? "s" : ""} remain.
            </span>
          )}
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300"
        >
          {error}
        </div>
      )}

      {loading && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>
      )}

      <div className="flex-1">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Posts ({visible.length})
          </h2>
        </div>
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/50">
                <th className="px-4 py-3 text-xs font-medium text-zinc-500 uppercase">Cover</th>
                <th className="px-4 py-3 text-xs font-medium text-zinc-500 uppercase">Title</th>
                <th className="px-4 py-3 text-xs font-medium text-zinc-500 uppercase">Date</th>
                <th className="px-4 py-3 text-xs font-medium text-zinc-500 uppercase">Type</th>
                <th className="px-4 py-3 text-xs font-medium text-zinc-500 uppercase text-right">Views</th>
                <th className="px-4 py-3 text-right">Remove</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-zinc-500 dark:text-zinc-400">
                    No posts match your filters.
                  </td>
                </tr>
              )}
              {visible.map((post) => (
                <tr
                  key={post.id}
                  className="border-b border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900/30 group"
                >
                  <td className="px-4 py-4">
                    <div className="relative h-12 w-12 rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-700">
                      <Image
                        src={`/api/photos/${post.photoId}`}
                        alt=""
                        fill
                        className="object-cover group-hover:opacity-90"
                        sizes="(max-width: 640px) 100vw, 48px"
                      />
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <button
                      type="button"
                      onClick={() => window.location.assign(`/tracker/${post.id}`)}
                      className="w-full text-left font-medium text-zinc-900 dark:text-zinc-100 hover:text-zinc-500 dark:hover:text-zinc-400"
                    >
                      {post.title || "(untitled)"}
                    </button>
                    <div className="mt-1 whitespace-pre-wrap text-xs text-zinc-500 dark:text-zinc-400 line-clamp-2">
                      {post.body}
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <span className="text-xs font-mono text-zinc-500 dark:text-zinc-400">
                      {post.createdAt.slice(0, 10)}
                    </span>
                  </td>
                  <td className="px-4 py-4">
                    {post.linkedInUrn ? (
                      <span className="inline-flex items-center gap-1 rounded-md bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800 dark:bg-sky-950 dark:text-sky-300">
                        <Share2 aria-hidden size={12} /> LinkedIn
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-md border border-zinc-200 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
                        <FileText aria-hidden size={12} /> Blog
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-4 text-right">
                    <span className="flex items-center justify-end gap-1 text-sm font-medium text-zinc-800 dark:text-zinc-200">
                      <Eye aria-hidden size={14} />
                      {post.views}
                    </span>
                  </td>
                  <td className="px-4 py-4">
                    <button
                      type="button"
                      aria-label={`Remove ${post.title}`}
                      title="Remove this post"
                      onClick={() => {
                        if (removeId === post.id) {
                          void remove(post.id);
                        } else {
                          setRemoveId(post.id);
                          window.setTimeout(
                            () => setRemoveId((armed) => (armed === post.id ? null : armed)),
                            6000,
                          );
                        }
                      }}
                      disabled={busyId === post.id}
                      className={`shrink-0 rounded-md p-1.5 transition-colors disabled:opacity-40 ${
                        removeId === post.id
                          ? "text-white bg-red-700 hover:bg-red-600"
                          : "text-zinc-400 hover:bg-zinc-100 hover:text-red-600 dark:hover:bg-zinc-800 dark:hover:text-red-400"
                      }`}
                    >
                      <Trash2 aria-hidden size={16} />
                    </button>
                    {removeId === post.id && (
                      <button
                        type="button"
                        onClick={() => void remove(post.id)}
                        disabled={busyId === post.id}
                        className="mt-1 rounded-lg bg-red-700 px-3 py-1 font-medium text-white transition-colors hover:bg-red-600 disabled:opacity-40"
                      >
                        {busyId === post.id ? "Removing…" : "Confirm remove"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
