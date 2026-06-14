import type { TcgCard, PricingRules, EbaySettings } from '../types'
import { computeItemPrice, computeEstimatedNet, computeTotalBuyerPrice, computeNetPct, tierForCard, basePrice } from '../utils/pricingEngine'
import { generateEbayCsv, downloadCsv } from '../utils/ebayExport'

interface Props {
  cards: TcgCard[]
  pricing: PricingRules
  ebay: EbaySettings
  onBack: () => void
  onReset: () => void
}

function PctBadge({ pct, warn = 0.80 }: { pct: number; warn?: number }) {
  const good = pct >= warn
  return (
    <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${good ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
      {(pct * 100).toFixed(0)}%
    </span>
  )
}

export default function Step4Export({ cards, pricing, ebay, onBack, onReset }: Props) {
  const listable = cards.filter((c) => c.totalQuantity > 0)
  const withImages  = listable.filter((c) => c.imageObjectUrl).length
  const withBackImg = listable.filter((c) => c.imageObjectUrlBack).length

  const totalItemRevenue  = listable.reduce((s, c) => s + computeItemPrice(c, pricing) * c.totalQuantity, 0)
  const totalShipRevenue  = listable.reduce((s, c) => s + tierForCard(c, pricing).chargedShipping * c.totalQuantity, 0)
  const totalBuyerPays    = listable.reduce((s, c) => s + computeTotalBuyerPrice(c, pricing) * c.totalQuantity, 0)
  const totalEstNet       = listable.reduce((s, c) => s + computeEstimatedNet(c, pricing) * c.totalQuantity, 0)
  const totalActualShip   = listable.reduce((s, c) => s + tierForCard(c, pricing).actualShippingCost * c.totalQuantity, 0)
  const totalPackaging    = listable.reduce((s, c) => s + tierForCard(c, pricing).packagingCost * c.totalQuantity, 0)
  const totalMarket       = listable.reduce((s, c) => s + basePrice(c, pricing.priceSource) * c.totalQuantity, 0)
  const overallNetPct     = totalMarket > 0 ? totalEstNet / totalMarket : 0

  function handleExport() {
    const csv = generateEbayCsv(cards, pricing, ebay)
    const date = new Date().toISOString().slice(0, 10)
    downloadCsv(csv, `ebay-listings-${date}.csv`)
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Export eBay Listings</h2>
        <p className="text-sm text-gray-500 mt-1">
          Review the breakdown then download. All {listable.length} cards will be included — list everything,
          groom after 30–45 days.
        </p>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="bg-blue-50 rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-blue-700">{listable.length}</div>
          <div className="text-xs text-blue-500 mt-1">Listings</div>
        </div>
        <div className="bg-green-50 rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-green-700">${totalEstNet.toFixed(2)}</div>
          <div className="text-xs text-green-500 mt-1">Est. net (solo)</div>
        </div>
        <div className="bg-purple-50 rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-purple-700">${totalBuyerPays.toFixed(2)}</div>
          <div className="text-xs text-purple-500 mt-1">Total buyer pays</div>
        </div>
        <div className={`rounded-xl p-4 text-center ${overallNetPct >= 0.85 ? 'bg-green-50' : 'bg-yellow-50'}`}>
          <div className={`text-2xl font-bold ${overallNetPct >= 0.85 ? 'text-green-700' : 'text-yellow-700'}`}>
            {(overallNetPct * 100).toFixed(0)}%
          </div>
          <div className={`text-xs mt-1 ${overallNetPct >= 0.85 ? 'text-green-500' : 'text-yellow-600'}`}>
            Net of market
          </div>
        </div>
      </div>

      {/* Revenue breakdown */}
      <div className="bg-gray-50 rounded-xl p-4 text-sm space-y-1">
        <h3 className="font-medium text-gray-700 mb-3">Revenue breakdown (solo-sale worst case)</h3>
        <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-gray-600">
          <span>Item revenue</span>
          <span className="font-medium text-gray-900">${totalItemRevenue.toFixed(2)}</span>
          <span>Shipping revenue</span>
          <span className="font-medium text-gray-900">${totalShipRevenue.toFixed(2)}</span>
          <span>Total buyer pays</span>
          <span className="font-medium text-gray-900">${totalBuyerPays.toFixed(2)}</span>
          <span>eBay FVF ({(pricing.ebayFvfPct * 100).toFixed(2)}%)</span>
          <span className="font-medium text-red-600">−${(totalBuyerPays * pricing.ebayFvfPct).toFixed(2)}</span>
          <span>Transaction fees ({listable.length} × ${pricing.transactionFee.toFixed(2)})</span>
          <span className="font-medium text-red-600">−${(listable.length * pricing.transactionFee).toFixed(2)}</span>
          <span>Postage costs</span>
          <span className="font-medium text-red-600">−${totalActualShip.toFixed(2)}</span>
          <span>Packaging materials</span>
          <span className="font-medium text-red-600">−${totalPackaging.toFixed(2)}</span>
          <div className="col-span-2 border-t border-gray-200 my-1" />
          <span className="font-semibold text-gray-800">Estimated net</span>
          <span className="font-bold text-green-700">${totalEstNet.toFixed(2)} ({(overallNetPct * 100).toFixed(0)}% of ${totalMarket.toFixed(2)} market)</span>
        </div>
        <p className="text-xs text-gray-400 mt-2">
          Combined orders improve net — $0.30 transaction fee is per order, not per card.
          {' '}TCGPlayer deck at market price will net ~87–90%, blending your overall average higher.
        </p>
      </div>

      {/* Image note */}
      {withImages > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-sm text-yellow-800">
          <strong>Images:</strong> PicURL contains your image filenames
          ({withImages} front{withBackImg > 0 ? `, ${withBackImg} back` : ''}).
          eBay File Exchange requires hosted URLs — upload to an image host and replace filenames with
          full URLs before importing. Multiple images per listing are pipe-separated (<code>front.jpg|back.jpg</code>).
        </div>
      )}

      {/* Card table */}
      <div className="border rounded-xl overflow-hidden">
        <div className="bg-gray-50 px-4 py-2">
          <span className="text-xs font-semibold text-gray-600">All listings ({listable.length})</span>
        </div>
        <div className="max-h-72 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 sticky top-0 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-2 font-medium text-gray-500">Card</th>
                <th className="text-right px-2 py-2 font-medium text-gray-500">Market</th>
                <th className="text-center px-2 py-2 font-medium text-gray-500">Tier</th>
                <th className="text-right px-2 py-2 font-medium text-gray-500">Item</th>
                <th className="text-right px-2 py-2 font-medium text-gray-500">Ship</th>
                <th className="text-right px-2 py-2 font-medium text-gray-500">Total</th>
                <th className="text-right px-2 py-2 font-medium text-gray-500">Net</th>
                <th className="text-center px-4 py-2 font-medium text-gray-500">Img</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {listable.map((c) => {
                const tier  = tierForCard(c, pricing)
                const market = basePrice(c, pricing.priceSource)
                const net   = computeEstimatedNet(c, pricing)
                const pct   = computeNetPct(c, pricing)
                return (
                  <tr key={c.tcgplayerId} className="hover:bg-gray-50">
                    <td className="px-4 py-1.5 font-medium text-gray-800 max-w-48 truncate">{c.productName}</td>
                    <td className="px-2 py-1.5 text-right text-gray-500">${market.toFixed(2)}</td>
                    <td className="px-2 py-1.5 text-center">
                      <span className="bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{tier.label}</span>
                    </td>
                    <td className="px-2 py-1.5 text-right font-semibold text-gray-900">
                      ${computeItemPrice(c, pricing).toFixed(2)}
                    </td>
                    <td className="px-2 py-1.5 text-right text-gray-500">${tier.chargedShipping.toFixed(2)}</td>
                    <td className="px-2 py-1.5 text-right text-gray-700">
                      ${computeTotalBuyerPrice(c, pricing).toFixed(2)}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <span className={net < 0 ? 'text-red-600' : 'text-gray-900'}>${net.toFixed(2)}</span>
                      {' '}<PctBadge pct={pct} />
                    </td>
                    <td className="px-4 py-1.5 text-center">
                      <div className="flex items-center justify-center gap-1">
                        {c.imageObjectUrl
                          ? <img src={c.imageObjectUrl} alt="" className="w-5 h-7 object-cover rounded" />
                          : <span className="text-gray-300">—</span>}
                        {c.imageObjectUrlBack && (
                          <img src={c.imageObjectUrlBack} alt="" className="w-5 h-7 object-cover rounded opacity-70" title="Back face" />
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex justify-between items-center">
        <button onClick={onBack} className="text-gray-600 hover:text-gray-800 px-4 py-2 rounded-lg font-medium transition-colors">← Back</button>
        <div className="flex gap-3">
          <button onClick={onReset} className="text-gray-600 hover:text-gray-800 px-4 py-2 rounded-lg font-medium border border-gray-300 transition-colors">Start over</button>
          <button onClick={handleExport} className="bg-green-600 hover:bg-green-700 text-white px-8 py-2 rounded-lg font-semibold transition-colors">
            Download eBay CSV
          </button>
        </div>
      </div>
    </div>
  )
}
