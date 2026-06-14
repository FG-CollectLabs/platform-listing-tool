import { CHANGELOG } from '../version'

interface Props {
  open: boolean
  onClose: () => void
}

export default function ChangelogModal({ open, onClose }: Props) {
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-base font-semibold text-gray-900">Changelog</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-lg leading-none transition-colors"
          >
            ✕
          </button>
        </div>

        <div className="overflow-y-auto px-6 py-4 space-y-6">
          {CHANGELOG.map(release => (
            <div key={release.version}>
              <div className="flex items-baseline gap-2 mb-2">
                <span className="text-sm font-bold text-gray-900">v{release.version}</span>
                <span className="text-xs text-gray-400">{release.date}</span>
              </div>
              <ul className="space-y-1">
                {release.notes.map((note, i) => (
                  <li key={i} className="text-xs text-gray-600 flex gap-2">
                    <span className="text-gray-300 flex-shrink-0">·</span>
                    <span>{note}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
