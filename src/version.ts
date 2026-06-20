export const VERSION = '2.0.0'

export interface Release {
  version: string
  date: string
  notes: string[]
}

export const CHANGELOG: Release[] = [
  {
    version: '2.0.0',
    date: '2026-06-20',
    notes: [
      'Image hosting migrated from homelab Docker volume to Cloudflare R2 (https://images.futuregadgetlabs.com). Fixes the silent 524-timeout failure that was losing images on a percentage of new listings',
      'Uploads now stored at YYYY-MM/{uuid}.{ext} so old months can be retired without touching newer listings',
      'Image Library redesigned: month-folder navigation with per-month archive workflow — Archive moves a month to TODELETE/, Restore puts it back, Purge permanently deletes',
      'New backend endpoints: GET /api/months, POST /api/months/archive, POST /api/months/restore, DELETE /api/months/purge, GET /api/image, DELETE /api/image',
    ],
  },
  {
    version: '1.10.1',
    date: '2026-06-19',
    notes: [
      'eBay CSV: C:Graded uses full eBay-approved label "Ungraded: Not in original packaging or professionally graded"',
      'eBay CSV: C:Card Condition uses full descriptive label "Near Mint or Better: Comparable to a fresh pack" (and equivalents for LP/MP/HP/DMG)',
      'Default description updated — combined shipping happens automatically on eBay\'s side once a Combined Shipping Discount is set up in seller hub',
    ],
  },
  {
    version: '1.10.0',
    date: '2026-06-19',
    notes: [
      'eBay CSV: added Location, PostalCode, ShippingType, ShippingService-1, DispatchTimeMax, Returns columns — fixes "Location missing", "shipping service not specified", "Return policy not specified" warnings',
      'eBay CSV: default category ID changed 2536 → 183454 (current MTG Individual Cards) — fixes "Invalid category" warning',
      'eBay CSV: smarter title truncation — drops "Commander:" prefix and shortens set name with … so the trailing condition + MTG is no longer chopped off',
      'eBay CSV: 3rd photo is now the Scryfall stock image (resolved from catalog) instead of the TCGPlayer CDN URL',
      'Pricing: new competitive discount rule — by default, $1 off buyer total for cards above $5 (toggleable in Step 2)',
      'Step 2: new section for Item location, ZIP, Shipping service / cost, Returns accepted / window',
    ],
  },
  {
    version: '1.9.5',
    date: '2026-06-19',
    notes: [
      'Step 3 multi-select: now uses the F/B tags on each tile (not file order) to determine which goes where',
      'Step 3 multi-select: orange warning when both selected images are tagged the same side — flip one via the F/B badge before assigning',
      'Step 3: "Continue to Export" is now blocked until every assigned image has been uploaded to the server (hostedUrl present)',
    ],
  },
  {
    version: '1.9.4',
    date: '2026-06-19',
    notes: [
      'Step 3: multi-select image tiles — click multiple thumbnails to pick the front AND back at once, then click a card to assign both. Order badge (1, 2) shows which is which',
    ],
  },
  {
    version: '1.9.3',
    date: '2026-06-19',
    notes: [
      'Step 3: manual click-to-assign now respects pairs mode — picking one image and clicking a card assigns both the front AND the paired back at once',
      'Hint banner updated when an image is selected and pairs mode is on',
    ],
  },
  {
    version: '1.9.2',
    date: '2026-06-19',
    notes: [
      'Step 3 catalog: commander-aware set resolution — "Commander: TMNT" no longer falls through to the standalone "TMNT" set for stock images',
      'Step 3 OCR: parseLine1 now finds the rarity letter anywhere in the line, not just at the start. Handles OCR noise like "EE M 0009" (© misread)',
    ],
  },
  {
    version: '1.9.1',
    date: '2026-06-19',
    notes: [
      'Step 3 OCR: bottom region back to one larger crop (was missing text in the narrow two-crop split). Tesseract\'s output is now split by newlines — line 1 → rarity+number, line 2 → set code',
    ],
  },
  {
    version: '1.9.0',
    date: '2026-06-19',
    notes: [
      'Step 3 OCR: bottom split into two separate line crops — Line 1 (R 0045) parsed as rarity + number, Line 2 (TMC · EN · ARTIST) parsed as set code. No more reading copyright noise',
      'Step 3: stricter back detection — backs no longer mis-classified as fronts when Tesseract hallucinates 3-char noise from card-back texture',
      'Step 3: backs now reliably pair to their fronts via in-loop pair map (fixes race where React state batching hid the front\'s match)',
      'Step 3: post-OCR pass attaches any straggler backs to their matched fronts',
    ],
  },
  {
    version: '1.8.2',
    date: '2026-06-18',
    notes: [
      'Step 3: pairs by filename — "001.jpg" and "001-back.jpg" are paired together (same card key), regardless of sort order',
      'Step 3: folder name included in pair key so "001.jpg" in different dropped folders does not cross-pair',
    ],
  },
  {
    version: '1.8.1',
    date: '2026-06-18',
    notes: [
      'Step 3 OCR: now runs on EVERY image, not just fronts. OCR decides side: text found = front (match to card); no text = back (paired with previous front)',
      'Step 3: works regardless of whether your scanner outputs one-per-card or alternating F+B — no need to predict the workflow',
      'Step 3: OCR result shown on each unassigned image tile so blank backs are visible at a glance',
      'Step 3: match threshold lowered to 0.40 so partial OCR reads still match',
    ],
  },
  {
    version: '1.8.0',
    date: '2026-06-18',
    notes: [
      'Step 3 OCR: bottom region now extracts rarity (R/U/C/M/L) and set code (TMC, etc) alongside the number',
      'Step 3 OCR: matching now boosts when rarity + set match the card (and penalizes when they mismatch)',
      'Step 3 catalog: token-based set name matching — "Commander: TMNT" now resolves to its actual Scryfall set even if word order differs',
      'Step 3 catalog: per-set manual code override UI appears for any sets that auto-resolve fails',
      'Step 3: Pairs mode default ON; pairsMode toggle now actually takes effect after dropping files (was captured stale by useCallback)',
    ],
  },
  {
    version: '1.7.1',
    date: '2026-06-18',
    notes: [
      'Step 3: Pairs mode defaults to OFF — folders of front-only scans no longer get every other image mislabeled as a back',
      'Step 3: fixed OCR closure bug — only the first match was firing because handleOcrMatch saw stale images',
      'Step 3 catalog: stricter set-name resolution — "Commander: TMNT" no longer falls through to "TMNT" stock images',
    ],
  },
  {
    version: '1.7.0',
    date: '2026-06-18',
    notes: [
      'Step 3: stock images auto-load from Scryfall for every set in your CSV — no more typing set codes (mixed-set decks like TMNT Commander + TMNT supported)',
      'Step 3: OCR runs automatically right after files are dropped',
      'Step 3: "Scanner pairs" toggle (ON by default) — files dropped in sorted order are alternating front/back; OCR matches the front and the back auto-attaches via shared pairKey',
      'Step 3: drag-and-drop an image from the photo tray onto any card row to assign it; paired back tags along',
      'Step 3: "Looks correct" now auto-advances to the next unverified card',
      'Step 3 OCR: improved number extraction — prefers "R 0054" rarity-letter pattern over "0/1" power/toughness bleed',
    ],
  },
  {
    version: '1.6.2',
    date: '2026-06-18',
    notes: [
      'Step 3 OCR: bottom region moved up (y=87-92% instead of 92.5-99%) — was previously cropping just card edge',
      'Step 3 OCR: name region pulled in 3% from left to avoid border bleed (e.g. phantom "f" before "Rain-Slicked Copse")',
      'Step 3 OCR: Levenshtein fuzzy match — close-but-not-exact OCR (≥92% similarity = 85% score, ≥82% = 75%, ≥72% = 60%)',
    ],
  },
  {
    version: '1.6.1',
    date: '2026-06-18',
    notes: [
      'Step 3: stopped auto-matching on file drop — scanner filenames like 054.jpg were being falsely matched to card #54',
      'Step 3: added prompt after drop pointing to the OCR match button',
    ],
  },
  {
    version: '1.6.0',
    date: '2026-06-18',
    notes: [
      'Step 3: OCR matching — "Run OCR match" reads the name bar (top) and collector number (bottom-right) of each card image using Tesseract.js; no filename used',
      'Step 3: verify modal now shows the cropped name/bottom regions and what OCR read from each',
      'Step 3: "Filename match" button kept as fallback for images where OCR fails',
    ],
  },
  {
    version: '1.5.0',
    date: '2026-06-18',
    notes: [
      'Step 3: verify modal shows match explanation — how the filename was parsed, which rule fired, confidence %',
      'Step 3: "Wrong card — reassign" opens wider modal with full-size scan; back image also moves with the front',
      'Step 3: verified cards collapse into a thin row after "Looks correct" — click "re-check" to re-open',
      'Step 3: "Orphaned only" toggle in photo tray — shows only unassigned images, highlighted in yellow',
    ],
  },
  {
    version: '1.4.1',
    date: '2026-06-15',
    notes: [
      'Step 3: stock images now loaded from Scryfall (fixes CORS issue with previous market-tracker approach)',
      'Step 3: "Wrong card — reassign" now opens an inline search instead of just unassigning; pick the correct card to swap the scan; cards that already have a scan show a warning',
    ],
  },
  {
    version: '1.4.0',
    date: '2026-06-15',
    notes: [
      'Step 3: catalog loader — enter a set code (e.g. tmc) to pull stock images; used in side-by-side validation modal',
      'Step 3: matching tiebreaker — when NM and NM Foil rows share the same card number, non-foil is preferred so photos match the correct row',
    ],
  },
  {
    version: '1.3.1',
    date: '2026-06-14',
    notes: [
      'Title format: {name} - {set} #{number} - {foil}{condition_abbr} MTG (e.g. "Ninja Pizza - TMNT Commander #32 - Foil NM MTG")',
      'New {condition_abbr} token: NM / LP / MP / HP / DMG',
    ],
  },
  {
    version: '1.3.0',
    date: '2026-06-14',
    notes: [
      'Step 3: "Unmatched only" toggle in card list — quickly find cards without a photo assigned',
      'Step 3: click any matched card row to verify — side-by-side comparison of your scan vs. TCGPlayer stock image; accept or reassign',
      'eBay export: TCGPlayer stock image added as 3rd photo (front | back | stock)',
      'eBay export: added Type (Individual Card), Professional Grader, Certification Number, Grade (Does Not Apply) item specifics',
      'Packaging description default changed to "Shipped in a penny sleeve and card saver" — still configurable in Step 2',
      'Layout widened for easier reading of card names and set info',
    ],
  },
  {
    version: '1.2.1',
    date: '2026-06-14',
    notes: [
      'SKU / location input moved to Step 3 (Images) — set it per card while matching photos, not after',
      'Step 4 shows SKU inline next to card name (read-only) for reference before export',
    ],
  },
  {
    version: '1.2.0',
    date: '2026-06-14',
    notes: [
      'CSV export now matches eBay draft listing template format (#INFO rows, Draft action, C: item specifics for Game/Set/Card Name/Language/Rarity/Finish/Condition/etc.)',
      'Title template: added {foil} token (outputs "Foil " for foil cards); default changed to "{name} {set} #{number} {foil}MTG Magic"',
      'Step 3: drag-and-drop a folder to load all images inside it recursively',
      'Step 4: inline SKU field per card — exports to Custom label (SKU) column; customer never sees it',
      'Pricing defaults: no price rounding, 0% eBay premium across all tiers',
    ],
  },
  {
    version: '1.1.0',
    date: '2026-06-14',
    notes: [
      'Image hosting: Go backend serves uploaded images at listings.futuregadgetlabs.com/uploads/; hosted URLs flow into PicURL so eBay can fetch them',
      'Step 3 redesign: large thumbnails, front/back pairing per card, F/B toggle badge',
      'Auto-match by filename: card number exact match scores 1.0 (e.g. 058.jpg → card #058)',
      'Image Library drawer: view, preview, and bulk-delete hosted images',
      'Removed broken pHash pass (scan vs. stock render never matched reliably)',
      'USPS shipping updated to $0.74 (eBay discounted label rate)',
      'Packaging cost ($0.12) added as separate field in pricing tiers',
    ],
  },
  {
    version: '1.0.0',
    date: '2026-06-01',
    notes: [
      'Initial release: TCGPlayer CSV → eBay File Exchange CSV',
      'Step 1: import TCGPlayer inventory CSV',
      'Step 2: configurable pricing tiers with competitive pricing model (competitor total × premium)',
      'Step 3: image matching (filename + pHash)',
      'Step 4: export with revenue breakdown',
      'Deployed to listings.futuregadgetlabs.com via Cloudflare Tunnel on Proxmox LXC 109',
    ],
  },
]
