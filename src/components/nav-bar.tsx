"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Shared navigation. Built to grow: add entries here as new surfaces land
 * (assistant, stats, settings…). Blog/LinkedIn live together on Today's Tea;
 * voice journaling lives on Chat; portfolio blog comment review on Feedback.
 */
const LINKS = [
  { href: "/", label: "Today's Tea" },
  { href: "/chat", label: "Chat with Secptile" },
  { href: "/feedback", label: "Feedback" },
];

export function NavBar() {
  // null during SSR — both tabs render unhighlighted; the client fixes it up.
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-10 border-b border-zinc-200/70 bg-white/80 backdrop-blur dark:border-zinc-800/70 dark:bg-zinc-950/80">
      <nav
        aria-label="Main"
        className="mx-auto flex w-full max-w-6xl items-center gap-2 px-6 py-3"
      >
        <Link
          href="/"
          className="mr-4 flex items-center gap-2 text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50"
        >
          <span aria-hidden>🦎</span> Secptile
        </Link>
        {LINKS.map((link) => {
          const active = pathname === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                active
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              }`}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
