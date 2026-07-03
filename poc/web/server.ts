import { spawn } from "bun-pty";
import { resolve as resolvePath, join as joinPath } from "node:path";
import { existsSync, mkdirSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PORT = Number(process.env.PORT ?? 5174);
const SPACE_ROOT = resolvePath(import.meta.dir, "../../../..");
// PoC 固定使用 ~/.wopal，不读 WOPAL_HOME / CHAT_WOPAL_HOME 环境变量。
// 避免开发机上的临时 PATH/WOPAL_HOME 配置干扰正确解析。
const POC_WOPAL_HOME = joinPath(homedir(), ".wopal");
const ELLAMAKA_URL = process.env.ELLAMAKA_URL ?? "http://localhost:4141";
const ELLAMAKA_DIRECTORY = process.env.ELLAMAKA_DIRECTORY ?? SPACE_ROOT;
const CHAT_AGENT = process.env.CHAT_AGENT ?? "wopal";
const CHAT_MODEL = process.env.CHAT_MODEL ?? "";
const CHAT_TITLE = process.env.CHAT_TITLE ?? "Web Chat PoC";
const CHAT_WELCOME = process.env.CHAT_WELCOME ?? "你好，请简单自我介绍一下。";

// ---------------------------------------------------------------------------
// Ellamaka path detection (binary lookup only — cwd is per-space at spawn)
// ---------------------------------------------------------------------------

const DEFAULT_DEV_CWD = resolvePath(import.meta.dir, "../../packages/opencode");

function detectEllamaka(): { cmd: string; args: string[] } {
  // PoC 优先使用 ~/.wopal/bin/ellamaka（写死的 WOPAL_HOME），不依赖 PATH。
  // 开发机 PATH 可能因临时测试指向其他 WOPAL_HOME 的 bin 目录。
  const hardcoded = joinPath(homedir(), ".wopal", "bin", "ellamaka");
  if (existsSync(hardcoded)) return { cmd: hardcoded, args: [] };

  // Fallback: 系统 PATH（仍可能受 WOPAL_HOME 干扰，但作为兜底）
  const fromPath = (() => {
    try { return (Bun as any).which?.("ellamaka") as string | undefined; } catch { return undefined; }
  })();
  if (fromPath) return { cmd: fromPath, args: [] };

  // Fallback: 其他常见安装位置
  const candidates = [
    "/usr/local/bin/ellamaka",
    "/opt/homebrew/bin/ellamaka",
  ];
  for (const c of candidates) {
    if (existsSync(c)) return { cmd: c, args: [] };
  }

  // Dev mode: run from source
  return { cmd: "bun", args: ["run", "--conditions=browser", "./src/index.ts"] };
}

const detected = detectEllamaka();
const CMD = process.env.ELLAMAKA_CMD ?? detected.cmd;
const ARGS = process.env.ELLAMAKA_ARGS !== undefined
  ? process.env.ELLAMAKA_ARGS.split(/\s+/).filter(Boolean)
  : (process.env.ELLAMAKA_CMD ? [] : detected.args);

function resolveCmd(cmd: string): string {
  if (cmd.startsWith("/")) return cmd;
  try {
    const found = (Bun as any).which?.(cmd);
    if (found) return found as string;
  } catch {}
  return cmd;
}

const RESOLVED_CMD = resolveCmd(CMD);

const encoder = new TextEncoder();

// ---------------------------------------------------------------------------
// Static files
// ---------------------------------------------------------------------------

const readFile = (name: string) => Bun.file(joinPath(import.meta.dir, "public", name)).text();
const [indexHtml, desktopHtml, tuiHtml, mHtml, workbenchHtml] = await Promise.all([
  readFile("index.html"),
  readFile("desktop.html"),
  readFile("tui.html"),
  readFile("m.html"),
  readFile("workbench.html"),
]);

function html(body: string) {
  return new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

// ---------------------------------------------------------------------------
// Spaces API — wraps `wopal space list`
// Tries `--json` first (future-proof); falls back to parsing the markdown
// table that current wopal versions print to stdout.
// ---------------------------------------------------------------------------

interface SpaceInfo { name: string; path: string }

// 写死 wopal 二进制路径，避免 PATH 中的 wopal 指向错误的 WOPAL_HOME。
const WOPAL_BIN = joinPath(POC_WOPAL_HOME, "bin", "wopal");

// Parse a markdown table row like "| wopal-workspace | /path/to/space |"
function parseSpaceRow(line: string): SpaceInfo | null {
  const parts = line.split("|").map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  // skip separator rows like |---|---|
  if (parts.every((p) => /^[-:]+$/.test(p))) return null;
  const name = parts[0];
  const path = parts[1];
  if (!name || !path || name.toLowerCase() === "name") return null;
  return { name, path };
}

function parseSpacesMarkdown(text: string): SpaceInfo[] {
  const spaces: SpaceInfo[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) continue;
    const info = parseSpaceRow(trimmed);
    if (info) spaces.push(info);
  }
  return spaces;
}

async function listSpaces(): Promise<{ spaces: SpaceInfo[]; current: string | null }> {
  // Try --json first; if the installed wopal doesn't support it, fall back to
  // parsing the human-readable markdown table. Either way we return the same
  // shape so callers don't care which path was taken.
  const env = { ...process.env, WOPAL_HOME: POC_WOPAL_HOME };
  const proc = Bun.spawn([WOPAL_BIN, "space", "list", "--json"], {
    cwd: SPACE_ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env,
  });
  const text = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;

  if (exitCode === 0) {
    try {
      const parsed = JSON.parse(text) as { success?: boolean; data?: { spaces?: SpaceInfo[] } };
      const spaces = parsed?.data?.spaces ?? [];
      const current = spaces.find((s) => s.path === SPACE_ROOT)?.name ?? null;
      return { spaces, current };
    } catch { /* not JSON, fall through to markdown parse */ }
  }

  // Fallback: re-run without --json and parse the markdown table.
  const proc2 = Bun.spawn([WOPAL_BIN, "space", "list"], {
    cwd: SPACE_ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env,
  });
  const md = await new Response(proc2.stdout).text();
  const exit2 = await proc2.exited;
  if (exit2 !== 0) throw new Error(`wopal space list failed (exit ${exit2}): ${md.slice(0, 200)}`);
  const spaces = parseSpacesMarkdown(md);
  const current = spaces.find((s) => s.path === SPACE_ROOT)?.name ?? null;
  return { spaces, current };
}

// ===========================================================================
// Part 1 — TUI Embed (desktop): pty-bridge 子进程 + xterm.js
// Multi-space support: one PTY per space, indexed by space name.
//
// 为什么用子进程：bun-pty 0.4.8 的 native read-loop（while + await setTimeout）
// 在 Bun.serve 进程里 onData 回调不触发——已通过最小复现确认（fetch handler、
// ReadableStream、Worker 均失效，仅独立 bun 进程正常）。根因是 bun-pty 的 ffi
// 轮询循环在 Bun.serve 的事件循环上下文里不被调度。解法：把 PTY 管理外包给
// 独立子进程 pty-bridge.ts，主 server 通过 stdin/stdout NDJSON 与之通信。
// ===========================================================================

interface PtySession {
  controllers: Set<ReadableStreamDefaultController<Uint8Array>>;
  space: string;
  cwd: string;
  // 暂存 PTY 启动后、首个客户端连上前的 output（解决创建早于 SSE 注册的时序竞态）。
  pendingOutput: string[];
  // 最近一次 resize 的尺寸，用于复用 PTY 时触发重绘。
  lastCols: number;
  lastRows: number;
}

const ptys = new Map<string, PtySession>();

function ptySend(c: ReadableStreamDefaultController<Uint8Array>, payload: unknown) {
  try { c.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)); } catch {}
}

function ptyBroadcast(session: PtySession, payload: unknown) {
  // 还没有客户端连接时，output 类消息先缓冲，等首个 controller 注册时 flush。
  if (session.controllers.size === 0) {
    if (typeof payload === "object" && payload !== null && (payload as { type?: string }).type === "output") {
      session.pendingOutput.push((payload as { data: string }).data);
      if (session.pendingOutput.length > 256) session.pendingOutput.shift();
    }
    return;
  }
  for (const c of session.controllers) ptySend(c, payload);
}

// ----- pty-bridge 子进程管理 -----
// 单一桥接进程管理所有空间的 PTY。主 server 通过 stdin 发命令、通过 stdout 收事件。

let bridgeProc: ReturnType<typeof Bun.spawn> | null = null;
let bridgeReady: Promise<void> | null = null;
let bridgeReadyResolve: (() => void) | null = null;
let bridgeLineBuf = "";

function bridgeSend(cmd: unknown) {
  if (!bridgeProc) return;
  try { bridgeProc.stdin.write(JSON.stringify(cmd) + "\n"); } catch {}
}

function startBridge() {
  if (bridgeProc) return;
  const bridgePath = joinPath(import.meta.dir, "pty-bridge.ts");
  // 通过 sh -c 启动，让 bridge 进程脱离 Bun.spawn 子进程的 ffi 事件循环束缚
  // （直接 Bun.spawn(["bun","run",...]) 时 bun-pty 的 onData 不触发，sh 启动则正常）
  bridgeProc = Bun.spawn(["sh", "-c", `exec bun run "${bridgePath}"`], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
    env: { ...process.env, WOPAL_HOME: POC_WOPAL_HOME },
  });
  bridgeReady = new Promise((r) => { bridgeReadyResolve = r; });

  // 读 bridge stdout NDJSON，分发事件到对应 session
  const reader = bridgeProc.stdout.getReader();
  const decoder = new TextDecoder();
  (async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bridgeLineBuf += decoder.decode(value, { stream: true });
      const lines = bridgeLineBuf.split("\n");
      bridgeLineBuf = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try { handleBridgeEvent(JSON.parse(trimmed)); } catch {}
      }
    }
  })();

  bridgeProc.exited.then((code) => {
    console.log(`[tui/bridge] exited code=${code}`);
    bridgeProc = null;
    // 清理所有 session
    for (const [space, session] of ptys) {
      ptyBroadcast(session, { type: "exited", exitCode: -1, signal: "bridge-down" });
      for (const c of session.controllers) { try { c.close(); } catch {} }
    }
    ptys.clear();
  });
}

function handleBridgeEvent(ev: { type?: string; space?: string; data?: string; exitCode?: number; signal?: string | null; pid?: number; message?: string }) {
  switch (ev.type) {
    case "ready":
      console.log(`[tui/bridge] ready`);
      if (bridgeReadyResolve) { bridgeReadyResolve(); bridgeReadyResolve = null; }
      break;
    case "spawned":
      console.log(`[tui/bridge] spawned space=${ev.space} pid=${ev.pid}`);
      break;
    case "output": {
      const session = ptys.get(ev.space ?? "");
      if (session) ptyBroadcast(session, { type: "output", data: ev.data ?? "" });
      break;
    }
    case "exited": {
      const session = ptys.get(ev.space ?? "");
      if (session) {
        ptyBroadcast(session, { type: "exited", exitCode: ev.exitCode ?? 0, signal: ev.signal ?? null });
        for (const c of session.controllers) { try { c.close(); } catch {} }
        session.controllers.clear();
        ptys.delete(ev.space ?? "");
      }
      break;
    }
    case "error":
      console.error(`[tui/bridge] error: ${ev.message ?? "unknown"}`);
      break;
  }
}

async function ensurePtyForSpace(space: string, cwd: string): Promise<PtySession> {
  const existing = ptys.get(space);
  if (existing) return existing;

  startBridge();
  if (bridgeReady) await bridgeReady;

  const session: PtySession = { controllers: new Set(), space, cwd, pendingOutput: [], lastCols: 100, lastRows: 30 };
  ptys.set(space, session);
  console.log(`[tui/pty] requesting spawn space=${space} cwd=${cwd}`);
  bridgeSend({ cmd: "spawn", space, cwd });
  return session;
}

async function resolveSpaceFromReq(req: Request): Promise<{ name: string; path: string } | { error: Response }> {
  const url = new URL(req.url);
  const name = url.searchParams.get("space") ?? "";
  if (!name) return { error: new Response("missing ?space query", { status: 400 }) };
  const { spaces } = await listSpaces();
  const found = spaces.find((s) => s.name === name);
  if (!found) return { error: new Response(`unknown space: ${name}`, { status: 400 }) };
  return found;
}

async function tuiStream(req: Request) {
  const resolved = await resolveSpaceFromReq(req);
  if (resolved instanceof Object && "error" in resolved) return resolved.error;
  const spaceInfo = resolved;
  const session = await ensurePtyForSpace(spaceInfo.name, spaceInfo.path);

  let mine: ReadableStreamDefaultController<Uint8Array> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      mine = controller;
      // 复用判定：若已有其他客户端连接，说明 PTY 早创建、banner 已输出过。
      const wasReused = session.controllers.size > 0;
      session.controllers.add(controller);
      ptySend(controller, { type: "connected", space: spaceInfo.name, cwd: spaceInfo.path });
      // flush 暂存的 output（PTY 创建早于首个客户端连接的时序竞态修复）
      if (session.pendingOutput.length > 0) {
        const buffered = session.pendingOutput.join("");
        session.pendingOutput.length = 0;
        ptySend(controller, { type: "output", data: buffered });
      }
      // 复用已有 PTY 时主动 resize 触发 ellamaka 重绘，让新客户端看到当前 TUI 界面
      if (wasReused) {
        bridgeSend({ cmd: "resize", space: spaceInfo.name, cols: session.lastCols, rows: session.lastRows });
      }
      console.log(`[tui/sse] client joined space=${spaceInfo.name} (total=${session.controllers.size})`);
    },
    cancel() {
      if (mine) session.controllers.delete(mine);
      console.log(`[tui/sse] client left space=${spaceInfo.name} (total=${session.controllers.size})`);
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

async function tuiInput(req: Request) {
  const url = new URL(req.url);
  const space = url.searchParams.get("space") ?? "";
  if (!ptys.has(space)) return new Response(`no active PTY for space: ${space}`, { status: 400 });
  const body = await req.json() as { data?: string };
  bridgeSend({ cmd: "input", space, data: body.data ?? "" });
  return new Response(null, { status: 204 });
}

async function tuiResize(req: Request) {
  const url = new URL(req.url);
  const space = url.searchParams.get("space") ?? "";
  const session = ptys.get(space);
  if (!session) return new Response(`no active PTY for space: ${space}`, { status: 400 });
  const body = await req.json() as { cols?: number; rows?: number };
  const cols = Math.max(1, Number(body.cols) | 0);
  const rows = Math.max(1, Number(body.rows) | 0);
  session.lastCols = cols;
  session.lastRows = rows;
  bridgeSend({ cmd: "resize", space, cols, rows });
  return new Response(null, { status: 204 });
}

async function tuiKill(req: Request) {
  const url = new URL(req.url);
  const space = url.searchParams.get("space") ?? "";
  if (!ptys.has(space)) return new Response(null, { status: 404 });
  // kill 命令触发 bridge 的 onExit 回调，由其完成 broadcast + Map 清理
  bridgeSend({ cmd: "kill", space });
  return new Response(null, { status: 202 });
}

// ===========================================================================
// Part 2 — Chat (mobile): EllamakaClient + ChatProjector
// ---------------------------------------------------------------------------
// Ensure a headless ellamaka server is running for chat mode.
// Reuses an existing one if reachable; otherwise spawns `ellamaka serve`
// from the WopalSpace root so space-local agents/config are available.
// ---------------------------------------------------------------------------

const CHAT_SERVE_PORT = (() => { try { return new URL(ELLAMAKA_URL).port || "4141"; } catch { return "4141"; } })();
const CHAT_SERVE_CWD = process.env.CHAT_SERVE_CWD ?? SPACE_ROOT;
let ellamakaServerProc: Bun.Subprocess | null = null;

async function isServerUp(): Promise<boolean> {
  try {
    // Use HEAD /session to verify the API is ready, not just HTTP server listening.
    // The root URL may respond before instance bootstrapping completes.
    const url = `${ELLAMAKA_URL}/session?directory=${encodeURIComponent(ELLAMAKA_DIRECTORY)}`;
    const res = await fetch(url, { method: "HEAD" });
    return res.ok || res.status === 405; // 405 = endpoint exists but HEAD not allowed — still means API is up
  } catch { return false; }
}

async function ensureEllamakaServer(): Promise<void> {
  if (await isServerUp()) {
    console.log(`[chat/server] reuse existing ellamaka serve at ${ELLAMAKA_URL}`);
    return;
  }
  mkdirSync(CHAT_SERVE_CWD, { recursive: true });
  console.log(`[chat/server] spawning ellamaka serve --port ${CHAT_SERVE_PORT} cwd=${CHAT_SERVE_CWD}`);
  ellamakaServerProc = Bun.spawn([RESOLVED_CMD, "serve", "--port", CHAT_SERVE_PORT, "--print-logs"], {
    cwd: CHAT_SERVE_CWD,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
    env: { ...process.env, WOPAL_HOME: POC_WOPAL_HOME, TERM: "xterm-256color" },
  });
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await isServerUp()) {
      console.log(`[chat/server] ellamaka serve ready`);
      return;
    }
  }
  throw new Error(`ellamaka serve did not become ready within 15s at ${ELLAMAKA_URL}`);
}

const chatServerReady = ensureEllamakaServer().catch((err) => {
  console.warn(`[chat/server] ${err.message} — chat mode unavailable, TUI mode still works`);
});

process.on("beforeExit", () => {
  if (ellamakaServerProc) { try { ellamakaServerProc.kill(); } catch {} }
});

// ===========================================================================
// Part 2 core — EllamakaClient + ChatProjector
// ===========================================================================

interface StreamEvent {
  sessionID: string;
  type?: string;
  messageID?: string;
  partID?: string;
  partType?: string;
  field?: string;
  tool?: string;
  toolStatus?: string;
  toolTitle?: string;
  delta?: string;
  text?: string;
  role?: string;
  synthetic?: boolean;
  ignored?: boolean;
  error?: unknown;
  [key: string]: unknown;
}

interface ModelRef { providerID: string; modelID: string }
interface ChatSettings { agent: string; model?: string }

const defaultChatSettings: ChatSettings = {
  agent: CHAT_AGENT,
  ...(CHAT_MODEL.trim() ? { model: CHAT_MODEL.trim() } : {}),
};

function parseModelRef(model?: string): ModelRef | undefined {
  const value = model?.trim();
  if (!value) return undefined;
  const [providerID, ...rest] = value.split("/");
  const modelID = rest.join("/");
  if (!providerID || !modelID) return undefined;
  return { providerID, modelID };
}

function normalizeSettings(input?: Partial<ChatSettings>): ChatSettings {
  return {
    agent: input?.agent?.trim() || defaultChatSettings.agent,
    ...((input?.model?.trim() || defaultChatSettings.model)
      ? { model: input?.model?.trim() || defaultChatSettings.model }
      : {}),
  };
}

function sameSettings(a: ChatSettings, b: ChatSettings) {
  return a.agent === b.agent && (a.model ?? "") === (b.model ?? "");
}

// EllamakaClient — minimal HTTP SDK for ellamaka server.
// Uses /global/event (not /event) because instance-level event route uses an
// isolated Bus whose events never reach this subscriber.
class EllamakaClient {
  constructor(
    private baseUrl: string = ELLAMAKA_URL,
    private directory: string = ELLAMAKA_DIRECTORY,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async createSession(title: string, settings: ChatSettings): Promise<string> {
    const url = `${this.baseUrl}/session?directory=${encodeURIComponent(this.directory)}`;
    const model = parseModelRef(settings.model);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, agent: settings.agent, ...(model ? { model } : {}) }),
    });
    if (!res.ok) throw new Error(`createSession failed: ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`.trim());
    const data = await res.json() as { id: string };
    console.log(`[chat/client] session created id=${data.id} agent=${settings.agent} model=${settings.model ?? "(default)"}`);
    return data.id;
  }

  async promptAsync(sessionId: string, parts: Array<{ type: "text"; text: string }>, settings: ChatSettings): Promise<void> {
    const url = `${this.baseUrl}/session/${sessionId}/prompt_async?directory=${encodeURIComponent(this.directory)}`;
    const model = parseModelRef(settings.model);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parts, agent: settings.agent, ...(model ? { model } : {}) }),
    });
    if (!res.ok && res.status !== 204) throw new Error(`promptAsync failed: ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`.trim());
  }

  async listAgents(): Promise<unknown[]> {
    const res = await fetch(`${this.baseUrl}/agent?directory=${encodeURIComponent(this.directory)}`);
    if (!res.ok) throw new Error(`listAgents failed: ${res.status}`);
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  }

  async listProviders(): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}/config/providers?directory=${encodeURIComponent(this.directory)}`);
    if (!res.ok) throw new Error(`listProviders failed: ${res.status}`);
    return res.json();
  }

  async *streamEvents(sessionId: string, signal?: AbortSignal): AsyncGenerator<StreamEvent> {
    const url = `${this.baseUrl}/global/event`;
    const partInfoById = new Map<string, Pick<StreamEvent, "partType" | "tool" | "toolStatus" | "synthetic" | "ignored">>();
    const res = await fetch(url, { headers: { Accept: "text/event-stream" }, signal });
    if (!res.ok || !res.body) throw new Error(`global/event connect failed: ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const wrapper = JSON.parse(line.slice(6));
          const event = wrapper.payload;
          if (!event) continue;
          if (event.type === "sync" || event.type === "server.heartbeat" || event.type === "server.connected") continue;
          const props = event.properties;
          if (!props || props.sessionID !== sessionId) continue;

          if (event.type === "message.part.removed" && props.partID) {
            partInfoById.delete(props.partID);
            continue;
          }

          const part = props.part as
            | { id?: string; messageID?: string; type?: string; text?: string; synthetic?: boolean; ignored?: boolean; tool?: string; state?: { status?: string } }
            | undefined;
          if (part?.id) {
            partInfoById.set(part.id, {
              partType: part.type,
              synthetic: part.synthetic,
              ignored: part.ignored,
              tool: part.tool,
              toolStatus: part.state?.status,
            });
          }
          const cached = props.partID ? partInfoById.get(props.partID) : undefined;
          const info = props.info as { id?: string; role?: string } | undefined;
          yield {
            sessionID: props.sessionID,
            type: event.type,
            messageID: props.messageID ?? part?.messageID ?? info?.id,
            partID: props.partID ?? part?.id,
            partType: part?.type ?? cached?.partType,
            field: props.field,
            tool: part?.tool ?? cached?.tool,
            toolStatus: part?.state?.status ?? cached?.toolStatus,
            delta: props.delta,
            text: props.text ?? part?.text,
            role: info?.role,
            synthetic: part?.synthetic ?? cached?.synthetic,
            ignored: part?.ignored ?? cached?.ignored,
            error: props.error,
          };
        } catch { /* skip malformed */ }
      }
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    const url = `${this.baseUrl}/session/${sessionId}?directory=${encodeURIComponent(this.directory)}`;
    try { await fetch(url, { method: "DELETE" }); } catch {}
  }
}

interface ProjectedMessage { id: string; role: "assistant" | "user"; text: string }
interface ChatSnapshot { messages: ProjectedMessage[]; status: string }

type NormalizedEvent =
  | { type: "snapshot"; messages: ProjectedMessage[]; status: string }
  | { type: "status"; status: string | null }
  | { type: "error"; message: string }
  | { type: "message_delta"; message_id: string; text: string }
  | { type: "user_echo"; message_id: string; text: string };

// ChatProjector — consumes raw ellamaka events and projects a normalized chat
// view: assistant text only (no reasoning, no tool details), with part
// reassembly and automatic reconnect.
class ChatProjector {
  private messages: ProjectedMessage[] = [];
  private status = "";
  private readonly partTexts = new Map<string, string>();
  private readonly partMessageMap = new Map<string, string>();
  private readonly messageRoles = new Map<string, string>();
  private readonly listeners = new Set<(e: NormalizedEvent) => void>();
  private abort: AbortController | null = null;
  private started = false;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private client: EllamakaClient,
    private sessionId: string,
  ) {}

  start() {
    if (this.started) return;
    this.started = true;
    this.runConsumer();
  }

  stop() {
    this.started = false;
    if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null; }
    if (this.abort) { this.abort.abort(); this.abort = null; }
    this.listeners.clear();
  }

  getSnapshot(): ChatSnapshot {
    return { messages: this.messages.map((m) => ({ ...m })), status: this.status };
  }

  addListener(fn: (e: NormalizedEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  addUserMessage(text: string, id?: string): void {
    const msgId = id ?? `user-${Date.now()}`;
    this.messages.push({ id: msgId, role: "user", text });
    this.emit({ type: "user_echo", message_id: msgId, text });
  }

  private emit(event: NormalizedEvent) {
    for (const fn of this.listeners) { try { fn(event); } catch {} }
  }

  private runConsumer() {
    if (!this.started) return;
    this.abort = new AbortController();
    (async () => {
      try {
        for await (const event of this.client.streamEvents(this.sessionId, this.abort.signal)) {
          this.processEvent(event);
        }
      } catch (err) {
        if (!this.started) return;
        console.warn("[chat/projector] consumer error, reconnecting in 3s", err);
      }
      if (this.started) {
        this.restartTimer = setTimeout(() => this.runConsumer(), 3000);
      }
    })();
  }

  private processEvent(event: StreamEvent): void {
    if (event.type === "session.error") {
      const message = this.errorMessage(event.error);
      this.status = message;
      this.emit({ type: "error", message });
      return;
    }

    // Status mapping (generic, not GESP-specific)
    const statusResult = this.mapStatus(event);
    if (statusResult !== undefined) {
      const newStatus = statusResult ?? "";
      if (newStatus !== this.status) {
        this.status = newStatus;
        this.emit({ type: "status", status: statusResult });
      }
    }

    // Track roles from message.updated
    if (event.type === "message.updated" && event.role && event.messageID) {
      this.messageRoles.set(event.messageID, event.role);
      return;
    }

    const partID = event.partID ?? "";
    const messageID = event.messageID ?? "";
    const messageRole = this.messageRoles.get(messageID);

    // Visibility filter: assistant text parts only
    const visible =
      event.type === "message.part.updated" &&
      event.partType === "text" &&
      !!event.text &&
      messageRole === "assistant" &&
      !event.synthetic &&
      !event.ignored;

    if (!visible || !partID || !messageID) return;

    this.partMessageMap.set(partID, messageID);
    this.partTexts.set(partID, event.text ?? "");
    this.ensureMessage(messageID);
    this.updateMessageText(messageID);

    const msg = this.messages.find((m) => m.id === messageID);
    this.emit({ type: "message_delta", message_id: messageID, text: msg?.text ?? "" });
  }

  private mapStatus(event: StreamEvent): string | null | undefined {
    if (event.partType === "reasoning") return undefined;
    if (event.partType === "step-start") return "AI 思考中...";
    if (event.partType === "step-finish") return null;
    if (event.partType !== "tool") return undefined;
    if (event.toolStatus === "completed" || event.toolStatus === "error") return null;
    if (event.toolStatus !== "pending" && event.toolStatus !== "running") return undefined;
    return "调用工具中...";
  }

  private errorMessage(error: unknown): string {
    if (!error || typeof error !== "object") return "ellamaka session error";
    const e = error as { message?: string; name?: string; data?: { message?: string } };
    return e.message ?? e.data?.message ?? e.name ?? JSON.stringify(error).slice(0, 240);
  }

  private ensureMessage(messageID: string): void {
    if (!this.messages.find((m) => m.id === messageID)) {
      this.messages.push({ id: messageID, role: "assistant", text: "" });
    }
  }

  private updateMessageText(messageID: string): void {
    const msg = this.messages.find((m) => m.id === messageID);
    if (!msg) return;
    const parts: string[] = [];
    for (const [pid, mid] of this.partMessageMap) {
      if (mid === messageID) {
        const txt = this.partTexts.get(pid);
        if (txt) parts.push(txt);
      }
    }
    msg.text = parts.join("");
  }
}

// Singleton chat state — PoC uses a single ellamaka session.
const chatClient = new EllamakaClient();
let chatSession: { id: string; projector: ChatProjector; settings: ChatSettings } | null = null;

async function getChatSession(): Promise<{ id: string; projector: ChatProjector; settings: ChatSettings }> {
  if (chatSession) return chatSession;
  await chatServerReady;
  const settings = normalizeSettings();
  const id = await chatClient.createSession(CHAT_TITLE, settings);
  const projector = new ChatProjector(chatClient, id);
  projector.start();
  chatSession = { id, projector, settings };
  console.log(`[chat] session ready id=${id} agent=${settings.agent} model=${settings.model ?? "(default)"}`);
  return chatSession;
}

async function ensureChatSession(input?: Partial<ChatSettings>, reset = false): Promise<{ id: string; projector: ChatProjector; settings: ChatSettings }> {
  const settings = normalizeSettings(input);
  if (chatSession && !reset && sameSettings(chatSession.settings, settings)) return chatSession;
  await chatServerReady;
  if (chatSession) {
    chatSession.projector.stop();
    chatClient.deleteSession(chatSession.id).catch(() => {});
    chatSession = null;
  }
  const id = await chatClient.createSession(CHAT_TITLE, settings);
  const projector = new ChatProjector(chatClient, id);
  projector.start();
  chatSession = { id, projector, settings };
  console.log(`[chat] session ready id=${id} agent=${settings.agent} model=${settings.model ?? "(default)"}`);
  return chatSession;
}

async function chatMessages() {
  const { id, projector, settings } = await getChatSession();
  return Response.json({ success: true, data: { ...projector.getSnapshot(), sessionID: id, settings } });
}

function modelOptionsFromProviders(raw: unknown) {
  const providers = (raw as { providers?: unknown[] })?.providers;
  if (!Array.isArray(providers)) return [];
  return providers.flatMap((provider) => {
    const item = provider as { id?: string; providerID?: string; name?: string; models?: unknown };
    const providerID = item.id ?? item.providerID ?? item.name;
    if (!providerID || !item.models || typeof item.models !== "object") return [];
    return Object.entries(item.models as Record<string, unknown>).map(([modelID, model]) => ({
      id: `${providerID}/${modelID}`,
      providerID,
      modelID,
      name: (model as { name?: string })?.name ?? modelID,
    }));
  });
}

async function chatOptions() {
  await chatServerReady;
  const [agentsResult, providersResult] = await Promise.allSettled([
    chatClient.listAgents(),
    chatClient.listProviders(),
  ]);
  const agents = agentsResult.status === "fulfilled" ? agentsResult.value : [];
  const providers = providersResult.status === "fulfilled" ? providersResult.value : { providers: [], default: [] };
  return Response.json({
    success: true,
    data: {
      defaults: defaultChatSettings,
      current: chatSession ? { sessionID: chatSession.id, settings: chatSession.settings } : null,
      agents,
      providers,
      models: modelOptionsFromProviders(providers),
      runtime: {
        wopalHome: POC_WOPAL_HOME,
        directory: ELLAMAKA_DIRECTORY,
        serveCwd: CHAT_SERVE_CWD,
        ellamakaUrl: ELLAMAKA_URL,
      },
    },
  });
}

async function chatSessionCreate(req: Request) {
  try {
    const body = await req.json().catch(() => ({})) as Partial<ChatSettings> & { reset?: boolean };
    const { id, projector, settings } = await ensureChatSession(body, body.reset ?? true);
    return Response.json({ success: true, data: { sessionID: id, settings, snapshot: projector.getSnapshot() } });
  } catch (err) {
    return Response.json({ success: false, message: err instanceof Error ? err.message : "session create failed" }, { status: 400 });
  }
}

function chatStream() {
  const abort = new AbortController();
  const stream = new ReadableStream({
    async start(controller) {
      const { id, projector, settings } = await getChatSession();

      // Initial snapshot
      const snap = projector.getSnapshot();
      controller.enqueue(encoder.encode(
        `data: ${JSON.stringify({ type: "snapshot", messages: snap.messages, status: snap.status, sessionID: id, settings })}\n\n`,
      ));

      const unsubscribe = projector.addListener((event) => {
        if (abort.signal.aborted) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      });

      // Heartbeat to prevent idle timeout
      const heartbeat = setInterval(() => {
        if (abort.signal.aborted) return;
        try { controller.enqueue(encoder.encode(": heartbeat\n\n")); } catch { clearInterval(heartbeat); }
      }, 5000);

      abort.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        unsubscribe();
        try { controller.close(); } catch {}
        console.log("[chat/sse] stream closed");
      }, { once: true });
    },
    cancel() { abort.abort(); },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

async function chatSend(req: Request) {
  try {
    const body = await req.json() as { message?: string; message_id?: string; agent?: string; model?: string };
    const text = body.message?.trim();
    if (!text) return Response.json({ success: false, message: "empty message" }, { status: 400 });

    const { id, projector, settings } = await ensureChatSession(body);
    projector.addUserMessage(text, body.message_id);
    await chatClient.promptAsync(id, [{ type: "text", text }], settings);
    return Response.json({ success: true, data: { sessionID: id, settings } });
  } catch (err) {
    return Response.json({ success: false, message: err instanceof Error ? err.message : "send failed" }, { status: 400 });
  }
}

// ===========================================================================
// Workbench — feedback collection (prototype validation)
// ---------------------------------------------------------------------------
// PoC stores feedback to a JSONL file under the PoC dir. Production would
// forward to an analytics/CRM pipeline. Captures rating + free text + the
// view/space context the user was in, so iteration prioritization is grounded.
// ===========================================================================

const FEEDBACK_FILE = joinPath(import.meta.dir, "feedback.jsonl");

async function feedbackReceive(req: Request) {
  try {
    const body = await req.json() as { rating?: number; text?: string; view?: string; space?: string; ts?: number };
    const rating = Math.max(1, Math.min(5, Number(body.rating) | 0));
    if (!rating) return Response.json({ success: false, message: "rating required" }, { status: 400 });
    const entry = {
      rating,
      text: String(body.text ?? "").slice(0, 2000),
      view: String(body.view ?? ""),
      space: String(body.space ?? ""),
      ts: body.ts ?? Date.now(),
      receivedAt: new Date().toISOString(),
    };
    appendFileSync(FEEDBACK_FILE, JSON.stringify(entry) + "\n");
    console.log(`[feedback] rating=${rating} view=${entry.view} space=${entry.space} text=${entry.text.slice(0, 60)}`);
    return Response.json({ success: true, data: { saved: true } });
  } catch (err) {
    return Response.json({ success: false, message: err instanceof Error ? err.message : "feedback failed" }, { status: 500 });
  }
}

// ===========================================================================
// Router
// ===========================================================================

function isDesktopUA(req: Request): boolean {
  const ua = req.headers.get("user-agent") ?? "";
  // No mobile/android/ios markers → treat as desktop (covers iPad desktop UA too)
  return !/Mobile|Android|iPhone|iPad|iPod/i.test(ua);
}

Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  idleTimeout: 255,
  async fetch(req) {
    const url = new URL(req.url);
    const { pathname } = url;

    // Pages — `/` auto-routes by User-Agent.
    // Desktop default → productized Workbench (三栏 IDE 工作台).
    if (pathname === "/" || pathname === "/index.html") {
      return html(isDesktopUA(req) ? workbenchHtml : indexHtml);
    }
    if (pathname === "/desktop" || pathname === "/desktop.html") return html(desktopHtml);
    if (pathname === "/workbench" || pathname === "/workbench.html") return html(workbenchHtml);
    if (pathname === "/tui" || pathname === "/tui.html") return html(tuiHtml);
    if (pathname === "/m" || pathname === "/m.html") return html(mHtml);

    // Spaces API
    if (pathname === "/api/spaces" && req.method === "GET") {
      try {
        const result = await listSpaces();
        return Response.json({ success: true, data: result });
      } catch (err) {
        return Response.json({ success: false, message: err instanceof Error ? err.message : "spaces list failed" }, { status: 500 });
      }
    }

    // TUI API
    if (pathname === "/api/tui/stream") return tuiStream(req);
    if (pathname === "/api/tui/input" && req.method === "POST") return tuiInput(req);
    if (pathname === "/api/tui/resize" && req.method === "POST") return tuiResize(req);
    if (pathname === "/api/tui/kill" && req.method === "POST") return tuiKill(req);

    // Chat API
    if (pathname === "/api/chat/options" && req.method === "GET") return chatOptions();
    if (pathname === "/api/chat/session" && req.method === "POST") return chatSessionCreate(req);
    if (pathname === "/api/chat/messages" && req.method === "GET") return chatMessages();
    if (pathname === "/api/chat/stream") return chatStream();
    if (pathname === "/api/chat/send" && req.method === "POST") return chatSend(req);

    // Workbench — feedback collection + health probe
    if (pathname === "/api/feedback" && req.method === "POST") return feedbackReceive(req);
    if (pathname === "/api/health" && req.method === "GET") {
      return Response.json({ success: true, data: { ok: true, tuiSessions: ptys.size, chatReady: chatSession !== null, spaces: (await listSpaces().catch(() => ({ spaces: [] }))).spaces.length, uptime: process.uptime() | 0 } });
    }

    return new Response("not found", { status: 404 });
  },
});

console.log("\n  ── Ellamaka Web PoC (TUI + Chat) ──");
console.log(`  web:      http://localhost:${PORT}            (auto route by UA)`);
console.log(`  workbench:http://localhost:${PORT}/workbench (产品化工作台 — 推荐)`);
console.log(`  desktop:  http://localhost:${PORT}/desktop    (space selector → /tui?space=)`);
console.log(`  tui:      http://localhost:${PORT}/tui?space=  (desktop, per-space PTY)`);
console.log(`  chat:     http://localhost:${PORT}/m          (mobile)`);
console.log(`  tui cmd:  ${RESOLVED_CMD} ${ARGS.join(" ")}`);
console.log(`  chat url: ${ELLAMAKA_URL} (directory=${ELLAMAKA_DIRECTORY})`);
console.log(`  chat defaults: agent=${CHAT_AGENT} model=${CHAT_MODEL || "(agent/default)"}`);
console.log(`  env: WOPAL_HOME=${POC_WOPAL_HOME}`);
console.log(`  chat serve cwd: ${CHAT_SERVE_CWD} (auto-spawned if ${ELLAMAKA_URL} is down)\n`);
