import { describe, expect, test } from "bun:test"
import { isVmwareVirtualGpu } from "./gpu-detect"

describe("isVmwareVirtualGpu", () => {
  test("returns true when wmic reports a VMware video controller", () => {
    const exec = () => "Name\nVMware SVGA 3D\n"
    expect(isVmwareVirtualGpu("win32", exec as any)).toBe(true)
  })

  test("returns false for a non-VMware video controller", () => {
    const exec = () => "Name\nIntel(R) UHD Graphics\n"
    expect(isVmwareVirtualGpu("win32", exec as any)).toBe(false)
  })

  test("returns false when wmic fails (fail-open)", () => {
    const exec = () => {
      throw new Error("wmic not found")
    }
    expect(isVmwareVirtualGpu("win32", exec as any)).toBe(false)
  })

  test("returns false on non-win32 platforms without invoking wmic", () => {
    let called = false
    const exec = () => {
      called = true
      return "Name\nVMware SVGA 3D\n"
    }
    expect(isVmwareVirtualGpu("darwin", exec as any)).toBe(false)
    expect(called).toBe(false)
  })
})
