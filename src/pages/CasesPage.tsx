import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useFacility } from '../context/FacilityContext'
import { AlertTriangle } from 'lucide-react'
import type { Case } from '../types'

export default function CasesPage() {
  const navigate = useNavigate()
  const { currentFacility } = useFacility()
  const [cases, setCases] = useState<Case[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [priorityFilter, setPriorityFilter] = useState('')

  useEffect(() => {
    fetchCases()
  }, [currentFacility, statusFilter, typeFilter, priorityFilter])

  async function fetchCases() {
    if (!currentFacility) { setLoading(false); return }

    let query = supabase
      .from('cases')
      .select('*, profiles!cases_created_by_fkey(name), assets!inner(equipment_name, asset_tag, facility_id)')
      .eq('assets.facility_id', currentFacility.id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })

    if (statusFilter) query = query.eq('status', statusFilter)
    if (typeFilter) query = query.eq('case_type', typeFilter)
    if (priorityFilter) query = query.eq('priority', priorityFilter)

    const { data } = await query
    setCases(data || [])
    setLoading(false)
  }

  return (
    <div className="p-4 lg:p-8 max-w-5xl mx-auto">
      <div className="mb-4">
        <h1 className="text-xl font-bold text-neutral-900">Cases</h1>
        <p className="text-sm text-neutral-500">{cases.length} total</p>
      </div>

      <div className="flex gap-2 mb-4 overflow-x-auto">
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="px-3 py-2 border border-neutral-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-400/40 focus:border-primary-400"
        >
          <option value="">All Types</option>
          <option value="observation">Observation</option>
          <option value="deficiency">Deficiency</option>
          <option value="work_order">Work Order</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border border-neutral-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-400/40 focus:border-primary-400"
        >
          <option value="">All Status</option>
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="resolved">Resolved</option>
          <option value="closed">Closed</option>
        </select>
        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
          className="px-3 py-2 border border-neutral-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-400/40 focus:border-primary-400"
        >
          <option value="">All Priority</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="w-8 h-8 border-2 border-primary-200 border-t-primary-500 rounded-full animate-spin" />
        </div>
      ) : cases.length === 0 ? (
        <div className="bg-white rounded-2xl border border-neutral-200 p-8 text-center shadow-sm">
          <AlertTriangle size={32} className="mx-auto mb-3 text-neutral-300" />
          <p className="text-neutral-500 text-sm">No cases found.</p>
          <p className="text-neutral-400 text-xs mt-1">Cases can be created from an asset's Chat or Case button.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {cases.map(c => (
            <button
              key={c.id}
              onClick={() => navigate(`/cases/${c.id}`)}
              className="w-full text-left bg-white rounded-xl border border-neutral-200 p-4 hover:border-primary-300 hover:shadow-sm transition-all duration-200"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-neutral-800 line-clamp-2">{c.title}</p>
                  <p className="text-xs text-neutral-500 mt-1">
                    {(c as any).assets?.equipment_name || (c as any).assets?.asset_tag} &middot; {(c as any).profiles?.name} &middot; {new Date(c.created_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-primary-50 text-primary-700">
                    {c.case_type === 'work_order' ? 'Work Order' : c.case_type.charAt(0).toUpperCase() + c.case_type.slice(1)}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${getPriorityColor(c.priority)}`}>
                    {c.priority}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${getCaseStatusColor(c.status)}`}>
                    {c.status.replace(/_/g, ' ')}
                  </span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function getPriorityColor(priority: string): string {
  const colors: Record<string, string> = {
    low: 'bg-neutral-100 text-neutral-600',
    medium: 'bg-warning-50 text-warning-600',
    high: 'bg-error-50 text-error-600',
    critical: 'bg-error-100 text-error-700',
  }
  return colors[priority] || 'bg-neutral-100 text-neutral-600'
}

function getCaseStatusColor(status: string): string {
  const colors: Record<string, string> = {
    open: 'bg-error-50 text-error-600',
    in_progress: 'bg-primary-50 text-primary-600',
    resolved: 'bg-success-50 text-success-600',
    closed: 'bg-neutral-100 text-neutral-600',
  }
  return colors[status] || 'bg-neutral-100 text-neutral-600'
}
