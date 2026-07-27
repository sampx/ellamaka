import { readOnboardingState } from "./onboarding-state"
import { getUserShell, loadShellEnv } from "./shell-env"

export type AppMode = "onboarding" | "workbench"

// GUI processes (Finder/Dock launch on macOS, Explorer on Windows) do not
// inherit shell rc variables, so process.env.WOPAL_HOME is typically empty
// when the desktop app cold-starts. install.sh writes WOPAL_HOME into the
// user's shell rc (Step 9), so we spawn a login shell and read its env to
// recover the value the user configured at install time. Returns null when
// the probe fails or the variable is absent; the caller falls back to ~/.wopal.
//
// Synchronous because resolveOnboardingMode is called early in main startup
// before any async work. loadShellEnv uses spawnSync with a 5s cap.
export function probeWopalHomeFromShell(): string | null {
  try {
    const shell = getUserShell()
    const env = loadShellEnv(shell)
    const value = env?.WOPAL_HOME?.trim()
    return value || null
  } catch {
    return null
  }
}

export function resolveOnboardingMode(
  homePath?: string,
  env: Record<string, string | undefined> = process.env,
): AppMode {
  // Allow explicit override flag for testing/dev commands
  if (env.ELLAMAKA_TEST_ONBOARDING === "1" || env.OPENCODE_TEST_ONBOARDING === "1") {
    return "onboarding"
  }

  // Purely driven by whether state.json in WOPAL_HOME is completed
  const state = readOnboardingState(homePath)
  if (!state || !state.completed) {
    return "onboarding"
  }

  return "workbench"
}
