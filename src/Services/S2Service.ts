import { Context, Effect, Layer } from "effect"
import { HttpClient, FetchHttpClient } from "effect/unstable/http"
import { S2FetchError } from "../Domain/Errors.ts"
import { Paper, PaperEdge, PaperGraph, PaperNode } from "../Domain/Paper.ts"

const S2_API = "https://api.semanticscholar.org/graph/v1"
const FIELDS = "title,authors,year,abstract,citationCount,externalIds"

interface S2Paper {
  paperId: string
  title: string
  authors?: Array<{ name: string }>
  abstract?: string
  year?: number
  citationCount?: number
  externalIds?: { ArXiv?: string }
}

function s2ToPaper(s2: S2Paper, arxivId: string): Paper {
  return new Paper({
    id: arxivId,
    title: s2.title ?? "Unknown",
    authors: (s2.authors ?? []).map((a) => a.name),
    abstract: s2.abstract ?? "",
    source: "arxiv",
    url: `https://arxiv.org/abs/${arxivId}`,
    year: s2.year,
    citationCount: s2.citationCount,
  })
}

function computeRelevance(paper: S2Paper, maxCitations: number, depth: number): number {
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

const make = Effect.gen(function* () {
  const http = yield* HttpClient.HttpClient

  const fetchPaper = (arxivId: string) =>
    http.get(`${S2_API}/paper/arXiv:${arxivId}?fields=${FIELDS}`).pipe(
      Effect.flatMap((r) => r.json),
      Effect.mapError(() => new S2FetchError({ id: arxivId })),
      Effect.map((data: any) => data as S2Paper)
    )

  const fetchRefs = (arxivId: string) =>
    http.get(`${S2_API}/paper/arXiv:${arxivId}/references?fields=${FIELDS}&limit=50`).pipe(
      Effect.flatMap((r) => r.json),
      Effect.mapError(() => new S2FetchError({ id: arxivId })),
      Effect.map((data: any) => (data?.data ?? []) as Array<{ citedPaper: S2Paper }>)
    )

  const fetchCitations = (arxivId: string) =>
    http.get(`${S2_API}/paper/arXiv:${arxivId}/citations?fields=${FIELDS}&limit=50`).pipe(
      Effect.flatMap((r) => r.json),
      Effect.mapError(() => new S2FetchError({ id: arxivId })),
      Effect.map((data: any) => (data?.data ?? []) as Array<{ citingPaper: S2Paper }>)
    )

  const buildGraph = (seedArxivId: string, _depth = 1) =>
    Effect.gen(function* () {
      const [seed, refsData, citationsData] = yield* Effect.all(
        [fetchPaper(seedArxivId), fetchRefs(seedArxivId), fetchCitations(seedArxivId)],
        { concurrency: 3 }
      )

      const seedPaper = s2ToPaper(seed, seedArxivId)
      const nodes: PaperNode[] = []
      const edges: PaperEdge[] = []

      const allCitations = [
        ...refsData.map((r) => r.citedPaper.citationCount ?? 0),
        ...citationsData.map((c) => c.citingPaper.citationCount ?? 0),
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
      Effect.map((data) =>
        data
          .filter((r) => r.citedPaper.externalIds?.ArXiv)
          .map((r) => s2ToPaper(r.citedPaper, r.citedPaper.externalIds!.ArXiv!))
      )
    )

  return { buildGraph, refs } satisfies S2ServiceShape
})

export const S2ServiceLive = Layer.effect(S2Service)(make).pipe(
  Layer.provide(FetchHttpClient.layer)
)
