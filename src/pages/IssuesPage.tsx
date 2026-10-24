import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useFacility } from '../context/FacilityContext'
import type { Issue } from '../types'

export default function IssuesPage() {
  const navigate = useNavigate()
  const { currentFacility } = useFacility()
  const [issues, setIssues] = useState<Issue[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [priorityFilter, setPriorityFilter] = useState('')

  useEffect(() => {
    fetchIssues()
  }, [currentFacility, statusFilter, priorityFilter])

  async function fetchIssues() {
    if (!currentFacility) return

    let query = supabase
      .from('issues')
      .select('*, profiles!issues_created_by_fkey(name), assets!inner(equipment_name, asset_tag, facility_id)')
      .eq('assets.facility_id', currentFacility.id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })

    if (statusFilter) query = query.eq('status', statusFilter)
    if (priorityFilter) query = query.eq('priority', priorityFilter)

    const { data } = await query
    setIssues(data || [])
    setLoading(false)
  }

  return (
    <div className="p-4 lg:p-8 max-w-5xl mx-auto">
      <div className="mb-4">
        <h1 className="text-xl font-bold text-neutral-900">Cases</h1>
        <p className="text-sm text-neutral-500">{issues.length} total</p>
      </div>

      <div className="flex gap-2 mb-4 overflow-x-auto">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border border-neutral-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-400/40 focus:border-primary-400"
        >
          <option value="">All Status</option>
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="resolved">Resolved</option>
          <option value="verified">Verified</option>
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
      ) : issues.length === 0 ? (
        <div className="bg-white rounded-2xl border border-neutral-200 p-8 text-center shadow-sm">
          <p className="text-neutral-500">No cases found.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {issues.map(issue => (
            <button
              key={issue.id}
              onClick={() => navigate(`/cases/${issue.id}`)}
              className="w-full text-left bg-white rounded-xl border border-neutral-200 p-4 hover:border-primary-300 hover:shadow-sm transition-all duration-200"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-neutral-800 line-clamp-2">{issue.description}</p>
                  <p className="text-xs text-neutral-500 mt-1">
                    {(issue as any).assets?.equipment_name || (issue as any).assets?.asset_tag} &middot; {(issue as any).profiles?.name} &middot; {new Date(issue.created_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${getPriorityColor(issue.priority)}`}>
                    {issue.priority}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${getIssueStatusColor(issue.status)}`}>
                    {issue.status}
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

function getIssueStatusColor(status: string): string {
  const colors: Record<string, string> = {
    open: 'bg-error-50 text-error-600',
    in_progress: 'bg-primary-50 text-primary-600',
    resolved: 'bg-success-50 text-success-600',
    verified: 'bg-success-50 text-success-700',
    closed: 'bg-neutral-100 text-neutral-600',
  }
  return colors[status] || 'bg-neutral-100 text-neutral-600'
}
