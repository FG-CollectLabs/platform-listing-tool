import Papa from 'papaparse'
import type { TcgCard } from '../types'

type RawRow = Record<string, string>

function num(v: string): number {
  const n = parseFloat(v)
  return isNaN(n) ? 0 : n
}

function int(v: string): number {
  const n = parseInt(v, 10)
  return isNaN(n) ? 0 : n
}

export function parseTcgplayerCsv(text: string): TcgCard[] {
  const result = Papa.parse<RawRow>(text, {
    header: true,
    skipEmptyLines: true,
  })

  return result.data.map((row) => ({
    tcgplayerId: row['TCGplayer Id'] ?? '',
    productLine: row['Product Line'] ?? '',
    setName: row['Set Name'] ?? '',
    productName: row['Product Name'] ?? '',
    number: row['Number'] ?? '',
    rarity: row['Rarity'] ?? '',
    condition: row['Condition'] ?? 'Near Mint',
    tcgMarketPrice: num(row['TCG Market Price']),
    tcgDirectLow: num(row['TCG Direct Low']),
    tcgLowPriceWithShipping: num(row['TCG Low Price With Shipping']),
    tcgLowPrice: num(row['TCG Low Price']),
    // handle both "Total Quantity" (export) and "Add to Quantity" style
    totalQuantity: int(row['Total Quantity']) || int(row['Add to Quantity']) || 1,
    addToQuantity: int(row['Add to Quantity']),
    tcgMarketplacePrice: num(row['TCG Marketplace Price']),
    photoUrl: row['Photo URL'] || (row['TCGplayer Id']
      ? `https://product-images.tcgplayer.com/fit-in/400x558/${row['TCGplayer Id']}.jpg`
      : ''),
  }))
}
