import { File } from "@opencode-ai/ui/file"
import type { Component } from "solid-js"
import { ellamakaFileProps } from "./ellamaka-file-props"

export const EllamakaFile: Component<Parameters<typeof File>[0]> = (props) => {
  if (props.mode === "diff") {
    return <File {...ellamakaFileProps(props)} />
  }
  return <File {...props} />
}
