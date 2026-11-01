export default function Home() {
  return (
    <main className="flex flex-1 items-center justify-center bg-zinc-50 px-6 font-sans dark:bg-black">
      <div className="flex flex-col items-start gap-3">
        <h1 className="text-4xl font-semibold tracking-tight text-black dark:text-zinc-50">
          Secptile
        </h1>
        <p className="text-neutral-600 dark:text-zinc-400">
          Speak your day. Get a blog post.
        </p>
        <p className="text-sm text-neutral-400 dark:text-zinc-600">
          Phase 0 scaffold &mdash; the journal loop arrives in Phase 1.
        </p>
      </div>
    </main>
  );
}
