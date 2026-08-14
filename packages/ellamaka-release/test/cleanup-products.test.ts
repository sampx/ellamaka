import { describe, expect, test } from "bun:test"
import { PRODUCTS } from "../src/cleanup/products"

describe("cleanup products config", () => {
  test("defines exactly the two products with their channel sets", () => {
    expect(Object.keys(PRODUCTS).sort()).toEqual(["ellamaka-cli", "ellamaka-desktop"])
    expect(PRODUCTS["ellamaka-cli"].channels).toEqual(["stable"])
    expect(PRODUCTS["ellamaka-desktop"].channels).toEqual(["stable", "beta"])
  })

  test("cli uses bare ellamaka R2 root and manifest-only latest restore", () => {
    const cli = PRODUCTS["ellamaka-cli"]
    expect(cli.r2Root).toBe("ellamaka")
    expect(cli.latestAlias).toBe("ellamaka/latest")
    expect(cli.ontologyRestore).toBe("alias")
  })

  test("desktop uses namespaced roots and full latest-channel restore", () => {
    const desktop = PRODUCTS["ellamaka-desktop"]
    expect(desktop.r2Root).toBe("ellamaka-desktop")
    expect(desktop.betaRoot).toBe("ellamaka-desktop/beta")
    expect(desktop.ontologyRestore).toBe("latest-channel")
  })

  test("github repo is shared", () => {
    expect(PRODUCTS["ellamaka-cli"].githubRepo).toBe("wopal-cn/ellamaka")
    expect(PRODUCTS["ellamaka-desktop"].githubRepo).toBe("wopal-cn/ellamaka")
  })
})
