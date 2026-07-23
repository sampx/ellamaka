import { createMemo, type Component } from "solid-js"
import { Button } from "./button"
import { Icon } from "./icon"

export interface NumberStepperRange {
  min: number
  max: number
  step?: number
}

export function clampValue(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min
  if (value < min) return min
  if (value > max) return max
  return value
}

export function NumberStepperChange(
  value: number,
  direction: 1 | -1,
  range: NumberStepperRange,
): number {
  const step = range.step ?? 1
  return clampValue(value + direction * step, range.min, range.max)
}

export interface NumberStepperProps {
  value: number
  range: NumberStepperRange
  onChange: (next: number) => void
  decreaseLabel: string
  increaseLabel: string
  class?: string
}

export const NumberStepper: Component<NumberStepperProps> = (props) => {
  const min = () => props.range.min
  const max = () => props.range.max
  const canDecrease = createMemo(() => props.value > min())
  const canIncrease = createMemo(() => props.value < max())

  const decrease = () => {
    if (!canDecrease()) return
    props.onChange(NumberStepperChange(props.value, -1, props.range))
  }

  const increase = () => {
    if (!canIncrease()) return
    props.onChange(NumberStepperChange(props.value, 1, props.range))
  }

  return (
    <div
      data-component="number-stepper"
      data-min={canDecrease() ? "false" : "true"}
      data-max={canIncrease() ? "false" : "true"}
      class={props.class}
      role="group"
    >
      <Button
        size="small"
        variant="secondary"
        data-action="number-stepper-decrease"
        aria-label={props.decreaseLabel}
        disabled={!canDecrease()}
        onClick={decrease}
      >
        <Icon name="dash" size="small" />
      </Button>
      <span data-slot="number-stepper-value" aria-live="polite">
        {props.value}
      </span>
      <Button
        size="small"
        variant="secondary"
        data-action="number-stepper-increase"
        aria-label={props.increaseLabel}
        disabled={!canIncrease()}
        onClick={increase}
      >
        <Icon name="plus" size="small" />
      </Button>
    </div>
  )
}
