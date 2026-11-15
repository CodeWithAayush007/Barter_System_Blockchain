import { useEffect, useState } from 'react'
import { UploadCloud, X } from 'lucide-react'
import { imageProblem } from '../utils/images'

/**
 * A click-to-upload photo box with a preview. Controlled by the parent: it holds the
 * File, this component just picks it. `onProblem(message)` is called for a bad file.
 */
export default function PhotoPicker({ file, onChange, onProblem, height = 'h-40', hint = 'Click to upload an image (max 5MB)', testId = 'photo-input' }) {
  const [preview, setPreview] = useState(null)

  useEffect(() => {
    if (!file) {
      setPreview(null)
      return undefined
    }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const handle = (e) => {
    const picked = e.target.files?.[0]
    e.target.value = '' // lets the same file be picked again after removing it
    if (!picked) return
    const problem = imageProblem(picked)
    if (problem) {
      onProblem?.(problem)
      return
    }
    onChange(picked)
  }

  return (
    <div className="relative">
      <label
        className={`flex flex-col items-center justify-center gap-2 border border-dashed border-ink-border rounded-lg ${height} cursor-pointer hover:border-copper/40 transition-colors overflow-hidden`}
      >
        {preview ? (
          <img src={preview} alt="Preview" className="h-full w-full object-cover" />
        ) : (
          <>
            <UploadCloud size={22} className="text-parchment-faint" />
            <span className="text-sm text-parchment-muted px-3 text-center">{hint}</span>
          </>
        )}
        <input data-testid={testId} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={handle} />
      </label>
      {preview && (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="absolute top-2 right-2 grid place-items-center h-7 w-7 rounded-full bg-ink/80 border border-ink-border text-parchment-muted hover:text-parchment"
          aria-label="Remove photo"
        >
          <X size={14} />
        </button>
      )}
    </div>
  )
}
