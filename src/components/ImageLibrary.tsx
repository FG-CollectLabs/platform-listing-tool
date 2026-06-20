import { useEffect, useState, useCallback } from 'react'
import {
  listImages, listMonths, deleteImage,
  archiveMonth, restoreMonth, purgeMonth,
  formatBytes,
  type HostedImage, type MonthStat,
} from '../utils/imageApi'

interface Props {
  open: boolean
  onClose: () => void
}

export default function ImageLibrary({ open, onClose }: Props) {
  const [months, setMonths]       = useState<MonthStat[]>([])
  const [images, setImages]       = useState<HostedImage[]>([])
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [busyMonth, setBusyMonth] = useState<string | null>(null)
  const [selected, setSelected]   = useState<Set<string>>(new Set())
  const [preview, setPreview]     = useState<HostedImage | null>(null)

  const reloadMonths = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      setMonths(await listMonths())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load months')
    } finally {
      setLoading(false)
    }
  }, [])

  const reloadImages = useCallback(async (month: string) => {
    setLoading(true); setError(null)
    try {
      setImages(await listImages(month + '/'))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load images')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) { reloadMonths(); setSelected(new Set()); setSelectedMonth(null) }
  }, [open, reloadMonths])

  useEffect(() => {
    if (selectedMonth) reloadImages(selectedMonth)
    else setImages([])
  }, [selectedMonth, reloadImages])

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function handleDeleteSelected() {
    if (selected.size === 0) return
    if (!confirm(`Permanently delete ${selected.size} image${selected.size > 1 ? 's' : ''}? Cannot be undone.`)) return
    setLoading(true)
    try {
      await Promise.all([...selected].map(id => deleteImage(id)))
      setImages(prev => prev.filter(img => !selected.has(img.id)))
      setSelected(new Set())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setLoading(false)
    }
  }

  async function handleArchive(month: string) {
    if (!confirm(`Move all ${month} images to TODELETE/${month}? Listings using these URLs will break.`)) return
    setBusyMonth(month)
    try {
      const { moved } = await archiveMonth(month)
      await reloadMonths()
      if (selectedMonth === month) setSelectedMonth(null)
      alert(`Moved ${moved} images to TODELETE/${month}.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Archive failed')
    } finally {
      setBusyMonth(null)
    }
  }

  async function handleRestore(month: string) {
    // month here is "TODELETE/2026-06" — strip the prefix for the API
    const base = month.replace(/^TODELETE\//, '')
    setBusyMonth(month)
    try {
      const { moved } = await restoreMonth(base)
      await reloadMonths()
      if (selectedMonth === month) setSelectedMonth(null)
      alert(`Restored ${moved} images back to ${base}.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Restore failed')
    } finally {
      setBusyMonth(null)
    }
  }

  async function handlePurge(month: string) {
    const base = month.replace(/^TODELETE\//, '')
    if (!confirm(`PERMANENTLY DELETE every image under TODELETE/${base}? Cannot be undone.`)) return
    if (!confirm(`Last chance — really delete ${base}?`)) return
    setBusyMonth(month)
    try {
      const { deleted } = await purgeMonth(base)
      await reloadMonths()
      if (selectedMonth === month) setSelectedMonth(null)
      alert(`Permanently deleted ${deleted} images.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Purge failed')
    } finally {
      setBusyMonth(null)
    }
  }

  const liveMonths     = months.filter(m => !m.archived)
  const archivedMonths = months.filter(m => m.archived)
  const totalLive      = liveMonths.reduce((s, m) => s + m.bytes, 0)
  const totalArchived  = archivedMonths.reduce((s, m) => s + m.bytes, 0)

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />

      <div className="relative ml-auto h-full w-full max-w-4xl bg-white shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b bg-gray-50">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Image Library (R2)</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {liveMonths.length} live months · {formatBytes(totalLive)} live
              {archivedMonths.length > 0 && (
                <span className="text-orange-500"> · {archivedMonths.length} archived · {formatBytes(totalArchived)} in TODELETE</span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => { reloadMonths(); if (selectedMonth) reloadImages(selectedMonth) }}
              disabled={loading}
              className="text-xs text-gray-500 hover:text-gray-800 border border-gray-200 px-3 py-1.5 rounded-lg transition-colors"
            >
              {loading ? '⟳' : '↻ Refresh'}
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">✕</button>
          </div>
        </div>

        {error && (
          <div className="px-6 py-3 bg-red-50 border-b border-red-200 text-sm text-red-700">{error}</div>
        )}

        <div className="flex-1 overflow-hidden flex">
          {/* Left: month list */}
          <div className="w-64 border-r overflow-y-auto bg-gray-50">
            {liveMonths.length === 0 && archivedMonths.length === 0 && !loading && (
              <p className="text-sm text-gray-400 p-4">No images yet.</p>
            )}

            {liveMonths.length > 0 && (
              <div className="p-2">
                <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold px-2 py-1">Live months</p>
                {liveMonths.map(m => (
                  <MonthRow
                    key={m.month}
                    month={m}
                    active={selectedMonth === m.month}
                    busy={busyMonth === m.month}
                    onSelect={() => setSelectedMonth(m.month)}
                    onArchive={() => handleArchive(m.month)}
                  />
                ))}
              </div>
            )}

            {archivedMonths.length > 0 && (
              <div className="p-2 border-t border-gray-200">
                <p className="text-[10px] uppercase tracking-wide text-orange-500 font-semibold px-2 py-1">In TODELETE</p>
                {archivedMonths.map(m => (
                  <MonthRow
                    key={m.month}
                    month={m}
                    active={selectedMonth === m.month}
                    busy={busyMonth === m.month}
                    onSelect={() => setSelectedMonth(m.month)}
                    onRestore={() => handleRestore(m.month)}
                    onPurge={() => handlePurge(m.month)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Right: image grid for the selected month */}
          <div className="flex-1 overflow-y-auto p-5">
            {!selectedMonth && (
              <div className="flex items-center justify-center h-40 text-gray-400 text-sm">
                Pick a month folder on the left to view images.
              </div>
            )}

            {selectedMonth && (
              <>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-gray-700">
                    {selectedMonth} <span className="text-gray-400 font-normal">({images.length} images)</span>
                  </h3>
                  {selected.size > 0 && (
                    <button
                      onClick={handleDeleteSelected}
                      className="text-xs bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 px-3 py-1.5 rounded-lg font-medium"
                    >
                      Delete {selected.size} selected
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                  {images.map(img => {
                    const isSel = selected.has(img.id)
                    return (
                      <div
                        key={img.id}
                        onClick={() => toggleSelect(img.id)}
                        className={`group relative rounded-xl overflow-hidden border-2 cursor-pointer transition-all
                          ${isSel ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-200 hover:border-gray-300'}`}
                      >
                        <img src={img.url} alt={img.fileName}
                          loading="lazy"
                          className="w-full aspect-[2/3] object-cover"
                          onError={e => { (e.target as HTMLImageElement).style.opacity = '0.3' }} />

                        <div className={`absolute top-2 left-2 w-5 h-5 rounded-full border-2 flex items-center justify-center text-xs font-bold
                          ${isSel ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white/80 border-gray-300'}`}>
                          {isSel && '✓'}
                        </div>

                        <button
                          onClick={e => { e.stopPropagation(); setPreview(img) }}
                          className="absolute bottom-8 right-2 w-6 h-6 bg-black/60 text-white rounded-full text-xs items-center justify-center hidden group-hover:flex"
                        >⤢</button>

                        <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-2 py-1.5 text-[10px] text-white">
                          <div className="truncate font-medium">{img.fileName}</div>
                          <div className="text-white/60">{formatBytes(img.size)}</div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {preview && (
        <div className="absolute inset-0 z-60 flex items-center justify-center bg-black/80" onClick={() => setPreview(null)}>
          <div className="relative max-w-lg max-h-[90vh] rounded-xl overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
            <img src={preview.url} alt={preview.fileName} className="max-h-[85vh] object-contain" />
            <div className="absolute bottom-0 left-0 right-0 bg-black/70 px-4 py-2 text-white text-xs">
              <div className="font-medium">{preview.fileName}</div>
              <div className="text-white/60">{preview.url}</div>
            </div>
          </div>
          <button className="absolute top-4 right-4 text-white text-2xl" onClick={() => setPreview(null)}>✕</button>
        </div>
      )}
    </div>
  )
}

function MonthRow({
  month, active, busy,
  onSelect, onArchive, onRestore, onPurge,
}: {
  month: MonthStat
  active: boolean
  busy: boolean
  onSelect: () => void
  onArchive?: () => void
  onRestore?: () => void
  onPurge?: () => void
}) {
  return (
    <div
      onClick={onSelect}
      className={`group flex items-center gap-2 px-2 py-2 rounded-lg cursor-pointer transition-colors
        ${active ? 'bg-blue-100' : 'hover:bg-gray-100'}`}
    >
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium truncate ${month.archived ? 'text-orange-700' : 'text-gray-800'}`}>
          {month.month}
        </p>
        <p className="text-[10px] text-gray-500">{month.count} · {formatBytes(month.bytes)}</p>
      </div>
      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {onArchive && (
          <button onClick={e => { e.stopPropagation(); onArchive() }} disabled={busy}
            title="Move to TODELETE"
            className="text-[10px] bg-yellow-100 hover:bg-yellow-200 text-yellow-800 px-1.5 py-0.5 rounded">
            {busy ? '⟳' : 'Archive'}
          </button>
        )}
        {onRestore && (
          <button onClick={e => { e.stopPropagation(); onRestore() }} disabled={busy}
            title="Move back to live"
            className="text-[10px] bg-green-100 hover:bg-green-200 text-green-800 px-1.5 py-0.5 rounded">
            {busy ? '⟳' : 'Restore'}
          </button>
        )}
        {onPurge && (
          <button onClick={e => { e.stopPropagation(); onPurge() }} disabled={busy}
            title="Permanently delete"
            className="text-[10px] bg-red-100 hover:bg-red-200 text-red-800 px-1.5 py-0.5 rounded">
            {busy ? '⟳' : 'Purge'}
          </button>
        )}
      </div>
    </div>
  )
}
