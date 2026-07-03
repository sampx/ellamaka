// pty-bridge.ts — 独立 PTY 管理子进程
//
// 为什么需要它：bun-pty 0.4.8 的 native read-loop（while + await setTimeout）
// 在 Bun.serve 进程里 onData 回调不触发（已复现确认，连 Worker 也不行）。
// 把 PTY 管理放到这个独立 bun 进程里，read-loop 在顶层事件循环正常运行，
// onData 能正常触发。主 server 通过 stdin/stdout NDJSON 与本进程通信。
//
// 协议（每行一个 JSON，以换行分隔）：
//   server → bridge: {"cmd":"spawn","space":"x","cwd":"/path"}
//                  {"cmd":"input","space":"x","data":"..."}
//                  {"cmd":"resize","space":"x","cols":N,"rows":N}
//                  {"cmd":"kill","space":"x"}
//   bridge → server: {"type":"ready"}
//                  {"type":"spawned","space":"x","pid":N}
//                  {"type":"output","space":"x","data":"..."}
//                  {"type":"exited","space":"x","exitCode":N,"signal":"..."}

import { spawn } from "bun-pty";
import { existsSync, mkdirSync } from "node:fs";

const WOPAL_HOME = process.env.WOPAL_HOME ?? `${process.env.HOME}/.wopal`;
const ELLAMAKA_BIN = `${WOPAL_HOME}/bin/ellamaka`;

interface BridgePty {
  pty: ReturnType<typeof spawn>;
  space: string;
}

const ptys = new Map<string, BridgePty>();

function send(msg: unknown) {
  // 用 console.log 而非 process.stdout.write：pipe 模式下 process.stdout 是块缓冲，
  // server 读不到数据；console.log 每次调用都会 flush，保证 NDJSON 及时送达。
  console.log(JSON.stringify(msg));
}

function handleSpawn(space: string, cwd: string) {
  if (ptys.has(space)) { send({ type: "error", space, message: "already exists" }); return; }
  if (!existsSync(cwd)) mkdirSync(cwd, { recursive: true });
  const pty = spawn(ELLAMAKA_BIN, [], {
    name: "xterm-256color",
    cols: 100,
    rows: 30,
    cwd,
    env: { ...process.env, WOPAL_HOME, TERM: "xterm-256color" } as Record<string, string>,
  });
  const session: BridgePty = { pty, space };
  ptys.set(space, session);
  send({ type: "spawned", space, pid: pty.pid });

  pty.onData((data) => send({ type: "output", space, data }));
  pty.onExit(({ exitCode, signal }) => { send({ type: "exited", space, exitCode, signal: signal ?? null }); ptys.delete(space); });
}

function handleInput(space: string, data: string) {
  const s = ptys.get(space);
  if (s) s.pty.write(data);
}

function handleResize(space: string, cols: number, rows: number) {
  const s = ptys.get(space);
  if (s) { try { s.pty.resize(cols, rows); } catch {} }
}

function handleKill(space: string) {
  const s = ptys.get(space);
  if (s) { try { s.pty.kill(); } catch {} ptys.delete(space); }
}

// 读 stdin NDJSON 命令
const decoder = new TextDecoder();
let buf = "";
process.stdin.on("data", (chunk: Buffer) => {
  buf += decoder.decode(chunk);
  const lines = buf.split("\n");
  buf = lines.pop() ?? "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const msg = JSON.parse(trimmed) as { cmd?: string; space?: string; cwd?: string; data?: string; cols?: number; rows?: number };
      switch (msg.cmd) {
        case "spawn": if (msg.space && msg.cwd) handleSpawn(msg.space, msg.cwd); break;
        case "input": if (msg.space && msg.data !== undefined) handleInput(msg.space, msg.data); break;
        case "resize": if (msg.space && msg.cols && msg.rows) handleResize(msg.space, msg.cols, msg.rows); break;
        case "kill": if (msg.space) handleKill(msg.space); break;
      }
    } catch (err) {
      send({ type: "error", message: `bad command: ${err instanceof Error ? err.message : "parse error"}` });
    }
  }
});

process.stdin.on("end", () => {
  for (const [space, s] of ptys) { try { s.pty.kill(); } catch {} }
  process.exit(0);
});

send({ type: "ready", pid: process.pid, bin: ELLAMAKA_BIN });
