import { useEffect, useState } from 'react'
import { CheckCircle, XCircle, Ban, Circle, Plus, X, ListChecks } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import type { ChecklistRun, ChecklistItem, ChecklistTemplate, ChecklistRunSummary } from '../../types'

export default function ChecklistSection({ assetId, facilityId, canEdit }: { assetId: string; facilityId: string; canEdit: boolean }) {
  const [runs, setRuns] = useState<ChecklistRun[]>([])
  const [summaries, setSummaries] = useState<Record<string, ChecklistRunSummary>>({})
  const [itemsByRun, setItemsByRun] = useState<Record<string, ChecklistItem[]>>({})
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedRun, setExpandedRun] = useState<string | null>(null)
  const [showNewRun, setShowNewRun] = useState(false)
  const [newRunName, setNewRunName] = useState('')
  const [newRunFocus, setNewRunFocus] = useState<'rough_in' | 'startup' | 'commissioning' | 'general'>('rough_in')
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function fetchRuns() {
    const { data } = await supabase
      .from('checklist_runs')
      .select('*')
      .eq('asset_id', assetId)
      .order('created_at', { ascending: false })
    setRuns((data as ChecklistRun[]) || [])
    setLoading(false)
    if (data && data.length > 0) {
      const summariesRes = await supabase
        .from('checklist_run_summary')
        .select('*')
        .in('run_id', data.map(r => r.id))
      const summaryMap: Record<string, ChecklistRunSummary> = {}
      for (const s of (summariesRes.data as ChecklistRunSummary[]) || []) {
        summaryMap[s.run_id] = s
      }
      setSummaries(summaryMap)
    }
  }

  async function fetchTemplates(orgId: string) {
    const { data } = await supabase
      .from('checklist_templates')
      .select('*')
      .eq('organization_id', orgId)
      .eq('is_active', true)
      .order('name')
    setTemplates((data as ChecklistTemplate[]) || [])
  }

  async function fetchItems(runId: string) {
    const { data } = await supabase
      .from('checklist_items')
      .select('*')
      .eq('run_id', runId)
      .order('sort_order', { ascending: true })
    setItemsByRun(prev => ({ ...prev, [runId]: (data as ChecklistItem[]) || [] }))
  }

  useEffect(() => {
    fetchRuns()
    // Get org ID from facility
    ;(async () => {
      const { data: fac } = await supabase.from('facilities').select('organization_id').eq('id', facilityId).maybeSingle()
      if (fac?.organization_id) fetchTemplates(fac.organization_id)
    })()
  }, [assetId, facilityId])

  async function handleCreateRun() {
    if (!newRunName.trim()) return
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    const insertData: Record<string, unknown> = {
      asset_id: assetId, facility_id: facilityId,
      focus: newRunFocus, name: newRunName.trim(),
      created_by: user?.id || null,
    }
    if (selectedTemplate) {
      insertData.template_id = selectedTemplate
    }
    const { data: run, error } = await supabase.from('checklist_runs').insert(insertData).select('*').single()
    setSaving(false)
    if (error) { alert(error.message); return }
    // If template selected, copy template items
    if (selectedTemplate) {
      const { data: tmplItems } = await supabase
        .from('checklist_template_items')
        .select('*')
        .eq('template_id', selectedTemplate)
        .order('sort_order', { ascending: true })
      if (tmplItems && tmplItems.length > 0) {
        await supabase.from('checklist_items').insert(
          tmplItems.map((item, idx) => ({
            run_id: run.id, label: item.label, sort_order: item.sort_order || idx,
            is_required: item.is_required, state: 'pending',
          }))
        )
      }
    } else {
      // Create a single default item
      await supabase.from('checklist_items').insert({
        run_id: run.id, label: 'New checklist item', sort_order: 0, is_required: false, state: 'pending',
      })
    }
    setNewRunName(''); setShowNewRun(false); setSelectedTemplate(null)
    fetchRuns()
  }

  async function handleToggleItem(runId: string, item: ChecklistItem, newState: ChecklistItem['state']) {
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('checklist_items').update({
      state: newState,
      completed_by: newState !== 'pending' ? user?.id || null : null,
      completed_at: newState !== 'pending' ? new Date().toISOString() : null,
    }).eq('id', item.id)
    fetchItems(runId)
    fetchRuns()
  }

  async function handleAddItem(runId: string) {
    await supabase.from('checklist_items').insert({
      run_id: runId, label: 'New item', sort_order: 99, is_required: false, state: 'pending',
    })
    fetchItems(runId)
  }

  async function handleUpdateItemLabel(runId: string, itemId: string, label: string) {
    await supabase.from('checklist_items').update({ label }).eq('id', itemId)
    fetchItems(runId)
  }

  async function handleDeleteItem(runId: string, itemId: string) {
    await supabase.from('checklist_items').delete().eq('id', itemId)
    fetchItems(runId)
    fetchRuns()
  }

  if (loading) return <div className="text-center py-8"><div className="w-6 h-6 border-2 border-primary-200 border-t-primary-500 rounded-full animate-spin mx-auto" /></div>

  return (
    <div className="space-y-4">
      {canEdit && !showNewRun && (
        <button onClick={() => setShowNewRun(true)}
          className="w-full flex items-center justify-center gap-2 bg-white border-2 border-dashed border-neutral-200 hover:border-primary-300 hover:bg-primary-50/50 text-neutral-700 py-3 rounded-xl text-sm font-medium transition-all">
          <Plus size={16} /> Start New Checklist Run
        </button>
      )}

      {showNewRun && (
        <div className="bg-white rounded-2xl border border-neutral-200 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-neutral-800">New Checklist Run</h3>
            <button onClick={() => setShowNewRun(false)} className="p-1 hover:bg-neutral-100 rounded-lg"><X size={18} /></button>
          </div>
          <div>
            <label className="text-xs font-medium text-neutral-600">Name</label>
            <input value={newRunName} onChange={(e) => setNewRunName(e.target.value)}
              className="w-full mt-1 px-3 py-2 border border-neutral-200 rounded-xl text-sm" placeholder="e.g. AHU-1 Rough-In" />
          </div>
          <div>
            <label className="text-xs font-medium text-neutral-600">Focus</label>
            <select value={newRunFocus} onChange={(e) => setNewRunFocus(e.target.value as 'rough_in' | 'startup' | 'commissioning' | 'general')}
              className="w-full mt-1 px-3 py-2 border border-neutral-200 rounded-xl text-sm">
              <option value="rough_in">Rough-In</option>
              <option value="startup">Startup</option>
              <option value="commissioning">Commissioning</option>
              <option value="general">General</option>
            </select>
          </div>
          {templates.length > 0 && (
            <div>
              <label className="text-xs font-medium text-neutral-600">Template (optional)</label>
              <select value={selectedTemplate || ''} onChange={(e) => setSelectedTemplate(e.target.value || null)}
                className="w-full mt-1 px-3 py-2 border border-neutral-200 rounded-xl text-sm">
                <option value="">No template</option>
                {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          )}
          <button onClick={handleCreateRun} disabled={saving || !newRunName.trim()}
            className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-primary-500 to-primary-600 text-white py-2.5 rounded-xl text-sm font-medium disabled:opacity-50 shadow-md shadow-primary-200">
            {saving ? 'Creating...' : 'Create Run'}
          </button>
        </div>
      )}

      {runs.length === 0 && !showNewRun && (
        <div className="text-center py-8 text-neutral-400">
          <ListChecks size={32} className="mx-auto mb-2" />
          <p className="text-sm">No checklist runs yet</p>
        </div>
      )}

      {runs.map((run) => {
        const summary = summaries[run.id]
        const items = itemsByRun[run.id]
        const isExpanded = expandedRun === run.id
        return (
          <div key={run.id} className="bg-white rounded-2xl border border-neutral-200 p-4">
            <button onClick={() => { setExpandedRun(isExpanded ? null : run.id); if (!isExpanded) fetchItems(run.id) }}
              className="w-full text-left">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-neutral-800">{run.name}</p>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    {run.focus.replace(/_/g, ' ')} &middot; {run.status.replace(/_/g, ' ')}
                  </p>
                </div>
                {summary && (
                  <div className="text-right">
                    <p className="text-lg font-bold text-primary-600">{summary.completion_pct}%</p>
                    <p className="text-xs text-neutral-500">{summary.passed_items}/{summary.total_items} passed</p>
                  </div>
                )}
              </div>
              {summary && summary.blocked_items > 0 && (
                <p className="text-xs text-error-600 mt-1">{summary.blocked_items} blocked</p>
              )}
              {summary && summary.failed_items > 0 && (
                <p className="text-xs text-error-600 mt-0.5">{summary.failed_items} deficient</p>
              )}
            </button>
            {isExpanded && items && (
              <div className="mt-3 pt-3 border-t border-neutral-100 space-y-2">
                {items.map((item) => (
                  <div key={item.id} className="flex items-center gap-2 p-2 rounded-xl hover:bg-neutral-50">
                    <button onClick={() => {
                      const states: ChecklistItem['state'][] = ['pending', 'passed', 'failed', 'blocked']
                      const nextIdx = (states.indexOf(item.state) + 1) % states.length
                      handleToggleItem(run.id, item, states[nextIdx])
                    }} className="shrink-0">
                      {item.state === 'passed' && <CheckCircle size={20} className="text-success-500" />}
                      {item.state === 'failed' && <XCircle size={20} className="text-error-500" />}
                      {item.state === 'blocked' && <Ban size={20} className="text-error-500" />}
                      {item.state === 'pending' && <Circle size={20} className="text-neutral-300" />}
                      {item.state === 'skipped' && <Circle size={20} className="text-neutral-200" />}
                    </button>
                    <input value={item.label}
                      onChange={(e) => handleUpdateItemLabel(run.id, item.id, e.target.value)}
                      className={`flex-1 text-sm bg-transparent border-none outline-none ${item.state === 'passed' ? 'text-neutral-400 line-through' : 'text-neutral-800'}`}
                    />
                    {item.is_required && <span className="text-xs text-error-500">req</span>}
                    {canEdit && (
                      <button onClick={() => handleDeleteItem(run.id, item.id)} className="text-neutral-300 hover:text-error-500 p-1">
                        <X size={14} />
                      </button>
                    )}
                  </div>
                ))}
                {canEdit && (
                  <button onClick={() => handleAddItem(run.id)}
                    className="w-full flex items-center justify-center gap-1.5 text-xs text-neutral-500 hover:text-primary-600 py-2">
                    <Plus size={14} /> Add Item
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
