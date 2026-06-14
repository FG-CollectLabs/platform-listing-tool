import { useRef, useState, useCallback } from 'react'
import type { TcgCard } from '../types'
import { parseTcgplayerCsv } from '../utils/parseCsv'

interface Props {
  cards: TcgCard[]
  onCards: (cards: TcgCard[]) => void
  onNext: () => void
}

export default function Step1Import({ cards, onCards, onNext }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)

  function handleFile(file: File) {
    setError('')
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string
        const parsed = parseTcgplayerCsv(text)
        if (parsed.length === 0) {
          setError('No cards found. Make sure this is a TCGPlayer inventory CSV.')
          return
        }
        onCards(parsed)
      } catch {
        setError('Failed to parse CSV. Make sure this is a TCGPlayer inventory CSV.')
      }
    }
    reader.readAsText(file)
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [])

  const totalValue = cards.reduce((sum, c) => sum + c.tcgMarketPrice * c.totalQuantity, 0)

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Import TCGPlayer CSV</h2>
        <p className="text-sm text-gray-500 mt-1">
          Export your inventory from TCGPlayer and drop it here. Both "inventory export" and
          "upload template" formats are supported.
        </p>
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors
          ${dragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50'}`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
        />
        <div className="text-4xl mb-3">📄</div>
        <p className="text-gray-700 font-medium">Drop TCGPlayer CSV here or click to browse</p>
        <p className="text-gray-400 text-sm mt-1">.csv files only</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {cards.length > 0 && (
        <>
          <div className="flex gap-4">
            <div className="bg-blue-50 rounded-lg px-4 py-3 text-center flex-1">
              <div className="text-2xl font-bold text-blue-700">{cards.length}</div>
              <div className="text-xs text-blue-500">Cards</div>
            </div>
            <div className="bg-green-50 rounded-lg px-4 py-3 text-center flex-1">
              <div className="text-2xl font-bold text-green-700">
                ${totalValue.toFixed(2)}
              </div>
              <div className="text-xs text-green-500">TCG Market Value</div>
            </div>
            <div className="bg-purple-50 rounded-lg px-4 py-3 text-center flex-1">
              <div className="text-2xl font-bold text-purple-700">
                {[...new Set(cards.map((c) => c.setName))].length}
              </div>
              <div className="text-xs text-purple-500">Sets</div>
            </div>
          </div>

          <div className="border rounded-xl overflow-hidden">
            <div className="max-h-72 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium text-gray-600">Card</th>
                    <th className="text-left px-4 py-2 font-medium text-gray-600">#</th>
                    <th className="text-left px-4 py-2 font-medium text-gray-600">Condition</th>
                    <th className="text-right px-4 py-2 font-medium text-gray-600">Market</th>
                    <th className="text-right px-4 py-2 font-medium text-gray-600">Qty</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {cards.map((c) => (
                    <tr key={c.tcgplayerId} className="hover:bg-gray-50">
                      <td className="px-4 py-2 font-medium text-gray-900">{c.productName}</td>
                      <td className="px-4 py-2 text-gray-500">{c.number}</td>
                      <td className="px-4 py-2 text-gray-500">{c.condition}</td>
                      <td className="px-4 py-2 text-right text-gray-900">
                        ${c.tcgMarketPrice.toFixed(2)}
                      </td>
                      <td className="px-4 py-2 text-right text-gray-500">{c.totalQuantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              onClick={onNext}
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium transition-colors"
            >
              Configure Listing Settings →
            </button>
          </div>
        </>
      )}
    </div>
  )
}
