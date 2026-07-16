/**
 * Sanitize a directory path before sending it to the backend (pty.create cwd,
 * SDKProvider directory header, etc.).
 *
 * Security: prevents path-traversal payloads (e.g. "../../etc/passwd" or
 * "/foo/../../../bar") from reaching the backend, where they could let a
 * dragged or server-supplied path escape its intended project root.
 *
 * - Empty string is allowed and returned as-is: it represents the General
 *   space, which has no project directory and is a legitimate value for the
 *   SDKProvider directory header (means "no x-opencode-directory header").
 * - Non-string input is rejected (returns undefined).
 * - Relative paths are rejected (must start with "/" on POSIX or a drive
 *   letter like "C:/" on Windows).
 * - Any ".." segment is rejected. We intentionally do not resolve ".." —
 *   backend-supplied and drag-source paths are expected to already be
 *   canonical, so a ".." segment is treated as suspicious rather than
 *   normalized away.
 * - Trailing slashes are stripped for consistency with normalizeSpacePath.
 *
 * Returns the sanitized path, or `undefined` if the input is unsafe.
 */
export function sanitizeDirectory(directory: unknown): string | undefined {
  if (typeof directory !== "string") return undefined
  if (directory === "") return ""

  // Normalize backslashes to forward slashes so Windows-style paths are
  // handled uniformly and ".." detection works on both platforms.
  const normalized = directory.replaceAll("\\", "/")

  const isPosixAbsolute = normalized.startsWith("/")
  const isWindowsAbsolute = /^[A-Za-z]:\//.test(normalized)
  if (!isPosixAbsolute && !isWindowsAbsolute) return undefined

  // Split into segments, drop empty segments and "." (self-references).
  const segments = normalized.split("/").filter((segment) => segment.length > 0 && segment !== ".")
  // Reject any ".." segment to prevent traversal above the project root.
  if (segments.some((segment) => segment === "..")) return undefined

  // Reassemble without a trailing slash. Keep the Windows drive prefix
  // (e.g. "C:/foo/bar") and the POSIX leading slash (e.g. "/foo/bar").
  const rejoined = segments.join("/")
  if (isWindowsAbsolute) return rejoined
  return "/" + rejoined
}
