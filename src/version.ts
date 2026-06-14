export const VERSION = '1.2.0'

export interface Release {
  version: string
  date: string
  notes: string[]
}

export const CHANGELOG: Release[] = [
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
