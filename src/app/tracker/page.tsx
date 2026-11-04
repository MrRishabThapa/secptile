"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Calendar,
  ChevronRight,
  Eye,
  FileText,
  Filter,
  Image,
  LayoutList,
  Search,
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
      </div>

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
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-zinc-500 dark:text-zinc-400">
                    No posts match your filters.
                  </td>
                </tr>
              )}
              {visible.map((post) => (
                <tr
                  key={post.id}
                  className="border-b border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900/30 group cursor-pointer"
                  onClick={() => window.location.assign(`/tracker/${post.id}`)}
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
                    <div className="font-medium text-zinc-900 dark:text-zinc-100 group-hover:text-zinc-500 dark:group-hover:text-zinc-400">
                      {post.title || "(untitled)"}
                    </div>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
