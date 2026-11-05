import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { phaseSchema, type Phase } from "./schema";

const MAX_BUFFER = 32 * 1024 * 1024; // 32 MB — streamed run events can be verbose

/** Integration-failure error with an owner-friendly message and HTTP status. */
export class OpenCodeError extends Error {
  readonly status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = "OpenCodeError";
    this.status = status;
  }
}

export type JournalInput = {
  /** OpenCode session from a previous turn; omitted on the first turn. */
  sessionId?: string;
  /** Full transcription of the day summary (first turn only). */
  transcript?: string;
  /** Private notes: remembered for context, never published in the draft. */
  privateNotes?: string;
  /** Answers to the previous questions, in the same order. */
  answers?: string[];
  /** Owner's correction/feedback to regenerate the draft with. */
  note?: string;
};

const PROMPT_RULES = [
  "You are Secptile's journaling assistant. The user dictates a summary of their day; you help turn it into a polished blog post.",
  "",
  "Loop rules:",
  "- Reply with ONLY one JSON object (no prose, no markdown fences):",
  '  {"status":"needs_info","questions":["…"]} or {"status":"ready","draft":{"title":"…","body":"…","tags":["…"],"linkedin":"…"}}',
  "- status 'needs_info': ask focused clarifying questions about what happened, why it mattered, the outcome, and the lesson. Keep questions short and concrete.",
  "- status 'ready': write the draft in Markdown. Roughly: what was done, what else happened, and lessons. First person, founder's voice, concise and human.",
  "",
  "'linkedin' rules — the exact text I will post to LinkedIn (plain text, NO markdown, no headings, no bullet ': ' formats):",
  "- Line 1 is ONE sentence that hooks on the single most interesting fact of the day: a huge number reached, a launch or milestone announcement, a bold claim/lesson, or a strong result. Lead with the number or the announcement, e.g. 'Shipped a voice agent that writes my blog for me in 3 minutes a day. 🚀'. Max ONE emoji, only where it is honestly earned.",
  "- After that hook line, insert 3-4 completely blank lines — the big vertical gap is deliberate, it grabs attention in the feed — then the main content: the day's story in short paragraphs of plain text. Never start the hook with 'Today'.",
  "- Total 'linkedin' text stays under 2,500 characters. Do NOT add hashtags — the app appends them once, joined with underscores (never hyphens). Do NOT repeat the whole blog body — compress.",
  "",
  "- Use ONLY facts the user stated. Never invent details or numbers. If something is uncertain, ask rather than guess.",
  "- Messages marked PRIVATE are context only: never mention, quote, or hint at them in the draft or questions.",
  "- Do not use any tools. Just reply with the JSON object.",
].join("\n");

/**
 * Each turn is one `opencode run --format json` invocation.
 * - New loop: run creates the session and reports its ID in the output stream.
 * - Follow-ups: run with `--session <id>` continues the same conversation.
 */
function buildRunArgs(input: JournalInput): string[] {
  const args = ["run", "--format", "json"];

  const model = process.env.OPENCODE_MODEL?.trim();
  if (model) args.push("--model", model);

  const serverUrl = process.env.OPENCODE_SERVER_URL?.trim();
  if (serverUrl) args.push("--server", serverUrl);

  if (input.sessionId) args.push("--session", input.sessionId);

  const sections: string[] = [PROMPT_RULES];

  if (input.transcript) {
    sections.push("Here is what I said about my day (transcribed, raw):", input.transcript);
  }
  if (input.privateNotes?.trim()) {
    sections.push("PRIVATE (context only, never publish):", input.privateNotes.trim());
  }
  const answers = input.answers ?? [];
  if (answers.length) {
    sections.push(
      "Answers to your questions:",
      answers.map((answer, i) => `${i + 1}. ${answer}`).join("\n"),
      "Continue: ask remaining questions, or produce the draft if the story is complete.",
    );
  }
  if (input.note?.trim()) {
    sections.push(
      "I reviewed the draft and want changes. Regenerate the draft in light of this note from me (private direction):",
      input.note.trim(),
      "If the note leaves gaps you need filled to write the story, ask; otherwise produce the final draft now.",
    );
  }

  args.push(sections.join("\n\n"));
  return args;
}

type RunEvent = { type?: string; sessionID?: string; part?: { type?: string; text?: string } };

/** Progress events surfaced to a streaming caller while the run executes. */
export type RunProgress =
  | { type: "started" }
  | { type: "session"; sessionId: string };

function parseRunOutput(stream: string): RunEvent[] {
  const events: RunEvent[] = [];
  for (const line of stream.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      events.push(JSON.parse(trimmed) as RunEvent);
    } catch {
      // Not a JSON event line; ignore.
    }
  }
  return events;
}

/** Pull the JSON contract object out of the model's text (tolerates fences/prose). */
export function extractJson(text: string): unknown {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

async function workspace(): Promise<string> {
  const dir =
    process.env.OPENCODE_WORKSPACE_DIR?.trim() ||
    path.join(homedir(), ".secptile", "workspace");
  await mkdir(dir, { recursive: true });
  return dir;
}

function timeoutMs(): number {
  const raw = Number(process.env.OPENCODE_TIMEOUT_MS);
  if (Number.isFinite(raw) && raw >= 1_000 && raw <= 900_000) return raw;
  return 300_000;
}

/**
 * Run a binary, gathering UTF-8 output. stdin is "ignore" — essential:
 * `opencode run` waits for stdin EOF, and execFile/spawn's default pipe
 * would keep it open and hang the run forever.
 */
function runBin(
  bin: string,
  args: string[],
  cwd: string,
  timeout: number,
  onLine?: (line: string) => void,
): Promise<{ stdout: string; stderr: string; code: number | null; timedOut: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    // Incremental line-splitter: forwards complete lines to onLine while
    // keeping full buffers for the final parse (same accumulation as before).
    function wire(which: "stdout" | "stderr") {
      let offset = 0;
      return (chunk: string) => {
        // Full-buffer accumulation first (final parse keeps old semantics).
        if (which === "stdout") stdout += chunk;
        else stderr += chunk;
        if (!onLine) return;
        const text = which === "stdout" ? stdout : stderr;
        let index: number;
        while ((index = text.indexOf("\n", offset)) !== -1) {
          onLine(text.slice(offset, index));
          offset = index + 1;
        }
      };
    }
    const onStdout = wire("stdout");
    const onStderr = wire("stderr");

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeout);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (stdout.length + chunk.length <= MAX_BUFFER) onStdout(chunk);
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length + chunk.length <= MAX_BUFFER) onStderr(chunk);
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code, timedOut });
    });
  });
}

export async function runJournalPhase(
  input: JournalInput,
  onProgress?: (event: RunProgress) => void,
): Promise<{ sessionId: string; phase: Phase }> {
  const bin = process.env.OPENCODE_BIN?.trim() || "opencode";
  const cwd = await workspace();
  const args = buildRunArgs(input);
  onProgress?.({ type: "started" });

  let announcedSession = false;
  const output = await runBin(
    bin,
    args,
    cwd,
    timeoutMs(),
    (line) => {
      if (announcedSession) return;
      const trimmed = line.trim();
      if (!trimmed.startsWith("{")) return;
      try {
        const event = JSON.parse(trimmed) as RunEvent;
        if (typeof event.sessionID === "string" && event.sessionID) {
          announcedSession = true;
          onProgress?.({ type: "session", sessionId: event.sessionID });
        }
      } catch {
        /* not JSON — ignore line */
      }
    },
  ).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    throw new OpenCodeError(`Could not start '${bin}': ${message}`);
  });

  if (output.timedOut) {
    throw new OpenCodeError(
      `OpenCode took longer than ${timeoutMs() / 1000}s to respond. Try again or raise OPENCODE_TIMEOUT_MS.`,
      504,
    );
  }
  const stdout = output.stdout;
  const stderr = output.stderr;

  if (!stdout.trim()) {
    throw new OpenCodeError("OpenCode returned no response.", 502);
  }

  const events = parseRunOutput(stdout + (stderr ? `\n${stderr}` : ""));
  const textParts = events.filter(
    (event) => event.type === "text" && typeof event.part?.text === "string",
  );
  const lastText = textParts.at(-1)?.part?.text;
  const sessionId =
    textParts.at(-1)?.sessionID ??
    events.findLast((event) => typeof event.sessionID === "string")?.sessionID;

  if (!lastText || !sessionId) {
    throw new OpenCodeError("OpenCode returned no response text.");
  }

  const structured = extractJson(lastText);
  if (structured == null) {
    throw new OpenCodeError("Model did not return the expected JSON contract.");
  }

  // Strict gate: if the JSON is not the agreed contract, fail loudly.
  const parsed = phaseSchema.safeParse(structured);
  if (!parsed.success) {
    throw new OpenCodeError(
      `Model response did not match the Secptile contract: ${parsed.error.issues[0]?.message}`,
    );
  }

  return { sessionId, phase: parsed.data };
}

/**
 * Generic one-shot run for other surfaces (Phase 7d: mail drafting). Same
 * CLI plumbing as the journal loop, no journal-specific prompt or schema —
 * the caller owns the contract entirely. Returns the model's final text and
 * the session id (so a follow-up turn can pass --session later). Timeout is
 * capped lower here by default: a mail draft should never take 5 minutes.
 */
export async function runOpenCodeText(
  prompt: string,
  options: { sessionId?: string; timeoutMs?: number } = {},
): Promise<{ sessionId: string; text: string }> {
  const bin = process.env.OPENCODE_BIN?.trim() || "opencode";
  const cwd = await workspace();
  const args = ["run", "--format", "json"];

  const model = process.env.OPENCODE_MODEL?.trim();
  if (model) args.push("--model", model);
  const serverUrl = process.env.OPENCODE_SERVER_URL?.trim();
  if (serverUrl) args.push("--server", serverUrl);
  if (options.sessionId) args.push("--session", options.sessionId);
  args.push(prompt);

  const output = await runBin(bin, args, cwd, options.timeoutMs ?? 120_000).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    throw new OpenCodeError(`Could not start '${bin}': ${message}`);
  });

  if (output.timedOut) {
    throw new OpenCodeError(
      `OpenCode took longer than ${(options.timeoutMs ?? 120_000) / 1000}s to draft. Try again.`,
      504,
    );
  }
  if (!output.stdout.trim() && !output.stderr.trim()) {
    throw new OpenCodeError("OpenCode returned no response.", 502);
  }

  const events = parseRunOutput(output.stdout + (output.stderr ? `\n${output.stderr}` : ""));
  const textParts = events.filter(
    (event) => event.type === "text" && typeof event.part?.text === "string",
  );
  const text = textParts.at(-1)?.part?.text ?? "";
  const sessionId =
    textParts.at(-1)?.sessionID ??
    events.findLast((event) => typeof event.sessionID === "string")?.sessionID;

  if (!text.trim()) {
    throw new OpenCodeError("OpenCode returned no response text.");
  }
  return { sessionId: sessionId ?? "", text };
}
