import { Effect, Layer, Option } from "effect"
import { describe, expect, it } from "@effect/vitest"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
import { ArxivFetchError, ArxivNotFoundError, ParseError } from "../Domain/Errors.ts"
import { makeArxivService } from "./ArxivService.ts"
import { CacheService } from "./CacheService.ts"
import { ParserService } from "./ParserService.ts"

describe("ArxivService", () => {
  it.effect("should search parse arXiv entries while not keeping version suffixes", () => Effect.gen(function* () {
    const service = yield* makeArxivService
    const papers = yield* service.search("graph neural", { max: 2, sort: "date" })

    // Test: should search parse arXiv entries while not keeping version suffixes
    // Scope: arXiv search XML is transformed into SDK search results without live network in the unit boundary.
    // Assertion: entry metadata is parsed, version suffix is removed, source URL is canonical, and requested sort/max reach the client.
    expect({ papers, requestedUrls }).toMatchObject({
      papers: [{
        id: "2401.00001",
        title: "Example Paper",
        authors: ["Alice", "Bob"],
        abstract: "Summary text",
        source: "arxiv",
        url: "https://arxiv.org/abs/2401.00001",
        year: 2024,
      }],
      requestedUrls: ["http://export.arxiv.org/api/query?search_query=all:graph%20neural&max_results=2&sortBy=submittedDate"],
    })
  }).pipe(Effect.provide(testLayer({ searchXml: arxivSearchXml }))))

  it.effect("should get return cached markdown while not calling remote services", () => Effect.gen(function* () {
    const service = yield* makeArxivService
    const markdown = yield* service.get("2401.00001")

    // Test: should get return cached markdown while not calling remote services
    // Scope: cache hits are the fast path and should avoid flaky HTTP and parser dependencies.
    // Assertion: cached markdown is returned and no HTTP request is made.
    expect({ markdown, requestedUrls }).toEqual({ markdown: "# Cached", requestedUrls: [] })
  }).pipe(Effect.provide(testLayer({ cachedMarkdown: "# Cached" }))))

  it.effect("should get fetch and cache markdown while not swallowing TLDR absence", () => Effect.gen(function* () {
    const service = yield* makeArxivService
    const markdown = yield* service.get("2401.00001", { noCache: true })

    // Test: should get fetch and cache markdown while not swallowing TLDR absence
    // Scope: cache misses compose metadata, ar5iv HTML, optional S2 TLDR, parser markdown, and cache write.
    // Assertion: generated markdown includes fetched metadata/body and cache receives the same value with undefined TLDR.
    expect({ markdown, cachedWrites }).toEqual({
      markdown: "# Example Paper\n\n**Authors:** Alice, Bob\n**arXiv:** https://arxiv.org/abs/2401.00001\n\n---\n\nBody markdown",
      cachedWrites: [{
        id: "2401.00001",
        markdown: "# Example Paper\n\n**Authors:** Alice, Bob\n**arXiv:** https://arxiv.org/abs/2401.00001\n\n---\n\nBody markdown",
      }],
    })
  }).pipe(Effect.provide(testLayer({ metaXml: arxivSearchXml, html: "<article>body</article>", tldrJson: {} }))))

  it.effect("should get report ar5iv not found while not caching missing papers", () => Effect.gen(function* () {
    const service = yield* makeArxivService
    const result = yield* Effect.result(service.get("missing", { noCache: true }))

    // Test: should get report ar5iv not found while not caching missing papers
    // Scope: a 404 from ar5iv is a domain not-found condition and should not create cache entries.
    // Assertion: the effect fails with ArxivNotFoundError and cache writes remain empty.
    expect({ failure: result._tag === "Failure" ? result.failure : undefined, cachedWrites }).toEqual({
      failure: new ArxivNotFoundError({ id: "missing" }),
      cachedWrites: [],
    })
  }).pipe(Effect.provide(testLayer({ metaXml: arxivSearchXml, htmlStatus: 404 }))))
})

const requestedUrls: Array<string> = []
const cachedWrites: Array<{ readonly id: string; readonly markdown: string }> = []

const arxivSearchXml = `
  <feed>
    <entry>
      <id>http://arxiv.org/abs/2401.00001v2</id>
      <title> Example Paper </title>
      <name>Alice</name>
      <name>Bob</name>
      <summary> Summary text </summary>
      <published>2024-01-02T00:00:00Z</published>
    </entry>
  </feed>
`

const testLayer = (fixture: {
  readonly cachedMarkdown?: string
  readonly searchXml?: string
  readonly metaXml?: string
  readonly html?: string
  readonly htmlStatus?: number
  readonly tldrJson?: unknown
}) => {
  requestedUrls.length = 0
  cachedWrites.length = 0
  return Layer.mergeAll(
    Layer.succeed(CacheService, CacheService.of({
      get: () => Effect.succeed(fixture.cachedMarkdown === undefined
        ? Option.none()
        : Option.some({ markdown: fixture.cachedMarkdown, meta: { id: "cached", title: "Cached", authors: "Cached" } })),
      set: (id, entry) => Effect.sync(() => { cachedWrites.push({ id, markdown: entry.markdown }) }),
      list: () => Effect.succeed([]),
      clear: () => Effect.void,
    })),
    Layer.succeed(ParserService, ParserService.of({
      htmlToMarkdown: () => Effect.succeed("Body markdown"),
      extractArxivXml: (xml) => ({
        title: xml.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.replace(/\s+/g, " ").trim() ?? "Unknown Title",
        authors: [...xml.matchAll(/<name>(.*?)<\/name>/g)].map((match) => match[1]).join(", "),
        abstract: xml.match(/<summary>([\s\S]*?)<\/summary>/)?.[1]?.replace(/\s+/g, " ").trim() ?? "",
      }),
      buildMarkdown: (params) => [
        `# ${params.title}`,
        "",
        `**Authors:** ${params.authors}`,
        `**arXiv:** ${params.url}`,
        params.tldr === undefined ? undefined : `**TLDR:** ${params.tldr}`,
        "",
        "---",
        "",
        params.body,
      ].filter((line) => line !== undefined).join("\n"),
    })),
    Layer.succeed(HttpClient.HttpClient, HttpClient.make((request) => Effect.sync(() => {
      const url = request.url.toString()
      requestedUrls.push(url)
      if (url.includes("id_list=")) return response(request, fixture.metaXml ?? arxivSearchXml)
      if (url.includes("ar5iv")) return response(request, fixture.html ?? "", fixture.htmlStatus ?? 200)
      if (url.includes("semanticscholar")) return response(request, JSON.stringify(fixture.tldrJson ?? {}))
      return response(request, fixture.searchXml ?? "<feed />")
    }))),
  )
}

const response = (request: Parameters<Parameters<typeof HttpClient.make>[0]>[0], body: string, status = 200) =>
  HttpClientResponse.fromWeb(request, new Response(body, { status }))
