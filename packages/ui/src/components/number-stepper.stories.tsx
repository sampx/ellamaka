// @ts-nocheck
import * as mod from "./number-stepper"
import { create } from "../storybook/scaffold"

const docs = `### Overview
Compact number stepper with [-] value [+] controls.

Replaces small native number inputs whose up/down arrows are hard to
target. Use in settings rows where the value is constrained to a
fixed range (font size, zoom level, etc.).

### API
- Required: \`value\`, \`range\` (\`{ min, max, step? }\`), \`onChange\`.
- Required: \`decreaseLabel\` and \`increaseLabel\` for aria-label.
- Optional: \`class\` for layout composition.

### Variants and states
- Buttons disable automatically at min/max.
- The value area is read-only and not focusable.

### Behavior
- Click +/- to step by \`range.step\` (default 1).
- Calls \`onChange\` with the clamped next value.

### Accessibility
- Buttons expose \`aria-label\` via the required \`decreaseLabel\` /
  \`increaseLabel\` props.
- \`role="group"\` wraps the three slots; \`aria-live="polite"\` on
  the value announces changes to assistive tech.

### Theming/tokens
- Uses \`data-component="number-stepper"\`.
- Reads secondary button surface tokens for the value chip.

`

const story = create({
  title: "UI/NumberStepper",
  mod,
  args: {
    value: 16,
    range: { min: 10, max: 24, step: 1 },
    decreaseLabel: "Decrease",
    increaseLabel: "Increase",
    onChange: () => undefined,
  },
})

export default {
  title: "UI/NumberStepper",
  id: "components-number-stepper",
  component: story.meta.component,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: docs,
      },
    },
  },
}

export const Basic = story.Basic

export const AtMinimum = {
  args: {
    value: 10,
  },
}

export const AtMaximum = {
  args: {
    value: 24,
  },
}
