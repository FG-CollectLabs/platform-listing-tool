const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? ''

export interface HostedImage {
  id: string            // R2 object key, e.g. "2026-06/abc123.jpg"
  key: string           // same as id
  month: string         // "2026-06" or "TODELETE/2026-06" or "legacy"
  archived: boolean
  fileName: string
  origName: string
  url: string
  size: number
  uploadedAt: string
}

export interface MonthStat {
  month: string         // "2026-06" or "TODELETE/2026-06"
  archived: boolean
  count: number
  bytes: number
}

export async function uploadImage(blob: Blob, origName: string): Promise<HostedImage> {
  const fd = new FormData()
  fd.append('image', blob, origName)
  const res = await fetch(`${API_BASE}/api/upload`, { method: 'POST', body: fd })
  if (!res.ok) {
    const text = await res.text().catch(() => String(res.status))
    throw new Error(`Upload failed: ${text}`)
  }
  return res.json()
}

export async function listImages(prefix = ''): Promise<HostedImage[]> {
  const url = prefix ? `${API_BASE}/api/images?prefix=${encodeURIComponent(prefix)}` : `${API_BASE}/api/images`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`List failed: ${res.status}`)
  return res.json()
}

export async function listMonths(): Promise<MonthStat[]> {
  const res = await fetch(`${API_BASE}/api/months`)
  if (!res.ok) throw new Error(`Months list failed: ${res.status}`)
  return res.json()
}

export async function deleteImage(key: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/image?key=${encodeURIComponent(key)}`, { method: 'DELETE' })
  if (!res.ok && res.status !== 404) throw new Error(`Delete failed: ${res.status}`)
}

export async function archiveMonth(month: string): Promise<{ moved: number }> {
  const res = await fetch(`${API_BASE}/api/months/archive?month=${encodeURIComponent(month)}`, { method: 'POST' })
  if (!res.ok) throw new Error(`Archive failed: ${res.status}`)
  return res.json()
}

export async function restoreMonth(month: string): Promise<{ moved: number }> {
  const res = await fetch(`${API_BASE}/api/months/restore?month=${encodeURIComponent(month)}`, { method: 'POST' })
  if (!res.ok) throw new Error(`Restore failed: ${res.status}`)
  return res.json()
}

export async function purgeMonth(month: string): Promise<{ deleted: number }> {
  const res = await fetch(`${API_BASE}/api/months/purge?month=${encodeURIComponent(month)}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`Purge failed: ${res.status}`)
  return res.json()
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}
