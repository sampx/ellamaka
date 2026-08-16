export function ellamakaFileProps<P extends object>(props: P): P & { diffIndicators: "classic" } {
  return { ...props, diffIndicators: "classic" }
}
