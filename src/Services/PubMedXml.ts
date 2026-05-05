import { Effect } from "effect"
import { PubMedFetchError, PubMedNotFoundError } from "../Domain/Errors.ts"
import { PubMedArticle } from "./PubMedTypes.ts"

export const parseArticleXml = Effect.fnUntraced(function* (id: string, xml: string) {
  const article = yield* firstBlock(xml, "PubmedArticle")
  if (article === undefined) {
    return yield* new PubMedNotFoundError({ id })
  }

  const title = yield* firstTag(article, "ArticleTitle").pipe(
    Effect.flatMap(stripTags),
    Effect.flatMap(decodeEntities),
    Effect.flatMap(cleanText),
  )
  const authors = yield* authorsFromXml(article)
  const published = yield* dateFromXml(article)
  const abstract = yield* abstractFromXml(article)
  if (title === undefined || authors.length === 0 || published === undefined) {
    return yield* new PubMedFetchError({ id, cause: "invalid paper XML" })
  }

  const journal = yield* firstBlock(article, "Journal").pipe(
    Effect.flatMap((journalXml) => firstBlock(journalXml ?? "", "Title")),
    Effect.flatMap((title) => title === undefined ? firstTag(article, "ISOAbbreviation") : Effect.succeed(title)),
    Effect.flatMap(stripTags),
    Effect.flatMap(decodeEntities),
    Effect.flatMap(cleanText),
  )
  const doi = yield* firstArticleId(article, "doi").pipe(
    Effect.flatMap((id) => id === undefined ? firstELocationId(article, "doi") : Effect.succeed(id)),
    Effect.flatMap(stripTags),
    Effect.flatMap(cleanText),
  )

  return new PubMedArticle({
    id: `pmid:${id}`,
    title,
    authors: [...authors],
    published,
    abstract: abstract ?? "",
    journal,
    doi,
  })
})

export const cleanText = Effect.fnUntraced(function* (input: string | undefined) {
  if (input === undefined) return undefined
  const cleaned = input.replace(/\s+/g, " ").trim()
  return cleaned === "" ? undefined : cleaned
})

export const normalizeDate = Effect.fnUntraced(function* (input: string | undefined) {
  const text = yield* cleanText(input)
  if (text === undefined) return undefined
  const year = /^\d{4}/.exec(text)
  return year === null ? text : year[0]
})

export const yearFromDate = Effect.fnUntraced(function* (date: string | undefined) {
  if (date === undefined) return undefined
  const match = /^\d{4}/.exec(date)
  return match === null ? undefined : Number(match[0])
})

const firstBlock = Effect.fnUntraced(function* (xml: string, tag: string) {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(xml)
  return match?.[1]
})

const firstTag = Effect.fnUntraced(function* (xml: string, tag: string) {
  return yield* firstBlock(xml, tag)
})

const tagBlocks = Effect.fnUntraced(function* (xml: string, tag: string) {
  const matches: Array<string> = []
  const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "g")
  let match = pattern.exec(xml)
  while (match !== null) {
    const block = match[1]
    if (block !== undefined) matches.push(block)
    match = pattern.exec(xml)
  }
  return matches
})

const authorsFromXml = Effect.fnUntraced(function* (xml: string) {
  const authors: Array<string> = []
  for (const author of yield* tagBlocks(xml, "Author")) {
    const last = yield* firstTag(author, "LastName").pipe(Effect.flatMap(stripTags), Effect.flatMap(cleanText))
    const initials = yield* firstTag(author, "Initials").pipe(Effect.flatMap(stripTags), Effect.flatMap(cleanText))
    const collective = yield* firstTag(author, "CollectiveName").pipe(Effect.flatMap(stripTags), Effect.flatMap(cleanText))
    if (last !== undefined) authors.push(initials === undefined ? last : `${last} ${initials}`)
    else if (collective !== undefined) authors.push(collective)
  }
  return authors
})

const dateFromXml = Effect.fnUntraced(function* (xml: string) {
  const pubDate = yield* firstBlock(xml, "PubDate")
  if (pubDate === undefined) return undefined
  const year = yield* firstTag(pubDate, "Year").pipe(Effect.flatMap(stripTags), Effect.flatMap(cleanText))
  const month = yield* firstTag(pubDate, "Month").pipe(Effect.flatMap(stripTags), Effect.flatMap(cleanText))
  const day = yield* firstTag(pubDate, "Day").pipe(Effect.flatMap(stripTags), Effect.flatMap(cleanText))
  const medline = yield* firstTag(pubDate, "MedlineDate").pipe(Effect.flatMap(stripTags), Effect.flatMap(cleanText))
  if (year === undefined) return medline
  return [year, month, day].filter((part) => part !== undefined).join(" ")
})

const abstractFromXml = Effect.fnUntraced(function* (xml: string) {
  const parts: Array<string> = []
  const pattern = /<AbstractText([^>]*)>([\s\S]*?)<\/AbstractText>/g
  let match = pattern.exec(xml)
  while (match !== null) {
    const attrs = match[1] ?? ""
    const text = yield* stripTags(match[2]).pipe(Effect.flatMap(decodeEntities), Effect.flatMap(cleanText))
    const label = yield* labelFromAttrs(attrs)
    if (text !== undefined) parts.push(label === undefined ? text : `**${label}.** ${text}`)
    match = pattern.exec(xml)
  }
  return parts.length === 0 ? undefined : parts.join("\n\n")
})

const labelFromAttrs = Effect.fnUntraced(function* (attrs: string) {
  const match = /\sLabel="([^"]+)"/.exec(attrs)
  return yield* decodeEntities(match?.[1]).pipe(Effect.flatMap(cleanText))
})

const firstArticleId = Effect.fnUntraced(function* (xml: string, idType: string) {
  const pattern = new RegExp(`<ArticleId[^>]*IdType="${idType}"[^>]*>([\\s\\S]*?)</ArticleId>`)
  return pattern.exec(xml)?.[1]
})

const firstELocationId = Effect.fnUntraced(function* (xml: string, idType: string) {
  const pattern = new RegExp(`<ELocationID[^>]*EIdType="${idType}"[^>]*>([\\s\\S]*?)</ELocationID>`)
  return pattern.exec(xml)?.[1]
})

const stripTags = Effect.fnUntraced(function* (input: string | undefined) {
  return input?.replace(/<[^>]*>/g, "")
})

const decodeEntities = Effect.fnUntraced(function* (input: string | undefined) {
  return input
    ?.replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
})
