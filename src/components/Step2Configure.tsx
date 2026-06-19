import { useState } from 'react'
import type { PricingRules, PricingTier, EbaySettings, TcgCard } from '../types'
import {
  computeItemPrice,
  computeTotalBuyerPrice,
  computeEstimatedNet,
  computeNetPct,
  computeTcgPlayerNet,
  computeShippingMargin,
  basePrice,
  tierForCard,
} from '../utils/pricingEngine'

interface Props {
  cards: TcgCard[]
  pricing: PricingRules
  ebay: EbaySettings
  onPricing: (p: PricingRules) => void
  onEbay: (e: EbaySettings) => void
  onBack: () => void
  onNext: () => void
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
    />
  )
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement> & { children: React.ReactNode }) {
  return (
    <select
      {...props}
      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
    />
  )
}

function Label({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-1">
      <span className="text-xs font-medium text-gray-600">{children}</span>
      {hint && <span className="text-xs text-gray-400 ml-1">— {hint}</span>}
    </div>
  )
}

const TIER_COLORS = [
  { bg: 'bg-slate-50',   border: 'border-slate-200',  badge: 'bg-slate-100 text-slate-600',   dot: 'bg-slate-400' },
  { bg: 'bg-blue-50',    border: 'border-blue-200',   badge: 'bg-blue-100 text-blue-700',     dot: 'bg-blue-400' },
  { bg: 'bg-indigo-50',  border: 'border-indigo-200', badge: 'bg-indigo-100 text-indigo-700', dot: 'bg-indigo-400' },
  { bg: 'bg-violet-50',  border: 'border-violet-200', badge: 'bg-violet-100 text-violet-700', dot: 'bg-violet-400' },
]

function PctBadge({ pct, warn = 0.80 }: { pct: number; warn?: number }) {
  const good = pct >= warn
  return (
    <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${good ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
      {(pct * 100).toFixed(0)}%
    </span>
  )
}

function TierCard({
  tier, color, isLast, onChange, onRemove, canRemove, ebayFvfPct,
}: {
  tier: PricingTier
  color: typeof TIER_COLORS[0]
  isLast: boolean
  onChange: (t: PricingTier) => void
  onRemove: () => void
  canRemove: boolean
  ebayFvfPct: number
}) {
  const shippingMargin = computeShippingMargin(tier, ebayFvfPct)

  return (
    <div className={`rounded-xl border ${color.border} ${color.bg} p-4 space-y-3`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${color.dot}`} />
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${color.badge}`}>
            {isLast ? 'Top tier' : tier.maxMarketPrice != null ? `≤ $${tier.maxMarketPrice.toFixed(2)}` : 'All'}
          </span>
          <input
            value={tier.label}
            onChange={(e) => onChange({ ...tier, label: e.target.value })}
            className="text-sm font-semibold bg-transparent border-b border-transparent hover:border-gray-300 focus:border-blue-400 focus:outline-none w-36"
          />
        </div>
        {canRemove && (
          <button onClick={onRemove} className="text-gray-300 hover:text-red-400 text-xs">✕</button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        {!isLast && (
          <div>
            <Label hint="cards at or below use this tier">Max market price ($)</Label>
            <Input type="number" step="0.50" min="0.01"
              value={tier.maxMarketPrice ?? ''}
              onChange={(e) => onChange({ ...tier, maxMarketPrice: parseFloat(e.target.value) || null })}
            />
          </div>
        )}
        {isLast && <div />}

        <div>
          <Label hint="what eBay buyer pays for shipping">Charged shipping ($)</Label>
          <Input type="number" step="0.01" min="0"
            value={tier.chargedShipping}
            onChange={(e) => onChange({ ...tier, chargedShipping: parseFloat(e.target.value) || 0 })}
          />
        </div>

        <div>
          <Label hint="what you pay USPS for postage">Postage cost ($)</Label>
          <Input type="number" step="0.01" min="0"
            value={tier.actualShippingCost}
            onChange={(e) => onChange({ ...tier, actualShippingCost: parseFloat(e.target.value) || 0 })}
          />
        </div>

        <div>
          <Label hint="sleeve + top loader + envelope + label">Packaging ($)</Label>
          <Input type="number" step="0.01" min="0"
            value={tier.packagingCost}
            onChange={(e) => onChange({ ...tier, packagingCost: parseFloat(e.target.value) || 0 })}
          />
        </div>

        <div>
          <Label hint="TCGPlayer shipping for same card (sets price-match baseline)">Competitor ship ($)</Label>
          <Input type="number" step="0.01" min="0"
            value={tier.competitorShipping}
            onChange={(e) => onChange({ ...tier, competitorShipping: parseFloat(e.target.value) || 0 })}
          />
        </div>

        <div>
          <Label hint="% above competitor total — 0% = match exactly, 15% = 15% above">eBay premium (%)</Label>
          <div className="relative">
            <Input type="number" step="1" min="0" max="100"
              value={Math.round(tier.premiumPct * 100)}
              onChange={(e) => onChange({ ...tier, premiumPct: (parseFloat(e.target.value) || 0) / 100 })}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">%</span>
          </div>
        </div>

        <div>
          <Label hint="minimum item listing price">Item floor ($)</Label>
          <Input type="number" step="0.01" min="0"
            value={tier.itemFloorPrice}
            onChange={(e) => onChange({ ...tier, itemFloorPrice: parseFloat(e.target.value) || 0 })}
          />
        </div>
      </div>

      {/* Live formula display */}
      <div className="bg-white/70 rounded-lg px-3 py-2 text-xs text-gray-500 space-y-1 border border-gray-100">
        <div className="font-medium text-gray-600 mb-1">Live formula</div>
        <div>
          <span className="text-gray-400">competitor total</span>
          {' = '}market + ${tier.competitorShipping.toFixed(2)} ship
          {' = '}market + ${tier.competitorShipping.toFixed(2)}
        </div>
        <div>
          <span className="text-gray-400">eBay total</span>
          {tier.premiumPct > 0
            ? <> = competitor × (1 + {(tier.premiumPct * 100).toFixed(0)}%) = competitor × {(1 + tier.premiumPct).toFixed(2)}</>
            : <> = competitor (0% premium — matches competitor exactly)</>}
        </div>
        <div>
          <span className="text-gray-400">item price</span>
          {' = '}max(${tier.itemFloorPrice.toFixed(2)} floor, eBay total − ${tier.chargedShipping.toFixed(2)} charged ship)
        </div>
        <div>
          <span className="text-gray-400">your net</span>
          {' = '}eBay total × {((1 - ebayFvfPct) * 100).toFixed(2)}% − ${(0.30).toFixed(2)} txn − ${tier.actualShippingCost.toFixed(2)} postage − ${tier.packagingCost.toFixed(2)} pkg
          {' | '}
          <span className="text-gray-400">shipping margin: </span>
          <span className={shippingMargin >= 0 ? 'text-green-600 font-medium' : 'text-red-500 font-medium'}>
            +${shippingMargin.toFixed(2)}
          </span>
          <span className="text-gray-400 ml-1">
            (${tier.chargedShipping.toFixed(2)} charged − ${tier.actualShippingCost.toFixed(2)} postage − ${tier.packagingCost.toFixed(2)} pkg − ${(tier.chargedShipping * ebayFvfPct).toFixed(2)} FVF)
          </span>
        </div>
      </div>
    </div>
  )
}

function newTier(id: string): PricingTier {
  return {
    id, label: 'New tier', maxMarketPrice: 5,
    chargedShipping: 1.50, actualShippingCost: 0.74, packagingCost: 0.12,
    competitorShipping: 0.99, premiumPct: 0,
    itemFloorPrice: 0.99,
  }
}

export default function Step2Configure({ cards, pricing, ebay, onPricing, onEbay, onBack, onNext }: Props) {
  const [showEbay, setShowEbay] = useState(false)
  const [showHelp, setShowHelp] = useState(false)

  function updateTier(id: string, t: PricingTier) {
    onPricing({ ...pricing, tiers: pricing.tiers.map((x) => (x.id === id ? t : x)) })
  }
  function removeTier(id: string) {
    onPricing({ ...pricing, tiers: pricing.tiers.filter((x) => x.id !== id) })
  }
  function addTier() {
    const tiers = [...pricing.tiers]
    tiers.splice(tiers.length - 1, 0, newTier(crypto.randomUUID()))
    onPricing({ ...pricing, tiers })
  }

  // Sample ~8 cards spread across price range for preview
  const previewCards = cards.length === 0 ? [] : (() => {
    const sorted = [...cards].sort((a, b) => basePrice(a, pricing.priceSource) - basePrice(b, pricing.priceSource))
    const step = Math.max(1, Math.floor(sorted.length / 8))
    return sorted.filter((_, i) => i % step === 0).slice(0, 8)
  })()

  const totalItemRev = cards.reduce((s, c) => s + computeItemPrice(c, pricing) * c.totalQuantity, 0)
  const totalShipRev = cards.reduce((s, c) => s + tierForCard(c, pricing).chargedShipping * c.totalQuantity, 0)
  const totalEstNet  = cards.reduce((s, c) => s + computeEstimatedNet(c, pricing) * c.totalQuantity, 0)
  const totalMarket  = cards.reduce((s, c) => s + basePrice(c, pricing.priceSource) * c.totalQuantity, 0)
  const overallNetPct = totalMarket > 0 ? totalEstNet / totalMarket : 0

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Pricing Tiers</h2>
          <p className="text-sm text-gray-500 mt-1">
            Competitive pricing: eBay item price is back-calculated from the competitor's total buyer cost.
            Net % is a result, not an input — tune <strong>Competitor ship</strong> and <strong>eBay premium</strong> to dial it in.
          </p>
        </div>
        <button
          onClick={() => setShowHelp((v) => !v)}
          className="flex-shrink-0 text-xs text-blue-600 hover:text-blue-800 border border-blue-200 rounded-lg px-3 py-1.5 bg-blue-50 hover:bg-blue-100 transition-colors"
        >
          {showHelp ? 'Hide' : 'How it works'}
        </button>
      </div>

      {showHelp && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm space-y-3 text-gray-700">
          <p className="font-medium text-blue-800">Pricing model — competitive mode</p>
          <div className="space-y-1.5 font-mono text-xs bg-white rounded-lg p-3 border border-blue-100">
            <div><span className="text-gray-400">// Step 1: what the competitor charges the buyer</span></div>
            <div>competitorTotal = market + competitorShipping</div>
            <div className="mt-2"><span className="text-gray-400">// Step 2: eBay total at your premium above competitor</span></div>
            <div>ebayTotal = competitorTotal × (1 + premiumPct)</div>
            <div className="mt-2"><span className="text-gray-400">// Step 3: eBay item price (shipping is separate)</span></div>
            <div>itemPrice = max(itemFloor, ebayTotal − chargedShipping)</div>
            <div className="mt-2"><span className="text-gray-400">// Step 4: what you actually pocket (solo-sale worst case)</span></div>
            <div>net = ebayTotal × (1 − FVF%) − $0.30 txn − postage − packagingCost</div>
          </div>
          <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
            <div className="bg-white rounded-lg p-3 border border-blue-100 space-y-1">
              <p className="font-semibold text-gray-700">To match a competitor exactly</p>
              <p className="text-gray-500">Set <strong>eBay premium = 0%</strong> and <strong>Competitor ship</strong> to whatever they charge for that card value. Item price ends up ≈ market price.</p>
            </div>
            <div className="bg-white rounded-lg p-3 border border-blue-100 space-y-1">
              <p className="font-semibold text-gray-700">To hit a target net %</p>
              <p className="text-gray-500">Raise <strong>eBay premium</strong> until the net % in the preview hits your target. Each +1% premium ≈ +0.87% net (after FVF).</p>
            </div>
            <div className="bg-white rounded-lg p-3 border border-blue-100 space-y-1">
              <p className="font-semibold text-gray-700">Competitor shipping reference</p>
              <p className="text-gray-500">TCGPlayer charges ~<strong>$1.50</strong> under $5 order total, <strong>free</strong> at $5+. Set accordingly per tier so your eBay prices stay competitive.</p>
            </div>
            <div className="bg-white rounded-lg p-3 border border-blue-100 space-y-1">
              <p className="font-semibold text-gray-700">Shipping margin</p>
              <p className="text-gray-500">The spread between what you charge for shipping and what USPS costs, minus FVF on the charged amount. Positive = extra profit on the shipment.</p>
            </div>
          </div>
          <p className="text-xs text-blue-700">
            <strong>Net at 0% premium:</strong> PWE Small ≈ 96–196% (cheap cards overperform, pull average up). PWE Mid ≈ 72–80% (eBay fees are higher than TCP and you're charging shipping where TCP is free). If you want ~85% on mid-tier cards, set eBay premium to ~10–13%.
          </p>
        </div>
      )}

      {/* Global settings */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <Label>Price source</Label>
          <Select value={pricing.priceSource}
            onChange={(e) => onPricing({ ...pricing, priceSource: e.target.value as PricingRules['priceSource'] })}>
            <option value="market">TCG Market Price</option>
            <option value="marketplace">TCG Marketplace Price</option>
            <option value="low">TCG Low Price</option>
          </Select>
        </div>
        <div>
          <Label>Round prices to</Label>
          <Select value={pricing.roundTo}
            onChange={(e) => onPricing({ ...pricing, roundTo: e.target.value as PricingRules['roundTo'] })}>
            <option value="none">No rounding</option>
            <option value="0.05">Nearest $0.05</option>
            <option value="0.10">Nearest $0.10</option>
            <option value="0.25">Nearest $0.25</option>
            <option value="0.50">Nearest $0.50</option>
            <option value="0.99">Charm .99</option>
          </Select>
        </div>
        <div>
          <Label hint="eBay Trading Cards category">eBay FVF (%)</Label>
          <div className="relative">
            <Input type="number" step="0.25" min="0" max="50"
              value={(pricing.ebayFvfPct * 100).toFixed(2)}
              onChange={(e) => onPricing({ ...pricing, ebayFvfPct: (parseFloat(e.target.value) || 0) / 100 })}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">%</span>
          </div>
        </div>
        <div>
          <Label hint="worst-case: solo sale">Per-order fee ($)</Label>
          <Input type="number" step="0.01" min="0"
            value={pricing.transactionFee}
            onChange={(e) => onPricing({ ...pricing, transactionFee: parseFloat(e.target.value) || 0 })}
          />
        </div>
      </div>

      {/* Competitive discount */}
      <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3 flex items-center gap-4 flex-wrap">
        <label className="flex items-center gap-2 cursor-pointer flex-shrink-0">
          <input
            type="checkbox"
            checked={pricing.competitiveDiscount.enabled}
            onChange={(e) => onPricing({
              ...pricing,
              competitiveDiscount: { ...pricing.competitiveDiscount, enabled: e.target.checked },
            })}
            className="w-4 h-4 accent-yellow-600"
          />
          <span className="text-sm font-semibold text-gray-700">Competitive discount</span>
        </label>
        <span className="text-xs text-gray-500 flex-1 min-w-[12rem]">
          Shave $X off buyer total for cards above $Y so you stay competitive with TCGPlayer net-of-fees.
        </span>
        <div className="flex items-center gap-2 text-xs text-gray-600">
          <span>$</span>
          <input
            type="number" step="0.25" min="0"
            value={pricing.competitiveDiscount.amount}
            onChange={(e) => onPricing({
              ...pricing,
              competitiveDiscount: { ...pricing.competitiveDiscount, amount: parseFloat(e.target.value) || 0 },
            })}
            disabled={!pricing.competitiveDiscount.enabled}
            className="w-16 border border-gray-300 rounded px-2 py-1 text-sm disabled:bg-gray-100 disabled:text-gray-400"
          />
          <span>off when market &gt; $</span>
          <input
            type="number" step="0.50" min="0"
            value={pricing.competitiveDiscount.threshold}
            onChange={(e) => onPricing({
              ...pricing,
              competitiveDiscount: { ...pricing.competitiveDiscount, threshold: parseFloat(e.target.value) || 0 },
            })}
            disabled={!pricing.competitiveDiscount.enabled}
            className="w-16 border border-gray-300 rounded px-2 py-1 text-sm disabled:bg-gray-100 disabled:text-gray-400"
          />
        </div>
      </div>

      {/* Overall net banner */}
      {cards.length > 0 && (
        <div className={`rounded-lg px-4 py-3 flex items-center justify-between text-sm border
          ${overallNetPct >= 0.85 ? 'bg-green-50 border-green-200' : overallNetPct >= 0.80 ? 'bg-yellow-50 border-yellow-200' : 'bg-red-50 border-red-200'}`}>
          <span className="text-gray-700">
            Est. net across all {cards.length} cards (solo worst-case):
            <strong className="ml-2">${totalEstNet.toFixed(2)}</strong>
            <span className="text-gray-400 ml-1">of ${totalMarket.toFixed(2)} market</span>
          </span>
          <PctBadge pct={overallNetPct} warn={0.85} />
        </div>
      )}

      {/* Tier cards */}
      <div className="space-y-3">
        {pricing.tiers.map((tier, i) => (
          <TierCard
            key={tier.id}
            tier={tier}
            color={TIER_COLORS[i % TIER_COLORS.length]}
            isLast={i === pricing.tiers.length - 1}
            onChange={(t) => updateTier(tier.id, t)}
            onRemove={() => removeTier(tier.id)}
            canRemove={pricing.tiers.length > 1}
            ebayFvfPct={pricing.ebayFvfPct}
          />
        ))}
        <button onClick={addTier}
          className="w-full border-2 border-dashed border-gray-200 rounded-xl py-3 text-sm text-gray-400 hover:border-blue-300 hover:text-blue-500 transition-colors">
          + Add tier
        </button>
      </div>

      {/* Preview table */}
      {previewCards.length > 0 && (
        <div className="border rounded-xl overflow-hidden">
          <div className="bg-gray-50 px-4 py-2 flex items-center justify-between flex-wrap gap-2">
            <span className="text-xs font-medium text-gray-600">Price preview (sampled)</span>
            <div className="flex gap-4 text-xs text-gray-500">
              <span>Item: <strong className="text-gray-900">${totalItemRev.toFixed(2)}</strong></span>
              <span>+ Ship: <strong className="text-gray-900">${totalShipRev.toFixed(2)}</strong></span>
              <span>Est. net: <strong className="text-green-700">${totalEstNet.toFixed(2)}</strong></span>
              <span>Overall: <PctBadge pct={overallNetPct} /></span>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 border-t border-gray-200">
                <tr>
                  <th className="text-left px-4 py-2 font-medium text-gray-500">Card</th>
                  <th className="text-right px-2 py-2 font-medium text-gray-500">Market</th>
                  <th className="text-center px-2 py-2 font-medium text-gray-500">Tier</th>
                  <th className="text-right px-2 py-2 font-medium text-gray-500">Item</th>
                  <th className="text-right px-2 py-2 font-medium text-gray-500">Ship</th>
                  <th className="text-right px-2 py-2 font-medium text-gray-500">eBay total</th>
                  <th className="text-right px-2 py-2 font-medium text-gray-500">TCP total</th>
                  <th className="text-right px-2 py-2 font-medium text-gray-500">eBay net</th>
                  <th className="text-right px-4 py-2 font-medium text-gray-500">TCP net</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {previewCards.map((card) => {
                  const tier    = tierForCard(card, pricing)
                  const market  = basePrice(card, pricing.priceSource)
                  const item    = computeItemPrice(card, pricing)
                  const ebayTotal = computeTotalBuyerPrice(card, pricing)
                  const tcpTotal  = market + tier.competitorShipping
                  const ebayNet   = computeEstimatedNet(card, pricing)
                  const ebayPct   = computeNetPct(card, pricing)
                  const tcpNet    = computeTcgPlayerNet(card, pricing)
                  const tcpPct    = market > 0 ? tcpNet / market : 0
                  return (
                    <tr key={card.tcgplayerId} className="hover:bg-gray-50">
                      <td className="px-4 py-1.5 font-medium text-gray-800 max-w-40 truncate">{card.productName}</td>
                      <td className="px-2 py-1.5 text-right text-gray-500">${market.toFixed(2)}</td>
                      <td className="px-2 py-1.5 text-center">
                        <span className="bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{tier.label}</span>
                      </td>
                      <td className="px-2 py-1.5 text-right font-semibold text-gray-900">${item.toFixed(2)}</td>
                      <td className="px-2 py-1.5 text-right text-gray-500">${tier.chargedShipping.toFixed(2)}</td>
                      <td className="px-2 py-1.5 text-right text-gray-700">${ebayTotal.toFixed(2)}</td>
                      <td className="px-2 py-1.5 text-right text-gray-400">${tcpTotal.toFixed(2)}</td>
                      <td className="px-2 py-1.5 text-right">
                        <span className={ebayNet < 0 ? 'text-red-600 font-semibold' : 'text-gray-900'}>
                          ${ebayNet.toFixed(2)}
                        </span>
                        {' '}<PctBadge pct={ebayPct} />
                      </td>
                      <td className="px-4 py-1.5 text-right">
                        <span className="text-gray-500">${tcpNet.toFixed(2)}</span>
                        {' '}<PctBadge pct={tcpPct} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* eBay settings collapsible */}
      <div className="border rounded-xl overflow-hidden">
        <button onClick={() => setShowEbay((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-sm font-medium text-gray-700">
          <span>eBay listing settings</span>
          <span className="text-gray-400 text-xs">{showEbay ? '▲ hide' : '▼ show'}</span>
        </button>
        {showEbay && (
          <div className="p-4 space-y-4">
            <div>
              <Label hint="tokens: {name} {set} {number} {condition} {condition_abbr} {rarity} {foil} — {condition_abbr}=NM/LP/MP/HP/DMG, {foil}=Foil or blank — max 80 chars">Title template</Label>
              <Input value={ebay.titleTemplate} onChange={(e) => onEbay({ ...ebay, titleTemplate: e.target.value })} />
            </div>
            <div>
              <Label hint="appended to every listing description">Condition description</Label>
              <Input value={ebay.conditionDescription} onChange={(e) => onEbay({ ...ebay, conditionDescription: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label hint="183454 = current MTG Individual Cards; 2536 was the old ID">eBay Category ID</Label>
                <Input value={ebay.categoryId} onChange={(e) => onEbay({ ...ebay, categoryId: e.target.value })} /></div>
              <div><Label>Handling time (days)</Label>
                <Input type="number" min="1" max="30" value={ebay.dispatchTimeMax}
                  onChange={(e) => onEbay({ ...ebay, dispatchTimeMax: parseInt(e.target.value) || 1 })} /></div>
              <div><Label>Country</Label>
                <Input value={ebay.country} onChange={(e) => onEbay({ ...ebay, country: e.target.value })} /></div>
              <div><Label>Currency</Label>
                <Input value={ebay.currency} onChange={(e) => onEbay({ ...ebay, currency: e.target.value })} /></div>
            </div>

            {/* Location + shipping (required by eBay) */}
            <div className="grid grid-cols-2 gap-4">
              <div><Label hint="City, State (required by eBay)">Item location</Label>
                <Input placeholder="Brooklyn, NY"
                  value={ebay.itemLocation}
                  onChange={(e) => onEbay({ ...ebay, itemLocation: e.target.value })} /></div>
              <div><Label>ZIP / Postal code</Label>
                <Input placeholder="11201"
                  value={ebay.postalCode}
                  onChange={(e) => onEbay({ ...ebay, postalCode: e.target.value })} /></div>
              <div><Label hint="USPSFirstClass, USPSGround, USPSPriority">Shipping service</Label>
                <Input value={ebay.shippingService}
                  onChange={(e) => onEbay({ ...ebay, shippingService: e.target.value })} /></div>
              <div><Label hint="charged to buyer">Shipping cost ($)</Label>
                <Input type="number" step="0.01" min="0"
                  value={ebay.shippingCost}
                  onChange={(e) => onEbay({ ...ebay, shippingCost: parseFloat(e.target.value) || 0 })} /></div>
            </div>

            {/* Returns */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label hint="required by eBay for most categories">Returns accepted</Label>
                <Select value={ebay.returnsAccepted ? 'yes' : 'no'}
                  onChange={(e) => onEbay({ ...ebay, returnsAccepted: e.target.value === 'yes' })}>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </Select>
              </div>
              <div>
                <Label>Return window (days)</Label>
                <Select value={String(ebay.returnPolicyDays)}
                  onChange={(e) => onEbay({ ...ebay, returnPolicyDays: parseInt(e.target.value) || 30 })}>
                  <option value="14">14 days</option>
                  <option value="30">30 days</option>
                  <option value="60">60 days</option>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div><Label>Payment profile</Label>
                <Input placeholder="My Payment Policy" value={ebay.paymentProfile}
                  onChange={(e) => onEbay({ ...ebay, paymentProfile: e.target.value })} /></div>
              <div><Label>Return profile</Label>
                <Input placeholder="My Returns Policy" value={ebay.returnProfile}
                  onChange={(e) => onEbay({ ...ebay, returnProfile: e.target.value })} /></div>
              <div><Label>Shipping profile</Label>
                <Input placeholder="My Shipping Policy" value={ebay.shippingProfile}
                  onChange={(e) => onEbay({ ...ebay, shippingProfile: e.target.value })} /></div>
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-between">
        <button onClick={onBack} className="text-gray-600 hover:text-gray-800 px-4 py-2 rounded-lg font-medium transition-colors">← Back</button>
        <button onClick={onNext} className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium transition-colors">Add Card Images →</button>
      </div>
    </div>
  )
}
