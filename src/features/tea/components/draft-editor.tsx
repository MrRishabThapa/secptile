"use client";

import { useState } from "react";
import type { Draft } from "@/lib/journal/schema";

export type EditedDraft = Draft;

type Props = {
  draft: Draft;
  approved: boolean;
  busy: boolean;
  onSave: (draft: EditedDraft) => void;
  onApprove: () => void;
  onWithdrawApproval: () => void;
  onRegenerate: (note: string) => void;
  /** Present only after an approval; publishing is the next explicit act. */
  onPublish?: () => void;
  publishBusy?: boolean;
  /** Cover photo of the day — mandatory before publishing. */
  photoId: string | null;
  onPhotoChange: (photoId: string | null) => void;
};

const inputClass =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-300/50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder-zinc-600";

export function DraftEditor({
  draft,
  approved,
  busy,
  onSave,
  onApprove,
  onWithdrawApproval,
  onRegenerate,
  onPublish,
  publishBusy = false,
  photoId,
  onPhotoChange,
}: Props) {
  const [title, setTitle] = useState(draft.title);
  const [body, setBody] = useState(draft.body);
  const [tagsText, setTagsText] = useState(draft.tags.join(", "));
  const [showNote, setShowNote] = useState(false);
  const [note, setNote] = useState("");
  const [publishArmed, setPublishArmed] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const dirty =
    title !== draft.title || body !== draft.body ||
    tagsText !== draft.tags.join(", ");

  const tags = tagsText
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

  const canSave = dirty && title.trim() && body.trim() && tags.length > 0 && !busy;
  const canRegenerate = note.trim().length > 0 && !busy;
  const canPublish = approved && Boolean(photoId) && !dirty && !busy && !publishBusy;

  async function pickPhoto(file: File | undefined) {
    if (!file) return;
    setPhotoBusy(true);
    setPhotoError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/photos", { method: "POST", body: form });
      const json: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          typeof json === "object" && json !== null && "error" in json
            ? String((json as { error: unknown }).error)
            : `Upload failed (${response.status})`;
        throw new Error(message);
      }
      const uploaded =
        typeof json === "object" && json !== null && "id" in json
          ? String((json as { id: unknown }).id)
          : null;
      if (!uploaded) throw new Error("Upload failed — no photo id.");
      onPhotoChange(uploaded);
    } catch (cause) {
      setPhotoError(cause instanceof Error ? cause.message : "Photo upload failed.");
    } finally {
      setPhotoBusy(false);
    }
  }

  return (
    <section className="flex w-full flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Draft editor
        </h2>
        {approved && (
          <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300">
            Approved — nothing published yet
          </span>
        )}
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Cover photo (required to publish)
        </span>
        {photoId ? (
          <div className="flex items-start gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/photos/${photoId}`}
              alt="Cover photo for today's post"
              className="h-24 w-40 rounded-lg border border-zinc-300 object-cover dark:border-zinc-700"
            />
            <button
              type="button"
              disabled={busy || photoBusy}
              onClick={() => onPhotoChange(null)}
              className="text-xs text-red-600 underline underline-offset-2 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
            >
              Remove
            </button>
          </div>
        ) : (
          <input
            type="file"
            accept="image/jpeg,image/png,image/gif"
            disabled={busy || photoBusy}
            onChange={(event) => void pickPhoto(event.target.files?.[0])}
            className="block w-full cursor-pointer rounded-lg border border-dashed border-zinc-400 bg-white px-3 py-2 text-sm text-zinc-600 file:mr-3 file:rounded-md file:border-0 file:bg-zinc-900 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white hover:file:bg-zinc-700 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-300 dark:file:bg-zinc-100 dark:file:text-zinc-900 dark:hover:file:bg-zinc-300"
          />
        )}
        {photoBusy && (
          <p role="status" className="text-xs text-zinc-500 dark:text-zinc-400">
            Uploading photo…
          </p>
        )}
        {photoError && (
          <p role="alert" className="text-xs text-red-600 dark:text-red-400">
            {photoError}
          </p>
        )}
        {!photoId && !photoBusy && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            JPEG, PNG, or GIF up to 8 MB. A cover photo tops every published post.
          </p>
        )}
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Title</span>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          disabled={busy}
          className={inputClass}
          placeholder="A title for the day's post"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Body (Markdown)
        </span>
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          disabled={busy}
          rows={14}
          className={`${inputClass} resize-y font-mono text-[13px] leading-relaxed`}
          placeholder="## What I did…"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Tags (comma separated)
        </span>
        <input
          value={tagsText}
          onChange={(event) => setTagsText(event.target.value)}
          disabled={busy}
          className={inputClass}
          placeholder="startup, ux, build-in-public"
        />
      </label>

      <div className="flex flex-wrap items-center gap-2">
        {approved ? (
          <button
            type="button"
            onClick={onWithdrawApproval}
            disabled={busy}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Withdraw approval
          </button>
        ) : (
          <button
            type="button"
            onClick={onApprove}
            disabled={busy || dirty}
            className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-emerald-600 dark:hover:bg-emerald-500"
            title={dirty ? "Save your edits first, then approve." : "Approve this draft"}
          >
            Approve
          </button>
        )}

        {approved && onPublish && (
          <button
            type="button"
            onClick={() => {
              if (publishArmed) {
                setPublishArmed(false);
                onPublish();
              } else {
                setPublishArmed(true);
                window.setTimeout(() => setPublishArmed(false), 6000);
              }
            }}
            disabled={!canPublish}
            title={
              !photoId
                ? "Attach a cover photo first — it is required to publish."
                : dirty
                  ? "Save your edits first."
                  : undefined
            }
            className={`rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              publishArmed
                ? "bg-red-700 hover:bg-red-600"
                : "bg-emerald-700 hover:bg-emerald-600 dark:bg-emerald-600 dark:hover:bg-emerald-500"
            }`}
          >
            {publishBusy ? "Publishing…" : publishArmed ? "Confirm — save to Today's Tea" : "Publish to Today's Tea"}
          </button>
        )}

        <button
          type="button"
          onClick={
            canSave
              ? () => onSave({ title: title.trim(), body: body.trim(), tags, linkedin: draft.linkedin })
              : undefined
          }
          disabled={!canSave}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {busy ? "Working…" : "Save edits"}
        </button>

        <button
          type="button"
          onClick={() => setShowNote(!showNote)}
          disabled={busy}
          className="text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300"
        >
          {showNote ? "Hide regeneration note" : "Regenerate with a note…"}
        </button>
      </div>

      {approved && !photoId && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Publishing needs a cover photo — attach one above.
        </p>
      )}

      {showNote && (
        <div className="flex flex-col gap-1.5">
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            disabled={busy}
            rows={3}
            placeholder="What should change? e.g. Lead with the launch, make the LinkedIn hook use the 10× number…"
            className={`${inputClass} resize-y`}
          />
          <div>
            <button
              type="button"
              onClick={canRegenerate ? () => onRegenerate(note.trim()) : undefined}
              disabled={!canRegenerate}
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              {busy ? "Regenerating…" : "Regenerate draft"}
            </button>
            <span className="ml-3 text-xs text-zinc-400 dark:text-zinc-600">
              The note stays private and replaces the current draft.
            </span>
          </div>
        </div>
      )}

      {dirty && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Unsaved edits — save before approving, or the original draft stays.
        </p>
      )}
    </section>
  );
}
