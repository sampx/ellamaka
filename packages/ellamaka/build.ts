#!/usr/bin/env bun
import { $ } from "bun"
import { Script } from "@opencode-ai/script"
import { BINARY_NAME, CHANNEL_RELEASE, CHANNEL_DEV } from "./branding"

const channel = Script.release ? CHANNEL_RELEASE : CHANNEL_DEV
await $`BINARY_NAME=${BINARY_NAME} OPENCODE_CHANNEL=${channel} bun run ../opencode/script/build.ts --p1`
