const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? ''

export interface HostedImage {
  id: string
  fileName: string
  origName: string
  url: string
  size: number
  uploadedAt: string
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

export async function listImages(): Promise<HostedImage[]> {
  const res = await fetch(`${API_BASE}/api/images`)
  if (!res.ok) throw new Error(`List failed: ${res.status}`)
  return res.json()
}

export async function deleteImage(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/images/${id}`, { method: 'DELETE' })
  if (!res.ok && res.status !== 404) throw new Error(`Delete failed: ${res.status}`)
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
