import { useRef, useState, useEffect } from 'react'
import type { TcgCard } from '../types'
import { uploadImage } from '../utils/imageApi'
import { analyzeCard, initOcrWorker, type CardOcrResult } from '../utils/cardOcr'
import { loadCatalogsForSets, loadSetImages, type CatalogStore } from '../utils/scryfallSets'

interface UploadedImage {
  id: string
  objectUrl: string
  fileName: string
  side: 'front' | 'back'
  assignedTo: string | null
  hostedUrl?: string
  hostedId?: string
  matchScore?: number
  matchReason?: string
  ocr?: CardOcrResult
  ocrStatus?: 'pending' | 'running' | 'done' | 'error'
  pairKey?: string  // links front+back of the same physical card
}

function normalizeBase(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

// Levenshtein distance + similarity (0-1, higher is closer)
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  if (m === 0) return n
  if (n === 0) return m
  const dp = Array.from({ length: n + 1 }, (_, i) => i)
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]
    dp[0] = i
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j]
      dp[j] = a[i - 1] === b[j - 1]
        ? prev
        : Math.min(prev, dp[j - 1], dp[j]) + 1
      prev = tmp
    }
  }
  return dp[n]
}

function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length)
  return maxLen === 0 ? 1 : 1 - levenshtein(a, b) / maxLen
}

// Map TCGPlayer rarity strings → single OCR letter
function rarityLetter(cardRarity: string): string {
  const r = (cardRarity || '').toLowerCase()
  if (r.startsWith('mythic')) return 'M'
  if (r.startsWith('rare')) return 'R'
  if (r.startsWith('uncommon')) return 'U'
  if (r.startsWith('common')) return 'C'
  if (r.startsWith('land')) return 'L'
  if (r.startsWith('basic land')) return 'L'
  return ''
}

// Score an OCR result against a card. Accepts an optional catalogStore so we
// can compare the OCR'd set code against the card's resolved Scryfall code.
function scoreOcr(
  ocr: CardOcrResult,
  card: TcgCard,
  catalogStore?: CatalogStore,
): { score: number; reason: string } {
  const ocrNum    = ocr.parsedNumber
  const cardNum   = card.number.replace(/\D/g, '')
  const ocrRar    = ocr.parsedRarity
  const ocrSet    = ocr.parsedSetCode
  const cardRar   = rarityLetter(card.rarity)
  const cardCode  = catalogStore?.get(card.setName)?.code?.toUpperCase() ?? ''

  // Bonus signals that nudge the score up or down without overriding base match
  let bonus = 0
  const bonusReasons: string[] = []
  if (ocrRar && cardRar && ocrRar === cardRar) { bonus += 0.03; bonusReasons.push(`rarity ${ocrRar}`) }
  if (ocrRar && cardRar && ocrRar !== cardRar) { bonus -= 0.20; bonusReasons.push(`rarity mismatch ${ocrRar}≠${cardRar}`) }
  if (ocrSet && cardCode && ocrSet === cardCode) { bonus += 0.05; bonusReasons.push(`set ${ocrSet}`) }
  if (ocrSet && cardCode && ocrSet !== cardCode) { bonus -= 0.30; bonusReasons.push(`set mismatch ${ocrSet}≠${cardCode}`) }
  const bonusSuffix = bonusReasons.length ? ` [+${bonusReasons.join(', ')}]` : ''

  if (ocrNum && cardNum) {
    if (ocrNum === cardNum || ocrNum === cardNum.replace(/^0+/, '')) {
      return { score: 0.97 + bonus, reason: `card number OCR "${ocrNum}" → #${card.number}${bonusSuffix}` }
    }
  }

  if (ocr.parsedName) {
    const normalOcr  = normalizeBase(ocr.parsedName)
    const normalCard = normalizeBase(card.productName)

    if (normalOcr === normalCard)
      return { score: 0.88 + bonus, reason: `exact name OCR "${ocr.parsedName}" → "${card.productName}"${bonusSuffix}` }

    // Fuzzy similarity — handles Tesseract artifacts like a phantom "f" or single missing char
    const sim = similarity(normalOcr, normalCard)
    const simPct = Math.round(sim * 100)
    if (sim >= 0.92)
      return { score: 0.85 + bonus, reason: `OCR name "${ocr.parsedName}" → "${card.productName}" (${simPct}% sim)${bonusSuffix}` }
    if (sim >= 0.82)
      return { score: 0.75 + bonus, reason: `OCR name "${ocr.parsedName}" ≈ "${card.productName}" (${simPct}% sim)${bonusSuffix}` }
    if (sim >= 0.72)
      return { score: 0.60 + bonus, reason: `OCR name "${ocr.parsedName}" ~ "${card.productName}" (${simPct}% sim)${bonusSuffix}` }

    if (normalCard.length >= 4 && normalOcr.includes(normalCard))
      return { score: 0.70 + bonus, reason: `OCR name "${ocr.parsedName}" contains "${card.productName}"${bonusSuffix}` }
    if (normalCard.length >= 4 && normalCard.includes(normalOcr) && normalOcr.length >= 4)
      return { score: 0.65 + bonus, reason: `"${card.productName}" contains OCR text "${ocr.parsedName}"${bonusSuffix}` }
    // Token overlap
    const tokenList = (normalCard.match(/[a-z0-9]{3,}/g) ?? [])
    const matched = tokenList.filter(t => normalOcr.includes(t))
    if (matched.length >= 2)
      return { score: 0.50 + bonus, reason: `token overlap: "${matched.join('", "')}" in OCR name "${ocr.parsedName}"${bonusSuffix}` }
  }

  return { score: 0, reason: 'no OCR match' }
}

function filenameMatchDetail(fileName: string, card: TcgCard): { score: number; reason: string } {
  const stripped = fileName.toLowerCase()
    .replace(/\.[^.]+$/, '')
    .replace(/[-_](back|b)$/, '')
    .replace(/\(back\)$/, '')
  const base = normalizeBase(stripped)
  const num = card.number.replace(/\D/g, '')
  const name = normalizeBase(card.productName)

  if (num && (base === num || base === num.padStart(3, '0')))
    return { score: 1.0, reason: `card number in filename "${stripped}" → #${card.number}` }
  if (base === name)
    return { score: 0.9, reason: `exact name match "${stripped}" → "${card.productName}"` }
  if (name.length >= 5 && base.includes(name))
    return { score: 0.75, reason: `filename "${stripped}" contains card name "${card.productName}"` }
  if (name.length >= 5 && name.includes(base))
    return { score: 0.75, reason: `card name "${card.productName}" contains filename text "${stripped}"` }
  const tokens = (name.match(/[a-z0-9]{3,}/g) ?? [])
  const matched = tokens.filter(t => base.includes(t))
  if (matched.length >= 2)
    return { score: 0.5, reason: `token overlap: "${matched.join('", "')}" found in filename "${stripped}"` }
  return { score: 0, reason: 'no match' }
}


function isBackFilename(fileName: string): boolean {
  const s = fileName.toLowerCase().replace(/\.[^.]+$/, '')
  return /[-_](back|b)$/.test(s) || /\(back\)$/.test(s)
}

interface Props {
  cards: TcgCard[]
  onCards: (cards: TcgCard[]) => void
  onBack: () => void
  onNext: () => void
}

function setSku(cards: TcgCard[], tcgplayerId: string, sku: string): TcgCard[] {
  return cards.map(c => c.tcgplayerId === tcgplayerId ? { ...c, sku: sku || undefined } : c)
}

function applyDefaultSku(cards: TcgCard[], matchedIds: string[], defaultSku: string): TcgCard[] {
  if (!defaultSku) return cards
  return cards.map(c =>
    matchedIds.includes(c.tcgplayerId) && !c.sku ? { ...c, sku: defaultSku } : c
  )
}

export default function Step3Images({ cards, onCards, onBack, onNext }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [images, setImages]           = useState<UploadedImage[]>([])
  const [selectedId, setSelectedId]   = useState<string | null>(null)
  const [filter, setFilter]           = useState('')
  const [scopeSet, setScopeSet]       = useState('all')
  const [dragging, setDragging]       = useState(false)
  const [matching, setMatching]       = useState(false)
  const [matchStats, setMatchStats]   = useState<{ byFilename: number } | null>(null)
  const [uploading, setUploading]     = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [defaultSku, setDefaultSku]   = useState('')
  const [showUnmatchedOnly, setShowUnmatchedOnly] = useState(false)
  const [showOrphanedOnly, setShowOrphanedOnly]   = useState(false)
  const [verifiedIds, setVerifiedIds] = useState<Set<string>>(new Set())
  const [validatingCard, setValidatingCard] = useState<TcgCard | null>(null)
  const [reassignMode, setReassignMode]     = useState(false)
  const [reassignSearch, setReassignSearch] = useState('')
  const [catalogStore, setCatalogStore]     = useState<CatalogStore>(new Map())
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [catalogStatus, setCatalogStatus]   = useState('')  // human-readable progress
  const [catalogUnresolved, setCatalogUnresolved] = useState<string[]>([])
  const [ocrRunning, setOcrRunning]         = useState(false)
  const [ocrProgress, setOcrProgress]       = useState({ done: 0, total: 0 })
  const [pairsMode, setPairsMode]           = useState(true)
  const [draggedImageId, setDraggedImageId] = useState<string | null>(null)
  const [manualCode, setManualCode]         = useState<Record<string, string>>({})  // setName → typed code
  // Refs always reflect the latest values — avoids closure staleness when
  // handlers are queued from a useEffect / drop handler.
  const imagesRef = useRef<UploadedImage[]>(images)
  imagesRef.current = images
  const pairsModeRef = useRef(pairsMode)
  pairsModeRef.current = pairsMode

  // Stock image lookup that respects per-set catalogs
  function getStockUrl(card: TcgCard): string {
    return catalogStore.get(card.setName)?.images.get(card.number) || card.photoUrl || ''
  }

  async function loadManualCode(setName: string) {
    const code = (manualCode[setName] || '').trim().toLowerCase()
    if (!code) return
    try {
      const images = await loadSetImages(code)
      setCatalogStore(prev => {
        const next = new Map(prev)
        next.set(setName, { code, images })
        return next
      })
      setCatalogUnresolved(prev => prev.filter(n => n !== setName))
    } catch (e) {
      console.error('Manual catalog load failed:', e)
    }
  }

  function openValidation(card: TcgCard) {
    setValidatingCard(card)
    setReassignMode(false)
    setReassignSearch('')
  }

  function closeValidation() {
    setValidatingCard(null)
    setReassignMode(false)
    setReassignSearch('')
  }

  function markVerified(tcgplayerId: string) {
    const newVerified = new Set([...verifiedIds, tcgplayerId])
    setVerifiedIds(newVerified)
    // Auto-advance to the next card that has a front image and hasn't been verified
    const idx = displayCards.findIndex(c => c.tcgplayerId === tcgplayerId)
    const next = displayCards.slice(idx + 1).find(c =>
      !newVerified.has(c.tcgplayerId) &&
      images.some(i => i.assignedTo === c.tcgplayerId && i.side === 'front')
    )
    if (next) {
      setValidatingCard(next)
      setReassignMode(false)
      setReassignSearch('')
    } else {
      closeValidation()
    }
  }

  function unverify(tcgplayerId: string) {
    setVerifiedIds(prev => { const s = new Set(prev); s.delete(tcgplayerId); return s })
  }

  // Reassign front (and optionally back) to a new card, freeing any existing assignment on the target.
  function reassignTo(frontImgId: string, backImgId: string | null, newCard: TcgCard) {
    setImages(prev => prev.map(img => {
      if (img.assignedTo === newCard.tcgplayerId && img.side === 'front' && img.id !== frontImgId)
        return { ...img, assignedTo: null }
      if (backImgId && img.assignedTo === newCard.tcgplayerId && img.side === 'back' && img.id !== backImgId)
        return { ...img, assignedTo: null }
      if (img.id === frontImgId)
        return { ...img, assignedTo: newCard.tcgplayerId, matchReason: 'manual reassignment', matchScore: 1.0 }
      if (backImgId && img.id === backImgId)
        return { ...img, assignedTo: newCard.tcgplayerId, matchReason: 'manual reassignment', matchScore: 1.0 }
      return img
    }))
    closeValidation()
  }

  // Auto-load Scryfall catalogs for every unique set in the user's CSV on mount.
  useEffect(() => {
    const setNames = Array.from(new Set(cards.map(c => c.setName).filter(Boolean)))
    if (setNames.length === 0) return
    let cancelled = false
    setCatalogLoading(true)
    setCatalogStatus(`Loading ${setNames.length} set${setNames.length !== 1 ? 's' : ''}…`)
    loadCatalogsForSets(setNames, (done, total, name) => {
      if (cancelled) return
      setCatalogStatus(`Loading ${done}/${total} — ${name}`)
    }).then(({ store, unresolved }) => {
      if (cancelled) return
      setCatalogStore(store)
      setCatalogUnresolved(unresolved)
      let imageCount = 0
      for (const entry of store.values()) imageCount += entry.images.size
      setCatalogStatus(`${imageCount} stock images from ${store.size} set${store.size !== 1 ? 's' : ''}`)
      setCatalogLoading(false)
    }).catch(() => {
      if (cancelled) return
      setCatalogStatus('Catalog load failed')
      setCatalogLoading(false)
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleOcrMatch() {
    // Snapshot via ref so this works correctly when invoked from a useEffect
    // shortly after setImages — closure-captured `images` would be stale.
    const snapshot = imagesRef.current
    const frontImgs = snapshot.filter(i =>
      i.side === 'front' && (!i.ocr || i.ocrStatus === 'error')
    )
    if (frontImgs.length === 0) return

    setOcrRunning(true)
    setOcrProgress({ done: 0, total: frontImgs.length })

    await initOcrWorker()

    const target = scopedCards
    let matched = 0
    const newlyMatchedIds: string[] = []
    // Track which target cards have been claimed during THIS run, to avoid
    // double-matching when React hasn't flushed previous setImages updates yet.
    const claimedFronts = new Set<string>(
      snapshot.filter(i => i.assignedTo && i.side === 'front').map(i => i.assignedTo!)
    )

    for (const img of frontImgs) {
      setImages(prev => prev.map(x => x.id === img.id ? { ...x, ocrStatus: 'running' } : x))

      let ocr: CardOcrResult | null = null
      try {
        ocr = await analyzeCard(img.objectUrl)
      } catch {
        setImages(prev => prev.map(x => x.id === img.id ? { ...x, ocrStatus: 'error' } : x))
        setOcrProgress(p => ({ ...p, done: p.done + 1 }))
        continue
      }

      // Find best card match using OCR data
      let best: { card: TcgCard; score: number; reason: string } | null = null
      for (const card of target) {
        const result = scoreOcr(ocr, card, catalogStore)
        const betterScore = !best || result.score > best.score
        const tiebreakNonFoil = best !== null && result.score === best.score
          && best.card.condition.toLowerCase().includes('foil')
          && !card.condition.toLowerCase().includes('foil')
        if (result.score >= 0.50 && (betterScore || tiebreakNonFoil))
          best = { card, score: result.score, reason: result.reason }
      }

      const canAssign = !!best && !claimedFronts.has(best.card.tcgplayerId)
      if (canAssign && best) claimedFronts.add(best.card.tcgplayerId)

      setImages(prev => prev.map(x => {
        if (x.id === img.id) {
          return {
            ...x,
            ocr,
            ocrStatus: 'done',
            ...(canAssign && best ? {
              assignedTo: best.card.tcgplayerId,
              matchScore: best.score,
              matchReason: best.reason,
            } : {}),
          }
        }
        // Auto-pair the back image (same pairKey) to the same card
        if (canAssign && best && img.pairKey && x.pairKey === img.pairKey && x.side === 'back' && !x.assignedTo) {
          return { ...x, assignedTo: best.card.tcgplayerId }
        }
        return x
      }))

      if (canAssign && best) {
        matched++
        newlyMatchedIds.push(best.card.tcgplayerId)
      }
      setOcrProgress(p => ({ ...p, done: p.done + 1 }))
    }

    setMatchStats({ byFilename: matched })
    setOcrRunning(false)
    if (defaultSku && newlyMatchedIds.length > 0) {
      onCards(applyDefaultSku(cards, newlyMatchedIds, defaultSku))
    }
  }

  // Auto-trigger OCR whenever there are un-processed front images and OCR isn't
  // already running. This handles the post-drop case correctly even when React
  // hasn't flushed the setImages update yet.
  useEffect(() => {
    if (ocrRunning) return
    const hasPending = images.some(i =>
      i.side === 'front' && !i.ocr && i.ocrStatus !== 'error' && i.ocrStatus !== 'running'
    )
    if (hasPending) void handleOcrMatch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images, ocrRunning])

  const setNames = Array.from(new Set(cards.map(c => c.setName))).sort()
  const scopedCards = scopeSet === 'all' ? cards : cards.filter(c => c.setName === scopeSet)
  const filteredCards = filter
    ? scopedCards.filter(c =>
        c.productName.toLowerCase().includes(filter.toLowerCase()) || c.number.includes(filter)
      )
    : scopedCards
  const matchedCardIds = new Set(images.filter(i => i.assignedTo && i.side === 'front').map(i => i.assignedTo!))
  const displayCards = showUnmatchedOnly
    ? filteredCards.filter(c => !matchedCardIds.has(c.tcgplayerId))
    : filteredCards

  const orphanedCount  = images.filter(i => !i.assignedTo).length
  const displayImages  = showOrphanedOnly ? images.filter(i => !i.assignedTo) : images

  function addImageFiles(files: File[]) {
    // Read from ref so toggling pairs mode after page load takes effect
    const pairs = pairsModeRef.current
    const accepted = files.filter(f => f.type.startsWith('image/'))
    const batchKey = crypto.randomUUID().slice(0, 8)
    const newImgs: UploadedImage[] = accepted.map((f, i) => {
      const filenameBack = isBackFilename(f.name)
      // Pairs mode: alternate front/back. Filename suffix (-back) still wins if present.
      const side: 'front' | 'back' = filenameBack
        ? 'back'
        : pairs
          ? (i % 2 === 0 ? 'front' : 'back')
          : 'front'
      return {
        id: crypto.randomUUID(),
        objectUrl: URL.createObjectURL(f),
        fileName: f.name,
        side,
        assignedTo: null,
        pairKey: pairs ? `${batchKey}-${Math.floor(i / 2)}` : undefined,
      }
    })
    setImages([...imagesRef.current, ...newImgs])
    // OCR is triggered by useEffect below when new un-OCR'd images appear
  }

  function loadFiles(files: FileList) {
    addImageFiles(Array.from(files))
  }

  async function collectFromEntry(entry: FileSystemEntry): Promise<File[]> {
    if (entry.isFile) {
      return new Promise(resolve => {
        (entry as FileSystemFileEntry).file(
          f => resolve(f.type.startsWith('image/') ? [f] : []),
          () => resolve([])
        )
      })
    }
    if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader()
      const allEntries: FileSystemEntry[] = []
      await new Promise<void>(resolve => {
        function readBatch() {
          reader.readEntries(batch => {
            if (batch.length === 0) { resolve(); return }
            allEntries.push(...batch)
            readBatch()
          }, () => resolve())
        }
        readBatch()
      })
      const nested = await Promise.all(allEntries.map(collectFromEntry))
      return nested.flat()
    }
    return []
  }

  async function onDrop(e: React.DragEvent) {
    e.preventDefault(); setDragging(false)
    const items = Array.from(e.dataTransfer.items)
    const hasEntries = items.length > 0 && typeof items[0].webkitGetAsEntry === 'function'
    if (hasEntries) {
      const entries = items.map(i => i.webkitGetAsEntry()).filter(Boolean) as FileSystemEntry[]
      const files = (await Promise.all(entries.map(collectFromEntry))).flat()
      files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
      addImageFiles(files)
    } else {
      loadFiles(e.dataTransfer.files)
    }
  }

  function toggleSide(id: string) {
    setImages(prev => prev.map(img =>
      img.id === id ? { ...img, side: img.side === 'front' ? 'back' : 'front' } : img
    ))
  }

  function assign(imgId: string, tcgplayerId: string, side: 'front' | 'back') {
    setImages(prev => prev.map(img =>
      img.id === imgId ? { ...img, assignedTo: tcgplayerId, side, matchReason: 'manual', matchScore: 1.0 } : img
    ))
    setSelectedId(null)
    if (defaultSku) {
      const card = cards.find(c => c.tcgplayerId === tcgplayerId)
      if (card && !card.sku) onCards(setSku(cards, tcgplayerId, defaultSku))
    }
  }

  function unassignSlot(tcgplayerId: string, side: 'front' | 'back') {
    setImages(prev => prev.map(img =>
      img.assignedTo === tcgplayerId && img.side === side ? { ...img, assignedTo: null } : img
    ))
  }

  // Drag-drop: when an image is dropped onto a card row, assign it there.
  // If the image has a pairKey, the paired back image also moves to that card.
  function dropImageOnCard(imageId: string, tcgplayerId: string) {
    const dragged = images.find(i => i.id === imageId)
    if (!dragged) return
    setImages(prev => prev.map(img => {
      // Free any existing image on the target's same side (front/back)
      if (img.assignedTo === tcgplayerId && img.side === dragged.side && img.id !== imageId)
        return { ...img, assignedTo: null }
      // If pair-moving, also free the existing back on the target
      if (dragged.pairKey && img.assignedTo === tcgplayerId && img.side === 'back' && img.id !== imageId
          && images.some(o => o.pairKey === dragged.pairKey && o.side === 'back'))
        return { ...img, assignedTo: null }
      // Assign the dragged image
      if (img.id === imageId)
        return { ...img, assignedTo: tcgplayerId, matchReason: 'manual drag-drop', matchScore: 1.0 }
      // Auto-pair: the back image with the same pairKey rides along
      if (dragged.pairKey && img.pairKey === dragged.pairKey && img.id !== imageId)
        return { ...img, assignedTo: tcgplayerId }
      return img
    }))
    if (defaultSku) {
      const card = cards.find(c => c.tcgplayerId === tcgplayerId)
      if (card && !card.sku) onCards(setSku(cards, tcgplayerId, defaultSku))
    }
  }

  async function handleAutoMatch() {
    setMatching(true); setMatchStats(null)
    const target = scopedCards
    let byFilename = 0

    const prevAssigned = new Set(images.filter(i => i.assignedTo).map(i => i.assignedTo!))
    const work = images.map(i => ({ ...i }))
    const usedFront = new Set(work.filter(i => i.assignedTo && i.side === 'front').map(i => i.assignedTo!))
    const usedBack  = new Set(work.filter(i => i.assignedTo && i.side === 'back').map(i => i.assignedTo!))

    for (const img of work) {
      if (img.assignedTo) continue
      const usedSet = img.side === 'front' ? usedFront : usedBack
      let best: { card: TcgCard; score: number; reason: string } | null = null
      for (const card of target) {
        const detail = filenameMatchDetail(img.fileName, card)
        const s = detail.score
        const betterScore = !best || s > best.score
        const tiebreakNonFoil = best !== null && s === best.score
          && best.card.condition.toLowerCase().includes('foil')
          && !card.condition.toLowerCase().includes('foil')
        if (s >= 0.7 && (betterScore || tiebreakNonFoil)) best = { card, score: s, reason: detail.reason }
      }
      if (best && !usedSet.has(best.card.tcgplayerId)) {
        img.assignedTo = best.card.tcgplayerId
        img.matchScore = best.score
        img.matchReason = best.reason
        usedSet.add(best.card.tcgplayerId)
        byFilename++
      }
    }

    setImages([...work]); setMatchStats({ byFilename }); setMatching(false)
    if (defaultSku) {
      const newlyMatchedIds = work
        .filter(i => i.assignedTo && !prevAssigned.has(i.assignedTo))
        .map(i => i.assignedTo!)
      if (newlyMatchedIds.length > 0) onCards(applyDefaultSku(cards, newlyMatchedIds, defaultSku))
    }
  }

  async function handleUploadToServer() {
    const toUpload = images.filter(i => i.assignedTo && !i.hostedUrl)
    if (toUpload.length === 0) return
    setUploading(true); setUploadError(null); setUploadProgress(0)
    let done = 0
    for (const img of toUpload) {
      try {
        const blob = await fetch(img.objectUrl).then(r => r.blob())
        const hosted = await uploadImage(blob, img.fileName)
        setImages(prev =>
          prev.map(x => x.id === img.id ? { ...x, hostedUrl: hosted.url, hostedId: hosted.id } : x)
        )
      } catch (e) {
        setUploadError(`Failed to upload ${img.fileName}: ${e instanceof Error ? e.message : 'unknown error'}`)
      }
      done++
      setUploadProgress(done / toUpload.length)
    }
    setUploading(false)
  }

  function applyAndContinue() {
    const updated = cards.map(card => {
      const frontImg = images.find(i => i.assignedTo === card.tcgplayerId && i.side === 'front')
      const backImg  = images.find(i => i.assignedTo === card.tcgplayerId && i.side === 'back')
      return {
        ...card,
        imageObjectUrl:     frontImg?.objectUrl,
        imageFileName:      frontImg?.hostedUrl ?? frontImg?.fileName,
        imageObjectUrlBack: backImg?.objectUrl,
        imageFileNameBack:  backImg?.hostedUrl ?? backImg?.fileName,
      }
    })
    onCards(updated)
    onNext()
  }

  const selectedImg   = selectedId ? images.find(i => i.id === selectedId) : null
  const matchedFronts = new Set(images.filter(i => i.assignedTo && i.side === 'front').map(i => i.assignedTo!))

  return (
    <div className="space-y-5">

      {/* ── Validation modal ── */}
      {validatingCard && (() => {
        const card = validatingCard
        const frontImg = images.find(i => i.assignedTo === card.tcgplayerId && i.side === 'front')
        const backImg  = images.find(i => i.assignedTo === card.tcgplayerId && i.side === 'back')
        const stockUrl = getStockUrl(card)

        // ── Reassign mode ──
        if (reassignMode && frontImg) {
          const q = reassignSearch.toLowerCase()
          const candidates = cards.filter(c =>
            c.tcgplayerId !== card.tcgplayerId && (
              !q || c.productName.toLowerCase().includes(q) || c.number.includes(q)
            )
          )
          return (
            <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
              onClick={closeValidation}>
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl p-6 space-y-4"
                onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">Reassign scan</h3>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Pick the correct card — front and back will both move
                    </p>
                  </div>
                  <button onClick={closeValidation} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
                </div>

                <div className="flex gap-6 items-start">
                  {/* Your scans — large */}
                  <div className="flex-shrink-0 space-y-2" style={{ width: '220px' }}>
                    <p className="text-xs font-semibold text-gray-500 text-center uppercase tracking-wide">Your scan</p>
                    <img src={frontImg.objectUrl} alt="scan front"
                      className="w-full rounded-xl border-2 border-blue-200 object-contain" style={{ maxHeight: '340px' }} />
                    {backImg && (
                      <img src={backImg.objectUrl} alt="scan back"
                        className="w-full rounded-xl border-2 border-purple-200 object-contain mt-2" style={{ maxHeight: '340px' }} />
                    )}
                    <p className="text-[10px] text-gray-400 text-center truncate">{frontImg.fileName}</p>
                    {frontImg.matchReason && (
                      <div className="text-[10px] text-gray-500 bg-gray-50 rounded-lg px-2 py-1.5 border border-gray-200 leading-relaxed">
                        <span className="font-semibold">How it was matched:</span><br />
                        {frontImg.matchReason}<br />
                        <span className="text-gray-400">Confidence: {Math.round((frontImg.matchScore ?? 0) * 100)}%</span>
                      </div>
                    )}
                  </div>

                  {/* Search + card list */}
                  <div className="flex-1 min-w-0 space-y-2">
                    <input
                      autoFocus
                      type="text"
                      placeholder="Search by name or card #"
                      value={reassignSearch}
                      onChange={e => setReassignSearch(e.target.value)}
                      className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                    <div className="space-y-1 overflow-y-auto pr-1" style={{ maxHeight: '420px' }}>
                      {candidates.slice(0, 80).map(c => {
                        const hasExistingFront = images.some(i => i.assignedTo === c.tcgplayerId && i.side === 'front')
                        const cStockUrl = getStockUrl(c)
                        return (
                          <div
                            key={c.tcgplayerId}
                            onClick={() => reassignTo(frontImg.id, backImg?.id ?? null, c)}
                            className="flex items-center gap-3 px-3 py-2 rounded-xl border border-gray-100 hover:border-blue-300 hover:bg-blue-50 cursor-pointer transition-colors"
                          >
                            {cStockUrl
                              ? <img src={cStockUrl} alt="" className="w-10 h-[3.125rem] object-cover rounded flex-shrink-0 border border-gray-200" />
                              : <div className="w-10 h-[3.125rem] bg-gray-100 rounded flex-shrink-0" />
                            }
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-900 truncate">{c.productName}</p>
                              <p className="text-xs text-gray-400">#{c.number} · {c.rarity} · {c.condition}</p>
                            </div>
                            {hasExistingFront && (
                              <span className="text-[10px] text-orange-500 font-medium flex-shrink-0 bg-orange-50 px-1.5 py-0.5 rounded">has scan</span>
                            )}
                          </div>
                        )
                      })}
                      {candidates.length === 0 && (
                        <p className="text-sm text-gray-400 text-center py-8">No cards match</p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex justify-start pt-1">
                  <button onClick={() => setReassignMode(false)}
                    className="text-gray-500 hover:text-gray-700 px-4 py-2 rounded-lg font-medium border border-gray-200 transition-colors text-sm">
                    ← Back
                  </button>
                </div>
              </div>
            </div>
          )
        }

        // ── Verify mode ──
        return (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
            onClick={closeValidation}>
            <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full p-6 space-y-4"
              onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">Verify match</h3>
                <button onClick={closeValidation} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
              </div>
              <p className="text-sm text-gray-600">
                <strong>{card.productName}</strong> — {card.setName} #{card.number} · {card.rarity}
              </p>

              {/* Match explanation + OCR regions */}
              {frontImg && (
                <div className="text-xs bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 space-y-2">
                  <div className="space-y-0.5">
                    <p className="font-semibold text-blue-700">
                      How this was matched{frontImg.matchScore !== undefined ? ` · ${Math.round(frontImg.matchScore * 100)}% confidence` : ''}
                    </p>
                    <p className="text-blue-600">{frontImg.matchReason ?? 'Manual assignment'}</p>
                  </div>
                  {frontImg.ocr && (
                    <div className="grid grid-cols-2 gap-3 pt-1 border-t border-blue-200">
                      <div>
                        <p className="text-[10px] font-semibold text-blue-500 uppercase tracking-wide mb-1">Name region OCR</p>
                        <img src={frontImg.ocr.nameRegion.dataUrl} alt="name region"
                          className="w-full rounded border border-blue-200 mb-1" />
                        <p className="text-blue-700 font-medium">Read: "{frontImg.ocr.parsedName || '—'}"</p>
                        <p className="text-blue-400 text-[10px] break-all">{frontImg.ocr.nameRegion.rawText}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold text-blue-500 uppercase tracking-wide mb-1">Bottom region OCR</p>
                        <img src={frontImg.ocr.bottomRegion.dataUrl} alt="bottom region"
                          className="w-full rounded border border-blue-200 mb-1" />
                        <p className="text-blue-700 font-medium">
                          #{frontImg.ocr.parsedNumber || '—'}
                          {frontImg.ocr.parsedRarity ? ` · ${frontImg.ocr.parsedRarity}` : ''}
                          {frontImg.ocr.parsedSetCode ? ` · ${frontImg.ocr.parsedSetCode}` : ''}
                        </p>
                        <p className="text-blue-400 text-[10px] break-all">{frontImg.ocr.bottomRegion.rawText}</p>
                      </div>
                    </div>
                  )}
                  {!frontImg.ocr && (
                    <p className="text-blue-400">No OCR data — run OCR match to see image regions</p>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-gray-500 text-center uppercase tracking-wide">Your scan</p>
                  {frontImg
                    ? <img src={frontImg.objectUrl} alt="scan"
                        className="w-full rounded-xl border-2 border-blue-200 object-contain max-h-80" />
                    : <div className="w-full aspect-[2/3] bg-gray-100 rounded-xl flex items-center justify-center text-gray-400 text-sm">No scan assigned</div>
                  }
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-gray-500 text-center uppercase tracking-wide">Stock image</p>
                  {stockUrl
                    ? <img src={stockUrl} alt="stock"
                        className="w-full rounded-xl border-2 border-gray-200 object-contain max-h-80" />
                    : <div className="w-full aspect-[2/3] bg-gray-100 rounded-xl flex items-center justify-center text-gray-400 text-sm text-center px-4">
                        No stock image — load catalog above
                      </div>
                  }
                </div>
              </div>

              <div className="flex justify-between pt-1">
                <button
                  onClick={() => setReassignMode(true)}
                  disabled={!frontImg}
                  className="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 px-5 py-2 rounded-lg font-medium transition-colors disabled:opacity-40"
                >
                  Wrong card — reassign
                </button>
                <button
                  onClick={() => markVerified(card.tcgplayerId)}
                  className="bg-green-600 hover:bg-green-700 text-white px-8 py-2 rounded-lg font-medium transition-colors"
                >
                  Looks correct ✓
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      <div>
        <h2 className="text-xl font-semibold text-gray-900">Match Card Images</h2>
        <p className="text-sm text-gray-500 mt-1">
          Upload photos and run auto-match. Toggle F/B on a photo to mark front or back face,
          then click a card row to assign it. Suffix files with -back to auto-mark back faces on upload.
        </p>
      </div>

      {/* Batch SKU */}
      <div className="flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
        <div className="flex-shrink-0">
          <p className="text-xs font-semibold text-gray-700">Batch SKU / location</p>
          <p className="text-[11px] text-gray-400 mt-0.5">Set before each folder drop — change between folders to label each batch</p>
        </div>
        <input
          type="text"
          value={defaultSku}
          onChange={e => setDefaultSku(e.target.value)}
          placeholder="e.g. E-MTG-01-01"
          className="ml-auto w-56 text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400 text-gray-800 placeholder-gray-300"
        />
      </div>

      {/* Catalog stock image status (auto-loaded from CSV set names) */}
      <div className="flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
        <div className="flex-shrink-0">
          <p className="text-xs font-semibold text-gray-700">Stock image catalog</p>
          <p className="text-[11px] text-gray-400 mt-0.5">Auto-loaded from Scryfall for the sets in your CSV</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {catalogLoading && (
            <span className="text-[11px] text-blue-700 font-medium bg-blue-50 px-2 py-1 rounded-full border border-blue-200">
              <span className="inline-block animate-spin mr-1">⟳</span>{catalogStatus}
            </span>
          )}
          {!catalogLoading && catalogStore.size > 0 && (
            <span className="text-[11px] text-green-700 font-medium bg-green-50 px-2 py-1 rounded-full border border-green-200">
              {catalogStatus}
            </span>
          )}
          {!catalogLoading && catalogUnresolved.length > 0 && (
            <span
              className="text-[11px] text-orange-600 font-medium bg-orange-50 px-2 py-1 rounded-full border border-orange-200"
              title={catalogUnresolved.join('\n')}
            >
              {catalogUnresolved.length} unresolved
            </span>
          )}
        </div>
      </div>

      {/* Manual override for unresolved sets */}
      {!catalogLoading && catalogUnresolved.length > 0 && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl px-4 py-3 space-y-2">
          <p className="text-xs font-semibold text-orange-800">
            Couldn't auto-resolve {catalogUnresolved.length} set{catalogUnresolved.length !== 1 ? 's' : ''} — enter the Scryfall set code manually
          </p>
          <p className="text-[11px] text-orange-600">
            Find the code at scryfall.com/sets — e.g. "Commander: Teenage Mutant Ninja Turtles" → <code>tmc</code>
          </p>
          {catalogUnresolved.map(name => (
            <div key={name} className="flex items-center gap-2">
              <span className="text-xs text-gray-700 flex-1 truncate">{name}</span>
              <input
                type="text"
                value={manualCode[name] || ''}
                onChange={e => setManualCode(prev => ({ ...prev, [name]: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') void loadManualCode(name) }}
                placeholder="set code"
                className="w-24 text-xs border border-gray-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-orange-400"
              />
              <button
                onClick={() => void loadManualCode(name)}
                disabled={!(manualCode[name] || '').trim()}
                className="text-xs px-3 py-1 rounded-lg font-medium bg-orange-600 hover:bg-orange-700 disabled:bg-gray-200 disabled:text-gray-400 text-white"
              >
                Load
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Pairs mode toggle */}
      <div className="flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
        <div className="flex-shrink-0">
          <p className="text-xs font-semibold text-gray-700">Scanner pairs (front then back)</p>
          <p className="text-[11px] text-gray-400 mt-0.5">When enabled, files are treated as alternating front/back and matched together by OCR</p>
        </div>
        <label className="ml-auto flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={pairsMode}
            onChange={e => setPairsMode(e.target.checked)}
            className="w-4 h-4 accent-blue-600"
          />
          <span className="text-xs text-gray-700">{pairsMode ? 'On' : 'Off'}</span>
        </label>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl px-6 py-5 text-center cursor-pointer transition-colors
          ${dragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50'}`}
      >
        <input ref={inputRef} type="file" accept="image/*" multiple className="hidden"
          onChange={e => { if (e.target.files) loadFiles(e.target.files) }} />
        <p className="text-gray-700 font-medium">Drop card photos or a folder here, or click to browse</p>
        <p className="text-gray-400 text-xs mt-0.5">
          Name by card number (058.jpg) or card name (sol-ring.jpg).
          Back face: 058-back.jpg. Dropping a folder loads all images inside it.
        </p>
      </div>

      {/* Top toolbar */}
      <div className="flex flex-wrap items-center gap-3 min-h-[2rem]">
        {images.length > 0 && (
          <div className="flex gap-2 text-xs">
            <span className="bg-green-100 text-green-800 px-2.5 py-1 rounded-full font-medium">
              {matchedFronts.size} cards matched
            </span>
            {orphanedCount > 0 && (
              <span className="bg-yellow-100 text-yellow-800 px-2.5 py-1 rounded-full font-medium">
                {orphanedCount} photos unassigned
              </span>
            )}
          </div>
        )}

        {setNames.length > 1 && (
          <select value={scopeSet} onChange={e => setScopeSet(e.target.value)}
            className="text-xs border border-gray-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400">
            <option value="all">All decks ({cards.length} cards)</option>
            {setNames.map(s => (
              <option key={s} value={s}>{s} ({cards.filter(c => c.setName === s).length} cards)</option>
            ))}
          </select>
        )}

        {images.length > 0 && (
          <div className="ml-auto flex items-center gap-2">
            {(() => {
              const needsUpload = images.filter(i => i.assignedTo && !i.hostedUrl)
              const hostedCount = images.filter(i => i.hostedUrl).length
              return (
                <button
                  onClick={handleUploadToServer}
                  disabled={uploading || needsUpload.length === 0}
                  className={`text-xs px-4 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1.5
                    ${needsUpload.length > 0 && !uploading
                      ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                      : 'bg-gray-100 text-gray-400 cursor-default'}`}
                >
                  {uploading
                    ? <><span className="inline-block animate-spin">⟳</span> Uploading… {Math.round(uploadProgress * 100)}%</>
                    : hostedCount > 0
                      ? `☁ ${hostedCount} hosted${needsUpload.length > 0 ? ` · +${needsUpload.length} pending` : ' ✓'}`
                      : '☁ Upload to server'}
                </button>
              )
            })()}
            <button
              onClick={handleAutoMatch}
              disabled={matching || ocrRunning}
              title="Match by filename (fallback)"
              className="text-xs bg-gray-200 hover:bg-gray-300 disabled:bg-gray-100 text-gray-600 px-3 py-1.5 rounded-lg font-medium transition-colors"
            >
              Filename match
            </button>
            <button
              onClick={handleOcrMatch}
              disabled={ocrRunning || matching}
              className="text-xs bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white px-4 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-2"
            >
              {ocrRunning
                ? <><span className="inline-block animate-spin">⟳</span> OCR {ocrProgress.done}/{ocrProgress.total}</>
                : '⚡ Run OCR match'}
            </button>
          </div>
        )}
      </div>

      {matchStats && (
        <div className="text-xs text-gray-600 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
          Matched <strong>{matchStats.byFilename}</strong> image{matchStats.byFilename !== 1 ? 's' : ''}.
        </div>
      )}
      {images.length > 0 && images.every(i => !i.assignedTo && !i.ocr) && (
        <div className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
          <strong>Next step:</strong> click <strong>"⚡ Run OCR match"</strong> above to read the card name and collector number from each image. Use "Filename match" only if your filenames are named after card numbers (e.g. <code>060.jpg</code>).
        </div>
      )}
      {uploadError && (
        <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {uploadError}
        </div>
      )}

      {/* Main matcher */}
      {images.length > 0 && (
        <div className="grid gap-5" style={{ gridTemplateColumns: '2fr 3fr' }}>

          {/* Left: image tray */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-gray-600">Photos ({images.length})</span>
              <button
                onClick={() => setShowOrphanedOnly(v => !v)}
                className={`text-xs px-2 py-0.5 rounded-full font-medium transition-colors flex-shrink-0
                  ${showOrphanedOnly ? 'bg-yellow-100 text-yellow-700 ring-1 ring-yellow-300' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
              >
                {showOrphanedOnly ? `Orphaned (${orphanedCount})` : 'Orphaned only'}
              </button>
              {selectedImg && (
                <span className="text-xs text-blue-600 font-medium truncate max-w-[120px] ml-auto">
                  "{selectedImg.fileName}"
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2.5 max-h-[540px] overflow-y-auto pr-1">
              {displayImages.map(img => {
                const isSelected = img.id === selectedId
                const assignedCard = img.assignedTo ? cards.find(c => c.tcgplayerId === img.assignedTo) : null
                return (
                  <div
                    key={img.id}
                    draggable
                    onDragStart={e => {
                      setDraggedImageId(img.id)
                      e.dataTransfer.effectAllowed = 'move'
                    }}
                    onDragEnd={() => setDraggedImageId(null)}
                    onClick={() => setSelectedId(isSelected ? null : img.id)}
                    className={`relative rounded-xl overflow-hidden cursor-pointer border-2 transition-all select-none
                      ${isSelected
                        ? 'border-blue-500 ring-2 ring-blue-200 shadow-lg scale-[1.02]'
                        : assignedCard
                          ? 'border-gray-200 hover:border-blue-300 hover:shadow-md'
                          : 'border-yellow-300 hover:border-yellow-400 hover:shadow-md'}`}
                  >
                    <img src={img.objectUrl} alt={img.fileName} className="w-full aspect-[2/3] object-cover pointer-events-none" />
                    <button
                      onClick={e => { e.stopPropagation(); toggleSide(img.id) }}
                      className={`absolute top-2 left-2 text-[11px] font-bold w-7 h-7 rounded-full shadow-md flex items-center justify-center transition-colors
                        ${img.side === 'front' ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-purple-600 hover:bg-purple-700 text-white'}`}
                    >
                      {img.side === 'front' ? 'F' : 'B'}
                    </button>
                    {img.ocrStatus === 'running' && (
                      <div className="absolute top-2 right-2 w-5 h-5 bg-blue-600 rounded-full flex items-center justify-center shadow">
                        <span className="text-white text-[9px] font-bold animate-spin inline-block">⟳</span>
                      </div>
                    )}
                    {img.ocrStatus === 'done' && !img.hostedUrl && (
                      <div className="absolute top-2 right-2 w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center shadow" title="OCR done">
                        <span className="text-white text-[9px] font-bold">T</span>
                      </div>
                    )}
                    {img.ocrStatus === 'error' && (
                      <div className="absolute top-2 right-2 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center shadow" title="OCR failed">
                        <span className="text-white text-[9px] font-bold">!</span>
                      </div>
                    )}
                    {img.hostedUrl && (
                      <div className="absolute top-2 right-2 w-5 h-5 bg-emerald-600 rounded-full flex items-center justify-center shadow" title={img.hostedUrl}>
                        <span className="text-white text-[9px] font-bold">☁</span>
                      </div>
                    )}
                    <div className={`absolute bottom-0 left-0 right-0 px-2 py-1.5 text-[10px] leading-snug
                      ${assignedCard ? 'bg-green-800/85 text-white' : 'bg-yellow-900/75 text-white'}`}>
                      <div className="truncate font-medium">
                        {assignedCard ? assignedCard.productName : img.fileName}
                      </div>
                      {assignedCard && <div className="text-white/60">#{assignedCard.number}</div>}
                      {!assignedCard && <div className="text-yellow-200/80">unassigned</div>}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Right: card list */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-gray-600">
                Cards ({filteredCards.length}{scopeSet !== 'all' ? ` in ${scopeSet}` : ''})
              </span>
              <button
                onClick={() => setShowUnmatchedOnly(v => !v)}
                className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors flex-shrink-0
                  ${showUnmatchedOnly ? 'bg-yellow-100 text-yellow-700 ring-1 ring-yellow-300' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
              >
                {showUnmatchedOnly ? `Unmatched (${displayCards.length})` : 'Unmatched only'}
              </button>
              <input
                type="text"
                placeholder="Filter by name or #"
                value={filter}
                onChange={e => setFilter(e.target.value)}
                className="ml-auto text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 w-44 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            </div>

            {selectedImg && (
              <div className="text-xs text-blue-600 bg-blue-50 rounded-lg px-3 py-1.5 border border-blue-100">
                Click any card row to assign "{selectedImg.fileName}" as its{' '}
                <strong>{selectedImg.side === 'front' ? 'front' : 'back'} face</strong>.
              </div>
            )}

            <div className="space-y-1.5 max-h-[500px] overflow-y-auto pr-1">
              {displayCards.map(card => {
                const frontImg  = images.find(i => i.assignedTo === card.tcgplayerId && i.side === 'front')
                const backImg   = images.find(i => i.assignedTo === card.tcgplayerId && i.side === 'back')
                const hasAny    = !!(frontImg || backImg)
                const isAssigning   = !!selectedImg
                const isValidatable = !selectedImg && !!frontImg
                const isVerified    = verifiedIds.has(card.tcgplayerId)

                // Verified — collapsed row
                if (isVerified && !isAssigning) {
                  return (
                    <div key={card.tcgplayerId}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-green-100 bg-green-50">
                      <span className="text-green-500 text-xs font-bold flex-shrink-0">✓</span>
                      <span className="text-xs font-medium text-gray-600 truncate flex-1">{card.productName}</span>
                      <span className="text-xs text-gray-400 flex-shrink-0">#{card.number}</span>
                      <button
                        onClick={() => unverify(card.tcgplayerId)}
                        className="text-[10px] text-gray-400 hover:text-blue-600 flex-shrink-0 transition-colors"
                      >
                        re-check
                      </button>
                    </div>
                  )
                }

                const isDropTarget = !!draggedImageId
                return (
                  <div
                    key={card.tcgplayerId}
                    onClick={() => {
                      if (selectedImg) {
                        assign(selectedImg.id, card.tcgplayerId, selectedImg.side)
                      } else if (frontImg) {
                        openValidation(card)
                      }
                    }}
                    onDragOver={e => { if (draggedImageId) { e.preventDefault(); e.dataTransfer.dropEffect = 'move' } }}
                    onDrop={e => {
                      e.preventDefault()
                      if (draggedImageId) {
                        dropImageOnCard(draggedImageId, card.tcgplayerId)
                        setDraggedImageId(null)
                      }
                    }}
                    className={`flex items-center gap-3 px-3 py-2 rounded-xl border transition-all
                      ${hasAny ? 'border-green-200 bg-green-50' : 'border-gray-100 bg-gray-50'}
                      ${isAssigning ? 'cursor-pointer hover:border-blue-400 hover:bg-blue-50 hover:shadow-sm' :
                        isValidatable ? 'cursor-pointer hover:border-green-300 hover:shadow-sm' : ''}
                      ${isDropTarget ? 'ring-2 ring-blue-300 ring-offset-1' : ''}`}
                  >
                    <Slot img={frontImg} label="FRONT"
                      highlight={isAssigning && selectedImg?.side === 'front' ? 'blue' : null}
                      onUnassign={() => unassignSlot(card.tcgplayerId, 'front')} />
                    <Slot img={backImg} label="BACK"
                      highlight={isAssigning && selectedImg?.side === 'back' ? 'purple' : null}
                      onUnassign={() => unassignSlot(card.tcgplayerId, 'back')} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{card.productName}</p>
                      <p className="text-xs text-gray-400 truncate">
                        #{card.number} · {card.setName} · {card.condition}
                      </p>
                      {isValidatable && (
                        <span className="text-[10px] text-green-600 font-medium">Click to verify ↗</span>
                      )}
                      <input
                        type="text"
                        value={card.sku ?? ''}
                        onChange={e => onCards(setSku(cards, card.tcgplayerId, e.target.value))}
                        onClick={e => e.stopPropagation()}
                        placeholder="SKU / location"
                        className="mt-1 w-full text-xs border border-gray-200 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-400 text-gray-700 placeholder-gray-300 bg-white"
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-between pt-1">
        <button onClick={onBack} className="text-gray-600 hover:text-gray-800 px-4 py-2 rounded-lg font-medium transition-colors">← Back</button>
        <div className="flex gap-3">
          <button onClick={() => { onCards(cards); onNext() }}
            className="text-gray-600 hover:text-gray-800 px-4 py-2 rounded-lg font-medium border border-gray-300 transition-colors">Skip images</button>
          <button onClick={applyAndContinue}
            className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium transition-colors">Continue to Export →</button>
        </div>
      </div>
    </div>
  )
}

function Slot({ img, label, highlight, onUnassign }: {
  img: UploadedImage | undefined; label: string; highlight: 'blue' | 'purple' | null; onUnassign: () => void
}) {
  return (
    <div className="flex-shrink-0">
      <div className="text-[9px] text-gray-400 text-center mb-0.5 font-semibold tracking-wide">{label}</div>
      {img ? (
        <div className="relative group">
          <img src={img.objectUrl} alt={label} className="w-14 h-[4.375rem] object-cover rounded-lg border-2 border-green-300 shadow-sm" />
          <button onClick={e => { e.stopPropagation(); onUnassign() }}
            className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 hover:bg-red-600 text-white rounded-full text-[9px] items-center justify-center shadow hidden group-hover:flex transition-colors">✕</button>
        </div>
      ) : (
        <div className={`w-14 h-[4.375rem] rounded-lg border-2 border-dashed flex items-center justify-center text-xs font-bold transition-colors
          ${highlight === 'blue' ? 'border-blue-400 bg-blue-50 text-blue-400' :
            highlight === 'purple' ? 'border-purple-400 bg-purple-50 text-purple-400' :
            'border-gray-200 text-gray-300'}`}>
          {label[0]}
        </div>
      )}
    </div>
  )
}
