import { Effect } from "effect"
import { describe, expect, it } from "@effect/vitest"
import { ParseError } from "../Domain/Errors.ts"
import { ParserService, ParserServiceLive } from "./ParserService.ts"

describe("ParserService", () => {
  it.effect("should HTML conversion emit readable markdown while not keeping removed document noise", () => Effect.gen(function* () {
    const parser = yield* ParserService
    const markdown = yield* parser.htmlToMarkdown("paper", `
      <article>
        <h1>Title &amp; Result</h1>
        <p>First <strong>bold</strong> paragraph.</p>
        <script>ignored()</script>
        <p>Second &lt;value&gt;</p>
      </article>
    `)

    // Test: should HTML conversion emit readable markdown while not keeping removed document noise
    // Scope: ar5iv HTML is an external boundary and contains markup that should not leak into paper markdown.
    // Assertion: visible article content is converted and decoded, while script/style/tag noise is absent.
    expect(markdown).toBe("# Title & Result\n\nFirst bold paragraph.\n\nSecond <value>")
  }).pipe(Effect.provide(ParserServiceLive)))

  it.effect("should HTML conversion fail typed while not accepting documents without articles", () => Effect.gen(function* () {
    const parser = yield* ParserService
    const result = yield* Effect.result(parser.htmlToMarkdown("missing", "<main>No article</main>"))

    // Test: should HTML conversion fail typed while not accepting documents without articles
    // Scope: malformed ar5iv responses must be reported as parse failures, not empty successful markdown.
    // Assertion: a document without an article element fails with ParseError.
    expect(result._tag === "Failure" ? result.failure : undefined).toBeInstanceOf(ParseError)
  }).pipe(Effect.provide(ParserServiceLive)))

  it.effect("should markdown building include optional TLDR while not inventing absent summaries", () => Effect.gen(function* () {
    const parser = yield* ParserService
    const withoutTldr = parser.buildMarkdown({ title: "Title", authors: "A, B", id: "1", url: "https://arxiv.org/abs/1", body: "Body" })
    const withTldr = parser.buildMarkdown({ title: "Title", authors: "A, B", id: "1", url: "https://arxiv.org/abs/1", tldr: "Short", body: "Body" })

    // Test: should markdown building include optional TLDR while not inventing absent summaries
    // Scope: generated markdown is SDK output and must represent optional metadata honestly.
    // Assertion: TLDR appears only when provided and the rest of the paper skeleton remains stable.
    expect({ withoutTldr, withTldr }).toEqual({
      withoutTldr: "# Title\n\n**Authors:** A, B\n**arXiv:** https://arxiv.org/abs/1\n\n---\n\nBody",
      withTldr: "# Title\n\n**Authors:** A, B\n**arXiv:** https://arxiv.org/abs/1\n**TLDR:** Short\n\n---\n\nBody",
    })
  }).pipe(Effect.provide(ParserServiceLive)))
})
