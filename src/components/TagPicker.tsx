import { useState, useEffect, useRef } from 'react'
import { Plus, X, Check, ChevronDown } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useFacility } from '../context/FacilityContext'
import type { Tag } from '../types'

const TAG_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#22c55e', '#14b8a6',
  '#3b82f6', '#6366f1', '#8b5cf6', '#ec4899', '#6b7280',
]

interface Props {
  selectedTagIds: string[]
  onChange: (tagIds: string[]) => void
}

export default function TagPicker({ selectedTagIds, onChange }: Props) {
  const { currentFacility } = useFacility()
  const [tags, setTags] = useState<Tag[]>([])
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(TAG_COLORS[0])
  const [saving, setSaving] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (currentFacility) fetchTags()
  }, [currentFacility])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setCreating(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  async function fetchTags() {
    if (!currentFacility) return
    const { data } = await supabase
      .from('tags')
      .select('*')
      .eq('facility_id', currentFacility.id)
      .order('name')
    setTags(data || [])
  }

  async function handleCreate() {
    if (!newName.trim() || !currentFacility) return
    setSaving(true)
    const { data, error } = await supabase
      .from('tags')
      .insert({ facility_id: currentFacility.id, name: newName.trim(), color: newColor })
      .select()
      .maybeSingle()
    if (!error && data) {
      setTags(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
      onChange([...selectedTagIds, data.id])
      setNewName('')
      setNewColor(TAG_COLORS[0])
      setCreating(false)
    }
    setSaving(false)
  }

  function toggleTag(tagId: string) {
    if (selectedTagIds.includes(tagId)) {
      onChange(selectedTagIds.filter(id => id !== tagId))
    } else {
      onChange([...selectedTagIds, tagId])
    }
  }

  const selectedTags = tags.filter(t => selectedTagIds.includes(t.id))

  return (
    <div className="relative" ref={ref}>
      <label className="block text-sm font-medium text-neutral-800 mb-1">Tags</label>

      {/* Selected tags display + trigger */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full min-h-[42px] px-3 py-2 bg-white border border-neutral-200 rounded-xl text-sm text-left flex items-center gap-2 flex-wrap focus:outline-none focus:ring-2 focus:ring-primary-400/40 focus:border-primary-400"
      >
        {selectedTags.length === 0 ? (
          <span className="text-neutral-500">Select tags...</span>
        ) : (
          selectedTags.map(tag => (
            <span
              key={tag.id}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium text-white"
              style={{ backgroundColor: tag.color }}
            >
              {tag.name}
              <X
                size={12}
                className="cursor-pointer opacity-80 hover:opacity-100"
                onClick={(e) => { e.stopPropagation(); toggleTag(tag.id) }}
              />
            </span>
          ))
        )}
        <ChevronDown size={16} className="ml-auto text-neutral-400 shrink-0" />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-neutral-200 rounded-xl shadow-lg max-h-64 overflow-y-auto">
          {tags.length === 0 && !creating && (
            <div className="p-3 text-sm text-neutral-500 text-center">No tags yet</div>
          )}

          {tags.map(tag => (
            <button
              key={tag.id}
              type="button"
              onClick={() => toggleTag(tag.id)}
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-neutral-50 text-left transition-colors"
            >
              <span
                className="w-3 h-3 rounded-full shrink-0"
                style={{ backgroundColor: tag.color }}
              />
              <span className="text-sm text-neutral-900 flex-1">{tag.name}</span>
              {selectedTagIds.includes(tag.id) && (
                <Check size={14} className="text-primary-600" />
              )}
            </button>
          ))}

          {/* Create new tag inline */}
          {creating ? (
            <div className="border-t border-neutral-200 p-3 space-y-2">
              <input
                type="text"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="Tag name"
                autoFocus
                className="w-full px-2.5 py-1.5 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-400/40"
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleCreate() } }}
              />
              <div className="flex gap-1 flex-wrap">
                {TAG_COLORS.map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setNewColor(c)}
                    className={`w-5 h-5 rounded-full border-2 transition-all ${newColor === c ? 'border-neutral-900 scale-110' : 'border-transparent'}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { setCreating(false); setNewName('') }}
                  className="px-3 py-1.5 text-xs text-neutral-600 hover:bg-neutral-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={!newName.trim() || saving}
                  className="px-3 py-1.5 text-xs bg-primary-500 text-white rounded-lg disabled:opacity-50 hover:bg-primary-600"
                >
                  {saving ? 'Creating...' : 'Create'}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="w-full flex items-center gap-2 px-3 py-2 border-t border-neutral-200 hover:bg-neutral-50 text-left transition-colors"
            >
              <Plus size={14} className="text-primary-600" />
              <span className="text-sm text-primary-600 font-medium">Create new tag</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
