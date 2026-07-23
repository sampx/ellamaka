import { describe, expect, test } from "bun:test"
import { clampValue, NumberStepperChange } from "./number-stepper"

describe("number stepper", () => {
  test("clamps the initial value into the min/max range", () => {
    expect(clampValue(5, 10, 24)).toBe(10)
    expect(clampValue(30, 10, 24)).toBe(24)
    expect(clampValue(16, 10, 24)).toBe(16)
  })

  test("steps up by the configured step", () => {
    const next = NumberStepperChange(16, 1, { min: 10, max: 24, step: 1 })
    expect(next).toBe(17)
  })

  test("steps down by the configured step", () => {
    const next = NumberStepperChange(16, -1, { min: 10, max: 24, step: 1 })
    expect(next).toBe(15)
  })

  test("does not step above the maximum", () => {
    const next = NumberStepperChange(24, 1, { min: 10, max: 24, step: 1 })
    expect(next).toBe(24)
  })

  test("does not step below the minimum", () => {
    const next = NumberStepperChange(10, -1, { min: 10, max: 24, step: 1 })
    expect(next).toBe(10)
  })

  test("supports custom step sizes", () => {
    expect(NumberStepperChange(16, 1, { min: 10, max: 24, step: 2 })).toBe(18)
    expect(NumberStepperChange(16, -1, { min: 10, max: 24, step: 2 })).toBe(14)
  })
})
