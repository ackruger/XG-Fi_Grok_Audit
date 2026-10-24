import { useState, useRef } from 'react'
import { X, Camera, Check } from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { Asset, IssuePriority } from '../types'

interface Props {
  asset: Asset
  onClose: () => void
  onComplete: () => void
}

export default function CreateIssueModal({ asset, onClose, onComplete }: Props) {
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<IssuePriority>('medium')
  const [category, setCategory] = useState('')
  const [photos, setPhotos] = useState<File[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handlePhotoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) {
      setPhotos(prev => [...prev, ...Array.from(e.target.files!)])
    }
  }

  async function handleSubmit() {
    if (!description.trim()) {
      setError('Please describe the case.')
      return
    }

    setSubmitting(true)
    setError('')

    try {
      const { data: issue, error: issueErr } = await supabase
        .from('issues')
        .insert({
          asset_id: asset.id,
          description,
          priority,
          category,
        })
        .select()
        .maybeSingle()

      if (issueErr) throw issueErr

      // Upload photos
      if (photos.length > 0 && issue) {
        for (const photo of photos) {
          const path = `${asset.facility_id}/${asset.id}/issues/${Date.now()}_${photo.name}`
          const { error: uploadErr } = await supabase.storage
            .from('photos')
            .upload(path, photo)

          if (!uploadErr) {
            await supabase.from('photos').insert({
              issue_id: issue.id,
              asset_id: asset.id,
              storage_path: path,
              caption: '',
            })
          }
        }
      }

      // Also create an event for the case
      await supabase.from('events').insert({
        asset_id: asset.id,
        event_type: 'issue_reported',
        raw_note: `Case reported: ${description}`,
        status_before: asset.status,
        status_after: asset.status,
      })

      onComplete()
    } catch (err: any) {
      setError(err.message || 'Failed to create case.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end lg:items-center justify-center pb-20 lg:pb-0">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white border border-neutral-200 w-full max-w-lg rounded-t-2xl lg:rounded-2xl max-h-[80vh] lg:max-h-[90vh] overflow-y-auto shadow-lg">
        <div className="sticky top-0 bg-white border-b border-neutral-200 px-4 py-3 flex items-center justify-between rounded-t-2xl">
          <h2 className="text-base font-semibold text-neutral-900">Report Case</h2>
          <button onClick={onClose} className="p-1 hover:bg-neutral-100 rounded-lg">
            <X size={20} />
          </button>
        </div>

        <div className="p-4 pb-8 space-y-4">
          <div>
            <label className="block text-sm font-medium text-neutral-800 mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Describe the case, deficiency, or observation..."
              className="w-full px-3 py-2.5 bg-white border border-neutral-200 rounded-xl text-sm text-neutral-900 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-primary-400/40 focus:border-primary-400 resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-neutral-800 mb-1">Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as IssuePriority)}
                className="w-full px-3 py-2.5 bg-white border border-neutral-200 rounded-xl text-sm text-neutral-900 focus:outline-none focus:ring-2 focus:ring-primary-400/40 focus:border-primary-400"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-800 mb-1">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-3 py-2.5 bg-white border border-neutral-200 rounded-xl text-sm text-neutral-900 focus:outline-none focus:ring-2 focus:ring-primary-400/40 focus:border-primary-400"
              >
                <option value="">Select...</option>
                <option value="deficiency">Deficiency</option>
                <option value="damage">Damage</option>
                <option value="safety">Safety</option>
                <option value="design">Design Case</option>
                <option value="access">Access Case</option>
                <option value="material">Material Case</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-800 mb-1">Photos</label>
            <div className="flex flex-wrap gap-2">
              {photos.map((photo, i) => (
                <div key={i} className="relative w-16 h-16 rounded-xl overflow-hidden bg-neutral-200">
                  <img src={URL.createObjectURL(photo)} alt="" className="w-full h-full object-cover" />
                  <button
                    onClick={() => setPhotos(prev => prev.filter((_, idx) => idx !== i))}
                    className="absolute top-0.5 right-0.5 bg-black/60 text-white rounded-full p-0.5"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-16 h-16 border-2 border-dashed border-neutral-300 rounded-xl flex items-center justify-center text-neutral-500 hover:border-primary-400 hover:text-primary-600 transition-colors"
              >
                <Camera size={20} />
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              onChange={handlePhotoSelect}
              className="hidden"
            />
          </div>

          {error && (
            <div className="bg-error-50 border border-error-500 text-error-700 text-sm px-3 py-2 rounded-xl">
              {error}
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-error-600 to-error-700 hover:from-error-700 hover:to-error-800 text-white py-3 rounded-xl text-sm font-medium disabled:opacity-50 shadow-md shadow-error-200"
          >
            {submitting ? (
              <div className="w-5 h-5 border-2 border-error-200 border-t-error-500 rounded-full animate-spin" />
            ) : (
              <>
                <Check size={18} />
                Report Case
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
