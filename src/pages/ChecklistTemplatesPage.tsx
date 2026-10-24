import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, Pencil, ArrowUp, ArrowDown, X, Check, Archive, Loader2, ListChecks } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useFacility } from '../context/FacilityContext'
import { useAuth } from '../context/AuthContext'
import type { ChecklistTemplate, ChecklistTemplateItem, ChecklistFocusType } from '../types'

export default function ChecklistTemplatesPage() {
  const { currentOrganization } = useFacility()
  const { profile } = useAuth()
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([])
  const [selectedTemplate, setSelectedTemplate] = useState<ChecklistTemplate | null>(null)
  const [items, setItems] = useState<ChecklistTemplateItem[]>([])
  const [loading, setLoading] = useState(true)
  const [userRole, setUserRole] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [newFocus, setNewFocus] = useState<ChecklistFocusType>('general')
  const [newDesc, setNewDesc] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [newItemLabel, setNewItemLabel] = useState('')
  const [newItemRequired, setNewItemRequired] = useState(false)
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const [editLabel, setEditLabel] = useState('')
  const [editRequired, setEditRequired] = useState(false)

  useEffect(() => {
    if (currentOrganization) fetchTemplates()
  }, [currentOrganization])

  useEffect(() => {
    if (!profile || !currentOrganization) return
    supabase.from('organization_members').select('role').eq('organization_id', currentOrganization.id).eq('user_id', profile.id).maybeSingle()
      .then(({ data }) => setUserRole(data?.role || null))
  }, [profile, currentOrganization])

  const canEdit = userRole === 'admin' || userRole === 'manager'

  async function fetchTemplates() {
    if (!currentOrganization) return
    setLoading(true)
    const { data } = await supabase.from('checklist_templates').select('*').eq('organization_id', currentOrganization.id).order('name')
    setTemplates(data || [])
    setLoading(false)
  }

  async function fetchItems(templateId: string) {
    const { data } = await supabase.from('checklist_template_items').select('*').eq('template_id', templateId).order('sort_order')
    setItems(data || [])
  }

  const selectTemplate = useCallback((t: ChecklistTemplate) => {
    setSelectedTemplate(t)
    setEditingItemId(null)
    fetchItems(t.id)
  }, [])

  async function handleCreate() {
    if (!newName.trim() || !currentOrganization) { setError('Name is required'); return }
    setCreating(true)
    setError('')
    const { data, error: err } = await supabase.from('checklist_templates')
      .insert({ organization_id: currentOrganization.id, name: newName.trim(), focus: newFocus, description: newDesc.trim() || null })
      .select().maybeSingle()
    if (err) { setError(err.message); setCreating(false); return }
    setShowCreate(false)
    setNewName('')
    setNewDesc('')
    setCreating(false)
    await fetchTemplates()
    if (data) selectTemplate(data)
  }

  async function handleArchive(template: ChecklistTemplate) {
    await supabase.from('checklist_templates').update({ is_active: !template.is_active }).eq('id', template.id)
    await fetchTemplates()
  }

  async function addItem() {
    if (!newItemLabel.trim() || !selectedTemplate) return
    const nextSort = items.length > 0 ? Math.max(...items.map(i => i.sort_order)) + 1 : 0
    const { data } = await supabase.from('checklist_template_items')
      .insert({ template_id: selectedTemplate.id, label: newItemLabel.trim(), sort_order: nextSort, is_required: newItemRequired })
      .select().maybeSingle()
    if (data) setItems(prev => [...prev, data])
    setNewItemLabel('')
    setNewItemRequired(false)
  }

  async function deleteItem(item: ChecklistTemplateItem) {
    await supabase.from('checklist_template_items').delete().eq('id', item.id)
    setItems(prev => prev.filter(i => i.id !== item.id))
  }

  async function moveItem(item: ChecklistTemplateItem, dir: 'up' | 'down') {
    const sorted = [...items].sort((a, b) => a.sort_order - b.sort_order)
    const idx = sorted.findIndex(i => i.id === item.id)
    const swapIdx = dir === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= sorted.length) return
    const swapItem = sorted[swapIdx]
    await Promise.all([
      supabase.from('checklist_template_items').update({ sort_order: swapItem.sort_order }).eq('id', item.id),
      supabase.from('checklist_template_items').update({ sort_order: item.sort_order }).eq('id', swapItem.id),
    ])
    await fetchItems(selectedTemplate!.id)
  }

  async function saveEditItem(item: ChecklistTemplateItem) {
    await supabase.from('checklist_template_items').update({ label: editLabel.trim(), is_required: editRequired }).eq('id', item.id)
    setEditingItemId(null)
    await fetchItems(selectedTemplate!.id)
  }

  if (loading) return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="w-8 h-8 border-2 border-primary-200 border-t-primary-500 rounded-full animate-spin" />
    </div>
  )

  const inputCls = 'w-full px-3 py-2.5 bg-white border border-neutral-200 rounded-xl text-sm text-neutral-900 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-primary-400/40 focus:border-primary-400'

  return (
    <div className="p-4 lg:p-8 max-w-5xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-neutral-900 flex items-center gap-2"><ListChecks size={24} /> Checklist Templates</h1>
          <p className="text-sm text-neutral-500 mt-1">Create and manage reusable checklist templates for your organization</p>
        </div>
        {canEdit && !showCreate && (
          <button onClick={() => setShowCreate(true)} className="bg-gradient-to-r from-primary-500 to-primary-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:from-primary-600 hover:to-primary-700 flex items-center gap-2 shadow-md shadow-primary-200">
            <Plus size={16} /> New Template
          </button>
        )}
      </div>

      {showCreate && (
        <div className="bg-white rounded-2xl border border-neutral-200 p-5 shadow-sm mb-6 space-y-3">
          <h3 className="text-sm font-semibold text-neutral-900">Create New Template</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-neutral-600 mb-1">Name</label>
              <input type="text" value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. AHU Startup Checklist" className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-600 mb-1">Focus</label>
              <select value={newFocus} onChange={e => setNewFocus(e.target.value as ChecklistFocusType)} className={inputCls}>
                <option value="rough_in">Rough In</option>
                <option value="startup">Startup</option>
                <option value="commissioning">Commissioning</option>
                <option value="general">General</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-600 mb-1">Description (optional)</label>
            <input type="text" value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="Brief description" className={inputCls} />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button onClick={handleCreate} disabled={creating} className="bg-primary-500 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-primary-600 disabled:opacity-50 flex items-center gap-2">
              {creating ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Create
            </button>
            <button onClick={() => { setShowCreate(false); setError('') }} className="border border-neutral-200 text-neutral-700 px-4 py-2 rounded-xl text-sm font-medium hover:bg-neutral-50">Cancel</button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="space-y-2">
          {templates.length === 0 && <p className="text-sm text-neutral-400 text-center py-8">No templates yet</p>}
          {templates.map(t => (
            <button key={t.id} onClick={() => selectTemplate(t)}
              className={`w-full text-left p-4 rounded-xl border transition-colors ${
                selectedTemplate?.id === t.id ? 'border-primary-300 bg-primary-50' : 'border-neutral-200 bg-white hover:bg-neutral-50'}`}>
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-neutral-900">{t.name}</p>
                {t.is_active ? <span className="text-xs bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full">Active</span> : <span className="text-xs bg-neutral-100 text-neutral-500 px-2 py-0.5 rounded-full">Archived</span>}
              </div>
              <p className="text-xs text-neutral-500 mt-1">{t.focus.replace('_', ' ')}{t.description ? ` — ${t.description}` : ''}</p>
            </button>
          ))}
        </div>

        <div className="lg:col-span-2">
          {selectedTemplate ? (
            <div className="bg-white rounded-2xl border border-neutral-200 p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-semibold text-neutral-900">{selectedTemplate.name}</h3>
                  <p className="text-xs text-neutral-500">{selectedTemplate.focus.replace('_', ' ')}{selectedTemplate.description ? ` — ${selectedTemplate.description}` : ''}</p>
                </div>
                {canEdit && (
                  <div className="flex gap-2">
                    <button onClick={() => handleArchive(selectedTemplate)} className="p-2 text-neutral-500 hover:bg-neutral-100 rounded-lg" title={selectedTemplate.is_active ? 'Archive' : 'Reactivate'}>
                      <Archive size={16} />
                    </button>
                  </div>
                )}
              </div>

              <div className="space-y-2 mb-4">
                {items.length === 0 && <p className="text-sm text-neutral-400 text-center py-4">No items yet — add one below</p>}
                {[...items].sort((a, b) => a.sort_order - b.sort_order).map((item, idx) => (
                  <div key={item.id} className="flex items-center gap-2 bg-neutral-50 rounded-xl p-3">
                    {canEdit && (
                      <div className="flex flex-col">
                        <button onClick={() => moveItem(item, 'up')} disabled={idx === 0} className="text-neutral-400 hover:text-neutral-700 disabled:opacity-30"><ArrowUp size={14} /></button>
                        <button onClick={() => moveItem(item, 'down')} disabled={idx === items.length - 1} className="text-neutral-400 hover:text-neutral-700 disabled:opacity-30"><ArrowDown size={14} /></button>
                      </div>
                    )}
                    <div className="flex-1">
                      {editingItemId === item.id ? (
                        <div className="flex items-center gap-2">
                          <input type="text" value={editLabel} onChange={e => setEditLabel(e.target.value)} className="flex-1 px-2 py-1 border border-neutral-200 rounded-lg text-sm" />
                          <label className="flex items-center gap-1 text-xs text-neutral-600">
                            <input type="checkbox" checked={editRequired} onChange={e => setEditRequired(e.target.checked)} className="rounded" /> Req
                          </label>
                          <button onClick={() => saveEditItem(item)} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"><Check size={16} /></button>
                          <button onClick={() => setEditingItemId(null)} className="p-1 text-neutral-400 hover:bg-neutral-100 rounded"><X size={16} /></button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-neutral-800">{item.label}</span>
                          {item.is_required && <span className="text-xs bg-red-50 text-red-600 px-1.5 py-0.5 rounded-full">Required</span>}
                        </div>
                      )}
                    </div>
                    {canEdit && editingItemId !== item.id && (
                      <div className="flex gap-1">
                        <button onClick={() => { setEditingItemId(item.id); setEditLabel(item.label); setEditRequired(item.is_required) }} className="p-1.5 text-neutral-400 hover:bg-neutral-200 rounded-lg"><Pencil size={14} /></button>
                        <button onClick={() => deleteItem(item)} className="p-1.5 text-neutral-400 hover:bg-red-50 hover:text-red-500 rounded-lg"><Trash2 size={14} /></button>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {canEdit && (
                <div className="border-t border-neutral-200 pt-3 flex items-center gap-2">
                  <input type="text" value={newItemLabel} onChange={e => setNewItemLabel(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addItem() } }}
                    placeholder="New checklist item label..." className={inputCls} />
                  <label className="flex items-center gap-1 text-xs text-neutral-600 whitespace-nowrap">
                    <input type="checkbox" checked={newItemRequired} onChange={e => setNewItemRequired(e.target.checked)} className="rounded" /> Required
                  </label>
                  <button onClick={addItem} disabled={!newItemLabel.trim()} className="bg-primary-500 text-white px-3 py-2 rounded-xl text-sm font-medium hover:bg-primary-600 disabled:opacity-50 flex items-center gap-1 shrink-0">
                    <Plus size={16} /> Add
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-neutral-200 p-8 shadow-sm text-center">
              <ListChecks size={40} className="mx-auto text-neutral-300 mb-3" />
              <p className="text-sm text-neutral-500">Select a template to view and edit its items</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
