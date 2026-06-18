import { createWorker, type Worker } from 'tesseract.js'

export interface OcrRegion {
  dataUrl: string   // cropped image region as data URL (for display)
  rawText: string   // raw OCR output
}

export interface CardOcrResult {
  nameRegion: OcrRegion
  bottomRegion: OcrRegion
  parsedName: string     // cleaned name text
  parsedNumber: string   // extracted collector number (digits only)
  confidence: number     // 0-1
}

// MTG card regions (relative fractions of card dimensions)
// Name bar: skip top bleed, crop before mana cost on the right.
// Pulled in slightly from the left edge to avoid black border bleed
// causing Tesseract to read a phantom "f" / "l" before the name.
const NAME_REGION    = { x: 0.06, y: 0.06, w: 0.72, h: 0.09 }
// Bottom info line: rarity letter + collector number + set code + language.
// Modern MTG cards have this around y=88-94%; the top edge (86-88%) often
// includes the power/toughness box from the rules section above.
const BOTTOM_REGION  = { x: 0.04, y: 0.88, w: 0.92, h: 0.06 }

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

// Pull the collector number from the bottom line text.
// MTG format examples: "060/240", "★ 060", "R 0054", "C 060", "#060", "0060 ★"
// Priority order avoids picking up power/toughness ("0/1") from rules box bleed.
function extractNumber(text: string): string {
  // 1. Rarity letter + number ("R 0054", "C 060", "U 32", "M 071", "L 134")
  // This is the canonical MTG collector number format — highest priority.
  const rarityMatch = text.match(/\b([CURML])\s+(\d{1,4})\b/i)
  if (rarityMatch) return parseInt(rarityMatch[2], 10).toString()

  // 2. "nnn/NNN" collector slash total — only if the denominator is plausibly
  // a set size (>= 30). Power/toughness like "0/1", "2/3" get rejected.
  const slashMatch = text.match(/\b(\d{1,4})\/(\d{1,4})\b/)
  if (slashMatch && parseInt(slashMatch[2], 10) >= 30) {
    return parseInt(slashMatch[1], 10).toString()
  }

  // 3. Preceded by ★ ✦ * #
  const symbolMatch = text.match(/[★✦*#]\s*(\d{1,4})/)
  if (symbolMatch) return parseInt(symbolMatch[1], 10).toString()

  // 4. Standalone 3-4 digit number (more likely a collector number than a stat)
  const longBareMatch = text.match(/(?<!\d)(\d{3,4})(?!\d)/)
  if (longBareMatch) return parseInt(longBareMatch[1], 10).toString()

  // 5. Bare 1-2 digit fallback
  const bareMatch = text.match(/(?<!\d)(\d{1,4})(?!\d)/)
  if (bareMatch) return parseInt(bareMatch[1], 10).toString()

  return ''
}

function cleanName(text: string): string {
  // Remove non-printable junk, collapse whitespace
  return text.replace(/[^A-Za-z0-9 ',\-]/g, ' ').replace(/\s+/g, ' ').trim()
}

export async function analyzeCard(objectUrl: string): Promise<CardOcrResult> {
  if (!_worker) await initOcrWorker()
  const worker = _worker!

  const [nameRegionData, bottomRegionData] = await Promise.all([
    cropRegion(objectUrl, NAME_REGION),
    cropRegion(objectUrl, BOTTOM_REGION),
  ])

  const [nameResult, bottomResult] = await Promise.all([
    worker.recognize(nameRegionData.canvas),
    worker.recognize(bottomRegionData.canvas),
  ])

  const rawName   = nameResult.data.text.trim()
  const rawBottom = bottomResult.data.text.trim()
  const nameConf  = nameResult.data.confidence / 100
  const botConf   = bottomResult.data.confidence / 100

  const parsedName   = cleanName(rawName)
  const parsedNumber = extractNumber(rawBottom)

  return {
    nameRegion:   { dataUrl: nameRegionData.dataUrl,   rawText: rawName },
    bottomRegion: { dataUrl: bottomRegionData.dataUrl, rawText: rawBottom },
    parsedName,
    parsedNumber,
    confidence: (nameConf + botConf) / 2,
  }
}
