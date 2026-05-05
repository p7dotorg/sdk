import { Effect, Result } from "effect"
import { describe, expect, it } from "@effect/vitest"
import { PubMedFetchError, PubMedNotFoundError } from "../Domain/Errors.ts"
import { cleanText, normalizeDate, parseArticleXml, yearFromDate } from "./PubMedXml.ts"

describe("PubMedXml", () => {
  it.effect("should text normalization preserve known dates while rejecting empty text", () => Effect.gen(function* () {
    const normalizedWhitespace = yield* cleanText("  alpha\n\t beta  ")
    const emptyText = yield* cleanText(" \n\t ")
    const isoDate = yield* normalizeDate(" 2024 Jan 15 ")
    const medlineDate = yield* normalizeDate("Spring 2024")
    const leadingYear = yield* yearFromDate("2023 Feb")
    const missingLeadingYear = yield* yearFromDate("Feb 2023")

    // Test: should text normalization preserve known dates while rejecting empty text
    // Scope: PubMed date and text fields arrive with inconsistent whitespace and date formats.
    // Assertion: meaningful text is compacted, empty text is absent, leading years are parsed, and non-leading years are ignored.
    expect({
      normalizedWhitespace,
      emptyText,
      isoDate,
      medlineDate,
      leadingYear,
      missingLeadingYear,
    }).toEqual({
      normalizedWhitespace: "alpha beta",
      emptyText: undefined,
      isoDate: "2024",
      medlineDate: "Spring 2024",
      leadingYear: 2023,
      missingLeadingYear: undefined,
    })
  }))

  it.effect("should XML parsing decode article metadata while preserving labeled abstract sections", () => Effect.gen(function* () {
    const article = yield* parseArticleXml("123", `
      <PubmedArticle>
        <Article>
          <Journal>
            <Title>Journal &amp; Testing</Title>
          </Journal>
          <ArticleTitle>Example &amp; Study</ArticleTitle>
          <AuthorList>
            <Author><LastName>Smith</LastName><Initials>AB</Initials></Author>
            <Author><CollectiveName>Research Group</CollectiveName></Author>
          </AuthorList>
          <PubDate><Year>2024</Year><Month>Jan</Month><Day>02</Day></PubDate>
          <Abstract>
            <AbstractText Label="Objective">First &amp; second.</AbstractText>
            <AbstractText>Plain result.</AbstractText>
          </Abstract>
          <ELocationID EIdType="doi">10.1000/example</ELocationID>
        </Article>
      </PubmedArticle>
    `)

    // Test: should XML parsing decode article metadata while preserving labeled abstract sections
    // Scope: PubMed articles are the boundary format this adapter must convert into domain data.
    // Assertion: the parsed article contains decoded user-visible fields, resolved authors, publication date, DOI, and abstract labels.
    expect(article).toMatchObject({
      id: "pmid:123",
      title: "Example & Study",
      authors: ["Smith AB", "Research Group"],
      published: "2024 Jan 02",
      abstract: "**Objective.** First & second.\n\nPlain result.",
      journal: "Journal & Testing",
      doi: "10.1000/example",
    })
  }))

  it.effect("should XML parsing use fallback identifiers while not dropping valid DOI values", () => Effect.gen(function* () {
    const articleIdDoi = yield* parseArticleXml("with-article-id", articleXml("with-article-id", `
      <ArticleId IdType="doi">10.1000/article-id</ArticleId>
    `))
    const eLocationDoi = yield* parseArticleXml("with-elocation", articleXml("with-elocation", `
      <ELocationID EIdType="doi">10.1000/elocation</ELocationID>
    `))

    // Test: should XML parsing use fallback identifiers while not dropping valid DOI values
    // Scope: PubMed may encode DOI in ArticleId or ELocationID, and both are public article metadata.
    // Assertion: ArticleId DOI wins when present, and ELocationID DOI is preserved when ArticleId DOI is absent.
    expect({ articleIdDoi: articleIdDoi.doi, eLocationDoi: eLocationDoi.doi }).toEqual({
      articleIdDoi: "10.1000/article-id",
      eLocationDoi: "10.1000/elocation",
    })
  }))

  it.effect("should malformed XML return typed failures while not fabricating partial articles", () => Effect.gen(function* () {
    const missingArticle = yield* Effect.result(parseArticleXml("missing", "<root />"))
    const invalidArticle = yield* Effect.result(parseArticleXml(
      "bad",
      "<PubmedArticle><ArticleTitle>Untitled</ArticleTitle></PubmedArticle>",
    ))

    // Test: should malformed XML return typed failures while not fabricating partial articles
    // Scope: Malformed upstream payloads are regression and anomaly cases; callers need domain errors, not partial success.
    // Assertion: missing article blocks fail as not found, and incomplete article blocks fail as fetch/parse invalid.
    expect({
      missingArticle: failureTag(missingArticle),
      invalidArticle: failureTag(invalidArticle),
    }).toEqual({
      missingArticle: "PubMedNotFoundError",
      invalidArticle: "PubMedFetchError",
    })
  }))
})

const articleXml = (title: string, extra: string) => `
  <PubmedArticle>
    <Article>
      <Journal><Title>Journal</Title></Journal>
      <ArticleTitle>${title}</ArticleTitle>
      <AuthorList><Author><LastName>Smith</LastName></Author></AuthorList>
      <PubDate><MedlineDate>Spring 2024</MedlineDate></PubDate>
      <Abstract><AbstractText>Abstract.</AbstractText></Abstract>
      ${extra}
    </Article>
  </PubmedArticle>
`

const failureTag = (result: Result.Result<unknown, PubMedFetchError | PubMedNotFoundError>) => {
  if (Result.isSuccess(result)) return undefined
  return result.failure._tag
}
