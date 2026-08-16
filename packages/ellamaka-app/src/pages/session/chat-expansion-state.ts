import { createBoundedExpansionState } from "./chat-render.utils"

/**
 * A single, bounded, in-memory expansion state shared across all tool blocks in
 * the Workbench Chat render layer. Keys are `sessionID + tool + callID/partID`.
 * It survives virtual-list recycling and remounts within the current app
 * lifetime, and evicts the oldest entry when it exceeds its limit. Session data,
 * WorkbenchStore and localStorage never carry this transient state.
 */
export const chatExpansionState = createBoundedExpansionState(200)
