import { useEffect, useState, useRef } from 'react'
import { Plus, Upload, Pencil, Trash2, X, Check } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useFacility } from '../context/FacilityContext'
import type { Tag } from '../types'

const TAG_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#22c55e', '#14b8a6',
  '#3b82f6', '#6366f1', '#8b5cf6', '#ec4899', '#6b7280',
]

export default function TagsPage() {
  const { currentFacility } = useFacility()
  const [tags, setTags] = useState<Tag[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState('')
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(TAG_COLORS[0])
  const [saving, setSaving] = useState(false)
  const [showCsvModal, setShowCsvModal] = useState(false)
  const [csvError, setCsvError] = useState('')
  const [csvImporting, setCsvImporting] = useState(false)
  const [csvResults, setCsvResults] = useState<{ imported: number; skipped: number } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetchTags()
  }, [currentFacility])

  async function fetchTags() {
    if (!currentFacility) return
    const { data } = await supabase
      .from('tags')
      .select('*')
      .eq('facility_id', currentFacility.id)
      .order('name')
    setTags(data || [])
    setLoading(false)
  }

  async function handleCreate() {
    if (!newName.trim() || !currentFacility) return
    setSaving(true)
    const { error } = await supabase
      .from('tags')
      .insert({ facility_id: currentFacility.id, name: newName.trim(), color: newColor })
    if (!error) {
      setNewName('')
      setNewColor(TAG_COLORS[0])
      setShowCreate(false)
      fetchTags()
    }
    setSaving(false)
  }

  async function handleUpdate(tagId: string) {
    if (!editName.trim()) return
    setSaving(true)
    const { error } = await supabase
      .from('tags')
      .update({ name: editName.trim(), color: editColor })
      .eq('id', tagId)
    if (!error) {
      setEditingId(null)
      fetchTags()
    }
    setSaving(false)
  }

  async function handleDelete(tagId: string) {
    const { error } = await supabase.from('tags').delete().eq('id', tagId)
    if (!error) fetchTags()
  }

  async function handleCsvUpload(file: File) {
    if (!currentFacility) return
    setCsvError('')
    setCsvResults(null)
    setCsvImporting(true)

    try {
      const text = await file.text()
      const lines = text.split(/\r?\n/).filter(l => l.trim())
      if (lines.length === 0) {
        setCsvError('File is empty.')
        setCsvImporting(false)
        return
      }

      const header = lines[0].toLowerCase()
      const hasHeader = header.includes('name') || header.includes('tag')
      const dataLines = hasHeader ? lines.slice(1) : lines

      let imported = 0
      let skipped = 0

      for (const line of dataLines) {
        const parts = line.split(',').map(s => s.trim().replace(/^["']|["']$/g, ''))
        const name = parts[0]
        const color = parts[1] && /^#[0-9a-fA-F]{6}$/.test(parts[1]) ? parts[1] : TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)]

        if (!name) {
          skipped++
          continue
        }

        const { error } = await supabase
          .from('tags')
          .insert({ facility_id: currentFacility.id, name, color })
        if (error) {
          skipped++
        } else {
          imported++
        }
      }

      setCsvResults({ imported, skipped })
      fetchTags()
    } catch {
      setCsvError('Failed to parse CSV file.')
    }
    setCsvImporting(false)
  }

  function startEdit(tag: Tag) {
    setEditingId(tag.id)
    setEditName(tag.name)
    setEditColor(tag.color)
  }

  async function getTagUsageCount(tagId: string): Promise<number> {
    const { count } = await supabase
      .from('asset_tags')
      .select('*', { count: 'exact', head: true })
      .eq('tag_id', tagId)
    return count || 0
  }

  const [usageCounts, setUsageCounts] = useState<Record<string, number>>({})

  useEffect(() => {
    async function loadCounts() {
      if (tags.length === 0) return
      const counts: Record<string, number> = {}
      for (const tag of tags) {
        counts[tag.id] = await getTagUsageCount(tag.id)
      }
      setUsageCounts(counts)
    }
    loadCounts()
  }, [tags])

  return (
    <div className="p-4 lg:p-8 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">Tags</h1>
          <p className="text-sm text-neutral-500">{tags.length} tag{tags.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCsvModal(true)}
            className="flex items-center gap-1.5 border border-neutral-200 text-neutral-700 px-3 py-2 rounded-xl text-sm font-medium hover:bg-neutral-50 transition-colors"
          >
            <Upload size={16} />
            <span className="hidden sm:inline">CSV Import</span>
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 bg-gradient-to-r from-primary-500 to-primary-600 text-white px-3 py-2 rounded-xl text-sm font-medium hover:from-primary-600 hover:to-primary-700 transition-all shadow-md shadow-primary-200"
          >
            <Plus size={16} />
            <span className="hidden sm:inline">New Tag</span>
          </button>
        </div>
      </div>

      {/* Create tag inline */}
      {showCreate && (
        <div className="bg-white border border-neutral-200 rounded-xl p-4 mb-4 shadow-sm">
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Tag name"
              autoFocus
              className="flex-1 px-3 py-2 border border-neutral-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-400/40 focus:border-primary-400"
              onKeyDown={e => { if (e.key === 'Enter') handleCreate() }}
            />
            <button
              onClick={handleCreate}
              disabled={!newName.trim() || saving}
              className="px-4 py-2 bg-primary-500 text-white text-sm rounded-xl font-medium disabled:opacity-50 hover:bg-primary-600 transition-colors"
            >
              Create
            </button>
            <button
              onClick={() => { setShowCreate(false); setNewName('') }}
              className="p-2 text-neutral-500 hover:bg-neutral-100 rounded-lg"
            >
              <X size={16} />
            </button>
          </div>
          <div className="flex gap-1.5 mt-3">
            {TAG_COLORS.map(c => (
              <button
                key={c}
                type="button"
                onClick={() => setNewColor(c)}
                className={`w-6 h-6 rounded-full border-2 transition-all ${newColor === c ? 'border-neutral-900 scale-110' : 'border-transparent'}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Tags List */}
      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="w-8 h-8 border-2 border-primary-200 border-t-primary-500 rounded-full animate-spin" />
        </div>
      ) : tags.length === 0 ? (
        <div className="bg-white rounded-2xl border border-neutral-200 p-8 text-center shadow-sm">
          <p className="text-neutral-500">No tags created yet.</p>
          <button
            onClick={() => setShowCreate(true)}
            className="text-primary-600 text-sm font-medium mt-2"
          >
            Create your first tag
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {tags.map(tag => (
            <div
              key={tag.id}
              className="bg-white border border-neutral-200 rounded-xl p-4 flex items-center gap-3 hover:border-neutral-300 transition-colors"
            >
              {editingId === tag.id ? (
                <>
                  <div className="flex-1 space-y-2">
                    <input
                      type="text"
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      autoFocus
                      className="w-full px-3 py-2 border border-neutral-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-400/40 focus:border-primary-400"
                      onKeyDown={e => { if (e.key === 'Enter') handleUpdate(tag.id) }}
                    />
                    <div className="flex gap-1.5">
                      {TAG_COLORS.map(c => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setEditColor(c)}
                          className={`w-5 h-5 rounded-full border-2 transition-all ${editColor === c ? 'border-neutral-900 scale-110' : 'border-transparent'}`}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={() => handleUpdate(tag.id)}
                    disabled={saving}
                    className="p-2 text-success-600 hover:bg-success-50 rounded-lg"
                  >
                    <Check size={16} />
                  </button>
                  <button
                    onClick={() => setEditingId(null)}
                    className="p-2 text-neutral-500 hover:bg-neutral-100 rounded-lg"
                  >
                    <X size={16} />
                  </button>
                </>
              ) : (
                <>
                  <span
                    className="w-4 h-4 rounded-full shrink-0"
                    style={{ backgroundColor: tag.color }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-neutral-900">{tag.name}</p>
                    <p className="text-xs text-neutral-500">
                      {usageCounts[tag.id] ?? 0} asset{(usageCounts[tag.id] ?? 0) !== 1 ? 's' : ''}
                    </p>
                  </div>
                  <button
                    onClick={() => startEdit(tag)}
                    className="p-2 text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 rounded-lg transition-colors"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => handleDelete(tag.id)}
                    className="p-2 text-neutral-400 hover:text-error-600 hover:bg-error-50 rounded-lg transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {/* CSV Upload Modal */}
      {showCsvModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => { setShowCsvModal(false); setCsvError(''); setCsvResults(null) }} />
          <div className="relative bg-white border border-neutral-200 w-full max-w-md rounded-2xl shadow-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-neutral-900">Import Tags from CSV</h2>
              <button
                onClick={() => { setShowCsvModal(false); setCsvError(''); setCsvResults(null) }}
                className="p-1 hover:bg-neutral-100 rounded-lg"
              >
                <X size={20} />
              </button>
            </div>

            <div className="mb-4">
              <p className="text-sm text-neutral-600 mb-2">
                Upload a CSV file with tag names. Expected format:
              </p>
              <div className="bg-neutral-50 rounded-lg p-3 text-xs font-mono text-neutral-700">
                name,color<br />
                HVAC,#3b82f6<br />
                Electrical,#f59e0b<br />
                Plumbing,#22c55e
              </div>
              <p className="text-xs text-neutral-500 mt-2">
                Color column is optional. If omitted, a random color will be assigned.
                Duplicate tag names will be skipped.
              </p>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={e => {
                const file = e.target.files?.[0]
                if (file) handleCsvUpload(file)
                e.target.value = ''
              }}
            />

            {csvResults && (
              <div className="bg-success-50 border border-success-200 text-success-700 text-sm px-3 py-2 rounded-xl mb-4">
                Imported {csvResults.imported} tag{csvResults.imported !== 1 ? 's' : ''}.
                {csvResults.skipped > 0 && ` Skipped ${csvResults.skipped} (duplicates or invalid).`}
              </div>
            )}

            {csvError && (
              <div className="bg-error-50 border border-error-200 text-error-700 text-sm px-3 py-2 rounded-xl mb-4">
                {csvError}
              </div>
            )}

            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={csvImporting}
              className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-600 hover:to-primary-700 text-white py-3 rounded-xl text-sm font-medium disabled:opacity-50 shadow-md shadow-primary-200"
            >
              {csvImporting ? (
                <div className="w-5 h-5 border-2 border-primary-200 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <Upload size={18} />
                  Select CSV File
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
