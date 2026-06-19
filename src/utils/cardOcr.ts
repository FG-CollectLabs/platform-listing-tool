import { createWorker, type Worker } from 'tesseract.js'

export interface OcrRegion {
  dataUrl: string   // cropped image region as data URL (for display)
  rawText: string   // raw OCR output
}

export interface CardOcrResult {
  nameRegion: OcrRegion
  bottomRegion: OcrRegion
  parsedName: string      // cleaned name text
  parsedNumber: string    // extracted collector number (digits only)
  parsedRarity: string    // R/U/C/M/L from "R 0054"
  parsedSetCode: string   // 3-4 letter set code like "TMC"
  confidence: number      // 0-1
}

// MTG card regions (relative fractions of card dimensions)
// Name bar: skip top bleed, crop before mana cost on the right.
const NAME_REGION    = { x: 0.06, y: 0.06, w: 0.72, h: 0.09 }
// Bottom info area: includes BOTH lines (rarity+number, set+lang+artist).
// Cropped to the left half so the copyright stack on the right side
// doesn't leak into OCR. We split Tesseract's output by newlines after.
const BOTTOM_REGION  = { x: 0.04, y: 0.875, w: 0.50, h: 0.070 }

let _worker: Worker | null = null

export async function initOcrWorker(): Promise<void> {
  if (_worker) return
  _worker = await createWorker('eng', 1, { logger: () => {} })
  // Restrict alphabet to characters that appear on MTG cards
  await _worker.setParameters({
    tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 ',-./★✦*",
  })
}

export async function terminateOcrWorker(): Promise<void> {
  if (_worker) {
    await _worker.terminate()
    _worker = null
  }
}

// Crop a fractional region of an image and return a data URL + scaled canvas
async function cropRegion(
  objectUrl: string,
  region: { x: number; y: number; w: number; h: number },
): Promise<{ dataUrl: string; canvas: HTMLCanvasElement }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const iw = img.naturalWidth
      const ih = img.naturalHeight
      const sx = Math.round(iw * region.x)
      const sy = Math.round(ih * region.y)
      const sw = Math.round(iw * region.w)
      const sh = Math.round(ih * region.h)

      // Scale up so OCR has enough pixels to work with (target ~180px tall)
      const scale = Math.max(1, 180 / sh)
      const canvas = document.createElement('canvas')
      canvas.width  = Math.round(sw * scale)
      canvas.height = Math.round(sh * scale)
      const ctx = canvas.getContext('2d')!
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)

      // Boost contrast: MTG name bar is light text on dark — invert helps Tesseract
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const d = imageData.data
      for (let i = 0; i < d.length; i += 4) {
        const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
        // Stretch contrast around midpoint
        const stretched = Math.min(255, Math.max(0, (gray - 80) * 1.8))
        d[i] = d[i + 1] = d[i + 2] = stretched
      }
      ctx.putImageData(imageData, 0, 0)

      resolve({ dataUrl: canvas.toDataURL('image/png'), canvas })
    }
    img.onerror = () => reject(new Error('Failed to load image for OCR'))
    img.src = objectUrl
  })
}

// Parse line 1: "R 0045" → { rarity: 'R', number: '45' }
function parseLine1(text: string): { rarity: string; number: string } {
  // Skip leading non-letter/digit junk, then [rarity letter] then [number].
  const both = text.match(/^[^A-Z0-9]*([CURML])[^0-9]*(\d{1,4})/i)
  if (both) return { rarity: both[1].toUpperCase(), number: parseInt(both[2], 10).toString() }
  // Number only (rarity may have OCR'd poorly)
  const num = text.match(/\b(\d{1,4})\b/)
  return { rarity: '', number: num ? parseInt(num[1], 10).toString() : '' }
}

// Parse line 2: "TMC · EN ★ LORDIGAN" → 'TMC'
function parseSetCode(text: string): string {
  // First 3-4 alpha sequence at the start (after optional non-letter junk).
  // Filter out language codes that might come first if set code OCR'd badly.
  const SET_IGNORE = new Set(['EN','JA','FR','DE','ES','IT','PT','RU','ZH','KO','TM','WB'])
  const matches = text.toUpperCase().match(/[A-Z]{3,4}/g) ?? []
  for (const m of matches) {
    if (!SET_IGNORE.has(m)) return m
  }
  return ''
}

function cleanName(text: string): string {
  // Remove non-printable junk, collapse whitespace
  return text.replace(/[^A-Za-z0-9 ',\-]/g, ' ').replace(/\s+/g, ' ').trim()
}

export async function analyzeCard(objectUrl: string): Promise<CardOcrResult> {
  if (!_worker) await initOcrWorker()
  const worker = _worker!

  const [nameData, bottomData] = await Promise.all([
    cropRegion(objectUrl, NAME_REGION),
    cropRegion(objectUrl, BOTTOM_REGION),
  ])

  const [nameResult, bottomResult] = await Promise.all([
    worker.recognize(nameData.canvas),
    worker.recognize(bottomData.canvas),
  ])

  const rawName   = nameResult.data.text.trim()
  const rawBottom = bottomResult.data.text.trim()
  const nameConf  = nameResult.data.confidence / 100
  const botConf   = bottomResult.data.confidence / 100

  const parsedName = cleanName(rawName)

  // Tesseract preserves newlines in its output — split into lines.
  // Line 1 is the rarity+number row, line 2 is the set+lang+artist row.
  const lines = rawBottom.split('\n').map(l => l.trim()).filter(l => l.length > 0)
  const rawLine1 = lines[0] || ''
  const rawLine2 = lines[1] || ''

  // If splitting failed (e.g. lines merged into one), fall back to whole text
  const { rarity: parsedRarity, number: parsedNumber } = parseLine1(rawLine1 || rawBottom)
  const parsedSetCode = parseSetCode(rawLine2 || rawBottom)

  return {
    nameRegion:   { dataUrl: nameData.dataUrl,   rawText: rawName },
    bottomRegion: { dataUrl: bottomData.dataUrl, rawText: rawBottom },
    parsedName,
    parsedNumber,
    parsedRarity,
    parsedSetCode,
    confidence: (nameConf + botConf) / 2,
  }
}
