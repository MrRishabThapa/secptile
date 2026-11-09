"use client";

import dynamic from "next/dynamic";

/**
 * The thread is restored from sessionStorage as the page first renders, which
 * the server can't do, so the view only ever renders in the browser.
 */
const ChatView = dynamic(
  () => import("@/features/chat/components/chat-view").then((module) => module.ChatView),
  { ssr: false },
);

export default function ChatPage() {
  return <ChatView />;
}
