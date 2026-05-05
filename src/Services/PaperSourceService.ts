import { Context, Effect, Layer, Match } from "effect"
import { PubMedFetchError } from "../Domain/Errors.ts"
import type { Paper7Error } from "../Domain/Errors.ts"
import type { GetOptions, SearchOptions } from "../Domain/Paper.ts"
import { SearchResult } from "../Domain/Paper.ts"
import { ArxivPaperSourceServiceLive, ArxivServiceLive } from "./ArxivService.ts"
import { PaperSourceAdapter, PaperSourceContent } from "./PaperSourceAdapter.ts"
import { PubMedPaperSourceServiceLive, PubMedServiceLive } from "./PubMedService.ts"

export interface PaperSourceServiceShape {
  readonly search: (query: string, opts?: SearchOptions) => Effect.Effect<ReadonlyArray<SearchResult>, Paper7Error>
  readonly get: (id: string, opts?: GetOptions) => Effect.Effect<string, Paper7Error>
}

export class PaperSourceService extends Context.Service<PaperSourceService, PaperSourceServiceShape>()(
  "p7/PaperSourceService"
) {}

const make = Effect.gen(function* () {
  const arxivLayer = yield* Layer.build(ArxivPaperSourceServiceLive)
  const pubmedLayer = yield* Layer.build(PubMedPaperSourceServiceLive)

  const searchSource = (query: string, opts?: SearchOptions) =>
    Effect.gen(function* () {
      const source = yield* PaperSourceAdapter
      return yield* source.search(query, opts)
    })

  const getSource = (id: string, opts?: GetOptions) =>
    Effect.gen(function* () {
      const source = yield* PaperSourceAdapter
      const content = yield* source.get(id, opts)
      return yield* (source.format ?? ((value: PaperSourceContent) =>
        PaperSourceContent.$match({
          Markdown: ({ markdown }) => Effect.succeed(markdown),
          PubMedArticle: () => Effect.fail(new PubMedFetchError({ id, cause: "missing formatter" })),
        })(value)))(content)
    })

  const searchAll = (query: string, opts?: SearchOptions) =>
    Effect.all(
      [searchSource(query, opts).pipe(Effect.provide(arxivLayer)),
        searchSource(query, opts).pipe(Effect.provide(pubmedLayer))],
      { concurrency: 2 }
    ).pipe(Effect.map(([arxiv, pubmed]) => [...arxiv, ...pubmed]))

  return {
    search: (query: string, opts?: SearchOptions) =>
      Match.value(opts?.source).pipe(
        Match.when("arxiv", () => searchSource(query, opts).pipe(Effect.provide(arxivLayer))),
        Match.when("pubmed", () => searchSource(query, opts).pipe(Effect.provide(pubmedLayer))),
        Match.orElse(() => searchAll(query, opts))
      ),
    get: (id: string, opts?: GetOptions) =>
      Match.value(id).pipe(
        Match.when((value) => value.startsWith("pmid:"), () =>
          getSource(id, opts).pipe(Effect.provide(pubmedLayer))),
        Match.orElse(() => getSource(id, opts).pipe(Effect.provide(arxivLayer)))
      ),
  } satisfies PaperSourceServiceShape
})

export const PaperSourceServiceLive = Layer.effect(PaperSourceService)(make).pipe(
  Layer.provide(Layer.mergeAll(ArxivServiceLive, PubMedServiceLive))
)
