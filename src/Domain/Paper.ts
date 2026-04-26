import { Schema } from "effect"

export const PaperSource = Schema.Literals(["arxiv", "pubmed", "doi", "biorxiv", "medrxiv"])
export type PaperSource = typeof PaperSource.Type

export class Paper extends Schema.Class<Paper>("Paper")({
  id: Schema.String,
  title: Schema.String,
  authors: Schema.Array(Schema.String),
  abstract: Schema.String,
  source: PaperSource,
  url: Schema.String,
  tldr: Schema.optional(Schema.String),
  year: Schema.optional(Schema.Number),
  citationCount: Schema.optional(Schema.Number),
}) {}

export class SearchResult extends Schema.Class<SearchResult>("SearchResult")({
  id: Schema.String,
  title: Schema.String,
  authors: Schema.Array(Schema.String),
  abstract: Schema.String,
  source: PaperSource,
  url: Schema.String,
  year: Schema.optional(Schema.Number),
}) {}

export class PaperNode extends Schema.Class<PaperNode>("PaperNode")({
  paper: Paper,
  depth: Schema.Number,
  relevance: Schema.Number,
}) {}

export class PaperEdge extends Schema.Class<PaperEdge>("PaperEdge")({
  from: Schema.String,
  to: Schema.String,
  type: Schema.Union([Schema.Literal("cites"), Schema.Literal("cited_by")]),
}) {}

export class PaperGraph extends Schema.Class<PaperGraph>("PaperGraph")({
  seed: Paper,
  nodes: Schema.Array(PaperNode),
  edges: Schema.Array(PaperEdge),
}) {}

export interface SearchOptions {
  source?: "arxiv" | "pubmed"
  max?: number
  sort?: "relevance" | "date"
}

export interface GetOptions {
  detailed?: boolean
  noRefs?: boolean
  noCache?: boolean
  range?: string
}
