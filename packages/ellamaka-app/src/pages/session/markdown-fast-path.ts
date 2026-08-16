type CopyLabels = { copy: string; copied: string }

/**
 * Fast-path initial render for completed (non-streaming) markdown blocks.
 * Skips incremental matching by writing innerHTML directly when the container
 * is empty. On large session switches this avoids the dominant
 * "Parse HTML + diff" cost for historical messages. Ported from kilocode
 * `markdown-fast-path`.
 */
export function tryFastRender(
  container: HTMLDivElement,
  content: string,
  streaming: boolean | undefined,
  decorate: (root: HTMLDivElement, labels: CopyLabels) => void,
  setupCopy: (root: HTMLDivElement, getLabels: () => CopyLabels) => (() => void) | undefined,
  getLabels: () => CopyLabels,
  copyCleanup: (() => void) | undefined,
): { handled: boolean; copyCleanup: (() => void) | undefined } {
  if (streaming || container.childNodes.length > 0) {
    return { handled: false, copyCleanup }
  }
  container.innerHTML = content
  decorate(container, getLabels())
  const cleanup = copyCleanup ?? setupCopy(container, getLabels)
  return { handled: true, copyCleanup: cleanup }
}
