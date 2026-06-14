import { useRef, useState, useCallback } from 'react'
import type { TcgCard } from '../types'
import { uploadImage } from '../utils/imageApi'

interface UploadedImage {
  id: string
  objectUrl: string
  fileName: string
  side: 'front' | 'back'
  assignedTo: string | null   // tcgplayerId
  hostedUrl?: string          // URL after upload to server
  hostedId?: string           // server ID for the uploaded image
}

// ─── filename matching ────────────────────────────────────────────────────────

function normalizeBase(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function filenameScore(fileName: string, card: TcgCard): number {
  const stripped = fileName.toLowerCase()
    .replace(/\.[^.]+$/, '')
    .replace(/[-_](back|b)$/, '')
    .replace(/\(back\)$/, '')
  const base = normalizeBase(stripped)
  const num = card.number.replace(/\D/g, '')
  const name = normalizeBase(card.productName)

  if (num && (base === num || base === num.padStart(3, '0'))) return 1.0
  if (base === name) return 0.9
  if (name.length >= 5 && (base.includes(name) || name.includes(base))) return 0.75
  const tokens = (name.match(/[a-z0-9]{3,}/g) ?? [])
  const overlap = tokens.filter(t => base.includes(t)).length
  return overlap >= 2 ? 0.5 : 0
}

function isBackFilename(fileName: string): boolean {
  const s = fileName.toLowerCase().replace(/\.[^.]+$/, '')
  return /[-_](back|b)$/.test(s) || /\(back\)$/.test(s)
}

function quickFilenameMatch(imgs: UploadedImage[], cards: TcgCard[]): UploadedImage[] {
  const usedFront = new Set(imgs.filter(i => i.assignedTo && i.side === 'front').map(i => i.assignedTo!))
  const usedBack  = new Set(imgs.filter(i => i.assignedTo && i.side === 'back').map(i => i.assignedTo!))
  return imgs.map(img => {
    if (img.assignedTo) return img
    const usedSet = img.side === 'front' ? usedFront : usedBack
    let best: { card: TcgCard; score: number } | null = null
    for (const card of cards) {
      const s = filenameScore(img.fileName, card)
      if (s >= 0.75 && (!best || s > best.score)) best = { card, score: s }
    }
    if (best && !usedSet.has(best.card.tcgplayerId)) {
      usedSet.add(best.card.tcgplayerId)
      return { ...img, assignedTo: best.card.tcgplayerId }
    }
    return img
  })
}

// ─── component ────────────────────────────────────────────────────────────────

interface Props {
  cards: TcgCard[]
  onCards: (cards: TcgCard[]) => void
  onBack: () => void
  onNext: () => void
}

function setSku(cards: TcgCard[], tcgplayerId: string, sku: string): TcgCard[] {
  return cards.map(c => c.tcgplayerId === tcgplayerId ? { ...c, sku: sku || undefined } : c)
}

export default function Step3Images({ cards, onCards, onBack, onNext }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [images, setImages]         = useState<UploadedImage[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filter, setFilter]         = useState('')
  const [scopeSet, setScopeSet]     = useState('all')
  const [dragging, setDragging]     = useState(false)
  const [matching, setMatching]     = useState(false)
  const [matchStats, setMatchStats] = useState<{ byFilename: number } | null>(null)
  const [uploading, setUploading]   = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const setNames = Array.from(new Set(cards.map(c => c.setName))).sort()
  const scopedCards = scopeSet === 'all' ? cards : cards.filter(c => c.setName === scopeSet)
  const filteredCards = filter
    ? scopedCards.filter(c =>
        c.productName.toLowerCase().includes(filter.toLowerCase()) || c.number.includes(filter)
      )
    : scopedCards

  function addImageFiles(files: File[]) {
    const newImgs: UploadedImage[] = files
      .filter(f => f.type.startsWith('image/'))
      .map(f => ({
        id: crypto.randomUUID(),
        objectUrl: URL.createObjectURL(f),
        fileName: f.name,
        side: isBackFilename(f.name) ? 'back' : 'front' as 'front' | 'back',
        assignedTo: null,
      }))
    setImages(prev => quickFilenameMatch([...prev, ...newImgs], scopedCards))
  }

  function loadFiles(files: FileList) {
    addImageFiles(Array.from(files))
  }

  // Recursively collect all image files from a dropped directory entry
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

  const onDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false)

    // Use DataTransferItemList to support dropped folders
    const items = Array.from(e.dataTransfer.items)
    const hasEntries = items.length > 0 && typeof items[0].webkitGetAsEntry === 'function'

    if (hasEntries) {
      const entries = items.map(i => i.webkitGetAsEntry()).filter(Boolean) as FileSystemEntry[]
      const files = (await Promise.all(entries.map(collectFromEntry))).flat()
      // Sort by name so front/back pairs stay ordered
      files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
      addImageFiles(files)
    } else {
      loadFiles(e.dataTransfer.files)
    }
  }, [images, scopedCards])

  function toggleSide(id: string) {
    setImages(prev => prev.map(img =>
      img.id === id ? { ...img, side: img.side === 'front' ? 'back' : 'front' } : img
    ))
  }

  function assign(imgId: string, tcgplayerId: string, side: 'front' | 'back') {
    setImages(prev => prev.map(img =>
      img.id === imgId ? { ...img, assignedTo: tcgplayerId, side } : img
    ))
    setSelectedId(null)
  }

  function unassignSlot(tcgplayerId: string, side: 'front' | 'back') {
    setImages(prev => prev.map(img =>
      img.assignedTo === tcgplayerId && img.side === side ? { ...img, assignedTo: null } : img
    ))
  }

  async function handleAutoMatch() {
    setMatching(true); setMatchStats(null)
    const target = scopedCards
    let byFilename = 0

    const work = images.map(i => ({ ...i }))
    const usedFront = new Set(work.filter(i => i.assignedTo && i.side === 'front').map(i => i.assignedTo!))
    const usedBack  = new Set(work.filter(i => i.assignedTo && i.side === 'back').map(i => i.assignedTo!))

    for (const img of work) {
      if (img.assignedTo) continue
      const usedSet = img.side === 'front' ? usedFront : usedBack
      let best: { card: TcgCard; score: number } | null = null
      for (const card of target) {
        const s = filenameScore(img.fileName, card)
        if (s >= 0.7 && (!best || s > best.score)) best = { card, score: s }
      }
      if (best && !usedSet.has(best.card.tcgplayerId)) {
        img.assignedTo = best.card.tcgplayerId
        usedSet.add(best.card.tcgplayerId)
        byFilename++
      }
    }

    setImages([...work]); setMatchStats({ byFilename }); setMatching(false)
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
        // Use hosted URL in CSV if available, else fall back to local filename
        imageFileName:      frontImg?.hostedUrl ?? frontImg?.fileName,
        imageObjectUrlBack: backImg?.objectUrl,
        imageFileNameBack:  backImg?.hostedUrl ?? backImg?.fileName,
      }
    })
    onCards(updated)
    onNext()
  }

  const selectedImg     = selectedId ? images.find(i => i.id === selectedId) : null
  const matchedFronts   = new Set(images.filter(i => i.assignedTo && i.side === 'front').map(i => i.assignedTo!))
  const unassignedCount = images.filter(i => !i.assignedTo).length

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Match Card Images</h2>
        <p className="text-sm text-gray-500 mt-1">
          Upload photos and run auto-match. Toggle <strong className="text-blue-700">F</strong> / <strong className="text-purple-700">B</strong> on a photo
          to mark front or back face, then click a card row to assign it.
          Suffix files with <code className="text-xs bg-gray-100 px-1 rounded">-back</code> to auto-mark back faces on upload.
        </p>
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
          Name by card number (<code>058.jpg</code>) or card name (<code>sol-ring.jpg</code>).
          Back face: <code>058-back.jpg</code>. Dropping a folder loads all images inside it.
        </p>
      </div>

      {/* Top toolbar */}
      <div className="flex flex-wrap items-center gap-3 min-h-[2rem]">
        {images.length > 0 && (
          <div className="flex gap-2 text-xs">
            <span className="bg-green-100 text-green-800 px-2.5 py-1 rounded-full font-medium">
              {matchedFronts.size} cards matched
            </span>
            {unassignedCount > 0 && (
              <span className="bg-yellow-100 text-yellow-800 px-2.5 py-1 rounded-full font-medium">
                {unassignedCount} photos unmatched
              </span>
            )}
          </div>
        )}

        {setNames.length > 1 && (
          <select
            value={scopeSet}
            onChange={e => setScopeSet(e.target.value)}
            className="text-xs border border-gray-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400"
          >
            <option value="all">All decks ({cards.length} cards)</option>
            {setNames.map(s => (
              <option key={s} value={s}>{s} ({cards.filter(c => c.setName === s).length} cards)</option>
            ))}
          </select>
        )}

        {images.length > 0 && (
          <div className="ml-auto flex items-center gap-2">
            {/* Upload to server */}
            {(() => {
              const needsUpload = images.filter(i => i.assignedTo && !i.hostedUrl)
              const hostedCount = images.filter(i => i.hostedUrl).length
              return (
                <button
                  onClick={handleUploadToServer}
                  disabled={uploading || needsUpload.length === 0}
                  title={needsUpload.length === 0 ? 'All assigned images are hosted' : `Upload ${needsUpload.length} image${needsUpload.length > 1 ? 's' : ''} to server`}
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

            {/* Auto-match */}
            <button
              onClick={handleAutoMatch}
              disabled={matching}
              className="text-xs bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white px-4 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-2"
            >
              {matching
                ? <><span className="inline-block animate-spin">⟳</span> Matching…</>
                : '⚡ Run auto-match'}
            </button>
          </div>
        )}
      </div>

      {matchStats && (
        <div className="text-xs text-gray-600 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
          Auto-match assigned <strong>{matchStats.byFilename}</strong> image{matchStats.byFilename !== 1 ? 's' : ''} by filename.
          Drag remaining unmatched photos to a card row, or rename files to card numbers (e.g. <code className="bg-blue-100 px-0.5 rounded">058.jpg</code>) before uploading.
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

          {/* ── Left: image tray ── */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-600">Photos ({images.length})</span>
              {selectedImg && (
                <span className="text-xs text-blue-600 font-medium truncate max-w-[160px]">
                  "{selectedImg.fileName}" selected
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2.5 max-h-[540px] overflow-y-auto pr-1">
              {images.map(img => {
                const isSelected = img.id === selectedId
                const assignedCard = img.assignedTo ? cards.find(c => c.tcgplayerId === img.assignedTo) : null
                return (
                  <div
                    key={img.id}
                    onClick={() => setSelectedId(isSelected ? null : img.id)}
                    className={`relative rounded-xl overflow-hidden cursor-pointer border-2 transition-all select-none
                      ${isSelected
                        ? 'border-blue-500 ring-2 ring-blue-200 shadow-lg scale-[1.02]'
                        : 'border-gray-200 hover:border-blue-300 hover:shadow-md'}`}
                  >
                    <img src={img.objectUrl} alt={img.fileName} className="w-full aspect-[2/3] object-cover" />

                    {/* F / B toggle */}
                    <button
                      onClick={e => { e.stopPropagation(); toggleSide(img.id) }}
                      title="Toggle front / back"
                      className={`absolute top-2 left-2 text-[11px] font-bold w-7 h-7 rounded-full shadow-md flex items-center justify-center transition-colors
                        ${img.side === 'front'
                          ? 'bg-blue-600 hover:bg-blue-700 text-white'
                          : 'bg-purple-600 hover:bg-purple-700 text-white'}`}
                    >
                      {img.side === 'front' ? 'F' : 'B'}
                    </button>

                    {/* Hosted indicator */}
                    {img.hostedUrl && (
                      <div className="absolute top-2 right-2 w-5 h-5 bg-emerald-600 rounded-full flex items-center justify-center shadow"
                        title={img.hostedUrl}>
                        <span className="text-white text-[9px] font-bold">☁</span>
                      </div>
                    )}

                    {/* Assignment label at bottom */}
                    <div className={`absolute bottom-0 left-0 right-0 px-2 py-1.5 text-[10px] leading-snug
                      ${assignedCard ? 'bg-green-800/85 text-white' : 'bg-black/65 text-white/75'}`}>
                      <div className="truncate font-medium">
                        {assignedCard ? assignedCard.productName : img.fileName}
                      </div>
                      {assignedCard && (
                        <div className="text-white/60">#{assignedCard.number}</div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* ── Right: card list ── */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-gray-600">
                Cards ({filteredCards.length}{scopeSet !== 'all' ? ` in ${scopeSet}` : ''})
              </span>
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
                Click any card row to assign "<strong>{selectedImg.fileName}</strong>" as its{' '}
                <strong>{selectedImg.side === 'front' ? 'front' : 'back'} face</strong>.
                Toggle F/B on the photo first if needed.
              </div>
            )}

            <div className="space-y-1.5 max-h-[500px] overflow-y-auto pr-1">
              {filteredCards.map(card => {
                const frontImg = images.find(i => i.assignedTo === card.tcgplayerId && i.side === 'front')
                const backImg  = images.find(i => i.assignedTo === card.tcgplayerId && i.side === 'back')
                const hasAny   = !!(frontImg || backImg)
                const isClickable = !!selectedImg

                return (
                  <div
                    key={card.tcgplayerId}
                    onClick={() => {
                      if (!selectedImg) return
                      assign(selectedImg.id, card.tcgplayerId, selectedImg.side)
                    }}
                    className={`flex items-center gap-3 px-3 py-2 rounded-xl border transition-all
                      ${hasAny ? 'border-green-200 bg-green-50' : 'border-gray-100 bg-gray-50'}
                      ${isClickable ? 'cursor-pointer hover:border-blue-400 hover:bg-blue-50 hover:shadow-sm' : ''}`}
                  >
                    {/* Front slot */}
                    <Slot
                      img={frontImg}
                      label="FRONT"
                      highlight={isClickable && selectedImg?.side === 'front' ? 'blue' : null}
                      onUnassign={() => unassignSlot(card.tcgplayerId, 'front')}
                    />

                    {/* Back slot */}
                    <Slot
                      img={backImg}
                      label="BACK"
                      highlight={isClickable && selectedImg?.side === 'back' ? 'purple' : null}
                      onUnassign={() => unassignSlot(card.tcgplayerId, 'back')}
                    />

                    {/* Card info + SKU */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{card.productName}</p>
                      <p className="text-xs text-gray-400 truncate">
                        #{card.number} · {card.setName} · {card.condition}
                      </p>
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
        <button onClick={onBack}
          className="text-gray-600 hover:text-gray-800 px-4 py-2 rounded-lg font-medium transition-colors">
          ← Back
        </button>
        <div className="flex gap-3">
          <button onClick={() => { onCards(cards); onNext() }}
            className="text-gray-600 hover:text-gray-800 px-4 py-2 rounded-lg font-medium border border-gray-300 transition-colors">
            Skip images
          </button>
          <button onClick={applyAndContinue}
            className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium transition-colors">
            Continue to Export →
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Slot sub-component ───────────────────────────────────────────────────────

function Slot({
  img, label, highlight, onUnassign,
}: {
  img: UploadedImage | undefined
  label: string
  highlight: 'blue' | 'purple' | null
  onUnassign: () => void
}) {
  return (
    <div className="flex-shrink-0">
      <div className="text-[9px] text-gray-400 text-center mb-0.5 font-semibold tracking-wide">{label}</div>
      {img ? (
        <div className="relative group">
          <img src={img.objectUrl} alt={label}
            className="w-14 h-[4.375rem] object-cover rounded-lg border-2 border-green-300 shadow-sm" />
          <button
            onClick={e => { e.stopPropagation(); onUnassign() }}
            className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 hover:bg-red-600 text-white rounded-full text-[9px] items-center justify-center shadow hidden group-hover:flex transition-colors"
          >✕</button>
        </div>
      ) : (
        <div className={`w-14 h-[4.375rem] rounded-lg border-2 border-dashed flex items-center justify-center text-xs font-bold transition-colors
          ${highlight === 'blue'   ? 'border-blue-400 bg-blue-50 text-blue-400' :
            highlight === 'purple' ? 'border-purple-400 bg-purple-50 text-purple-400' :
            'border-gray-200 text-gray-300'}`}
        >
          {label[0]}
        </div>
      )}
    </div>
  )
}
