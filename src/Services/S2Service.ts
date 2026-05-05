import { Context, Effect, Layer, Schema } from "effect"
import { HttpClient, FetchHttpClient } from "effect/unstable/http"
import { S2FetchError } from "../Domain/Errors.ts"
import { Paper, PaperEdge, PaperGraph, PaperNode } from "../Domain/Paper.ts"

const S2_API = "https://api.semanticscholar.org/graph/v1"
const FIELDS = "title,authors,year,abstract,citationCount,externalIds"

const S2PaperSchema = Schema.Struct({
  paperId: Schema.String,
  title: Schema.NullOr(Schema.String),
  authors: Schema.NullOr(Schema.Array(Schema.Struct({ name: Schema.String }))),
  abstract: Schema.NullOr(Schema.String),
  year: Schema.NullOr(Schema.Number),
  citationCount: Schema.NullOr(Schema.Number),
  externalIds: Schema.NullOr(Schema.Struct({ ArXiv: Schema.optional(Schema.String) })),
})
type S2Paper = typeof S2PaperSchema.Type

const S2RefsResponseSchema = Schema.Struct({
  data: Schema.optional(Schema.Array(Schema.Struct({ citedPaper: S2PaperSchema }))),
})

const S2CitationsResponseSchema = Schema.Struct({
  data: Schema.optional(Schema.Array(Schema.Struct({ citingPaper: S2PaperSchema }))),
})




export function s2ToPaper(s2: S2Paper, arxivId: string): Paper {
  return new Paper({
    id: arxivId,
    title: s2.title ?? "Unknown",
    authors: (s2.authors ?? []).map((a) => a.name),
    abstract: s2.abstract ?? "",
    source: "arxiv",
    url: `https://arxiv.org/abs/${arxivId}`,
    year: s2.year ?? undefined,
    citationCount: s2.citationCount ?? undefined,
  })
}

export function computeRelevance(paper: S2Paper, maxCitations: number, depth: number): number {
  const citationScore = maxCitations > 0 ? (paper.citationCount ?? 0) / maxCitations : 0
  const depthPenalty = 1 / depth
  return Math.min(1, citationScore * 0.7 + depthPenalty * 0.3)
}

export interface S2ServiceShape {
  readonly buildGraph: (seedArxivId: string, depth?: number) => Effect.Effect<PaperGraph, S2FetchError>
  readonly refs: (arxivId: string) => Effect.Effect<ReadonlyArray<Paper>, S2FetchError>
}

export class S2Service extends Context.Service<S2Service, S2ServiceShape>()(
  "p7/S2Service"
) {}

export const makeS2Service = Effect.gen(function* () {
  const http = yield* HttpClient.HttpClient

  const fetchPaper = (arxivId: string) =>
    http.get(`${S2_API}/paper/arXiv:${arxivId}?fields=${FIELDS}`).pipe(
      Effect.flatMap((r) => r.json),
      Effect.mapError(() => new S2FetchError({ id: arxivId })),
      Effect.flatMap((json) =>
        Effect.try({
          try: () => Schema.decodeUnknownSync(S2PaperSchema)(json),
          catch: () => new S2FetchError({ id: arxivId, cause: "invalid S2 paper JSON" }),
        })
      ),
    )

  const fetchRefs = (arxivId: string) =>
    http.get(`${S2_API}/paper/arXiv:${arxivId}/references?fields=${FIELDS}&limit=50`).pipe(
      Effect.flatMap((r) => r.json),
      Effect.mapError(() => new S2FetchError({ id: arxivId })),
      Effect.flatMap((json) =>
        Effect.try({
          try: () => Schema.decodeUnknownSync(S2RefsResponseSchema)(json),
          catch: () => new S2FetchError({ id: arxivId, cause: "invalid S2 refs JSON" }),
        })
      ),
      Effect.map((parsed) => parsed.data ?? []),
    )

  const fetchCitations = (arxivId: string) =>
    http.get(`${S2_API}/paper/arXiv:${arxivId}/citations?fields=${FIELDS}&limit=50`).pipe(
      Effect.flatMap((r) => r.json),
      Effect.mapError(() => new S2FetchError({ id: arxivId })),
      Effect.flatMap((json) =>
        Effect.try({
          try: () => Schema.decodeUnknownSync(S2CitationsResponseSchema)(json),
          catch: () => new S2FetchError({ id: arxivId, cause: "invalid S2 citations JSON" }),
        })
      ),
      Effect.map((parsed) => parsed.data ?? []),
    )

  const buildGraph = (seedArxivId: string, _depth = 1) =>
    Effect.gen(function* () {
      // Sequential to avoid S2 rate limits (1 req/sec unauthenticated)
      const refsData = yield* fetchRefs(seedArxivId)
      const citationsData = yield* fetchCitations(seedArxivId)
      const seed = yield* fetchPaper(seedArxivId).pipe(
        Effect.orElseSucceed((): S2Paper => ({
          paperId: seedArxivId,
          title: refsData[0]?.citedPaper?.title ?? seedArxivId,
          authors: null,
          abstract: null,
          year: null,
          citationCount: null,
          externalIds: null,
        }))
      )

      const seedPaper = s2ToPaper(seed, seedArxivId)
      const nodes: PaperNode[] = []
      const edges: PaperEdge[] = []

      const allCitations = [
        ...refsData.map((r: { citedPaper: S2Paper }) => r.citedPaper.citationCount ?? 0),
        ...citationsData.map((c: { citingPaper: S2Paper }) => c.citingPaper.citationCount ?? 0),
      ]
      const maxCitations = Math.max(1, ...allCitations)

      for (const { citedPaper } of refsData) {
        const refArxivId = citedPaper.externalIds?.ArXiv
        if (!refArxivId) continue
        nodes.push(new PaperNode({
          paper: s2ToPaper(citedPaper, refArxivId),
          depth: 1,
          relevance: computeRelevance(citedPaper, maxCitations, 1),
        }))
        edges.push(new PaperEdge({ from: seedArxivId, to: refArxivId, type: "cites" }))
      }

      for (const { citingPaper } of citationsData) {
        const citeArxivId = citingPaper.externalIds?.ArXiv
        if (!citeArxivId) continue
        nodes.push(new PaperNode({
          paper: s2ToPaper(citingPaper, citeArxivId),
          depth: 1,
          relevance: computeRelevance(citingPaper, maxCitations, 1),
        }))
        edges.push(new PaperEdge({ from: citeArxivId, to: seedArxivId, type: "cited_by" }))
      }

      return new PaperGraph({ seed: seedPaper, nodes, edges })
    })

  const refs = (arxivId: string) =>
    fetchRefs(arxivId).pipe(
      Effect.map((data: ReadonlyArray<{ citedPaper: S2Paper }>) =>
        data
          .filter((r) => r.citedPaper.externalIds?.ArXiv)
          .map((r) => s2ToPaper(r.citedPaper, r.citedPaper.externalIds!.ArXiv!))
      )
    )

  return { buildGraph, refs } satisfies S2ServiceShape
})

export const S2ServiceLive = Layer.effect(S2Service)(makeS2Service).pipe(
  Layer.provide(FetchHttpClient.layer)
)
