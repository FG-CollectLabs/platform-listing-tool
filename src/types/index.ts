export interface TcgCard {
  tcgplayerId: string
  productLine: string
  setName: string
  productName: string
  number: string
  rarity: string
  condition: string
  tcgMarketPrice: number
  tcgDirectLow: number
  tcgLowPriceWithShipping: number
  tcgLowPrice: number
  totalQuantity: number
  addToQuantity: number
  tcgMarketplacePrice: number
  photoUrl: string
  imageObjectUrl?: string
  imageFileName?: string
  imageObjectUrlBack?: string
  imageFileNameBack?: string
}

export interface PricingTier {
  id: string
  label: string
  // threshold
  maxMarketPrice: number | null     // null = top tier
  // shipping
  chargedShipping: number            // what eBay buyer pays for shipping
  actualShippingCost: number         // what you pay USPS for postage
  packagingCost: number              // materials: sleeve + top loader + envelope + label
  // competitive pricing inputs
  competitorShipping: number         // reference platform shipping (TCGPlayer standard = $0.99)
  premiumPct: number                 // how much above competitor total to price (0 = match, 0.15 = +15%)
  // floor
  itemFloorPrice: number             // minimum item listing price
}

export interface PricingRules {
  tiers: PricingTier[]
  priceSource: 'market' | 'marketplace' | 'low'
  ebayFvfPct: number
  transactionFee: number
  roundTo: 'none' | '0.05' | '0.10' | '0.25' | '0.50' | '0.99'
}

export interface EbaySettings {
  titleTemplate: string
  conditionDescription: string
  categoryId: string
  listingDuration: string
  dispatchTimeMax: number
  paymentProfile: string
  returnProfile: string
  shippingProfile: string
  country: string
  currency: string
}

export interface AppState {
  step: 1 | 2 | 3 | 4
  cards: TcgCard[]
  pricing: PricingRules
  ebay: EbaySettings
}
