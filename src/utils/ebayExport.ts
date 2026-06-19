import type { TcgCard, PricingRules, EbaySettings } from '../types'
import { computeItemPrice, tierForCard } from './pricingEngine'

// eBay draft template condition IDs for Trading Cards (category 2536)
const CONDITION_ID: Record<string, string> = {
  'Near Mint':              '2750',
  'Near Mint Foil':         '2750',
  'Lightly Played':         '3000',
  'Lightly Played Foil':    '3000',
  'Moderately Played':      '4000',
  'Moderately Played Foil': '4000',
  'Heavily Played':         '5000',
  'Heavily Played Foil':    '5000',
  'Damaged':                '7000',
}

// eBay-facing C:Card Condition item specific — uses the full descriptive
// labels eBay expects under the new (post-2025) condition data requirement
// for category 183454.
const CONDITION_LABEL: Record<string, string> = {
  'Near Mint':              'Near Mint or Better: Comparable to a fresh pack',
  'Near Mint Foil':         'Near Mint or Better: Comparable to a fresh pack',
  'Lightly Played':         'Lightly Played (Excellent): Minor border or corner wear, very light scratches',
  'Lightly Played Foil':    'Lightly Played (Excellent): Minor border or corner wear, very light scratches',
  'Moderately Played':      'Moderately Played (Very Good): Moderate wear; minor scratches, scuffs, or edge wear',
  'Moderately Played Foil': 'Moderately Played (Very Good): Moderate wear; minor scratches, scuffs, or edge wear',
  'Heavily Played':         'Heavily Played (Poor): Major creases, tears, scuffing, scratches, or other wear',
  'Heavily Played Foil':    'Heavily Played (Poor): Major creases, tears, scuffing, scratches, or other wear',
  'Damaged':                'Damaged: Significantly damaged; major creases, water damage, or tears',
}

const CONDITION_ABBR: Record<string, string> = {
  'Near Mint':              'NM',
  'Near Mint Foil':         'NM',
  'Lightly Played':         'LP',
  'Lightly Played Foil':    'LP',
  'Moderately Played':      'MP',
  'Moderately Played Foil': 'MP',
  'Heavily Played':         'HP',
  'Heavily Played Foil':    'HP',
  'Damaged':                'DMG',
}

function isFoil(condition: string): boolean {
  return condition.toLowerCase().includes('foil')
}

function conditionId(condition: string): string {
  return CONDITION_ID[condition] ?? '3000'
}

function conditionLabel(condition: string): string {
  return CONDITION_LABEL[condition] ?? condition
}

function conditionAbbr(condition: string): string {
  return CONDITION_ABBR[condition] ?? 'NM'
}

// Resolve title template tokens.
// {foil} → "Foil " or ""; {condition_abbr} → NM/LP/MP/HP/DMG
// If the resulting title exceeds eBay's 80-char limit, progressively
// shorten the set name (drop "Commander:" prefix, then truncate with …)
// so the trailing condition + MTG suffix isn't lost to slice().
function resolveTitle(template: string, card: TcgCard): string {
  const foilTag = isFoil(card.condition) ? 'Foil ' : ''
  const build = (setName: string) => template
    .replace('{name}', card.productName)
    .replace('{set}', setName)
    .replace('{number}', card.number)
    .replace('{condition}', card.condition)
    .replace('{condition_abbr}', conditionAbbr(card.condition))
    .replace('{rarity}', card.rarity)
    .replace('{foil}', foilTag)

  let title = build(card.setName)
  if (title.length <= 80) return title.trim()

  // Drop "Commander:" / "Universes Beyond:" style prefixes
  const shortSet = card.setName
    .replace(/^Commander:\s*/, '')
    .replace(/^Universes Beyond:\s*/, '')
  if (shortSet !== card.setName) {
    title = build(shortSet)
    if (title.length <= 80) return title.trim()
  }

  // Still too long — chop the set name until it fits, append …
  let workingSet = shortSet
  while (workingSet.length > 4 && build(workingSet + '…').length > 80) {
    workingSet = workingSet.slice(0, -1).trimEnd()
  }
  title = build(workingSet + '…')
  return title.length <= 80 ? title.trim() : title.slice(0, 80).trim()
}

function buildDescription(card: TcgCard, conditionDescription: string): string {
  const parts = [
    `<p><b>${card.productName}</b> — ${card.setName} #${card.number}`,
    `<br>Condition: ${card.condition}`,
    `<br>Language: English`,
  ]
  if (conditionDescription) parts.push(`<br>${conditionDescription}`)
  parts.push('</p>')
  return parts.join('')
}

// Minimal CSV escaping: quote fields containing commas, quotes, or newlines.
function esc(val: string | number | undefined | null): string {
  if (val == null || val === '') return ''
  const s = String(val)
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"'
  }
  return s
}

function row(...cols: (string | number | undefined | null)[]): string {
  return cols.map(esc).join(',')
}

export function generateEbayCsv(
  cards: TcgCard[],
  pricing: PricingRules,
  settings: EbaySettings,
): string {
  const lines: string[] = []

  // eBay draft template header comments
  lines.push('#INFO,Version=0.0.2,Template= eBay-draft-listings-template_US,,,,,,,,,,,,,,,,,,,,,,')
  lines.push('#INFO Action and Category ID are required fields. 1) Set Action to Draft 2) Please find the category ID for your listings here: https://pages.ebay.com/sellerinformation/news/categorychanges.html,,,,,,,,,,,,,,,,,,,,,,,,')
  lines.push('#INFO After you\'ve successfully uploaded your draft from the Seller Hub Reports tab\, complete your drafts to active listings here: https://www.ebay.com/sh/lst/drafts,,,,,,,,,,,,,,,,,,,,,,,,')
  lines.push('#INFO,,,,,,,,,,,,,,,,,,,,,,,,')

  // Column header — Action column embeds site/currency metadata per eBay spec
  const actionCol = `Action(SiteID=US|Country=US|Currency=USD|Version=1193|CC=UTF-8)`
  lines.push([
    actionCol,
    'Custom label (SKU)',
    'Category ID',
    'Title',
    'UPC',
    'Price',
    'Quantity',
    'Item photo URL',
    'Condition ID',
    'Description',
    'Format',
    'Duration',
    'Location',
    'PostalCode',
    'Country',
    'ShippingType',
    'ShippingService-1:Option',
    'ShippingService-1:Cost',
    'DispatchTimeMax',
    'ReturnsAcceptedOption',
    'ReturnsWithinOption',
    'RefundOption',
    'ShippingCostPaidByOption',
    'C:Game',
    'C:Card Name',
    'C:Set',
    'C:Language',
    'C:Card Condition',
    'C:Rarity',
    'C:Card Number',
    'C:Card Size',
    'C:Manufacturer',
    'C:Finish',
    'C:Graded',
    'C:Age Level',
    'C:Type',
    'C:Professional Grader',
    'C:Certification Number',
    'C:Grade',
  ].join(','))

  const listable = cards.filter((c) => c.totalQuantity > 0)

  for (const card of listable) {
    const price = computeItemPrice(card, pricing)
    const tier  = tierForCard(card, pricing)
    const scans = [card.imageFileName, card.imageFileNameBack].filter(Boolean)
    const stockUrl = card.photoUrl || ''
    const picUrl = scans.length > 0 ? [...scans, stockUrl].filter(Boolean).join('|') : stockUrl
    const title = resolveTitle(settings.titleTemplate, card)
    const description = buildDescription(card, settings.conditionDescription)

    lines.push(row(
      'Draft',                          // Action
      card.sku ?? '',                   // Custom label (SKU)
      settings.categoryId,              // Category ID
      title,                            // Title
      '',                               // UPC
      price.toFixed(2),                 // Price
      card.totalQuantity,               // Quantity
      picUrl,                           // Item photo URL
      conditionId(card.condition),      // Condition ID
      description,                      // Description
      'FixedPrice',                     // Format
      settings.listingDuration,         // Duration (e.g. GTC)
      settings.itemLocation,            // Location
      settings.postalCode,              // PostalCode
      settings.country,                 // Country
      'Flat',                           // ShippingType
      settings.shippingService,         // ShippingService-1:Option
      settings.shippingCost.toFixed(2), // ShippingService-1:Cost
      settings.dispatchTimeMax,         // DispatchTimeMax
      settings.returnsAccepted ? 'ReturnsAccepted' : 'ReturnsNotAccepted', // ReturnsAcceptedOption
      settings.returnsAccepted ? `Days_${settings.returnPolicyDays}` : '', // ReturnsWithinOption
      settings.returnsAccepted ? 'MoneyBack' : '', // RefundOption
      settings.returnsAccepted ? 'Buyer' : '',     // ShippingCostPaidByOption (buyer pays return shipping)
      'Magic: The Gathering',           // C:Game
      card.productName,                 // C:Card Name
      card.setName,                     // C:Set
      'English',                        // C:Language
      conditionLabel(card.condition),   // C:Card Condition
      card.rarity,                      // C:Rarity
      card.number,                      // C:Card Number
      'Standard',                       // C:Card Size
      'Wizards of the Coast',           // C:Manufacturer
      isFoil(card.condition) ? 'Foil' : 'Non-Foil', // C:Finish
      'Ungraded: Not in original packaging or professionally graded', // C:Graded
      '13+',                            // C:Age Level
      'Individual Card',                // C:Type
      'Does Not Apply',                 // C:Professional Grader
      'Does Not Apply',                 // C:Certification Number
      'Does Not Apply',                 // C:Grade
    ))

    // If there are charged shipping costs, eBay draft format also supports a shipping column,
    // but the draft upload UI lets you set that in the template — omit here to keep it simple.
    void tier
  }

  return lines.join('\n')
}

export function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
