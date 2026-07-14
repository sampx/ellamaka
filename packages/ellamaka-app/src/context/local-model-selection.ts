import { Persist } from "@/utils/persist"

const MODEL_SELECTION_KEY = "model-selection"

export type ModelSelectionSource = "selected" | "message"

export function shouldApplyAgentSelection(current: string | undefined, next: string) {
  return current !== next
}

export function resolveSessionModel<T>(input: {
  state?: { model?: T; modelSource?: ModelSelectionSource }
  lastMessage?: T
  agentDefault?: T
  fallback?: T
  valid: (model: T) => boolean
}) {
  const selected = input.state?.modelSource === "selected" ? input.state.model : undefined

  for (const model of [selected, input.lastMessage, input.agentDefault, input.fallback]) {
    if (model !== undefined && input.valid(model)) return model
  }
}

export function shouldSyncSessionModel(state: { modelSource?: ModelSelectionSource } | undefined) {
  return state?.modelSource !== "selected"
}

export function modelSelectionPersistTarget(directory: string, sessionID?: string) {
  if (sessionID) return Persist.session(directory, sessionID, MODEL_SELECTION_KEY)
  return Persist.workspace(directory, MODEL_SELECTION_KEY, [`${MODEL_SELECTION_KEY}.v1`])
}
