/**
 * Mail token store (Phase 7) — server-only persistence for OAuth tokens.
 *
 * Where: outside the repo at `~/.secptile/mail.json` (override with
 * SECPTILE_MAIL_TOKEN_FILE), same local-first pattern as the blog DB and
 * linkedin.json. File mode 0600, directory 0700.
 *
 * What: one record per provider (google/zoho). The access and refresh
 * tokens are AES-256-GCM-encrypted before they ever touch disk
 * (`crypto.ts`, key: MAIL_ENCRYPTION_KEY); account email, expiry and scopes
 * are stored in the clear because the UI shows them and they are not
 * secrets.
 *
 * Who: `import "server-only"` makes any accidental client import a build
 * error. Decrypted tokens exist in memory only — never return records from
 * this module to the client, never log them.
 */
import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { decryptString, encryptString } from "./crypto";
import { MAIL_PROVIDERS, type MailProviderId } from "./types";

export { MAIL_PROVIDERS };
export type { MailProviderId };

/** Decrypted, in-memory view used by the provider adapters. Server-side only. */
export type MailTokenRecord = {
  provider: MailProviderId;
  /** Which mailbox this connection serves, e.g. you@gmail.com. */
  accountEmail: string;
  accessToken: string;
  refreshToken?: string;
  /** Unix ms when the access token expires. */
  expiresAt: number;
  /** Granted scopes as the provider reported them at connect time. */
  scope: string;
  connectedAt: string;
};

/** On-disk shape: secrets swapped for their envelopes. */
type StoredTokenRecord = Omit<MailTokenRecord, "accessToken" | "refreshToken"> & {
  accessTokenEnc: string;
  refreshTokenEnc?: string;
};

type MailStoreFile = {
  version: 1;
  accounts: Partial<Record<MailProviderId, StoredTokenRecord>>;
};

function isMailProviderId(value: unknown): value is MailProviderId {
  return (
    typeof value === "string" &&
    (MAIL_PROVIDERS as readonly string[]).includes(value)
  );
}

function storePath(): string {
  return (
    process.env.SECPTILE_MAIL_TOKEN_FILE?.trim() ||
    path.join(homedir(), ".secptile", "mail.json")
  );
}

async function readStore(): Promise<MailStoreFile> {
  try {
    const raw = await readFile(storePath(), "utf8");
    const parsed = JSON.parse(raw) as MailStoreFile;
    if (parsed?.version !== 1 || typeof parsed.accounts !== "object" || parsed.accounts === null) {
      throw new Error("unexpected shape");
    }
    return parsed;
  } catch (error) {
    if (error instanceof Error && error.message === "unexpected shape") {
      console.error("[mail/store] token file has an unexpected shape — treating as empty.");
    }
    return { version: 1, accounts: {} };
  }
}

async function writeStore(store: MailStoreFile): Promise<void> {
  const file = storePath();
  // 0700 so only the owner can even list into this directory.
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
}

function toStored(record: MailTokenRecord): StoredTokenRecord {
  const { accessToken, refreshToken, ...rest } = record;
  return {
    ...rest,
    accessTokenEnc: encryptString(accessToken),
    ...(refreshToken ? { refreshTokenEnc: encryptString(refreshToken) } : {}),
  };
}

/** Encrypt-and-save one provider record. Overwrites that provider's entry. */
export async function writeMailToken(record: MailTokenRecord): Promise<void> {
  if (!isMailProviderId(record.provider)) {
    throw new Error(`Unknown mail provider: ${String(record.provider)}`);
  }
  const store = await readStore();
  store.accounts[record.provider] = toStored(record);
  await writeStore(store);
}

/**
 * Read one provider's token record WITH the secrets decrypted. For server
 * use by the adapters only — never serialize the return value to the client.
 * Returns null when the provider is not connected (a missing store, a
 * corrupted file, or a record that fails decryption all read as "not
 * connected" — the UI offers Reconnect, no stack traces escape).
 */
export async function readMailToken(
  provider: MailProviderId,
): Promise<MailTokenRecord | null> {
  const store = await readStore();
  const stored = store.accounts[provider];
  if (!stored || !stored.accessTokenEnc) return null;
  try {
    const record: MailTokenRecord = {
      provider,
      accountEmail: stored.accountEmail,
      accessToken: decryptString(stored.accessTokenEnc),
      refreshToken: stored.refreshTokenEnc
        ? decryptString(stored.refreshTokenEnc)
        : undefined,
      expiresAt: stored.expiresAt,
      scope: stored.scope,
      connectedAt: stored.connectedAt,
    };
    if (!record.accountEmail || !record.accessToken) return null;
    return record;
  } catch (error) {
    console.error(
      `[mail/store] ${provider} tokens could not be decrypted:`,
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

/** Forget one provider's connection. True when a record was removed. */
export async function disconnectMailProvider(
  provider: MailProviderId,
): Promise<boolean> {
  const store = await readStore();
  const had = Boolean(store.accounts[provider]);
  delete store.accounts[provider];
  await writeStore(store);
  return had;
}

/** Cheap connected-check without decrypting anything (for status pills). */
export async function mailProviderConnected(
  provider: MailProviderId,
): Promise<boolean> {
  const store = await readStore();
  return Boolean(store.accounts[provider]?.accessTokenEnc);
}
