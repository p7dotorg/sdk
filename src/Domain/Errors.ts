import { Data } from "effect"

export class ArxivNotFoundError extends Data.TaggedError("ArxivNotFoundError")<{
  id: string
}> {
  override get message() { return `Paper ${this.id} not found on ar5iv (may be too recent)` }
}

export class ArxivFetchError extends Data.TaggedError("ArxivFetchError")<{
  id: string
  status: number
}> {
  override get message() { return `Failed to fetch paper ${this.id} (HTTP ${this.status})` }
}

export class PubMedNotFoundError extends Data.TaggedError("PubMedNotFoundError")<{
  id: string
}> {
  override get message() { return `PubMed paper ${this.id} not found` }
}

export class PubMedFetchError extends Data.TaggedError("PubMedFetchError")<{
  id: string
  cause?: unknown
}> {
  override get message() { return `Failed to fetch PubMed paper ${this.id}` }
}

export class S2FetchError extends Data.TaggedError("S2FetchError")<{
  id: string
  cause?: unknown
}> {
  override get message() { return `Semantic Scholar fetch failed for ${this.id}` }
}

export class ParseError extends Data.TaggedError("ParseError")<{
  id: string
  detail?: string
}> {
  override get message() { return `Failed to parse paper ${this.id}${this.detail ? `: ${this.detail}` : ""}` }
}

export class CacheReadError extends Data.TaggedError("CacheReadError")<{
  path: string
  cause?: unknown
}> {
  override get message() { return `Failed to read cache at ${this.path}` }
}

export class CacheWriteError extends Data.TaggedError("CacheWriteError")<{
  path: string
  cause?: unknown
}> {
  override get message() { return `Failed to write cache at ${this.path}` }
}

export type Paper7Error =
  | ArxivNotFoundError
  | ArxivFetchError
  | PubMedNotFoundError
  | PubMedFetchError
  | S2FetchError
  | ParseError
  | CacheReadError
  | CacheWriteError
