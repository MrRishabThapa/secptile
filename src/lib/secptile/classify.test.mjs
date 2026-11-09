// Run with: pnpm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyTurn, isConfirmation } from "./classify.ts";

const idle = (text) => classifyTurn(text, "idle");
const inBlog = (text) => classifyTurn(text, "session");

test("mail questions check the mail", () => {
  for (const text of [
    "Is there any new mail?",
    "Check my email.",
    "Do I have unread emails",
    "Any new mail from Zoho?",
    "What's in my inbox?",
  ]) {
    assert.deepEqual(idle(text), { type: "check_mail" }, text);
  }
});

test("each section answers its own questions", () => {
  assert.equal(idle("How many posts did I publish?").type, "posts");
  assert.equal(idle("What's my latest blog?").type, "posts");
  assert.equal(idle("Any pending comments?").type, "feedback");
  assert.equal(idle("Are there any updates?").type, "updates");
  assert.equal(idle("How's the battery").type, "system");
  assert.equal(idle("What time is it?").type, "time");
  assert.equal(idle("Is my LinkedIn connected?").type, "linkedin");
  assert.equal(idle("Show my past days").type, "history");
});

test("sections open by name", () => {
  const cases = {
    "Open mail": "mail",
    "Go to the tracker.": "tracker",
    "Take me to Today's Tea": "tea",
    "Open the clock": "clock",
    "Open feedback": "feedback",
    "Switch to updates": "updates",
  };
  for (const [text, section] of Object.entries(cases)) {
    assert.deepEqual(idle(text), { type: "open", section }, text);
  }
});

test("timers read digits and words", () => {
  assert.deepEqual(idle("Set a timer for 5 minutes"), { type: "timer", minutes: 5 });
  assert.deepEqual(idle("Start a ten minute timer"), { type: "timer", minutes: 10 });
  assert.deepEqual(idle("Set a timer for one hour"), { type: "timer", minutes: 60 });
});

test("a blog starts only when asked for", () => {
  assert.deepEqual(idle("I want to write a blog"), { type: "start_blog" });
  assert.deepEqual(idle("Let's write a blog about my day"), { type: "start_blog" });
  assert.deepEqual(idle("I want to tell you about my day"), { type: "start_blog" });
  assert.deepEqual(idle("Make a LinkedIn post"), { type: "start_blog" });
  assert.equal(idle("Today I fixed a bug and it felt great."), null);
  assert.equal(idle("How are you?"), null);
});

test("a long blog request keeps the story", () => {
  const text = "Write a blog about my day, I shipped the local voice and talked with two early users about the editor after lunch";
  assert.deepEqual(idle(text), { type: "start_blog", transcript: text });
});

test("sending, publishing and deciding never run from here", () => {
  for (const [text, section] of [
    ["Send an email to Sam", "mail"],
    ["Reply to that mail", "mail"],
    ["Publish the blog", "tea"],
    ["Post it on LinkedIn", "tea"],
    ["Approve the comment", "feedback"],
    ["Delete that post", "tracker"],
    ["Install the updates", "updates"],
  ]) {
    const action = idle(text);
    assert.equal(action.type, "needs_click", text);
    assert.equal(action.section, section, text);
  }
});

test("a blog in progress keeps your story", () => {
  for (const text of [
    "I replied to a mail from an investor and it went really well for us",
    "We checked the inbox together, then we looked at the latest posts and all the comments from users",
    "It shipped.",
    "Yes",
  ]) {
    assert.deepEqual(inBlog(text), { type: "journal" }, text);
  }
});

test("Kartabya questions go to Kartabya", () => {
  assert.deepEqual(idle("Any new messages?"), { type: "kartabya_messages" });
  assert.deepEqual(idle("Check my messages in Founders"), { type: "kartabya_messages", channel: "founders" });
  assert.deepEqual(idle("What's new in Kartabya?"), { type: "kartabya_messages" });
  assert.equal(idle("Did anyone mention me?").type, "kartabya_mentions");
  assert.equal(idle("What are my tasks?").type, "kartabya_tasks");
  assert.equal(idle("Show my stats").type, "kartabya_stats");
  assert.equal(idle("Check Team Claude").type, "kartabya_team_inbox");
});

test("a send keeps your exact words", () => {
  const cases = [
    ["Send a message to Founders saying the demo is ready.", "Founders", "the demo is ready"],
    ["Tell founders that I'll be late", "founders", "I'll be late"],
    ["Post in Learning: Great Job Today!", "Learning", "Great Job Today"],
    ["Message the learning channel, see you at 5", "learning", "see you at 5"],
  ];
  for (const [spoken, channel, text] of cases) {
    assert.deepEqual(idle(spoken), { type: "kartabya_send", channel, text }, spoken);
  }
});

test("mail stays mail", () => {
  assert.equal(idle("Send an email to Sam").type, "needs_click");
  assert.equal(idle("Any new mail?").type, "check_mail");
});

test("only a clear yes confirms a send", () => {
  for (const yes of ["Yes", "yes.", "Yes, send it.", "Send it", "Go ahead"]) {
    assert.equal(isConfirmation(yes), true, yes);
  }
  for (const no of ["No", "Cancel", "Yes but change it", "Yes I think so maybe", "Say yes", "", "Okay"]) {
    assert.equal(isConfirmation(no), false, no);
  }
});

test("a blog in progress keeps long stories about messages", () => {
  const text = "I sent a message to the founders about the launch and they all loved the new plan today";
  assert.deepEqual(inBlog(text), { type: "journal" });
});

test("short commands still work during a blog", () => {
  assert.equal(inBlog("Check my mail").type, "check_mail");
  assert.equal(inBlog("Open the tracker").type, "open");
  assert.equal(inBlog("Cancel the blog").type, "cancel_blog");
  assert.equal(classifyTurn("Never mind", "collecting").type, "cancel_blog");
});
