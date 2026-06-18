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

// Resolve a TCGPlayer-style set name to a Scryfall set code.
// Returns null if no good match.
export async function resolveSetCode(setName: string): Promise<string | null> {
  if (!setName) return null
  const sets = await getAllSets()
  const target = normalize(setName)

  // 1. Exact normalized match
  const exact = sets.find(s => normalize(s.name) === target)
  if (exact) return exact.code

  // 2. Substring match in either direction (TCGPlayer may add/drop prefixes)
  const sub = sets.find(s => {
    const sn = normalize(s.name)
    return sn.includes(target) || target.includes(sn)
  })
  if (sub) return sub.code

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

export type CatalogStore = Map<string, Map<string, string>>  // setName → (number → imageUrl)

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
        const map = await loadSetImages(code)
        store.set(name, map)
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
