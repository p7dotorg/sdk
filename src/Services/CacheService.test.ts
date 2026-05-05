import { Effect, FileSystem, Layer, Option, PlatformError } from "effect"
import { describe, expect, it } from "@effect/vitest"
import { CacheReadError } from "../Domain/Errors.ts"
import { makeCacheService } from "./CacheService.ts"

describe("CacheService", () => {
  it.effect("should get return none while not reading metadata for absent papers", () => Effect.gen(function* () {
    const cache = yield* makeCacheService
    const result = yield* cache.get("absent")

    // Test: should get return none while not reading metadata for absent papers
    // Scope: cache misses are normal and should not depend on side files or throw.
    // Assertion: missing paper markdown returns Option.none and no file reads occur.
    expect({ isNone: Option.isNone(result), reads }).toEqual({ isNone: true, reads: [] })
  }).pipe(Effect.provide(fileSystemLayer({ exists: false }))))

  it.effect("should get decode cache entry while not ignoring persisted metadata", () => Effect.gen(function* () {
    const cache = yield* makeCacheService
    const result = yield* cache.get("paper")

    // Test: should get decode cache entry while not ignoring persisted metadata
    // Scope: cache hits reconstruct SDK data from markdown plus meta JSON.
    // Assertion: markdown and parsed metadata are returned together.
    expect(Option.isSome(result) ? result.value : undefined).toEqual({
      markdown: "# Paper",
      meta: { id: "paper", title: "Paper", authors: "A, B", tldr: "Short" },
    })
  }).pipe(Effect.provide(fileSystemLayer({ exists: true }))))

  it.effect("should list skip malformed entries while not failing the whole cache listing", () => Effect.gen(function* () {
    const cache = yield* makeCacheService
    const entries = yield* cache.list()

    // Test: should list skip malformed entries while not failing the whole cache listing
    // Scope: users list local cache entries, where one bad meta file should not hide valid cached papers.
    // Assertion: valid metadata is returned and malformed metadata is ignored.
    expect(entries).toEqual([{ id: "paper", title: "Paper", authors: "A, B", tldr: "Short" }])
  }).pipe(Effect.provide(fileSystemLayer({ exists: true, ids: ["paper", "bad"] }))))

  it.effect("should get fail typed on read errors while not exposing platform errors", () => Effect.gen(function* () {
    const cache = yield* makeCacheService
    const result = yield* Effect.result(cache.get("broken"))

    // Test: should get fail typed on read errors while not exposing platform errors
    // Scope: filesystem failures cross a platform boundary and should become domain cache errors.
    // Assertion: read failure is mapped to CacheReadError.
    expect(result._tag === "Failure" ? result.failure : undefined).toBeInstanceOf(CacheReadError)
  }).pipe(Effect.provide(fileSystemLayer({ exists: true, failRead: true }))))
})

const reads: Array<string> = []

const fileSystemLayer = (fixture: {
  readonly exists: boolean
  readonly ids?: ReadonlyArray<string>
  readonly failRead?: boolean
}) => {
  reads.length = 0
  return Layer.succeed(FileSystem.FileSystem, FileSystem.makeNoop({
    exists: () => Effect.succeed(fixture.exists),
    readFileString: (path: string) => Effect.gen(function* () {
      reads.push(path)
      if (fixture.failRead === true) {
        return yield* Effect.fail(new PlatformError.PlatformError(new PlatformError.SystemError({
          _tag: "Unknown",
          module: "FileSystem",
          method: "readFileString",
        })))
      }
      if (path.endsWith("paper.md")) return "# Paper"
      if (path.includes("/bad/")) return "not-json"
      return JSON.stringify({ id: "paper", title: "Paper", authors: "A, B", tldr: "Short" })
    }),
    readDirectory: () => Effect.succeed([...(fixture.ids ?? [])]),
    makeDirectory: () => Effect.void,
    writeFileString: () => Effect.void,
    remove: () => Effect.void,
  }))
}
