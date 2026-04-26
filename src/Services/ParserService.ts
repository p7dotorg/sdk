import { Context, Effect, Layer } from "effect"
import { parse } from "node-html-parser"
import { ParseError } from "../Domain/Errors.ts"

export interface ParserServiceShape {
  readonly htmlToMarkdown: (id: string, html: string) => Effect.Effect<string, ParseError>
  readonly extractArxivXml: (xml: string) => { title: string; authors: string; abstract: string }
  readonly buildMarkdown: (params: {
    title: string
    authors: string
    id: string
    url: string
    tldr?: string
    body: string
  }) => string
}

export class ParserService extends Context.Service<ParserService, ParserServiceShape>()(
  "p7/ParserService"
) {}

const make = Effect.sync((): ParserServiceShape => {
  const htmlToMarkdown = (id: string, html: string): Effect.Effect<string, ParseError> =>
    Effect.try({
      try: () => {
        const root = parse(html)
        const article = root.querySelector("article")
        if (!article) throw new Error("no <article> found")

        article.querySelectorAll("annotation, .ltx_tag, script, style").forEach((el) => el.remove())

        const buf: string[] = []

        const walk = (node: ReturnType<typeof parse>) => {
          for (const child of node.childNodes) {
            const tag = "tagName" in child ? (child as any).tagName?.toLowerCase() : null

            if (!tag) {
              const text = child.text.replace(/\s+/g, " ")
              if (text.trim()) buf.push(text)
              continue
            }

            switch (tag) {
              case "h1": buf.push(`\n# ${child.text.trim()}\n`); break
              case "h2": buf.push(`\n## ${child.text.trim()}\n`); break
              case "h3": buf.push(`\n### ${child.text.trim()}\n`); break
              case "h4": buf.push(`\n#### ${child.text.trim()}\n`); break
              case "h5": buf.push(`\n##### ${child.text.trim()}\n`); break
              case "p":  buf.push(`\n${child.text.trim()}\n`); break
              case "li": buf.push(`\n- ${child.text.trim()}`); break
              case "br": buf.push("\n"); break
              case "strong": case "b": buf.push(`**${child.text.trim()}**`); break
              case "em": case "i":     buf.push(`*${child.text.trim()}*`); break
              case "code": buf.push(`\`${child.text.trim()}\``); break
              case "pre":  buf.push(`\n\`\`\`\n${child.text.trim()}\n\`\`\`\n`); break
              case "blockquote": buf.push(`\n> ${child.text.trim()}\n`); break
              case "hr":  buf.push("\n---\n"); break
              case "math": case "annotation": case "script": case "style": break
              default: walk(child as any)
            }
          }
        }

        walk(article as any)

        return buf
          .join("")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&nbsp;/g, " ")
          .replace(/\n{3,}/g, "\n\n")
          .trim()
      },
      catch: (e) => new ParseError({ id, detail: String(e) }),
    })

  const extractArxivXml = (xml: string) => {
    const title = xml.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.replace(/\s+/g, " ").trim() ?? "Unknown Title"
    const authors = [...xml.matchAll(/<name>(.*?)<\/name>/g)].map((m) => m[1]).join(", ")
    const abstract = xml.match(/<summary>([\s\S]*?)<\/summary>/)?.[1]?.replace(/\s+/g, " ").trim() ?? ""
    return { title, authors, abstract }
  }

  const buildMarkdown = (params: {
    title: string
    authors: string
    id: string
    url: string
    tldr?: string
    body: string
  }) => {
    const lines: string[] = [
      `# ${params.title}`,
      "",
      `**Authors:** ${params.authors}`,
      `**arXiv:** ${params.url}`,
    ]
    if (params.tldr) lines.push(`**TLDR:** ${params.tldr}`)
    lines.push("", "---", "", params.body)
    return lines.join("\n")
  }

  return { htmlToMarkdown, extractArxivXml, buildMarkdown }
})

export const ParserServiceLive = Layer.effect(ParserService)(make)
