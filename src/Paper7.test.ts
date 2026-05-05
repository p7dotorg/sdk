import { Effect, Layer, Option } from "effect"
import { describe, expect, it } from "@effect/vitest"
import { SearchResult } from "./Domain/Paper.ts"
import { Paper, PaperGraph } from "./Domain/Paper.ts"
import { makePaper7 } from "./Paper7.ts"
import { CacheService } from "./Services/CacheService.ts"
import { PaperSourceService } from "./Services/PaperSourceService.ts"
import { S2Service } from "./Services/S2Service.ts"

describe("Paper7", () => {
  it.effect("should facade delegate operations while not changing service outputs", () => Effect.gen(function* () {
    const paper7 = yield* makePaper7
    const search = yield* paper7.search("query")
    const markdown = yield* paper7.get("2401.00001")
    const refs = yield* paper7.refs("2401.00001")
    const graph = yield* paper7.graph("2401.00001", 2)
    const list = yield* paper7.list()
    yield* paper7.cache.clear("2401.00001")

    // Test: should facade delegate operations while not changing service outputs
    // Scope: Paper7 is the public SDK facade and should be a thin composition layer over services.
    // Assertion: every facade method returns the exact downstream result and cache clear forwards the id.
    expect({ search, markdown, refs, graph, list, clearedIds }).toEqual({
      search: [searchResult],
      markdown: "# Paper",
      refs: [paper],
      graph: new PaperGraph({ seed: paper, nodes: [], edges: [] }),
      list: [{ id: "cached", title: "Cached", authors: "A" }],
      clearedIds: ["2401.00001"],
    })
  }).pipe(Effect.provide(testLayer)))
})

const clearedIds: Array<string | undefined> = []

const searchResult = new SearchResult({
  id: "2401.00001",
  title: "Paper",
  authors: ["A"],
  abstract: "Abstract.",
  source: "arxiv",
  url: "https://arxiv.org/abs/2401.00001",
})

const paper = new Paper({
  id: "2401.00001",
  title: "Paper",
  authors: ["A"],
  abstract: "Abstract.",
  source: "arxiv",
  url: "https://arxiv.org/abs/2401.00001",
})

const testLayer = Layer.mergeAll(
  Layer.succeed(PaperSourceService, PaperSourceService.of({
    search: () => Effect.succeed([searchResult]),
    get: () => Effect.succeed("# Paper"),
  })),
  Layer.succeed(S2Service, S2Service.of({
    refs: () => Effect.succeed([paper]),
    buildGraph: () => Effect.succeed(new PaperGraph({ seed: paper, nodes: [], edges: [] })),
  })),
  Layer.succeed(CacheService, CacheService.of({
    get: () => Effect.succeed(Option.none()),
    set: () => Effect.void,
    list: () => Effect.succeed([{ id: "cached", title: "Cached", authors: "A" }]),
    clear: (id) => Effect.sync(() => { clearedIds.push(id) }),
  })),
)
