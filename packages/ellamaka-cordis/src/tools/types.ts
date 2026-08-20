/**
 * Self-owned contract types for `ctx.tools` — the minimal tool registry and
 * `tools/post-execute` waterfall (DESIGN §5.1).
 *
 * The shapes are borrowed from `@deepseek-ai/dsh-tools` (ToolDefinition /
 * ToolExecution / ToolExecutionResult / PostToolDecision) but are declared here
 * so the cordis boundary never imports dsh contract packages (CORDIS DESIGN
 * §7 current convention, D-03). spill-policy mounts against these self-owned shapes, so
 * structural compatibility is a compile-time requirement.
 *
 * This Plan implements only the registry, execute, and `tools/post-execute`
 * segments — the pre/guard/around pipeline stages are out of scope.
 */

import type { Tools } from "./registry.js"

/** A model-facing content block: a plain text block or any opaque tagged block. */
export type ContentBlock =
  | { type: "text"; text: string }
  | { type: string; [k: string]: unknown }

/**
 * A registered tool. `execute` receives frozen model arguments plus an
 * execution context carrying identity and the cancellation signal.
 */
export interface ToolDefinition {
  /** The model-visible tool name; the registry key. */
  readonly name: string
  /** The model-visible description. */
  readonly description: string
  /** The model-visible JSON schema for `arguments`. */
  readonly parameters: unknown
  /**
   * Run one call and return its canonical value. Async work must observe or
   * forward `exec.signal` so caller cancellation can reach quiescence.
   */
  execute(args: unknown, exec: ToolRunContext): Promise<unknown>
}

/**
 * The minimal session facade slice exposed on an execution: the owning
 * session's header. spill-policy reads `agent.session.header.id`.
 */
export interface AgentFacade {
  readonly session: {
    readonly header: {
      readonly id: string
      readonly cwd: string
    }
  }
}

/** The caller-supplied description of one tool call. */
export interface ToolExecution {
  readonly callId: string
  readonly rootCallId: string
  readonly name: string
  /** Losslessly JSON-serializable parsed arguments. */
  readonly arguments: unknown
  /** The agent on whose behalf the call runs, when known. */
  readonly agent?: AgentFacade
  /** Opaque token of an enclosing execution, when this is a sub-dispatch. */
  readonly parent?: unknown
  /** Required caller-owned cancellation signal. */
  readonly signal: AbortSignal
}

/** The execution context handed to a tool body. */
export type ToolRunContext = ToolExecution

/** Structured failure metadata for a failed tool call. */
export interface ToolFailure {
  /** Human-readable failure message without any `Error: ` envelope. */
  readonly message: string
  /** Internal error class/code used by policy and diagnostics. */
  readonly info?: { readonly name: string; readonly code: string }
}

/** Successful canonical tool execution. */
export interface ToolExecutionSuccess {
  readonly isError: false
  readonly content: ContentBlock[]
  readonly error?: never
}

/** Failed canonical tool execution; failures never carry a successful value. */
export interface ToolExecutionFailure {
  readonly isError: true
  readonly error: ToolFailure
  readonly content: ContentBlock[]
}

/** The discriminated outcome of one tool call. */
export type ToolExecutionResult = ToolExecutionSuccess | ToolExecutionFailure

/**
 * Post-dispatch decision: accept the result, replace its content projection,
 * or block by turning corrective feedback into an error result.
 */
export type PostToolDecision =
  | { kind: "accept"; content?: ContentBlock[]; value?: never }
  | { kind: "accept"; value: unknown; content?: never }
  | { kind: "block"; feedback: ContentBlock[] }

declare module "@deepseek-ai/cordis" {
  interface Context {
    tools: Tools
  }

  interface Events {
    /**
     * Accept, replace, enrich, or block a normalized dispatch result. `next()`
     * accepts it unchanged; thrown tools still reach this waterfall as errors.
     * @mode waterfall
     * @param exec - the call that just ran.
     * @param result - the dispatch outcome a listener may accept, replace, or block.
     * @param next - the innermost continuation; listeners must call it to delegate.
     */
    "tools/post-execute"(
      this: Context,
      exec: ToolExecution,
      result: Readonly<ToolExecutionResult>,
      next: () => Promise<PostToolDecision>,
    ): Promise<PostToolDecision>
  }
}
