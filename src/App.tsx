import { useState } from 'react'
import type { AppState, TcgCard } from './types'
import Step1Import from './components/Step1Import'
import Step2Configure from './components/Step2Configure'
import Step3Images from './components/Step3Images'
import Step4Export from './components/Step4Export'
import ImageLibrary from './components/ImageLibrary'

const DEFAULT_STATE: AppState = {
  step: 1,
  cards: [],
  pricing: {
    priceSource: 'market',
    ebayFvfPct: 0.1325,
    transactionFee: 0.30,
    roundTo: '0.05',
    tiers: [
      {
        // TCGPlayer charges ~$1.50 shipping on orders under $5 → match that total exactly
        // Item price ends up ≈ market price, floor at $0.99
        // Net: ~96–114% of market (cheap cards overperform, pulls average up)
        id: 'pwe-small',
        label: 'PWE Small',
        maxMarketPrice: 4.99,
        chargedShipping: 1.50,
        actualShippingCost: 0.74,
        packagingCost: 0.12,
        competitorShipping: 1.50,
        premiumPct: 0.0,
        itemFloorPrice: 0.99,
      },
      {
        // TCGPlayer free shipping kicks in at $5 → add 20% eBay premium to hit ~85% net
        // Buyer pays ~20% more than TCGPlayer, within normal eBay range
        id: 'pwe-mid',
        label: 'PWE Mid',
        maxMarketPrice: 20,
        chargedShipping: 1.50,
        actualShippingCost: 0.74,
        packagingCost: 0.12,
        competitorShipping: 0.00,
        premiumPct: 0.20,
        itemFloorPrice: 0.99,
      },
      {
        // High-value cards: tracked required, 15% eBay premium over TCP free-ship price
        // Buyers expect tracked + buyer protection premium on eBay for expensive cards
        id: 'tracked',
        label: 'Tracked',
        maxMarketPrice: null,
        chargedShipping: 5.00,
        actualShippingCost: 4.50,
        packagingCost: 0.12,
        competitorShipping: 0.00,
        premiumPct: 0.15,
        itemFloorPrice: 0.99,
      },
    ],
  },
  ebay: {
    titleTemplate: '{name} {set} #{number} {condition} MTG Magic',
    conditionDescription: 'Shipped in a sleeve and top-loader.',
    categoryId: '2536',
    listingDuration: 'GTC',
    dispatchTimeMax: 2,
    paymentProfile: '',
    returnProfile: '',
    shippingProfile: '',
    country: 'US',
    currency: 'USD',
  },
}

const STEPS = [
  { n: 1, label: 'Import CSV' },
  { n: 2, label: 'Configure' },
  { n: 3, label: 'Images' },
  { n: 4, label: 'Export' },
]

export default function App() {
  const [state, setState] = useState<AppState>(DEFAULT_STATE)
  const [libraryOpen, setLibraryOpen] = useState(false)

  function setStep(step: AppState['step']) {
    setState((s) => ({ ...s, step }))
  }

  function setCards(cards: TcgCard[]) {
    setState((s) => ({ ...s, cards }))
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <ImageLibrary open={libraryOpen} onClose={() => setLibraryOpen(false)} />
      <header className="bg-white border-b shadow-sm">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-gray-900">Platform Listing Tool</h1>
            <p className="text-xs text-gray-400">TCGPlayer CSV → eBay File Exchange</p>
          </div>
          <div className="flex items-center gap-4">
            {state.cards.length > 0 && (
              <span className="text-sm text-gray-500">{state.cards.length} cards loaded</span>
            )}
            <button
              onClick={() => setLibraryOpen(true)}
              className="text-sm text-gray-500 hover:text-gray-800 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50 transition-colors flex items-center gap-1.5"
            >
              <span>☁</span> Image Library
            </button>
          </div>
        </div>
      </header>

      {/* Step nav */}
      <div className="bg-white border-b">
        <div className="max-w-4xl mx-auto px-6 py-3 flex gap-1">
          {STEPS.map((s, i) => {
            const done = state.step > s.n
            const active = state.step === s.n
            return (
              <div key={s.n} className="flex items-center gap-1">
                {i > 0 && <div className="w-8 h-px bg-gray-200 mx-1" />}
                <div
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors
                    ${active ? 'bg-blue-600 text-white' : done ? 'text-blue-600 cursor-pointer hover:bg-blue-50' : 'text-gray-400'}`}
                  onClick={() => {
                    if (done) setStep(s.n as AppState['step'])
                  }}
                >
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs
                    ${active ? 'bg-white text-blue-600' : done ? 'bg-blue-100 text-blue-600' : 'bg-gray-200 text-gray-400'}`}
                  >
                    {done ? '✓' : s.n}
                  </span>
                  {s.label}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <main className="max-w-4xl mx-auto px-6 py-8">
        <div className="bg-white rounded-2xl shadow-sm p-8">
          {state.step === 1 && (
            <Step1Import
              cards={state.cards}
              onCards={setCards}
              onNext={() => setStep(2)}
            />
          )}
          {state.step === 2 && (
            <Step2Configure
              cards={state.cards}
              pricing={state.pricing}
              ebay={state.ebay}
              onPricing={(pricing) => setState((s) => ({ ...s, pricing }))}
              onEbay={(ebay) => setState((s) => ({ ...s, ebay }))}
              onBack={() => setStep(1)}
              onNext={() => setStep(3)}
            />
          )}
          {state.step === 3 && (
            <Step3Images
              cards={state.cards}
              onCards={setCards}
              onBack={() => setStep(2)}
              onNext={() => setStep(4)}
            />
          )}
          {state.step === 4 && (
            <Step4Export
              cards={state.cards}
              pricing={state.pricing}
              ebay={state.ebay}
              onBack={() => setStep(3)}
              onReset={() => setState(DEFAULT_STATE)}
            />
          )}
        </div>
      </main>
    </div>
  )
}
