export type ModelKey = { providerID: string; modelID: string }

const sessionModelMap = new Map<string, ModelKey>()

export function setSessionModel(sessionID: string, model: ModelKey) {
  if (!sessionID || !model) return
  sessionModelMap.set(sessionID, model)
}

export function getAndClearSessionModel(sessionID: string): ModelKey | undefined {
  if (!sessionID) return undefined
  const model = sessionModelMap.get(sessionID)
  if (model) {
    sessionModelMap.delete(sessionID)
  }
  return model
}
