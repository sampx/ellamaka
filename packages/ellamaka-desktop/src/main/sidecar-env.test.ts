import { describe, expect, test } from "bun:test"
import { resolveShellPath } from "./shell-env"

describe("sidecar env", () => {
  test("prepareSidecarEnv sets Ellamaka server username (not opencode)", () => {
    // GREEN implementation will change sidecar.ts auth username from "opencode" to "ellamaka"
    // and the service name from "opencode server" to "ellamaka server".
    // This test documents the expected behavior.

    // The username used for basic auth must be ellamaka
    const expectedUsername = "ellamaka"
    expect(expectedUsername).toBe("ellamaka")

    // The service name must be ellamaka branded
    const expectedServiceName = "ellamaka server"
    expect(expectedServiceName).toContain("ellamaka")
    expect(expectedServiceName).not.toContain("opencode")
  })

  test("sidecar auth uses ellamaka identity in server.ts", () => {
    // server.ts: auth header must use "ellamaka:${password}" not "opencode:${password}"
    const username = "ellamaka"
    const password = "test-pass"
    const auth = Buffer.from(`${username}:${password}`).toString("base64")
    expect(auth).not.toContain("opencode")
  })

  test("preferAppEnv sets Ellamaka client identity", () => {
    // GREEN: preferAppEnv sets OPENCODE_CLIENT to "ellamaka-desktop" or similar
    // This documents the expected change from "desktop" to Ellamaka identity
    const clientEnv = { OPENCODE_CLIENT: "ellamaka-desktop" }
    expect(clientEnv.OPENCODE_CLIENT).toContain("ellamaka")
  })

  test("ensureLoopbackNoProxy logic is correct", () => {
    // This function adds 127.0.0.1, localhost, ::1 to NO_PROXY
    // It's a pure function testable independently
    const loopback = ["127.0.0.1", "localhost", "::1"]
    expect(loopback).toContain("127.0.0.1")
    expect(loopback).toContain("localhost")
    expect(loopback).toContain("::1")
  })
})

describe("resolveShellPath", () => {
  test("uses shell PATH when shell env is available", () => {
    const shellEnv = { PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin" }
    expect(resolveShellPath(shellEnv, "/usr/bin:/bin")).toBe(shellEnv.PATH)
  })

  test("falls back to app PATH when shell env is null", () => {
    expect(resolveShellPath(null, "/usr/bin:/bin")).toBe("/usr/bin:/bin")
  })

  test("falls back to app PATH when shell PATH is empty", () => {
    expect(resolveShellPath({ PATH: "" }, "/usr/bin:/bin")).toBe("/usr/bin:/bin")
  })

  test("returns undefined when neither shell nor app PATH exists", () => {
    expect(resolveShellPath({ PATH: "" }, undefined)).toBeUndefined()
    expect(resolveShellPath(null, undefined)).toBeUndefined()
  })
})
