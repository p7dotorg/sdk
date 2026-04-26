import { Context, Effect, Layer, Option } from "effect"
import { HttpClient, FetchHttpClient } from "effect/unstable/http"
import { ArxivFetchError, ArxivNotFoundError } from "../Domain/Errors.ts"
import type { GetOptions, SearchOptions } from "../Domain/Paper.ts"
import { SearchResult } from "../Domain/Paper.ts"
import { CacheService, CacheServiceLive } from "./CacheService.ts"
import { ParserService, ParserServiceLive } from "./ParserService.ts"

const ARXIV_API = "http://export.arxiv.org/api/query"
const AR5IV_URL = "https://ar5iv.labs.arxiv.org/html"
const S2_API = "https://api.semanticscholar.org/graph/v1"

export interface ArxivServiceShape {
  readonly search: (query: string, opts?: SearchOptions) => Effect.Effect<ReadonlyArray<SearchResult>, any>
  readonly get: (id: string, opts?: GetOptions) => Effect.Effect<string, any>
}

export class ArxivService extends Context.Service<ArxivService, ArxivServiceShape>()(
  "p7/ArxivService"
) {}

const make = Effect.gen(function* () {
  const http = yield* HttpClient.HttpClient
  const cache = yield* CacheService
  const parser = yield* ParserService

  const fetchTldr = (id: string) =>
    http.get(`${S2_API}/paper/arXiv:${id}?fields=tldr`).pipe(
      Effect.flatMap((r) => r.json),
      Effect.map((data: any) => data?.tldr?.text as string | undefined),
      Effect.option,
      Effect.map((o) => (Option.isSome(o) ? o.value : undefined)),
      Effect.orElseSucceed(() => undefined as string | undefined)
    )

  const search = (query: string, opts: SearchOptions = {}) =>
    Effect.gen(function* () {
      const max = opts.max ?? 10
      const sortBy = opts.sort === "date" ? "submittedDate" : "relevance"
      const url = `${ARXIV_API}?search_query=all:${encodeURIComponent(query)}&max_results=${max}&sortBy=${sortBy}`

      const xml = yield* http.get(url).pipe(
        Effect.flatMap((r) => r.text),
        Effect.mapError(() => new ArxivFetchError({ id: "search", status: 0 }))
      )

      const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)]
      return entries.map((m) => {
        const entry = m[1] ?? ""
        const rawId = entry.match(/<id>(.*?)<\/id>/)?.[1] ?? ""
        const id = rawId.replace("http://arxiv.org/abs/", "").replace(/v\d+$/, "")
        const { title, authors, abstract } = parser.extractArxivXml(entry)
        const year = entry.match(/<published>(\d{4})/)?.[1]

        return new SearchResult({
          id,
          title,
          authors: authors.split(", ").filter(Boolean),
          abstract,
          source: "arxiv",
          url: `https://arxiv.org/abs/${id}`,
          year: year ? Number(year) : undefined,
        })
      })
    })

  const get = (id: string, opts: GetOptions = {}) =>
    Effect.gen(function* () {
      if (!opts.noCache) {
        const cached = yield* cache.get(id)
        if (Option.isSome(cached)) return cached.value.markdown
      }

      const metaXml = yield* http.get(`${ARXIV_API}?id_list=${id}&max_results=1`).pipe(
        Effect.flatMap((r) => r.text),
        Effect.mapError(() => new ArxivFetchError({ id, status: 0 }))
      )

      const { title, authors } = parser.extractArxivXml(metaXml)

      const htmlRes = yield* http.get(`${AR5IV_URL}/${id}`).pipe(
        Effect.mapError(() => new ArxivFetchError({ id, status: 0 }))
      )

      if (htmlRes.status === 404) yield* Effect.fail(new ArxivNotFoundError({ id }))
      if (htmlRes.status !== 200) yield* Effect.fail(new ArxivFetchError({ id, status: htmlRes.status }))

      const html = yield* htmlRes.text.pipe(
        Effect.mapError(() => new ArxivFetchError({ id, status: 200 }))
      )

      const [tldr, body] = yield* Effect.all(
        [fetchTldr(id), parser.htmlToMarkdown(id, html)],
        { concurrency: 2 }
      ).pipe(Effect.mapError(() => new ArxivFetchError({ id, status: 0 })))

      const markdown = parser.buildMarkdown({
        title,
        authors,
        id,
        url: `https://arxiv.org/abs/${id}`,
        tldr,
        body,
      })

      yield* cache.set(id, { markdown, meta: { id, title, authors, tldr } })

      return markdown
    })

  return { search, get }
})

export const ArxivServiceLive = Layer.effect(ArxivService)(make).pipe(
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(CacheServiceLive),
  Layer.provide(ParserServiceLive),
)
