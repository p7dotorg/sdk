import { Context, Effect, FileSystem, Layer, Option } from "effect"
import * as path from "path"
import * as os from "os"
import { CacheReadError, CacheWriteError } from "../Domain/Errors.ts"
import { BunFileSystem } from "@effect/platform-bun"

const CACHE_DIR = path.join(os.homedir(), ".paper7", "cache")

export interface CacheEntry {
  markdown: string
  meta: {
    id: string
    title: string
    authors: string
    tldr?: string
  }
}

export interface CacheServiceShape {
  readonly get: (id: string) => Effect.Effect<Option.Option<CacheEntry>, any>
  readonly set: (id: string, entry: CacheEntry) => Effect.Effect<void, any>
  readonly list: () => Effect.Effect<Array<CacheEntry["meta"]>, any>
  readonly clear: (id?: string) => Effect.Effect<void, any>
}

export class CacheService extends Context.Service<CacheService, CacheServiceShape>()(
  "p7/CacheService"
) {}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem

  const dir = (id: string) => path.join(CACHE_DIR, id)
  const paperPath = (id: string) => path.join(dir(id), "paper.md")
  const metaPath = (id: string) => path.join(dir(id), "meta.json")

  const get = (id: string) =>
    Effect.gen(function* () {
      const exists = yield* fs.exists(paperPath(id))
      if (!exists) return Option.none<CacheEntry>()

      const [markdown, metaRaw] = yield* Effect.all(
        [fs.readFileString(paperPath(id)), fs.readFileString(metaPath(id))],
        { concurrency: 2 }
      ).pipe(Effect.mapError((e) => new CacheReadError({ path: dir(id), cause: e })))

      const meta = JSON.parse(metaRaw) as CacheEntry["meta"]
      return Option.some<CacheEntry>({ markdown, meta })
    })

  const set = (id: string, entry: CacheEntry) =>
    Effect.gen(function* () {
      yield* fs.makeDirectory(dir(id), { recursive: true }).pipe(
        Effect.mapError((e) => new CacheWriteError({ path: dir(id), cause: e }))
      )
      yield* Effect.all(
        [
          fs.writeFileString(paperPath(id), entry.markdown),
          fs.writeFileString(metaPath(id), JSON.stringify(entry.meta)),
        ],
        { concurrency: 2 }
      ).pipe(Effect.mapError((e) => new CacheWriteError({ path: dir(id), cause: e })))
    })

  const list = () =>
    Effect.gen(function* () {
      const cacheExists = yield* fs.exists(CACHE_DIR)
      if (!cacheExists) return [] as Array<CacheEntry["meta"]>

      const ids = yield* fs.readDirectory(CACHE_DIR).pipe(
        Effect.mapError((e) => new CacheReadError({ path: CACHE_DIR, cause: e }))
      )

      const entries = yield* Effect.all(
        ids.map((id) =>
          fs.readFileString(metaPath(id)).pipe(
            Effect.map((raw) => JSON.parse(raw) as CacheEntry["meta"]),
            Effect.option
          )
        ),
        { concurrency: 10 }
      )

      return entries.flatMap((o) => (Option.isSome(o) ? [o.value] : []))
    })

  const clear = (id?: string) =>
    id
      ? fs.remove(dir(id), { recursive: true }).pipe(
          Effect.mapError((e) => new CacheWriteError({ path: dir(id), cause: e }))
        )
      : fs.remove(CACHE_DIR, { recursive: true }).pipe(
          Effect.mapError((e) => new CacheWriteError({ path: CACHE_DIR, cause: e }))
        )

  return { get, set, list, clear }
})

export const CacheServiceLive = Layer.effect(CacheService)(make).pipe(
  Layer.provide(BunFileSystem.layer)
)
