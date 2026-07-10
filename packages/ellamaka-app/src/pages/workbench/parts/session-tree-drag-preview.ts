export function setInvisibleSessionDragPreview(dataTransfer: Pick<DataTransfer, "setDragImage">) {
  const preview = document.createElement("canvas")
  preview.width = 1
  preview.height = 1
  dataTransfer.setDragImage(preview, 0, 0)
}
