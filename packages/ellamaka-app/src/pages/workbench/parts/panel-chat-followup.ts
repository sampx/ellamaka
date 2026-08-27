export type FollowupDeliveryItem = {
  id: string
}

type FollowupDispatchState = {
  busy: boolean
  sending: boolean
  failedID?: string
  paused: boolean
  child: boolean
  blocked: boolean
}

export function nextFollowupToSend<T extends FollowupDeliveryItem>(items: T[], state: FollowupDispatchState) {
  const item = items[0]
  if (!item) return undefined
  if (state.busy) return undefined
  if (state.sending) return undefined
  if (state.failedID === item.id) return undefined
  if (state.paused || state.child || state.blocked) return undefined
  return item
}
