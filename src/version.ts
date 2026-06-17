export const VERSION = '1.4.0'

export interface Release {
  version: string
  date: string
  notes: string[]
}

export const CHANGELOG: Release[] = [
  {
    version: '1.4.0',
    date: '2026-06-15',
    notes: [
      'Step 3: catalog loader — enter a set code (e.g. tmc) to pull Scryfall images from market tracker; used in side-by-side validation modal',
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
