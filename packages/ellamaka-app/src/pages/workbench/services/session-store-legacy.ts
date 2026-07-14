export const LEGACY_SESSION_STORAGE_KEY = "workbench.sessions"

export function removeLegacySessionStorage(storage: Pick<Storage, "removeItem"> | undefined) {
  if (!storage) return false
  try {
    storage.removeItem(LEGACY_SESSION_STORAGE_KEY)
    return true
  } catch (error) {
    console.error("Failed to remove legacy Workbench Session storage", error)
    return false
  }
}
