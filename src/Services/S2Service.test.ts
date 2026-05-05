import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { computeRelevance, s2ToPaper } from "./S2Service.ts"

describe("S2Service", () => {
  it.effect("should S2 paper conversion preserve arXiv identity while defaulting nullable metadata", () => Effect.gen(function* () {
    const complete = s2ToPaper({
      paperId: "s2-1",
      title: "Paper",
      authors: [{ name: "A" }, { name: "B" }],
      abstract: "Abstract.",
      year: 2024,
      citationCount: 10,
      externalIds: { ArXiv: "2401.00001" },
    }, "2401.00001")
    const nullable = s2ToPaper({
      paperId: "s2-2",
      title: null,
      authors: null,
      abstract: null,
      year: null,
      citationCount: null,
      externalIds: null,
    }, "2401.00002")

    // Test: should S2 paper conversion preserve arXiv identity while defaulting nullable metadata
    // Scope: Semantic Scholar responses are nullable, but Paper domain data needs stable strings and arrays.
    // Assertion: arXiv IDs drive SDK identity, present metadata is copied, and nulls become safe defaults.
    expect({ complete, nullable }).toMatchObject({
      complete: {
        id: "2401.00001",
        title: "Paper",
        authors: ["A", "B"],
        abstract: "Abstract.",
        source: "arxiv",
        url: "https://arxiv.org/abs/2401.00001",
        year: 2024,
        citationCount: 10,
      },
      nullable: {
        id: "2401.00002",
        title: "Unknown",
        authors: [],
        abstract: "",
        source: "arxiv",
        url: "https://arxiv.org/abs/2401.00002",
      },
    })
  }))

  it.effect("should relevance scoring stay bounded while rewarding citations and shallow depth", () => Effect.gen(function* () {
    const uncited = computeRelevance({
      paperId: "s2-1",
      title: null,
      authors: null,
      abstract: null,
      year: null,
      citationCount: 0,
      externalIds: null,
    }, 100, 1)
    const cited = computeRelevance({
      paperId: "s2-2",
      title: null,
      authors: null,
      abstract: null,
      year: null,
      citationCount: 100,
      externalIds: null,
    }, 100, 1)
    const deep = computeRelevance({
      paperId: "s2-3",
      title: null,
      authors: null,
      abstract: null,
      year: null,
      citationCount: 100,
      externalIds: null,
    }, 100, 2)

    // Test: should relevance scoring stay bounded while rewarding citations and shallow depth
    // Scope: graph node ranking is derived locally and should not exceed display-safe score limits.
    // Assertion: scores are bounded to one, cited papers outrank uncited papers, and deeper nodes receive a penalty.
    expect({ uncited, cited, deep }).toEqual({
      uncited: 0.3,
      cited: 1,
      deep: 0.85,
    })
  }))
})
