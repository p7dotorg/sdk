import { Schema } from "effect"
import { SearchResult } from "../Domain/Paper.ts"

export class PubMedArticle extends Schema.Class<PubMedArticle>("PubMedArticle")({
  id: Schema.String,
  title: Schema.String,
  authors: Schema.Array(Schema.String),
  published: Schema.String,
  abstract: Schema.String,
  journal: Schema.optional(Schema.String),
  doi: Schema.optional(Schema.String),
}) {}

export class PubMedSearch extends Schema.Class<PubMedSearch>("PubMedSearch")({
  total: Schema.Number,
  papers: Schema.Array(SearchResult),
  warnings: Schema.Array(Schema.String),
}) {}
