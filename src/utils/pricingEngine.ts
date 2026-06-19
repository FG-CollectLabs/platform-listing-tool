import type { TcgCard, PricingRules, PricingTier } from '../types'

export function basePrice(card: TcgCard, source: PricingRules['priceSource']): number {
  switch (source) {
    case 'market':      return card.tcgMarketPrice
    case 'marketplace': return card.tcgMarketplacePrice
    case 'low':         return card.tcgLowPrice || card.tcgLowPriceWithShipping
  }
}

export function tierForCard(card: TcgCard, rules: PricingRules): PricingTier {
  const price = basePrice(card, rules.priceSource)
  for (const tier of rules.tiers) {
    if (tier.maxMarketPrice === null || price <= tier.maxMarketPrice) return tier
  }
  return rules.tiers[rules.tiers.length - 1]
}

function applyRounding(price: number, roundTo: PricingRules['roundTo']): number {
  if (roundTo === 'none') return price
  if (roundTo === '0.99') return Math.floor(price) + 0.99
  const step = parseFloat(roundTo)
  return Math.round(price / step) * step
}

// Competitor total = what a buyer pays on the reference platform (TCGPlayer) for the same card
// eBay total       = competitorTotal × (1 + premiumPct) − competitive discount (if applicable)
// Item price       = max(floor, ebayTotal − chargedShipping)
//
// Competitive discount: for cards above $threshold, shave $amount off the
// buyer's total on eBay to remain competitive with TCGPlayer (whose lower
// fees mean we'd otherwise be priced higher net-of-fees on equivalent
// listings).
export function computeItemPrice(card: TcgCard, rules: PricingRules): number {
  const tier = tierForCard(card, rules)
  const market = basePrice(card, rules.priceSource)
  const competitorTotal = market + tier.competitorShipping
  let ebayTotal = competitorTotal * (1 + tier.premiumPct)
  const cd = rules.competitiveDiscount
  if (cd && cd.enabled && cd.amount > 0 && market > cd.threshold) {
    ebayTotal -= cd.amount
  }
  const raw = ebayTotal - tier.chargedShipping
  const floored = Math.max(raw, tier.itemFloorPrice)
  const rounded = applyRounding(floored, rules.roundTo)
  return Math.round(rounded * 100) / 100
}

export function computeTotalBuyerPrice(card: TcgCard, rules: PricingRules): number {
  const tier = tierForCard(card, rules)
  return computeItemPrice(card, rules) + tier.chargedShipping
}

// What you actually pocket after eBay FVF, transaction fee, USPS cost, and packaging (worst-case solo order)
export function computeEstimatedNet(card: TcgCard, rules: PricingRules): number {
  const tier = tierForCard(card, rules)
  const total = computeTotalBuyerPrice(card, rules)
  return total * (1 - rules.ebayFvfPct) - rules.transactionFee - tier.actualShippingCost - tier.packagingCost
}

export function computeNetPct(card: TcgCard, rules: PricingRules): number {
  const market = basePrice(card, rules.priceSource)
  if (market === 0) return 0
  return computeEstimatedNet(card, rules) / market
}

// What you'd net on the same card on TCGPlayer at market price
// Using the same fee structure shape (% + per-order fee) with TCP's lower rate
export function computeTcgPlayerNet(card: TcgCard, rules: PricingRules, tcgFvfPct = 0.1025): number {
  const tier = tierForCard(card, rules)
  const market = basePrice(card, rules.priceSource)
  const tcgTotal = market + tier.competitorShipping
  return tcgTotal * (1 - tcgFvfPct) - rules.transactionFee - tier.actualShippingCost - tier.packagingCost
}

export function computeShippingMargin(tier: PricingTier, ebayFvfPct: number): number {
  return tier.chargedShipping * (1 - ebayFvfPct) - tier.actualShippingCost - tier.packagingCost
}
