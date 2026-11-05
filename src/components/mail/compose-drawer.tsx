"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Send, Sparkles, Type, X } from "lucide-react";

/**
 * Compose drawer (Phase 7d): new mail and reply. Nothing is sent until the
 * owner clicks Send — the route is the single write surface, scope-gated
 * server-side, and every send lands in the local sent log. v1 is plain text
 * only: no outgoing attachments (their upload flows come later).
 */
type ProviderPick = { id: "google" | "zoho"; label: string; accountEmail: string };

type ComposeSeed = {
  id: string;
  accountId: "google" | "zoho";
  accountEmail: string;
  threadId: string | null;
  from: { name?: string; email: string } | null;
  subject: string;
  bodyText?: string;
  bodyHtml?: string;
  date: string;
};

type ComposeDrawerProps = {
  open: boolean;
  onClose: () => void;
  providers: ProviderPick[];
  /** Set when replying; from/provider and subject/body get prefilled. */
  seed: ComposeSeed | null;
  onSent: () => void;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseCommaList(value: string): string[] {
  return value
    .split(/[,;]/)
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part && EMAIL.test(part));
}

function htmlToText(html: string): string {
  try {
    return new DOMParser().parseFromString(html, "text/html").body.textContent ?? "";
  } catch {
    return html.replace(/<[^>]*>/g, "");
  }
}

function quoteOf(seed: ComposeSeed): string {
  const text = seed.bodyText ?? htmlToText(seed.bodyHtml ?? "");
  const lines = text.split("\n").map((line) => (line ? `> ${line}` : ">")).join("\n");
  const from = seed.from?.name || seed.from?.email || "someone";
  return `On ${seed.date}, ${from} wrote:\n${lines}`;
}

export function ComposeDrawer({
  open,
  onClose,
  providers,
  seed,
  onSent,
}: ComposeDrawerProps) {
  const [providerId, setProviderId] = useState<"google" | "zoho">(
    seed ? seed.accountId : providers[0]?.id ?? "google",
  );
  const [toInput, setToInput] = useState("");
  const [ccInput, setCcInput] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const provider = useMemo(
    () => providers.find((p) => p.id === providerId),
    [providers, providerId],
  );

  // Reply prefill: subject threading + quoted original body; user edits after.
  useEffect(() => {
    if (!open || !seed) return;
    setProviderId(seed.accountId as "google" | "zoho");
    const alreadyRe = /^re:/i.test(seed.subject);
    setSubject(alreadyRe ? seed.subject : `Re: ${seed.subject}`);
    setBody(`${quoteOf(seed)}\n`);
    setError(null);
  }, [open, seed]);

  const to = useMemo(() => parseCommaList(toInput), [toInput]);
  const cc = useMemo(() => parseCommaList(ccInput), [ccInput]);
  const canSend = Boolean(to.length) && body.trim().length > 0 && !busy && !aiBusy;

  const draftAI = useCallback(async () => {
    if (!brief.trim()) {
      setError("Tell me what the email should say first (the brief box above).");
      return;
    }
    setError(null);
    setAiBusy(true);
    try {
      const quoted = seed
        ? seed.bodyText ?? htmlToText(seed.bodyHtml ?? "")
        : "";
      const res = await fetch("/api/mail/ai-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent: seed ? "reply" : "new",
          from: seed?.from?.email ?? null,
          subjectOfIncoming: seed?.subject ?? null,
          quotedText: quoted || undefined,
          brief,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.draft) {
        throw new Error(json?.error ?? "The AI draft could not be generated.");
      }
      setSubject((current) =>
        current.trim() ? current : json.draft.subject || subject,
      );
      setBody((current) => (current.trim() ? current : json.draft.body));
    } catch (error) {
      setError(error instanceof Error ? error.message : "AI draft failed.");
    } finally {
      setAiBusy(false);
    }
  }, [brief, seed, subject]);

  const sendMail = useCallback(async () => {
    if (!provider) {
      setError("Choose a sending account.");
      return;
    }
    if (!to.length) {
      setError("Add at least one To address.");
      return;
    }
    if (!body.trim()) {
      setError("Write something before sending.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/mail/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: provider.id,
          to: to.map((email) => ({ email })),
          cc: cc.map((email) => ({ email })),
          subject,
          bodyText: body,
          ...(seed
            ? { replyTo: { messageId: seed.id, threadId: seed.threadId } }
            : {}),
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(json?.error ?? "The message could not be sent.");
      }
      onSent();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Send failed.");
    } finally {
      setBusy(false);
    }
  }, [provider, to, cc, subject, body, seed, onSent]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-30">
      <div
        aria-hidden
        onClick={onClose}
        className="absolute inset-0 bg-zinc-950/20"
      />
      <section className="flex w-full max-w-2xl flex-col border-l border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
        <header className="flex items-center gap-3 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <h2 className="flex-1 text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {seed ? "Reply" : "New mail"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close compose"
            className="rounded-full p-1.5 text-zinc-500 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X className="size-4" aria-hidden />
          </button>
        </header>

        <div className="overflow-y-auto min-h-0 flex-1 p-5">
          {error && (
            <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
              {error}
            </div>
          )}

          <div className="mb-3 flex items-start gap-3 px-2">
            <div className="w-12 shrink-0 text-zinc-400 dark:text-zinc-500">From</div>
            <div className="min-w-0 flex-1">
              {providers.length > 1 ? (
                <select
                  value={providerId}
                  onChange={(event) => setProviderId(event.target.value as "google" | "zoho")}
                  disabled={!!seed}
                  className="w-full rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                >
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label} ({p.accountEmail})
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-sm text-zinc-600 dark:text-zinc-300">
                  {provider?.label} — {provider?.accountEmail}
                </span>
              )}
            </div>
          </div>

          <div className="mb-3 flex gap-2">
            <input
              type="text"
              value={toInput}
              onChange={(event) => setToInput(event.target.value)}
              placeholder="name@example.com, another@x.y"
              aria-label="To"
              className="flex-1 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 placeholder-zinc-400 outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:placeholder-zinc-500"
            />
            <input
              type="text"
              value={ccInput}
              onChange={(event) => setCcInput(event.target.value)}
              placeholder="Cc (optional)"
              aria-label="Cc"
              className="w-64 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 placeholder-zinc-400 outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:placeholder-zinc-500"
            />
          </div>

          <div className="mb-3">
            <input
              type="text"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              placeholder="Subject"
              aria-label="Subject"
              className="w-full rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
          </div>

          <div className="mb-2 flex items-baseline gap-2">
            <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              AI brief
            </label>
            <span className="ml-1 text-[10px] rounded bg-zinc-100 px-1.5 py-0.5 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
              optional
            </span>
          </div>
          <textarea
            value={brief}
            onChange={(event) => setBrief(event.target.value)}
            placeholder="What should the email say? e.g. “decline, suggest next week”"
            aria-label="AI brief"
            rows={3}
            className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:placeholder-zinc-500"
          />
          <div className="mb-3 flex gap-2">
            <button
              type="button"
              onClick={draftAI}
              disabled={aiBusy || !brief.trim()}
              aria-label="Draft with AI"
              className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors disabled:opacity-50 disabled:pointer-events-none hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              <Sparkles className="size-3.5" aria-hidden />
              Draft with AI
            </button>
            <span className="ml-auto flex items-center gap-1 text-xs text-zinc-400 dark:text-zinc-500">
              <Type className="size-3.5" aria-hidden />
              Professional, no emojis
            </span>
          </div>

          <div className="mb-2 flex items-baseline gap-2">
            <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Message</label>
          </div>
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Type your message (plain text)."
            aria-label="Message body"
            rows={10}
            className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />

          {providers.length === 0 && (
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
              No send-enabled account — connect one with sending permission
              first.
            </p>
          )}
        </div>

        <footer className="border-t border-zinc-200 px-5 py-3 flex items-center justify-between gap-3 dark:border-zinc-800">
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            {providers.length === 0 ? "Connect an account to send." : canSend ? "" : "Fix the fields above to send."}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={sendMail}
              disabled={!canSend || providers.length === 0}
              aria-label="Send message"
              className="inline-flex items-center gap-1.5 rounded-full bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition-colors disabled:opacity-50 disabled:pointer-events-none hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              {busy ? "Sending…" : <Send className="size-3.5" aria-hidden /> Send}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
