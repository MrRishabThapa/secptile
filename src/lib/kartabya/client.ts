/**
 * Connects the app to Kartabya's MCP server (OAuth + JSON-RPC over HTTP).
 * The app talks to it directly, with no model in between, so team messages
 * are never sent to one. Tokens are encrypted at rest, like the mail tokens.
 */
import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { decryptString, encryptString, mailEncryptionKeyValid } from "@/lib/mail/crypto";

const DEFAULT_URL = "https://skills.arcademia.app";
const SCOPE = "kartabya";
const PROTOCOL_VERSION = "2025-06-18";
const REQUEST_TIMEOUT = 20_000;
const REFRESH_MARGIN_MS = 60_000;

export class KartabyaError extends Error {
  /** The saved login no longer works, so the owner has to connect again. */
  readonly needsConnect: boolean;
  constructor(message: string, needsConnect = false) {
    super(message);
    this.name = "KartabyaError";
    this.needsConnect = needsConnect;
  }
}

function baseUrl(): string {
  return (process.env.KARTABYA_URL?.trim() || DEFAULT_URL).replace(/\/$/, "");
}

function mcpUrl(): string {
  return `${baseUrl()}/mcp`;
}

function storeFile(): string {
  return path.join(homedir(), ".secptile", "kartabya.json");
}

const storedSchema = z.object({
  clientId: z.string().optional(),
  redirectUri: z.string().optional(),
  accessTokenEnc: z.string().optional(),
  refreshTokenEnc: z.string().optional(),
  expiresAt: z.number().optional(),
});
type Stored = z.infer<typeof storedSchema>;

async function readStore(): Promise<Stored> {
  try {
    return storedSchema.parse(JSON.parse(await readFile(storeFile(), "utf8")));
  } catch {
    return {};
  }
}

async function writeStore(stored: Stored): Promise<void> {
  await mkdir(path.dirname(storeFile()), { recursive: true, mode: 0o700 });
  await writeFile(storeFile(), `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600 });
}

const metadataSchema = z.object({
  authorization_endpoint: z.string(),
  token_endpoint: z.string(),
  registration_endpoint: z.string(),
});

async function serverMetadata() {
  const response = await fetch(`${baseUrl()}/.well-known/oauth-authorization-server`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT),
  });
  if (!response.ok) throw new KartabyaError(`Kartabya sign-in details failed (${response.status}).`);
  return metadataSchema.parse(await response.json());
}

const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().optional(),
  expires_in: z.number().optional(),
});

async function saveTokens(stored: Stored, body: unknown): Promise<string> {
  const tokens = tokenSchema.parse(body);
  await writeStore({
    ...stored,
    accessTokenEnc: encryptString(tokens.access_token),
    refreshTokenEnc: tokens.refresh_token
      ? encryptString(tokens.refresh_token)
      : stored.refreshTokenEnc,
    expiresAt: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined,
  });
  return tokens.access_token;
}

/** Step 1: registers this app if needed, and returns where to send the browser. */
export async function startKartabyaLogin(redirectUri: string): Promise<{
  url: string;
  state: string;
  verifier: string;
}> {
  if (!mailEncryptionKeyValid()) {
    throw new KartabyaError("MAIL_ENCRYPTION_KEY is missing, so the login can't be stored safely.");
  }
  const metadata = await serverMetadata();
  const stored = await readStore();
  let clientId = stored.redirectUri === redirectUri ? stored.clientId : undefined;
  if (!clientId) {
    const response = await fetch(metadata.registration_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "Secptile",
        redirect_uris: [redirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        scope: SCOPE,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT),
    });
    if (!response.ok) throw new KartabyaError(`Kartabya registration failed (${response.status}).`);
    clientId = z.object({ client_id: z.string() }).parse(await response.json()).client_id;
    await writeStore({ ...stored, clientId, redirectUri });
  }

  const state = randomBytes(16).toString("hex");
  const verifier = randomBytes(32).toString("base64url");
  const url = new URL(metadata.authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: SCOPE,
    state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    resource: mcpUrl(),
  }).toString();
  return { url: url.toString(), state, verifier };
}

/** Step 2: trades the code from the callback for tokens. */
export async function finishKartabyaLogin(code: string, verifier: string): Promise<void> {
  const metadata = await serverMetadata();
  const stored = await readStore();
  if (!stored.clientId || !stored.redirectUri) throw new KartabyaError("Kartabya sign-in was not started.");
  const response = await fetch(metadata.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: stored.redirectUri,
      client_id: stored.clientId,
      code_verifier: verifier,
      resource: mcpUrl(),
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT),
  });
  if (!response.ok) throw new KartabyaError(`Kartabya sign-in failed (${response.status}).`);
  await saveTokens(stored, await response.json());
}

export async function kartabyaConnected(): Promise<boolean> {
  return Boolean((await readStore()).accessTokenEnc);
}

export async function disconnectKartabya(): Promise<void> {
  await rm(storeFile(), { force: true });
  session = null;
}

async function refreshedToken(stored: Stored): Promise<string> {
  if (!stored.refreshTokenEnc || !stored.clientId) {
    throw new KartabyaError("Kartabya login expired.", true);
  }
  const metadata = await serverMetadata();
  const response = await fetch(metadata.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: decryptString(stored.refreshTokenEnc),
      client_id: stored.clientId,
      resource: mcpUrl(),
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT),
  });
  if (!response.ok) throw new KartabyaError("Kartabya login expired.", true);
  return saveTokens(stored, await response.json());
}

async function accessToken(forceRefresh = false): Promise<string> {
  const stored = await readStore();
  if (!stored.accessTokenEnc) throw new KartabyaError("Kartabya isn't connected yet.", true);
  const expired = stored.expiresAt !== undefined && stored.expiresAt - REFRESH_MARGIN_MS < Date.now();
  if (forceRefresh || expired) return refreshedToken(stored);
  try {
    return decryptString(stored.accessTokenEnc);
  } catch {
    throw new KartabyaError("The saved Kartabya login can't be read.", true);
  }
}

/** Replies come as plain JSON or as server-sent events, depending on the server. */
async function readRpcResult(response: Response): Promise<unknown> {
  const raw = await response.text();
  const isStream = response.headers.get("content-type")?.includes("text/event-stream");
  const candidates = isStream
    ? raw.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim())
    : [raw];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const message = JSON.parse(candidate) as { result?: unknown; error?: { message?: string } };
    if (message.error) throw new KartabyaError(`Kartabya: ${message.error.message ?? "request failed"}`);
    if (message.result !== undefined) return message.result;
  }
  throw new KartabyaError("Kartabya returned an empty reply.");
}

let session: string | null = null;
let nextId = 1;

async function rpc(method: string, params: unknown, token: string, isNotification = false) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": PROTOCOL_VERSION,
  };
  if (session) headers["Mcp-Session-Id"] = session;
  return fetch(mcpUrl(), {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      ...(isNotification ? {} : { id: nextId++ }),
      method,
      params,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT),
  });
}

async function openSession(token: string): Promise<void> {
  session = null;
  const response = await rpc(
    "initialize",
    {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "secptile", version: "1.0" },
    },
    token,
  );
  if (response.status === 401) throw new KartabyaError("Kartabya login expired.", true);
  if (!response.ok) throw new KartabyaError(`Kartabya isn't responding (${response.status}).`);
  await readRpcResult(response);
  session = response.headers.get("mcp-session-id");
  await rpc("notifications/initialized", {}, token, true);
}

const toolResultSchema = z.object({
  isError: z.boolean().optional(),
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })).default([]),
});

/** Calls one Kartabya tool, and returns its reply parsed from JSON. */
export async function callKartabyaTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
  let token = await accessToken();
  if (!session) await openSession(token);

  let response = await rpc("tools/call", { name, arguments: args }, token);
  if (response.status === 401) {
    token = await accessToken(true);
    await openSession(token);
    response = await rpc("tools/call", { name, arguments: args }, token);
  } else if (response.status === 404 || response.status === 400) {
    await openSession(token); // the server dropped our session
    response = await rpc("tools/call", { name, arguments: args }, token);
  }
  if (!response.ok) throw new KartabyaError(`Kartabya request failed (${response.status}).`);

  const result = toolResultSchema.parse(await readRpcResult(response));
  const text = result.content.map((part) => part.text ?? "").join("");
  if (result.isError) throw new KartabyaError(text.slice(0, 200) || "Kartabya refused that request.");
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
