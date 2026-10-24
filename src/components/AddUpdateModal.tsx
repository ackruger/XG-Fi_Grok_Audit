import { useState, useRef, useCallback } from 'react'
import { X, Mic, MicOff, Camera, Check, Sparkles } from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { Asset, AssetStatus, EventType } from '../types'
import { useAuth } from '../context/AuthContext'

interface Props {
  asset: Asset
  onClose: () => void
  onComplete: () => void
}

const STATUS_OPTIONS: { value: AssetStatus; label: string }[] = [
  { value: 'not_started', label: 'Not Started' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'complete', label: 'Complete' },
  { value: 'complete_pending_verification', label: 'Complete - Pending Verification' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'deficient', label: 'Deficient' },
  { value: 'ready_for_next_trade', label: 'Ready for Next Trade' },
]

const EVENT_TYPES: { value: EventType; label: string }[] = [
  { value: 'progress_update', label: 'Progress Update' },
  { value: 'completion_note', label: 'Completion Note' },
  { value: 'general_note', label: 'General Note' },
  { value: 'inspection_requested', label: 'Inspection Requested' },
  { value: 'commissioning_update', label: 'Commissioning Update' },
  { value: 'material_delay', label: 'Material Delay' },
  { value: 'access_issue', label: 'Access Case' },
  { value: 'damage_reported', label: 'Damage Reported' },
  { value: 'safety_concern', label: 'Safety Concern' },
]

export default function AddUpdateModal({ asset, onClose, onComplete }: Props) {
  const { session } = useAuth()
  const [note, setNote] = useState('')
  const [eventType, setEventType] = useState<EventType>('progress_update')
  const [newStatus, setNewStatus] = useState<AssetStatus>(asset.status)
  const [photos, setPhotos] = useState<File[]>([])
  const [recording, setRecording] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [aiSuggesting, setAiSuggesting] = useState(false)
  const [aiSuggestion, setAiSuggestion] = useState<any>(null)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const recognitionRef = useRef<any>(null)
  const aiDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchAiSuggestion = useCallback(async (noteText: string) => {
    if (!noteText.trim() || noteText.length < 10) {
      setAiSuggestion(null)
      return
    }
    setAiSuggesting(true)
    try {
      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-structure-note`
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session?.access_token}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          raw_note: noteText,
          asset_name: asset.equipment_name,
          asset_type: asset.equipment_type,
          current_status: asset.status,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        if (data.suggested_status || data.event_type) {
          setAiSuggestion(data)
        }
      }
    } catch {
      // silently fail - AI suggestion is optional
    } finally {
      setAiSuggesting(false)
    }
  }, [session, asset])

  function handleNoteChange(value: string) {
    setNote(value)
    if (aiDebounceRef.current) clearTimeout(aiDebounceRef.current)
    aiDebounceRef.current = setTimeout(() => fetchAiSuggestion(value), 1500)
  }

  function applyAiSuggestion() {
    if (!aiSuggestion) return
    if (aiSuggestion.suggested_status) {
      setNewStatus(aiSuggestion.suggested_status)
    }
    if (aiSuggestion.event_type) {
      setEventType(aiSuggestion.event_type)
    }
    setAiSuggestion(null)
  }

  function startVoice() {
    const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition
    if (!SpeechRecognition) {
      setError('Voice input not supported on this browser.')
      return
    }

    const recognition = new SpeechRecognition()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'

    recognition.onresult = (event: any) => {
      let transcript = ''
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript
      }
      handleNoteChange(transcript)
    }

    recognition.onerror = () => {
      setRecording(false)
    }

    recognition.onend = () => {
      setRecording(false)
    }

    recognitionRef.current = recognition
    recognition.start()
    setRecording(true)
  }

  function stopVoice() {
    if (recognitionRef.current) {
      recognitionRef.current.stop()
      recognitionRef.current = null
    }
    setRecording(false)
  }

  function handlePhotoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) {
      setPhotos(prev => [...prev, ...Array.from(e.target.files!)])
    }
  }

  function removePhoto(index: number) {
    setPhotos(prev => prev.filter((_, i) => i !== index))
  }

  async function handleSubmit() {
    if (!note.trim()) {
      setError('Please enter a note describing the update.')
      return
    }

    setSubmitting(true)
    setError('')

    try {
      // Create event
      const { data: event, error: eventErr } = await supabase
        .from('events')
        .insert({
          asset_id: asset.id,
          event_type: eventType,
          raw_note: note,
          status_before: asset.status,
          status_after: newStatus,
        })
        .select()
        .maybeSingle()

      if (eventErr) throw eventErr

      // Update asset status if changed
      if (newStatus !== asset.status) {
        const { error: updateErr } = await supabase
          .from('assets')
          .update({ status: newStatus, updated_at: new Date().toISOString() })
          .eq('id', asset.id)

        if (updateErr) throw updateErr

        const { error: histErr } = await supabase.from('status_history').insert({
          asset_id: asset.id,
          previous_status: asset.status,
          new_status: newStatus,
          reason: note,
        })

        if (histErr) throw histErr
      }

      // Upload photos
      if (photos.length > 0 && event) {
        for (const photo of photos) {
          const path = `${asset.facility_id}/${asset.id}/${Date.now()}_${photo.name}`
          const { error: uploadErr } = await supabase.storage
            .from('photos')
            .upload(path, photo)

          if (!uploadErr) {
            await supabase.from('photos').insert({
              event_id: event.id,
              asset_id: asset.id,
              storage_path: path,
              caption: '',
            })
          }
        }
      }

      onComplete()
    } catch (err: any) {
      setError(err.message || 'Failed to submit update.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end lg:items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white border border-neutral-200 w-full max-w-lg rounded-t-2xl lg:rounded-2xl max-h-[90vh] overflow-y-auto shadow-lg">
        <div className="sticky top-0 bg-white border-b border-neutral-200 px-4 py-3 flex items-center justify-between rounded-t-2xl">
          <h2 className="text-base font-semibold text-neutral-900">Add Update</h2>
          <button onClick={onClose} className="p-1 hover:bg-neutral-100 rounded-lg">
            <X size={20} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Event Type */}
          <div>
            <label className="block text-sm font-medium text-neutral-800 mb-1">Update Type</label>
            <select
              value={eventType}
              onChange={(e) => setEventType(e.target.value as EventType)}
              className="w-full px-3 py-2.5 bg-white border border-neutral-200 rounded-xl text-sm text-neutral-900 focus:outline-none focus:ring-2 focus:ring-primary-400/40 focus:border-primary-400"
            >
              {EVENT_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          {/* Note Input with Voice */}
          <div>
            <label className="block text-sm font-medium text-neutral-800 mb-1">Field Note</label>
            <div className="relative">
              <textarea
                value={note}
                onChange={(e) => handleNoteChange(e.target.value)}
                rows={4}
                placeholder="Describe what happened, what was done, what's remaining..."
                className="w-full px-3 py-2.5 bg-white border border-neutral-200 rounded-xl text-sm text-neutral-900 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-primary-400/40 focus:border-primary-400 resize-none pr-12"
              />
              <button
                type="button"
                onClick={recording ? stopVoice : startVoice}
                className={`absolute right-2 bottom-2 p-2 rounded-lg transition-colors ${
                  recording ? 'bg-error-50 text-error-700 animate-pulse' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                }`}
              >
                {recording ? <MicOff size={18} /> : <Mic size={18} />}
              </button>
            </div>
            {recording && <p className="text-xs text-error-700 mt-1">Listening... tap to stop</p>}
          </div>

          {/* Status Change */}
          <div>
            <label className="block text-sm font-medium text-neutral-800 mb-1">Status</label>
            {aiSuggesting && (
              <div className="mb-2 flex items-center gap-2 text-xs text-primary-600">
                <Sparkles size={14} className="animate-pulse" />
                Analyzing note...
              </div>
            )}
            {aiSuggestion && aiSuggestion.suggested_status && aiSuggestion.suggested_status !== newStatus && (
              <button
                type="button"
                onClick={applyAiSuggestion}
                className="mb-2 w-full flex items-center gap-2 px-3 py-2 bg-primary-50 border border-primary-200 rounded-xl text-sm text-primary-800 hover:bg-primary-100 transition-colors"
              >
                <Sparkles size={14} className="text-primary-600 shrink-0" />
                <span className="flex-1 text-left">
                  AI suggests: <strong>{aiSuggestion.suggested_status.replace(/_/g, ' ')}</strong>
                  {aiSuggestion.event_type && <span className="text-primary-600"> ({aiSuggestion.event_type.replace(/_/g, ' ')})</span>}
                </span>
                <span className="text-xs text-primary-500">Apply</span>
              </button>
            )}
            <select
              value={newStatus}
              onChange={(e) => setNewStatus(e.target.value as AssetStatus)}
              className="w-full px-3 py-2.5 bg-white border border-neutral-200 rounded-xl text-sm text-neutral-900 focus:outline-none focus:ring-2 focus:ring-primary-400/40 focus:border-primary-400"
            >
              {STATUS_OPTIONS.map(s => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>

          {/* Photo Upload */}
          <div>
            <label className="block text-sm font-medium text-neutral-800 mb-1">Photos</label>
            <div className="flex flex-wrap gap-2">
              {photos.map((photo, i) => (
                <div key={i} className="relative w-16 h-16 rounded-xl overflow-hidden bg-neutral-200">
                  <img src={URL.createObjectURL(photo)} alt="" className="w-full h-full object-cover" />
                  <button
                    onClick={() => removePhoto(i)}
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
            className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-600 hover:to-primary-700 text-white py-3 rounded-xl text-sm font-medium disabled:opacity-50 shadow-md shadow-primary-200"
          >
            {submitting ? (
              <div className="w-5 h-5 border-2 border-primary-200 border-t-primary-500 rounded-full animate-spin" />
            ) : (
              <>
                <Check size={18} />
                Submit Update
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
