import { Service } from "@deepseek-ai/cordis"
import type { Context } from "@deepseek-ai/cordis"
import type {
  ContentBlock,
  PostToolDecision,
  ToolDefinition,
  ToolExecution,
  ToolExecutionResult,
  ToolFailure,
} from "./types.js"

/**
 * The self-owned `ctx.tools` registry and `tools/post-execute` waterfall
 * (DESIGN §5.1, D-03).
 *
 * Holds a `name → ToolDefinition` map. `execute` runs the definition and
 * materializes a {@link ToolExecutionResult}, then triggers the
 * `tools/post-execute` waterfall so plugins (e.g. spill-policy) may accept,
 * replace, or block the outcome. Thrown definitions still reach the waterfall
 * as error results.
 *
 * Only the registry, execute, and post-execute segments are implemented in
 * this Plan — the pre/guard/around pipeline stages are out of scope.
 */
export class Tools extends Service {
  static provide = "tools"

  private readonly definitions = new Map<string, ToolDefinition>()

  constructor(ctx: Context) {
    super(ctx, "tools")
  }

  /**
   * Register a tool definition under its name. Registering the same name
   * twice replaces the previous definition.
   */
  register(definition: ToolDefinition): void {
    this.definitions.set(definition.name, definition)
  }

  /**
   * Return the registered definition for a name, or `undefined` when unregistered.
   */
  get(name: string): ToolDefinition | undefined {
    return this.definitions.get(name)
  }

  /**
   * Execute a tool by name and materialize its result.
   *
   * An unregistered name yields a `UNKNOWN_TOOL` error result without entering
   * the waterfall (a dispatch-level failure, matching dsh semantics). A
   * definition body that throws materializes an error result that DOES reach
   * the `tools/post-execute` waterfall. Caller cancellation via `exec.signal`
   * is forwarded to the body, which must settle cooperatively.
   */
  async execute(
    name: string,
    args: unknown,
    exec: ToolExecution,
  ): Promise<ToolExecutionResult> {
    const definition = this.definitions.get(name)
    if (definition === undefined) {
      return {
        isError: true,
        error: { message: `unknown tool "${name}"`, info: { name: "ToolNotFoundError", code: "UNKNOWN_TOOL" } },
        content: [{ type: "text", text: `unknown tool "${name}"` }],
      }
    }

    return this.executeInline(definition, args, exec)
  }

  /**
   * Execute an inline definition without touching the shared registry.
   *
   * Per-call dispatches (e.g. the grep bridge, whose execute body closes over
   * caller state) use this so concurrent calls never interleave closures by
   * re-registering a shared definition.
   */
  async executeInline(
    definition: ToolDefinition,
    args: unknown,
    exec: ToolExecution,
  ): Promise<ToolExecutionResult> {
    // Already-aborted before dispatch: materialize an aborted error result.
    if (exec.signal.aborted) {
      return this.runPostExecute(exec, {
        isError: true,
        error: { message: "tool execution aborted", info: { name: "ToolAborted", code: "ABORTED" } },
        content: [{ type: "text", text: "tool execution aborted" }],
      })
    }

    let result: ToolExecutionResult
    try {
      const value = await definition.execute(args, exec)
      result = {
        isError: false,
        content: [{ type: "text", text: stringifyValue(value) }],
      }
    } catch (error: unknown) {
      const failure = normalizeFailure(error)
      result = {
        isError: true,
        error: failure,
        content: [{ type: "text", text: failure.message }],
      }
    }

    return this.runPostExecute(exec, result)
  }

  /** Run the `tools/post-execute` waterfall and apply the returned decision. */
  private runPostExecute(
    exec: ToolExecution,
    result: ToolExecutionResult,
  ): Promise<ToolExecutionResult> {
    const innerNext = async (): Promise<PostToolDecision> => ({ kind: "accept" })
    const decision = this.ctx.waterfall("tools/post-execute", exec, result, innerNext)
    return decision.then((d) => this.applyDecision(result, d))
  }

  /** Apply a post-execute decision onto the base result. */
  private applyDecision(
    result: ToolExecutionResult,
    decision: PostToolDecision,
  ): ToolExecutionResult {
    switch (decision.kind) {
      case "accept": {
        const content = decision.content
        if (content === undefined) return result
        return { ...result, content }
      }
      case "block": {
        const message = feedbackMessage(decision.feedback)
        const failure: ToolFailure = {
          message,
          info: { name: "ToolBlocked", code: "BLOCKED" },
        }
        return { isError: true, error: failure, content: decision.feedback }
      }
    }
  }
}

/** Best-effort text projection of a successful tool value. */
function stringifyValue(value: unknown): string {
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

/** Normalize an arbitrary thrown value into a `ToolFailure`. */
function normalizeFailure(error: unknown): ToolFailure {
  if (error instanceof Error) return { message: error.message }
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string"
  ) {
    return { message: (error as { message: string }).message }
  }
  return { message: String(error) }
}

/** Flatten feedback blocks into one human-readable failure message. */
function feedbackMessage(content: ContentBlock[]): string {
  const text = content
    .map((block) => (block.type === "text" ? block.text : `[${block.type} content]`))
    .join("\n")
  return text.length > 0 ? text : "tool result blocked by post-execute policy"
}
