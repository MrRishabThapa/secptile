# Good first issue: remove the unused `MailListQuery` import

> When writing this up as the actual GitHub issue, copy the "Issue text" block
> below verbatim and label it `good first issue`.

## Issue text

**Title:** Remove the unused `MailListQuery` import in the Gmail adapter

**Body:**

`src/lib/mail/google.ts` imports a type it never uses, which shows up in every
`pnpm lint` run:

```
/home/rishab/Projects/secptile/src/lib/mail/google.ts
  38:3  warning  'MailListQuery' is defined but never used  @typescript-eslint/no-unused-vars
```

Line 38 of `src/lib/mail/google.ts`:

```ts
import type {
  MailAddress,
  MailListQuery,   // ← imported, never referenced anywhere else in the file
  MailMessageDetail,
  ...
} from "./types";
```

`MailListQuery` itself stays in `src/lib/mail/types.ts` — it may be used by
`zoho.ts` / `provider.ts`; only the dead import in `google.ts` should go.

### What to do (start to finish)

1. **Fork the repo** (top-right Fork button), then `git clone` your fork.
2. **Install and verify the warning exists first:**

   ```bash
   pnpm install
   pnpm lint 2>&1 | grep MailListQuery
   # → 38:3  warning  'MailListQuery' is defined but never used
   ```

3. **Create a branch** (the repo works on feature branches, never `main`):

   ```bash
   git checkout -b chore/remove-unused-mail-list-query
   ```

4. **Edit** `src/lib/mail/google.ts`, delete the `MailListQuery,` line (line 38),
   and save. That's the whole change — nothing else in the file changes.
5. **Confirm the warning is gone:**

   ```bash
   pnpm lint 2>&1 | grep -c MailListQuery || echo "clean"
   # → clean
   ```

   Note: `pnpm lint` still exits nonzero — other pre-existing lint errors exist
   elsewhere and are tracked separately. Your job is only that the
   `MailListQuery` warning is no longer in the output.
6. **Type-check as well** (the import is TypeScript-only, but belt and braces):

   ```bash
   pnpm build
   ```

7. **Commit.** This repo has one rule above almost everything: **exactly one
   changed file per commit**. You changed exactly one file, so:

   ```bash
   git add src/lib/mail/google.ts
   git diff --cached --name-only   # must list ONLY src/lib/mail/google.ts
   git commit -m "chore(lint): remove unused MailListQuery import in google adapter"
   ```

8. **Push and open a PR** against `main`, mentioning this issue in the title or
   body. CI must show a green `CI / Build & type-check` job.

### Definition of done

- `MailListQuery` no longer appears in `pnpm lint` output.
- `pnpm build` passes.
- One commit, one file, clear Conventional Commits message.
