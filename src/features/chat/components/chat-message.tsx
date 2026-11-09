import Link from "next/link";
import { ArrowRight, AudioLines, CircleAlert, Lock, Mic } from "lucide-react";

export type ChatMessageData = {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** Numbered list shown after the text (clarifying questions). */
  questions?: string[];
  /** Plain rows shown after the text (emails, posts). Shown, not spoken. */
  items?: string[];
  /** A link shown after the text. */
  href?: string;
  hrefLabel?: string;
  /** assistant: how the bubble reads. user: unused. */
  tone?: "error" | "ready";
  /** user: this turn was spoken, not typed. */
  spoken?: boolean;
  /** user: private notes went along with this turn (their text is never shown). */
  hasPrivateNotes?: boolean;
};

export function AssistantAvatar({ size = "sm" }: { size?: "sm" | "md" }) {
  const box = size === "md" ? "h-9 w-9" : "h-7 w-7";
  const icon = size === "md" ? "h-[18px] w-[18px]" : "h-3.5 w-3.5";
  return (
    <span
      aria-hidden
      className={`${box} flex shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white shadow-sm shadow-indigo-600/30`}
    >
      <AudioLines className={icon} />
    </span>
  );
}

function UserBubble({ message }: { message: ChatMessageData }) {
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-indigo-600 px-4 py-2.5 text-sm leading-relaxed text-white shadow-sm shadow-indigo-600/20 sm:max-w-[75%]">
        <span className="sr-only">You said: </span>
        {message.text}
      </div>
      {(message.spoken || message.hasPrivateNotes) && (
        <p className="flex items-center gap-2.5 pr-1 text-[11px] text-zinc-500 dark:text-zinc-400">
          {message.spoken && (
            <span className="flex items-center gap-1">
              <Mic aria-hidden className="h-3 w-3" />
              Spoken
            </span>
          )}
          {message.hasPrivateNotes && (
            <span className="flex items-center gap-1">
              <Lock aria-hidden className="h-3 w-3" />
              Private notes attached
            </span>
          )}
        </p>
      )}
    </div>
  );
}

function AssistantBubble({ message }: { message: ChatMessageData }) {
  const isError = message.tone === "error";
  return (
    <div className="flex items-start gap-2.5">
      <AssistantAvatar />
      <div
        className={`max-w-[85%] break-words rounded-2xl rounded-tl-md px-4 py-2.5 text-sm leading-relaxed sm:max-w-[75%] ${
          isError
            ? "bg-red-50 text-red-800 ring-1 ring-inset ring-red-200 dark:bg-red-950/50 dark:text-red-200 dark:ring-red-900"
            : "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100"
        }`}
      >
        <span className="sr-only">Secptile said: </span>
        <p className="whitespace-pre-wrap">
          {isError && <CircleAlert aria-hidden className="mr-1.5 inline h-4 w-4 -translate-y-px" />}
          {message.text}
        </p>
        {message.questions && (
          <ol className="mt-2 flex list-decimal flex-col gap-1.5 pl-5 marker:text-zinc-400">
            {message.questions.map((question, index) => (
              <li key={index}>{question}</li>
            ))}
          </ol>
        )}
        {message.items && (
          <ul className="mt-2 flex flex-col gap-1 border-l-2 border-zinc-300 pl-3 text-xs text-zinc-600 dark:border-zinc-600 dark:text-zinc-300">
            {message.items.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        )}
        {(message.tone === "ready" || message.href) && (
          <Link
            href={message.href ?? "/tea"}
            className="mt-2 inline-flex items-center gap-1 font-medium text-indigo-700 underline-offset-2 hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300"
          >
            {message.hrefLabel ?? "Open Today's Tea"}
            <ArrowRight aria-hidden className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>
    </div>
  );
}

export function ChatMessage({ message }: { message: ChatMessageData }) {
  return message.role === "user" ? (
    <UserBubble message={message} />
  ) : (
    <AssistantBubble message={message} />
  );
}

/** Shown while OpenCode works, with its latest progress line. */
export function ThinkingBubble({ progress }: { progress: string | null }) {
  return (
    <div role="status" className="flex items-start gap-2.5">
      <AssistantAvatar />
      <div className="flex items-center gap-2.5 rounded-2xl rounded-tl-md bg-zinc-100 px-4 py-3 dark:bg-zinc-800">
        <span aria-hidden className="flex items-center gap-1">
          {[0, 150, 300].map((delay) => (
            <span
              key={delay}
              style={{ animationDelay: `${delay}ms` }}
              className="h-1.5 w-1.5 rounded-full bg-zinc-400 motion-safe:animate-bounce dark:bg-zinc-500"
            />
          ))}
        </span>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">{progress ?? "Thinking…"}</span>
      </div>
    </div>
  );
}
