import FileTree from "@/components/file-tree"
import { FileProvider } from "@/context/file"
import { WorkbenchPanelDirectoryProvider } from "../workbench-directory-provider"
import { fileTreePanelIdentity } from "./file-tree-panel-identity"
import type { FileNode } from "@opencode-ai/sdk/v2"

export function FileTreePanel(props: {
  directory: string
  onFileClick: (file: FileNode) => void
}) {
  const identity = () => fileTreePanelIdentity(props.directory)

  return (
    <WorkbenchPanelDirectoryProvider panelID={identity().key} directory={identity().path}>
      {() => (
        <FileProvider>
          <div class="flex flex-col min-h-0 h-full bg-v2-background-bg-base">
            <div class="flex-1 min-h-0 overflow-y-auto workbench-tree-scroll px-1.5 py-1">
              <FileTree path={identity().path} onFileClick={props.onFileClick} />
            </div>
          </div>
        </FileProvider>
      )}
    </WorkbenchPanelDirectoryProvider>
  )
}
