import { Context, Effect, Layer, Result, Schema } from "effect"
import { HttpClient, FetchHttpClient } from "effect/unstable/http"
import { PubMedFetchError, PubMedNotFoundError } from "../Domain/Errors.ts"
import type { Paper7Error } from "../Domain/Errors.ts"
import type { SearchOptions } from "../Domain/Paper.ts"
import { SearchResult } from "../Domain/Paper.ts"
import { PaperSourceAdapter, PaperSourceContent } from "./PaperSourceAdapter.ts"
import { PubMedArticle, PubMedSearch } from "./PubMedTypes.ts"
import { cleanText, normalizeDate, parseArticleXml, yearFromDate } from "./PubMedXml.ts"

const PUBMED_SEARCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
const PUBMED_SUMMARY_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi"
const PUBMED_FETCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"

// ---------------------------------------------------------------------------
// Service shape
// ---------------------------------------------------------------------------

export interface PubMedServiceShape {
  readonly search: (query: string, opts?: SearchOptions) => Effect.Effect<ReadonlyArray<SearchResult>, Paper7Error>
  readonly searchDetailed: (query: string, opts?: SearchOptions) => Effect.Effect<PubMedSearch, Paper7Error>
  readonly get: (id: string) => Effect.Effect<PubMedArticle, Paper7Error>
}

export class PubMedService extends Context.Service<PubMedService, PubMedServiceShape>()(
  "p7/PubMedService"
) {}

export const formatPubMedArticle = (article: PubMedArticle): string => {
  const lines = [
    `# ${article.title}`,
    "",
    `**Authors:** ${article.authors.join(", ")}`,
    `**Published:** ${article.published}`,
    article.journal ? `**Journal:** ${article.journal}` : undefined,
    article.doi ? `**DOI:** https://doi.org/${article.doi}` : undefined,
    `**PubMed:** https://pubmed.ncbi.nlm.nih.gov/${article.id.replace("pmid:", "")}/`,
    "",
    "## Abstract",
    "",
    article.abstract,
  ].filter((line) => line !== undefined)

  return lines.join("\n")
}

// ---------------------------------------------------------------------------
// JSON schemas — parse at the boundary
// ---------------------------------------------------------------------------

const SearchResponseSchema = Schema.Struct({
  esearchresult: Schema.Struct({
    count: Schema.String,
    idlist: Schema.Array(Schema.String),
  }),
})

const SummaryEntrySchema = Schema.Struct({
  title: Schema.String,
  pubdate: Schema.String,
  authors: Schema.Array(Schema.Struct({ name: Schema.String })),
})

const SummaryResponseSchema = Schema.Struct({
  result: Schema.Record(Schema.String, Schema.Unknown),
})

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export const makePubMedService = Effect.gen(function* () {
  const http = yield* HttpClient.HttpClient

  const searchDetailed = (query: string, opts: SearchOptions = {}) =>
    Effect.gen(function* () {
      const max = opts.max ?? 10
      const sort = opts.sort === "date" ? "pub date" : "relevance"

      const searchUrl = new URL(PUBMED_SEARCH_URL)
      searchUrl.searchParams.set("db", "pubmed")
      searchUrl.searchParams.set("retmode", "json")
      searchUrl.searchParams.set("term", query)
      searchUrl.searchParams.set("retmax", String(max))
      searchUrl.searchParams.set("sort", sort)

      const searchJson = yield* http.get(searchUrl.toString()).pipe(
        Effect.flatMap((r) => r.json),
        Effect.mapError(() => new PubMedFetchError({ id: "search" }))
      )

      const { esearchresult } = yield* Effect.try({
        try: () => Schema.decodeUnknownSync(SearchResponseSchema)(searchJson),
        catch: () => new PubMedFetchError({ id: "search", cause: "invalid search response" }),
      })

      const total = Number(esearchresult.count)
      if (!Number.isSafeInteger(total) || total < 0) {
        return yield* new PubMedFetchError({ id: "search", cause: "invalid search count" })
      }

      const ids = esearchresult.idlist

      if (ids.length === 0) return new PubMedSearch({ total, papers: [], warnings: [] })

      const summaryUrl = new URL(PUBMED_SUMMARY_URL)
      summaryUrl.searchParams.set("db", "pubmed")
      summaryUrl.searchParams.set("retmode", "json")
      summaryUrl.searchParams.set("id", ids.join(","))

      const summaryJson = yield* http.get(summaryUrl.toString()).pipe(
        Effect.flatMap((r) => r.json),
        Effect.mapError(() => new PubMedFetchError({ id: "search" }))
      )

      const { result } = yield* Effect.try({
        try: () => Schema.decodeUnknownSync(SummaryResponseSchema)(summaryJson),
        catch: () => new PubMedFetchError({ id: "search", cause: "invalid summary response" }),
      })

      const decodeSummaryEntry = Schema.decodeUnknownResult(SummaryEntrySchema)
      const entries = yield* Effect.forEach(ids, (id) => Effect.gen(function* () {
        const parsed = decodeSummaryEntry(result[id])
        if (Result.isFailure(parsed)) {
          return { _tag: "warning" as const, message: "PubMed partial failure: skipped malformed result" }
        }
        const record = parsed.success
        const title = yield* cleanText(record.title)
        const published = yield* normalizeDate(record.pubdate)
        const authors = yield* Effect.forEach(
          record.authors,
          (author) => cleanText(author.name),
          { concurrency: 10 },
        ).pipe(Effect.map((names) => names.flatMap((name) => name === undefined ? [] : [name])))
        if (title === undefined || published === undefined || authors.length === 0) {
          return { _tag: "warning" as const, message: "PubMed partial failure: skipped malformed result" }
        }

        const year = yield* yearFromDate(published)
        return {
          _tag: "paper" as const,
          paper: new SearchResult({
            id: `pmid:${id}`,
            title,
            authors,
            abstract: "",
            source: "pubmed",
            url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
            year,
          }),
        }
      }), { concurrency: 10 })

      const papers = entries.flatMap((entry) => entry._tag === "paper" ? [entry.paper] : [])
      const warnings = entries.flatMap((entry) => entry._tag === "warning" ? [entry.message] : [])

      return new PubMedSearch({ total, papers, warnings })
    })

  const search = (query: string, opts: SearchOptions = {}) =>
    searchDetailed(query, opts).pipe(Effect.map((result) => result.papers))

  const get = (id: string) =>
    Effect.gen(function* () {
      const fetchUrl = new URL(PUBMED_FETCH_URL)
      fetchUrl.searchParams.set("db", "pubmed")
      fetchUrl.searchParams.set("rettype", "abstract")
      fetchUrl.searchParams.set("retmode", "xml")
      fetchUrl.searchParams.set("id", id)
      fetchUrl.searchParams.set("tool", "paper7")

      const response = yield* http.get(fetchUrl.toString()).pipe(
        Effect.mapError(() => new PubMedFetchError({ id }))
      )

      if (response.status !== 200) {
        return yield* new PubMedFetchError({ id, cause: `HTTP ${response.status}` })
      }

      const xml = yield* response.text.pipe(
        Effect.mapError(() => new PubMedFetchError({ id }))
      )

      return yield* parseArticleXml(id, xml)
    })

  return { search, searchDetailed, get } satisfies PubMedServiceShape
})

export const PubMedServiceLive = Layer.effect(PubMedService)(makePubMedService).pipe(
  Layer.provide(FetchHttpClient.layer)
)

export const PubMedPaperSourceServiceLive = Layer.effect(PaperSourceAdapter)(Effect.gen(function* () {
  const pubmed = yield* PubMedService

  return {
    search: (query: string, opts?: SearchOptions) => pubmed.search(query, opts),
    get: (id: string) => pubmed.get(id.replace("pmid:", "")).pipe(
      Effect.map((article) => PaperSourceContent.PubMedArticle({ article }))
    ),
    format: PaperSourceContent.$match({
      Markdown: ({ markdown }) => Effect.succeed(markdown),
      PubMedArticle: ({ article }) => Effect.succeed(formatPubMedArticle(article)),
    }),
  }
}))
