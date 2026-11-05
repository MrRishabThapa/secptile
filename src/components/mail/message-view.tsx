"use client";

import { useEffect, useMemo, useState } from "react";
import DOMPurify from "dompurify";
import { ExternalLink, FileDown, ImageOff, Images, Mail, X } from "lucide-react";

/**
 * Reading pane (Phase 7b). Renders a message or, for Gmail rows with a
 * threadId, the whole conversation. HTML bodies are sanitized with
 * DOMPurify and viewed inside a FULLY-sandboxed iframe (sandbox="" — no
 * scripts, no forms, no same-origin escape). Remote images are blocked
 * until the reader opts in: loading them would beacon the sender that the
 * mail was opened. All rendering is local; no mail content leaves the app.
 */

type Address = { name?: string; email: string };

type Attachment = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
};

type Detail = {
  id: string;
  accountId: "google" | "zoho";
  accountEmail: string;
  from: Address | null;
  to: Address[];
  cc: Address[];
  subject: string;
  date: string;
  bodyHtml?: string;
  bodyText?: string;
  attachments: Attachment[];
};

export function MessageView({
  provider,
  id,
  threadId,
  onClose,
  /** 7d: reply gate — visible only when this provider's token grants sending. */
  canSend = false,
  /** 7d: opened a compose drawer prefilled from the newest message in view. */
  onReply,
}: {
  provider: "google" | "zoho";
  id: string;
  threadId: string | null;
  onClose: () => void;
  canSend?: boolean;
  onReply?: (detail: Detail) => void;
}) {
  const [subject, setSubject] = useState("");
  const [messages, setMessages] = useState<Detail[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const [showImages, setShowImages] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setMessages(null);
    setError(null);
    setNeedsReconnect(false);
    setSubject("");

    const query = (route: string, useParams: string) =>
      `/api/mail/${route}?${useParams}`;

    // Thread view when the provider offers one (Gmail); otherwise the row IS
    // the whole message (Zoho rows never carry threadId).
    const url =
      provider === "google" && threadId
        ? query("thread", new URLSearchParams({ provider, id: threadId }).toString())
        : query("message", new URLSearchParams({ provider, id }).toString());

    void fetch(url)
      .then((res) => res.json())
      .then((json: {
        thread?: { subject: string; messages: Detail[] };
        message?: Detail;
        error?: string;
        needsReconnect?: boolean;
      }) => {
        if (cancelled) return;
        if (json.error) {
          setError(json.error);
          setNeedsReconnect(Boolean(json.needsReconnect));
          return;
        }
        if (json.thread) {
          setSubject(json.thread.subject);
          setMessages(json.thread.messages ?? []);
        } else if (json.message) {
          setSubject(json.message.subject);
          setMessages([json.message]);
        }
      })
      .catch(() => {
        if (!cancelled) setError("Could not load the message.");
      });

    return () => {
      cancelled = true;
    };
  }, [provider, id, threadId]);

  return (
    <section
      aria-label="Message"
      className="fixed inset-y-0 right-0 z-20 flex w-full max-w-xl flex-col border-l border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
    >
      <header className="flex items-start gap-3 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
        <h2 className="min-w-0 flex-1 text-lg font-semibold leading-tight tracking-tight text-zinc-900 dark:text-zinc-50">
          {subject || (messages === null && !error ? "Loading…" : "(no subject)")}
        </h2>
        {canSend && onReply && messages && messages.length > 0 && (
          <button
            type="button"
            onClick={() => onReply(messages[messages.length - 1])}
            aria-label="Reply"
            className="shrink-0 rounded-full border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <Mail className="size-4 shrink-0" aria-hidden />
            Reply
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close message"
          className="rounded-full p-1.5 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        >
          <X className="size-4" aria-hidden />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error && (
          <div className="m-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
            {error}
            {needsReconnect && (
              <a href={`/api/mail/${provider}/login`} className="ml-2 underline underline-offset-2">
                Reconnect
              </a>
            )}
          </div>
        )}

        {messages && messages.length === 0 && !error && (
          <p className="m-5 text-sm text-zinc-500 dark:text-zinc-400">
            The conversation turned out empty.
          </p>
        )}

        {messages?.map((message) => (
          <MessageBlock key={message.id} message={message} showImages={showImages} />
        ))}
      </div>

      {messages && messages.some((m) => m.bodyHtml) && (
        <div className="flex items-center justify-between gap-2 border-t border-zinc-200 px-5 py-2 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          <span>Remote images {showImages ? "shown" : "hidden"}.</span>
          <button
            type="button"
            onClick={() => setShowImages((value) => !value)}
            className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 px-2.5 py-1 font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            {showImages ? (
              <>
                <ImageOff className="size-3.5" aria-hidden /> Hide images
              </>
            ) : (
              <>
                <Images className="size-3.5" aria-hidden /> Show images
              </>
            )}
          </button>
        </div>
      )}
    </section>
  );
}

function addressLine(addresses: Address[]): string {
  if (addresses.length === 0) return "—";
  return addresses
    .map((address) =>
      address.name ? `${address.name} <${address.email}>` : address.email,
    )
    .join(", ");
}

function formatFullDate(iso: string): string {
  const ms = Date.parse(iso);
  return Number.isNaN(ms)
    ? ""
    : new Intl.DateTimeFormat(undefined, {
        dateStyle: "full",
        timeStyle: "short",
      }).format(ms);
}

function formatBytes(size: number): string {
  if (!size) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1048576) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1048576).toFixed(1)} MB`;
}

function MessageBlock({
  message,
  showImages,
}: {
  message: Detail;
  showImages: boolean;
}) {
  const html = useMemo(() => {
    if (!message.bodyHtml) return null;
    return DOMPurify.sanitize(message.bodyHtml, {
      USE_PROFILES: { html: true },
      ...(showImages ? {} : { FORBID_TAGS: ["img"], FORBID_ATTR: ["srcset"] }),
    });
  }, [message.bodyHtml, showImages]);

  return (
    <article className="border-b border-zinc-100 px-5 py-4 last:border-b-0 dark:border-zinc-800/70">
      <dl className="mb-3 space-y-1 text-sm">
        <div className="flex gap-2">
          <dt className="w-12 shrink-0 text-zinc-400 dark:text-zinc-500">From</dt>
          <dd className="min-w-0 break-words font-medium text-zinc-800 dark:text-zinc-200">
            {addressLine(message.from ? [message.from] : [])}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-12 shrink-0 text-zinc-400 dark:text-zinc-500">To</dt>
          <dd className="min-w-0 break-words text-zinc-600 dark:text-zinc-300">
            {addressLine(message.to)}
          </dd>
        </div>
        {message.cc.length > 0 && (
          <div className="flex gap-2">
            <dt className="w-12 shrink-0 text-zinc-400 dark:text-zinc-500">Cc</dt>
            <dd className="min-w-0 break-words text-zinc-600 dark:text-zinc-300">
              {addressLine(message.cc)}
            </dd>
          </div>
        )}
        <div className="flex gap-2">
          <dt className="w-12 shrink-0 text-zinc-400 dark:text-zinc-500">Mailbox</dt>
          <dd className="min-w-0 break-words text-zinc-600 dark:text-zinc-300">
            {message.accountEmail}
          </dd>
        </div>
        {message.date && (
          <div className="flex gap-2">
            <dt className="w-12 shrink-0 text-zinc-400 dark:text-zinc-500">Date</dt>
            <dd className="min-w-0 text-zinc-600 dark:text-zinc-300">
              {formatFullDate(message.date)}
            </dd>
          </div>
        )}
      </dl>

      {message.attachments.length > 0 && (
        <ul className="mb-3 flex flex-wrap gap-2">
          {message.attachments.map((attachment) => {
            // Membership is the route's job; the URL carries the ids it needs.
            const params = new URLSearchParams({
              provider: message.accountId,
              messageId: message.id,
              attachmentId: attachment.id,
            });
            return (
              <li key={attachment.id}>
                <a
                  href={`/api/mail/attachment?${params.toString()}`}
                  download={attachment.filename}
                  className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  <FileDown className="size-3.5" aria-hidden />
                  {attachment.filename}
                  <span className="text-zinc-400">{formatBytes(attachment.size)}</span>
                  <ExternalLink className="sr-only" />
                </a>
              </li>
            );
          })}
        </ul>
      )}

      {html !== null ? (
        <iframe
          sandbox=""
          srcDoc={html}
          title={`Message body: ${message.subject}`}
          className="h-80 w-full rounded-xl border border-zinc-200 bg-white dark:border-zinc-800"
        />
      ) : message.bodyText ? (
        <pre className="whitespace-pre-wrap break-words font-sans text-sm text-zinc-700 dark:text-zinc-300">
          {message.bodyText}
        </pre>
      ) : (
        <p className="text-sm text-zinc-400 dark:text-zinc-500">No readable body.</p>
      )}
    </article>
  );
}
