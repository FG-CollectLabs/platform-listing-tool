import Papa from 'papaparse'
import type { TcgCard, PricingRules, EbaySettings } from '../types'
import { computeItemPrice, tierForCard } from './pricingEngine'

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

function conditionId(condition: string): string {
  return CONDITION_ID[condition] ?? '3000'
}

function resolveTitle(template: string, card: TcgCard): string {
  return template
    .replace('{name}', card.productName)
    .replace('{set}', card.setName)
    .replace('{number}', card.number)
    .replace('{condition}', card.condition)
    .replace('{rarity}', card.rarity)
    .slice(0, 80)
}

export function generateEbayCsv(
  cards: TcgCard[],
  pricing: PricingRules,
  settings: EbaySettings,
): string {
  const rows = cards
    .filter((c) => c.totalQuantity > 0)
    .map((card) => {
      const tier = tierForCard(card, pricing)
      return {
        Action: 'Add',
        ItemID: '',
        SiteID: '0',
        Country: settings.country,
        Currency: settings.currency,
        StartPrice: computeItemPrice(card, pricing).toFixed(2),
        BuyItNowPrice: '',
        Quantity: card.totalQuantity,
        Title: resolveTitle(settings.titleTemplate, card),
        Description: settings.conditionDescription
          ? `${card.productName} — ${card.condition}. ${settings.conditionDescription}`
          : `${card.productName} — ${card.condition}`,
        PicURL: [card.imageFileName, card.imageFileNameBack].filter(Boolean).join('|') || card.photoUrl || '',
        GalleryType: 'Gallery',
        Category1ID: settings.categoryId,
        ConditionID: conditionId(card.condition),
        CustomLabel: card.tcgplayerId,
        ShippingType: 'Flat',
        ShippingService: tier.chargedShipping === 0 ? 'USPSFirstClass' : 'USPSFirstClass',
        ShippingServiceCost: tier.chargedShipping.toFixed(2),
        ShippingServiceAdditionalCost: '0.00',
        DispatchTimeMax: settings.dispatchTimeMax,
        ListingDuration: settings.listingDuration,
        ListingType: 'FixedPriceItem',
        PaymentProfileName: settings.paymentProfile,
        ReturnProfileName: settings.returnProfile,
        ShippingProfileName: settings.shippingProfile,
      }
    })

  return Papa.unparse(rows)
}

export function generateSkipListCsv(_cards: TcgCard[], _pricing: PricingRules): string {
  return ''
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
