"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

/** The key AssistantBar stores the last delivered spoken turn under. */
const SEEN_KEY = "secptile:assistant:seen";
const POLL_MS = 1500;

/** Nothing here should be lost to a spoken turn. */
function pageIsBusy(pathname: string): boolean {
  if (pathname === "/tea") return true; // a draft may be unsaved
  if (pathname === "/clock" && window.location.search.includes("timer=")) return true; // running timer
  const element = document.activeElement;
  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    (element instanceof HTMLElement && element.isContentEditable)
  );
}

/**
 * Spoken turns are answered by the Chat page. After "open mail", this brings
 * you back to Chat when you say something else, unless you're in the middle of
 * something on the current page. There, the turn waits until you come back.
 */
export function VoiceReturn() {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (pathname === "/") return;
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch("/api/assistant/status", { cache: "no-store" });
        if (!response.ok) return;
        const { pending } = (await response.json()) as { pending: { id: string } | null };
        if (!pending || pageIsBusy(pathname)) return;
        if (window.localStorage.getItem(SEEN_KEY) !== pending.id) router.push("/");
      } catch {
        /* app offline or private mode: stay put */
      }
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [pathname, router]);

  return null;
}
