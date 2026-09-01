/**
 * Pure identity helpers for the Workbench file tree panel.
 *
 * Kept in a separate module (mirroring panel-chat-resume-scroll.ts) so unit
 * tests can exercise the logic without pulling the heavy file-tree component
 * and its context graph into the test bundle.
 */

/**
 * Stable identity for a Workbench file tree panel.
 *
 * `key` drives the keyed identity passed to the directory provider so the tree
 * remounts cleanly when the active directory changes (stale provider/view state
 * must not leak across spaces). `path` mirrors the panel's bound directory.
 *
 * Empty string is the canonical General scope and is a valid, well-formed input.
 */
export function fileTreePanelIdentity(directory: string) {
  return {
    key: `file-tree-panel\n${directory}`,
    path: directory,
  }
}
