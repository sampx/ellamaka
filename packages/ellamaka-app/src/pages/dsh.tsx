export const DSH_URL = "http://127.0.0.1:4098/"

export default function DshPage() {
  return (
    <div class="flex h-full w-full flex-col">
      <div class="flex shrink-0 items-center gap-2 border-b border-v2-border-border px-3 py-1.5">
        <span class="text-sm font-medium text-v2-text-text-primary">dsh</span>
      </div>
      <iframe
        src={DSH_URL}
        title="dsh"
        class="h-full w-full flex-1 border-0"
      />
    </div>
  )
}
