import { WorkbenchProvider } from "./view"
import { SpaceStoreProvider } from "./space-store"
import { TopBar } from "./parts/top-bar"
import { ActivityBar } from "./parts/activity-bar"
import { Sidebar } from "./parts/sidebar"
import { Workspace } from "./parts/workspace"
import { StatusBar } from "./parts/status-bar"

export default function Workbench() {
  return (
    <WorkbenchProvider>
      <SpaceStoreProvider>
        <div class="flex h-dvh flex-col bg-v2-background-bg-deep text-v2-text-text-base overflow-hidden">
          <TopBar />
          <div class="flex min-h-0 flex-1">
            <ActivityBar />
            <Sidebar />
            <Workspace />
          </div>
          <StatusBar />
        </div>
      </SpaceStoreProvider>
    </WorkbenchProvider>
  )
}