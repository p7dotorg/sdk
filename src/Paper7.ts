import { Context, Effect, Layer } from "effect"
import type { GetOptions, SearchOptions } from "./Domain/Paper.ts"
import { ArxivService, ArxivServiceLive } from "./Services/ArxivService.ts"
import { CacheService, CacheServiceLive } from "./Services/CacheService.ts"
import { S2Service, S2ServiceLive } from "./Services/S2Service.ts"

export interface Paper7Shape {
  readonly search: (query: string, opts?: SearchOptions) => Effect.Effect<any, any>
  readonly get: (id: string, opts?: GetOptions) => Effect.Effect<string, any>
  readonly refs: (id: string) => Effect.Effect<any, any>
  readonly graph: (seedId: string, depth?: number) => Effect.Effect<any, any>
  readonly list: () => Effect.Effect<any, any>
  readonly cache: { readonly clear: (id?: string) => Effect.Effect<void, any> }
}

export class Paper7 extends Context.Service<Paper7, Paper7Shape>()(
  "p7/Paper7"
) {}

const make = Effect.gen(function* () {
  const arxiv = yield* ArxivService
  const s2 = yield* S2Service
  const cache = yield* CacheService

  return {
    search: (query: string, opts?: SearchOptions) => arxiv.search(query, opts),
    get: (id: string, opts?: GetOptions) => arxiv.get(id, opts),
    refs: (id: string) => s2.refs(id),
    graph: (seedId: string, depth?: number) => s2.buildGraph(seedId, depth),
    list: () => cache.list(),
    cache: {
      clear: (id?: string) => cache.clear(id),
    },
  } satisfies Paper7Shape
})

export const Paper7Live = Layer.effect(Paper7)(make).pipe(
  Layer.provide(ArxivServiceLive),
  Layer.provide(S2ServiceLive),
  Layer.provide(CacheServiceLive),
)
