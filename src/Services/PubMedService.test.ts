import { Effect, Layer } from "effect"
import { describe, expect, it } from "@effect/vitest"
import { PubMedFetchError } from "../Domain/Errors.ts"
import { PaperSourceAdapter, PaperSourceContent } from "./PaperSourceAdapter.ts"
import { formatPubMedArticle, PubMedPaperSourceServiceLive, PubMedService } from "./PubMedService.ts"
import { PubMedArticle } from "./PubMedTypes.ts"

describe("PubMedService", () => {
  it.effect("should article formatting include publication links while not rendering missing optional metadata", () => Effect.gen(function* () {
    const formatted = formatPubMedArticle(new PubMedArticle({
      id: "pmid:123",
      title: "Paper",
      authors: ["A", "B"],
      published: "2024",
      abstract: "Abstract.",
    }))

    // Test: should article formatting include publication links while not rendering missing optional metadata
    // Scope: PubMed formatting is user-visible SDK output independent of transport and XML parsing.
    // Assertion: required metadata and PubMed URL render, while absent journal and DOI lines are omitted.
    expect(formatted).toBe("# Paper\n\n**Authors:** A, B\n**Published:** 2024\n**PubMed:** https://pubmed.ncbi.nlm.nih.gov/123/\n\n## Abstract\n\nAbstract.")
  }))

  it.effect("should source adapter format PubMed content while not requiring markdown fallback", () => Effect.gen(function* () {
    const adapter = yield* PaperSourceAdapter
    const format = adapter.format
    const formatted = yield* (format === undefined
      ? Effect.fail(new PubMedFetchError({ id: "456", cause: "missing formatter" }))
      : format(PaperSourceContent.PubMedArticle({
      article: new PubMedArticle({
        id: "pmid:456",
        title: "Paper",
        authors: ["A"],
        published: "2024",
        abstract: "Abstract.",
        doi: "10.1000/example",
      }),
    })))

    // Test: should source adapter format PubMed content while not requiring markdown fallback
    // Scope: PaperSourceService depends on this adapter contract to convert PubMedArticle content to markdown.
    // Assertion: PubMed articles format through the adapter and include DOI links.
    expect(formatted).toContain("**DOI:** https://doi.org/10.1000/example")
  }).pipe(Effect.provide(PubMedPaperSourceServiceLive), Effect.provide(pubMedStubLayer)))

  it.effect("should source adapter strip pmid prefix while not passing transport identifiers downstream", () => Effect.gen(function* () {
    const adapter = yield* PaperSourceAdapter
    const content = yield* adapter.get("pmid:789")

    // Test: should source adapter strip pmid prefix while not passing transport identifiers downstream
    // Scope: public IDs include pmid: prefixes, but PubMed efetch expects raw numeric IDs.
    // Assertion: adapter delegates with raw ID and returns typed PubMedArticle content.
    expect(PaperSourceContent.$match({
      Markdown: () => undefined,
      PubMedArticle: ({ article }) => article.id,
    })(content)).toBe("pmid:789")
  }).pipe(Effect.provide(PubMedPaperSourceServiceLive), Effect.provide(pubMedStubLayer)))

  it.effect("should source adapter surface service failures while not converting them to content", () => Effect.gen(function* () {
    const adapter = yield* PaperSourceAdapter
    const result = yield* Effect.result(adapter.get("pmid:fail"))

    // Test: should source adapter surface service failures while not converting them to content
    // Scope: failed PubMed reads must stay typed failures for callers and retries.
    // Assertion: downstream PubMedFetchError is preserved.
    expect(result._tag === "Failure" ? result.failure : undefined).toBeInstanceOf(PubMedFetchError)
  }).pipe(Effect.provide(PubMedPaperSourceServiceLive), Effect.provide(pubMedStubLayer)))
})

const pubMedStubLayer = Layer.succeed(PubMedService, PubMedService.of({
  search: () => Effect.succeed([]),
  searchDetailed: () => Effect.fail(new PubMedFetchError({ id: "unused" })),
  get: (id: string) => id === "fail"
    ? Effect.fail(new PubMedFetchError({ id }))
    : Effect.succeed(new PubMedArticle({
        id: `pmid:${id}`,
        title: "Paper",
        authors: ["A"],
        published: "2024",
        abstract: "Abstract.",
      })),
}))
