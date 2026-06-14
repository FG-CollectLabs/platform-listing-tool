import { useEffect, useState, useCallback } from 'react'
import { listImages, deleteImage, formatBytes, type HostedImage } from '../utils/imageApi'

interface Props {
  open: boolean
  onClose: () => void
}

export default function ImageLibrary({ open, onClose }: Props) {
  const [images, setImages]       = useState<HostedImage[]>([])
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [selected, setSelected]   = useState<Set<string>>(new Set())
  const [deleting, setDeleting]   = useState(false)
  const [preview, setPreview]     = useState<HostedImage | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      setImages(await listImages())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load images')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) { load(); setSelected(new Set()) }
  }, [open, load])

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function selectAll() {
    setSelected(selected.size === images.length ? new Set() : new Set(images.map(i => i.id)))
  }

  async function handleDelete(ids: string[]) {
    if (!confirm(`Delete ${ids.length} image${ids.length > 1 ? 's' : ''}? This cannot be undone.`)) return
    setDeleting(true)
    try {
      await Promise.all(ids.map(id => deleteImage(id)))
      setImages(prev => prev.filter(img => !ids.includes(img.id)))
      setSelected(new Set())
      if (preview && ids.includes(preview.id)) setPreview(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setDeleting(false)
    }
  }

  const totalBytes = images.reduce((s, i) => s + i.size, 0)

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" />

      {/* Drawer */}
      <div
        className="relative ml-auto h-full w-full max-w-3xl bg-white shadow-2xl flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b bg-gray-50">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Image Library</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {images.length} images · {formatBytes(totalBytes)} total
            </p>
          </div>
          <div className="flex items-center gap-3">
            {selected.size > 0 && (
              <button
                onClick={() => handleDelete([...selected])}
                disabled={deleting}
                className="text-xs bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50"
              >
                {deleting ? 'Deleting…' : `Delete ${selected.size} selected`}
              </button>
            )}
            <button
              onClick={load}
              disabled={loading}
              className="text-xs text-gray-500 hover:text-gray-800 border border-gray-200 px-3 py-1.5 rounded-lg transition-colors"
            >
              {loading ? '⟳' : '↻ Refresh'}
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">✕</button>
          </div>
        </div>

        {error && (
          <div className="px-6 py-3 bg-red-50 border-b border-red-200 text-sm text-red-700">
            {error} — is the server running?
          </div>
        )}

        {/* Toolbar */}
        {images.length > 0 && (
          <div className="flex items-center gap-3 px-6 py-2.5 border-b text-xs text-gray-500">
            <button onClick={selectAll} className="hover:text-gray-900 transition-colors">
              {selected.size === images.length ? 'Deselect all' : 'Select all'}
            </button>
            {selected.size > 0 && (
              <span className="text-gray-400">{selected.size} selected</span>
            )}
          </div>
        )}

        {/* Image grid */}
        <div className="flex-1 overflow-y-auto p-5">
          {loading && images.length === 0 && (
            <div className="flex items-center justify-center h-40 text-gray-400 text-sm">Loading…</div>
          )}
          {!loading && images.length === 0 && !error && (
            <div className="flex items-center justify-center h-40 text-gray-400 text-sm">
              No images uploaded yet.
            </div>
          )}

          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
            {images.map(img => {
              const isSelected = selected.has(img.id)
              return (
                <div
                  key={img.id}
                  className={`group relative rounded-xl overflow-hidden border-2 cursor-pointer transition-all
                    ${isSelected ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-200 hover:border-gray-300'}`}
                  onClick={() => toggleSelect(img.id)}
                >
                  <img
                    src={img.url}
                    alt={img.origName}
                    className="w-full aspect-[2/3] object-cover"
                    onError={e => { (e.target as HTMLImageElement).src = '' }}
                  />

                  {/* Selection badge */}
                  <div className={`absolute top-2 left-2 w-5 h-5 rounded-full border-2 flex items-center justify-center text-xs font-bold transition-colors
                    ${isSelected ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white/80 border-gray-300'}`}>
                    {isSelected && '✓'}
                  </div>

                  {/* Delete button */}
                  <button
                    onClick={e => { e.stopPropagation(); handleDelete([img.id]) }}
                    className="absolute top-2 right-2 w-6 h-6 bg-red-600 hover:bg-red-700 text-white rounded-full text-xs items-center justify-center hidden group-hover:flex transition-colors shadow"
                    title="Delete"
                  >✕</button>

                  {/* Preview button */}
                  <button
                    onClick={e => { e.stopPropagation(); setPreview(img) }}
                    className="absolute bottom-8 right-2 w-6 h-6 bg-black/60 hover:bg-black/80 text-white rounded-full text-xs items-center justify-center hidden group-hover:flex transition-colors"
                    title="Preview"
                  >⤢</button>

                  {/* Label */}
                  <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-2 py-1.5 text-[10px] text-white">
                    <div className="truncate font-medium">{img.origName}</div>
                    <div className="text-white/60">{formatBytes(img.size)} · {new Date(img.uploadedAt).toLocaleDateString()}</div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Preview lightbox */}
      {preview && (
        <div
          className="absolute inset-0 z-60 flex items-center justify-center bg-black/80"
          onClick={() => setPreview(null)}
        >
          <div className="relative max-w-lg max-h-[90vh] rounded-xl overflow-hidden shadow-2xl"
            onClick={e => e.stopPropagation()}>
            <img src={preview.url} alt={preview.origName} className="max-h-[85vh] object-contain" />
            <div className="absolute bottom-0 left-0 right-0 bg-black/70 px-4 py-2 flex items-center justify-between gap-3">
              <div className="text-white text-xs">
                <div className="font-medium">{preview.origName}</div>
                <div className="text-white/60">{formatBytes(preview.size)} · {preview.url}</div>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <a href={preview.url} target="_blank" rel="noreferrer"
                  className="text-xs text-white/80 hover:text-white border border-white/30 px-2 py-1 rounded">
                  Open ↗
                </a>
                <button
                  onClick={() => { handleDelete([preview.id]); setPreview(null) }}
                  className="text-xs bg-red-600 hover:bg-red-700 text-white px-2 py-1 rounded">
                  Delete
                </button>
              </div>
            </div>
          </div>
          <button className="absolute top-4 right-4 text-white text-2xl" onClick={() => setPreview(null)}>✕</button>
        </div>
      )}
    </div>
  )
}
