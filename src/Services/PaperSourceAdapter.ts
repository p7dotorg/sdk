import { Context, Data, Effect } from "effect"
import type { Paper7Error } from "../Domain/Errors.ts"
import type { GetOptions, SearchOptions } from "../Domain/Paper.ts"
import { SearchResult } from "../Domain/Paper.ts"
import type { PubMedArticle } from "./PubMedTypes.ts"

export type PaperSourceContent = Data.TaggedEnum<{
  Markdown: { readonly markdown: string }
  PubMedArticle: { readonly article: PubMedArticle }
}>

export const PaperSourceContent = Data.taggedEnum<PaperSourceContent>()

export interface PaperSourceAdapterShape {
  readonly search: (query: string, opts?: SearchOptions) => Effect.Effect<ReadonlyArray<SearchResult>, Paper7Error>
  readonly get: (id: string, opts?: GetOptions) => Effect.Effect<PaperSourceContent, Paper7Error>
  readonly format?: (content: PaperSourceContent) => Effect.Effect<string, Paper7Error>
}

export class PaperSourceAdapter extends Context.Service<PaperSourceAdapter, PaperSourceAdapterShape>()(
  "p7/PaperSourceAdapter"
) {}
