// Scryfall set lookup — caches the full sets list once per session, then
// resolves TCGPlayer set names like "Commander: Teenage Mutant Ninja Turtles"
// to Scryfall set codes like "tmc".

interface ScryfallSet {
  code: string
  name: string
  released_at?: string
  card_count?: number
  set_type?: string
}

let _setsCache: ScryfallSet[] | null = null
let _setsFetch: Promise<ScryfallSet[]> | null = null

export async function getAllSets(): Promise<ScryfallSet[]> {
  if (_setsCache) return _setsCache
  if (_setsFetch) return _setsFetch
  _setsFetch = fetch('https://api.scryfall.com/sets')
    .then(r => r.json())
    .then(data => {
      _setsCache = (data.data || []) as ScryfallSet[]
      return _setsCache
    })
  return _setsFetch
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function tokens(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9]{2,}/g) ?? [])
    .filter(t => t.length >= 3) // skip "of", "to", etc but keep "tmc"
}

// Symmetric token-set similarity (Jaccard-like).
function tokenSimilarity(a: string, b: string): number {
  const ta = new Set(tokens(a))
  const tb = new Set(tokens(b))
  if (ta.size === 0 || tb.size === 0) return 0
  let intersection = 0
  for (const t of ta) if (tb.has(t)) intersection++
  // Use min size so that "Commander: TMNT" (5 tokens) matches "TMNT Commander"
  // (5 tokens) at 1.0, but "Commander: TMNT" vs "TMNT" (4 tokens) at 4/5 = 0.8
  return intersection / Math.max(ta.size, tb.size)
}

// Resolve a TCGPlayer-style set name to a Scryfall set code.
// Returns null if no confident match.
// Uses token-set similarity so word reorders ("Commander: TMNT" vs
// "TMNT Commander") still match perfectly, but shorter contained names
// ("TMNT" alone) score lower and lose.
export async function resolveSetCode(setName: string): Promise<string | null> {
  if (!setName) return null
  const sets = await getAllSets()
  const target = normalize(setName)

  // 1. Exact normalized match
  const exact = sets.find(s => normalize(s.name) === target)
  if (exact) return exact.code

  // 2. Best token-set match (≥ 0.75) — prefers same tokens regardless of order
  let best: { code: string; score: number; name: string } | null = null
  for (const s of sets) {
    if (!s.name) continue
    const sim = tokenSimilarity(setName, s.name)
    if (sim >= 0.75 && (!best || sim > best.score)) {
      best = { code: s.code, score: sim, name: s.name }
    }
  }
  if (best) return best.code

  return null
}

interface CatalogCard {
  number: string
  image_url: string
}

// Load every card image URL for a set code, paginated, preferring non-foil.
export async function loadSetImages(code: string): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  let url: string = `https://api.scryfall.com/cards/search?q=set:${code}&unique=prints`
  while (url) {
    const res = await fetch(url)
    if (!res.ok) break
    const data = await res.json()
    for (const c of (data.data || [])) {
      const num: string = c.collector_number
      const imgUrl: string | undefined =
        c.image_uris?.normal ?? c.card_faces?.[0]?.image_uris?.normal
      if (imgUrl && !out.has(num)) out.set(num, imgUrl)
    }
    url = data.has_more ? data.next_page : ''
  }
  return out
}

export interface CatalogEntry {
  code: string                     // Scryfall set code (lowercase, e.g. "tmc")
  images: Map<string, string>      // collector number → image URL
}
export type CatalogStore = Map<string, CatalogEntry>  // setName → entry

export async function loadCatalogsForSets(
  setNames: string[],
  onProgress?: (done: number, total: number, name: string) => void,
): Promise<{ store: CatalogStore; unresolved: string[] }> {
  const store: CatalogStore = new Map()
  const unresolved: string[] = []
  let done = 0

  for (const name of setNames) {
    const code = await resolveSetCode(name)
    if (!code) {
      unresolved.push(name)
    } else {
      try {
        const images = await loadSetImages(code)
        store.set(name, { code, images })
      } catch {
        unresolved.push(name)
      }
    }
    done++
    onProgress?.(done, setNames.length, name)
  }

  return { store, unresolved }
}

export type { ScryfallSet, CatalogCard }
