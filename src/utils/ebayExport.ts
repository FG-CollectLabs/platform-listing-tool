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

// eBay-facing condition label for the C:Card Condition item specific
const CONDITION_LABEL: Record<string, string> = {
  'Near Mint':              'Near Mint or Better',
  'Near Mint Foil':         'Near Mint or Better',
  'Lightly Played':         'Lightly Played',
  'Lightly Played Foil':    'Lightly Played',
  'Moderately Played':      'Moderately Played',
  'Moderately Played Foil': 'Moderately Played',
  'Heavily Played':         'Heavily Played',
  'Heavily Played Foil':    'Heavily Played',
  'Damaged':                'Damaged',
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

// Resolve title template tokens. {foil} outputs "Foil " for foil cards, "" otherwise.
function resolveTitle(template: string, card: TcgCard): string {
  const foilTag = isFoil(card.condition) ? 'Foil ' : ''
  return template
    .replace('{name}', card.productName)
    .replace('{set}', card.setName)
    .replace('{number}', card.number)
    .replace('{condition}', card.condition)
    .replace('{rarity}', card.rarity)
    .replace('{foil}', foilTag)
    .slice(0, 80)
    .trim()
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
  ].join(','))

  const listable = cards.filter((c) => c.totalQuantity > 0)

  for (const card of listable) {
    const price = computeItemPrice(card, pricing)
    const tier  = tierForCard(card, pricing)
    const picUrl = [card.imageFileName, card.imageFileNameBack].filter(Boolean).join('|') || card.photoUrl || ''
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
      'No',                             // C:Graded
      '13+',                            // C:Age Level
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
