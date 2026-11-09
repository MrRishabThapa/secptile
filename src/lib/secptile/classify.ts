/**
 * Decides what a turn is asking for, using plain rules, so common requests
 * answer instantly and never need a model. No imports: this runs anywhere.
 *
 * While a blog is in progress, the day's story can mention anything ("I replied
 * to a mail from an investor"), so only short, direct commands leave the blog.
 */

export type Section = "chat" | "tea" | "clock" | "tracker" | "mail" | "feedback" | "updates" | "about";

export const SECTION_PATHS: Record<Section, string> = {
  chat: "/",
  tea: "/tea",
  clock: "/clock",
  tracker: "/tracker",
  mail: "/mail",
  feedback: "/feedback",
  updates: "/updates",
  about: "/about",
};

export const SECTION_LABELS: Record<Section, string> = {
  chat: "Chat",
  tea: "Today's Tea",
  clock: "Clock",
  tracker: "Tracker",
  mail: "Mail",
  feedback: "Feedback",
  updates: "Updates",
  about: "About",
};

export type TurnMode = "idle" | "collecting" | "session";

export type Action =
  | { type: "check_mail" }
  | { type: "posts" }
  | { type: "feedback" }
  | { type: "history" }
  | { type: "linkedin" }
  | { type: "updates" }
  | { type: "system" }
  | { type: "time" }
  | { type: "timer"; minutes: number }
  | { type: "open"; section: Section }
  | { type: "needs_click"; section: Section; message: string }
  | { type: "kartabya_messages"; channel?: string }
  | { type: "kartabya_mentions" }
  | { type: "kartabya_tasks" }
  | { type: "kartabya_stats" }
  | { type: "kartabya_team_inbox" }
  | { type: "kartabya_send"; channel: string; text: string }
  | { type: "start_blog"; transcript?: string }
  | { type: "cancel_blog" }
  | { type: "journal" };

const MAX_COMMAND_WORDS_IN_BLOG = 8;
/** A blog request this long already contains the story. */
const STORY_WORDS = 20;
const ASKING = /\b(any|new|unread|check|got|have|latest|recent|read|anything|what|whats|how many|show|list|is there|are there|pending|tell me)\b/;
const OPEN_VERB = /^(?:please |can you |could you )?(?:open|go to|take me to|switch to|bring up|navigate to)\b(.*)$/;

const SECTION_WORDS: [RegExp, Section][] = [
  [/\b(today'?s tea|todays tea|tea|editor)\b/, "tea"],
  [/\b(e ?mails?|mails?|inbox|gmail|zoho)\b/, "mail"],
  [/\b(tracker|posts?|blogs?)\b/, "tracker"],
  [/\b(feedback|comments?)\b/, "feedback"],
  [/\b(updates?|packages?)\b/, "updates"],
  [/\b(clock|timer|stopwatch)\b/, "clock"],
  [/\b(about|machine|stats)\b/, "about"],
  [/\bchat\b/, "chat"],
];

const NUMBER_WORDS: Record<string, number> = {
  one: 1, a: 1, an: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
};

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseTimer(text: string): number | null {
  if (!/\b(timer|countdown)\b/.test(text)) return null;
  const match = text.match(/\b(\d+|[a-z]+)[ -]?(minutes?|mins?|hours?|hrs?)\b/);
  if (!match) return null;
  const amount = /^\d+$/.test(match[1]) ? Number(match[1]) : NUMBER_WORDS[match[1]];
  if (!amount) return null;
  return match[2].startsWith("h") ? amount * 60 : amount;
}

/** "send a message to founders saying hello", "tell founders that ...", "post in learning: ...". */
const SEND_PATTERNS = [
  /^(?:please |can you |could you )?(?:send|post|write)(?: a| an| this)?(?: message| note)? (?:to|in|on) (?:the |my |#)?([a-z0-9_-]+)(?: channel)?(?: saying| that says| that|:|,)? (.+)$/i,
  /^(?:please |can you |could you )?(?:tell|message) (?:the |my |#)?([a-z0-9_-]+)(?: channel)?(?: that|:|,)? (.+)$/i,
];
/** Words after "tell" or "message" that mean a person or other app, not a channel. */
const NOT_A_CHANNEL = /^(me|him|her|them|us|you|it|gmail|zoho|linkedin|blog|journal|mail|email)$/i;

function matchSend(raw: string): Action | null {
  const clean = raw.trim().replace(/[.!?]+$/, "");
  for (const pattern of SEND_PATTERNS) {
    const match = clean.match(pattern);
    if (match && !NOT_A_CHANNEL.test(match[1])) {
      return { type: "kartabya_send", channel: match[1], text: match[2].trim() };
    }
  }
  return null;
}

/** Your Kartabya team: channels, mentions, tasks and stats. */
function matchKartabya(text: string): Action | null {
  if (/\bteam claude\b/.test(text)) return { type: "kartabya_team_inbox" };
  if (/\bmention(s|ed)?\b/.test(text)) return { type: "kartabya_mentions" };
  if (/\b(stats|statistics|my progress)\b/.test(text)) return { type: "kartabya_stats" };
  if (/\b(tasks?|to ?dos?)\b/.test(text) && ASKING.test(text)) return { type: "kartabya_tasks" };
  if (/\b(messages?|chats?|channels?|kartabya|skill academy)\b/.test(text) && ASKING.test(text)) {
    const channel = text.match(/\b(?:in|from|on) (?:the |my |#)?([a-z0-9_-]+)\b/)?.[1];
    return channel && !/^(kartabya|skill|chat|channels?)$/.test(channel)
      ? { type: "kartabya_messages", channel }
      : { type: "kartabya_messages" };
  }
  return null;
}

/** Direct requests for something in the app. */
function matchCommand(text: string): Action | null {
  // Anything that sends, publishes or decides waits for a click (hard rule 1).
  if (/\b(send|reply|respond|compose|forward)\b.*\b(e ?mails?|mails?)\b/.test(text)) {
    return {
      type: "needs_click",
      section: "mail",
      message: "I'll open Mail. Sending always needs your click there.",
    };
  }
  if (/\b(publish|post|share)\b.*\b(linkedin|blog|draft)\b/.test(text) && !/\b(write|draft a|create|make)\b/.test(text)) {
    return {
      type: "needs_click",
      section: "tea",
      message: "I'll open Today's Tea. Publishing always needs your click there.",
    };
  }
  if (/\b(approve|delete|remove|reject)\b.*\b(comments?|feedback)\b/.test(text)) {
    return {
      type: "needs_click",
      section: "feedback",
      message: "I'll open Feedback. Approving or deleting comments needs your click there.",
    };
  }
  if (/\b(delete|remove)\b.*\b(posts?|blogs?)\b/.test(text)) {
    return {
      type: "needs_click",
      section: "tracker",
      message: "I'll open the Tracker. Removing a post needs your click there.",
    };
  }
  if (/\b(install|run|apply)\b.*\bupdates?\b/.test(text)) {
    return {
      type: "needs_click",
      section: "updates",
      message: "I'll open Updates. I only read the list and don't install anything.",
    };
  }

  const minutes = parseTimer(text);
  if (minutes !== null) return { type: "timer", minutes };

  const open = text.match(OPEN_VERB);
  if (open) {
    const target = SECTION_WORDS.find(([words]) => words.test(open[1]));
    if (target) return { type: "open", section: target[1] };
  }

  if (/\b(what|whats|what's)\b.*\b(time|date|day is it)\b|\btime is it\b/.test(text)) return { type: "time" };
  if (/\b(e ?mails?|mails?|inbox|gmail|zoho)\b/.test(text) && ASKING.test(text)) return { type: "check_mail" };
  if (/\blinkedin\b.*\b(connected|connection|token|expire|expires|status)\b/.test(text)) return { type: "linkedin" };
  if (/\b(comments?|feedback)\b/.test(text) && ASKING.test(text)) return { type: "feedback" };
  if (/\b(past days|journal history|previous days)\b/.test(text)) return { type: "history" };
  const kartabya = matchKartabya(text);
  if (kartabya) return kartabya;
  if (/\b(updates?|packages?)\b/.test(text) && ASKING.test(text)) return { type: "updates" };
  if (/\b(battery|cpu|ram|memory usage|system status|system stats)\b|\bhow is my (laptop|machine|computer)\b/.test(text)) {
    return { type: "system" };
  }
  if (/\b(posts?|blogs?|views|tracker)\b/.test(text) && /\b(how many|latest|recent|last|show|list|what|which|views)\b/.test(text)) {
    return { type: "posts" };
  }
  return null;
}

/** The only way a blog starts: you asked for one. */
function matchBlogRequest(text: string): boolean {
  return (
    /\b(write|draft|create|make|start|do)\b.*\b(blog|journal|linkedin post|post)\b/.test(text) ||
    /\b(blog|journal)\b.*\b(about my day|today)\b/.test(text) ||
    /\b(tell you|talk|write) about my day\b/.test(text)
  );
}

const CONFIRM_YES = /^(yes|yeah|yep|yes please|yes send it|send it|send|confirm|go ahead)$/;

/** The reply to a read-back. Only a clear yes as the whole turn counts. */
export function isConfirmation(raw: string): boolean {
  return CONFIRM_YES.test(normalize(raw));
}

/** Returns null when the rules can't tell, so a model can have a look. */
export function classifyTurn(raw: string, mode: TurnMode): Action | null {
  const text = normalize(raw);
  const words = text ? text.split(" ").length : 0;

  if (mode !== "idle") {
    if (words <= MAX_COMMAND_WORDS_IN_BLOG) {
      if (/^(please )?(cancel|stop|forget|discard|never mind|nevermind)\b/.test(text)) {
        return { type: "cancel_blog" };
      }
      const command = matchSend(raw) ?? matchCommand(text);
      if (command) return command;
    }
    return { type: "journal" };
  }

  const send = matchSend(raw);
  if (send) return send;
  const command = matchCommand(text);
  if (command && !matchBlogRequest(text)) return command;
  if (matchBlogRequest(text)) {
    return words >= STORY_WORDS ? { type: "start_blog", transcript: raw.trim() } : { type: "start_blog" };
  }
  return command;
}
