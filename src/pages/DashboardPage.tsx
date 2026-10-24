import { useEffect, useState } from 'react'
import { useFacility } from '../context/FacilityContext'
import { supabase } from '../lib/supabase'
import { Package, AlertTriangle, CheckCircle, Ban } from 'lucide-react'

interface DashboardStats {
  total: number
  not_started: number
  in_progress: number
  complete: number
  complete_pending: number
  blocked: number
  deficient: number
  ready_next_trade: number
  open_cases: number
}

interface ChecklistStats {
  total_runs: number
  completion_pct: number
  blocked_runs: number
  deficient_runs: number
  focus: string | null
}

export default function DashboardPage() {
  const { currentFacility } = useFacility()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [checklistStats, setChecklistStats] = useState<ChecklistStats | null>(null)
  const [recentEvents, setRecentEvents] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [eventsError, setEventsError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const facilityId = currentFacility?.id

  useEffect(() => {
    if (!facilityId) return
    let stale = false
    setLoading(true)
    setError(null)
    setEventsError(null)
    setStats(null)
    setRecentEvents([])

    fetchStats(facilityId).then(
      result => { if (!stale) { setStats(result); setLoading(false) } },
      (err: unknown) => { if (!stale) { setError(errorMessage(err)); setLoading(false) } },
    )
    fetchChecklistStats(facilityId).then(
      result => { if (!stale) setChecklistStats(result) },
      () => { if (!stale) setChecklistStats(null) },
    )
    fetchRecentEvents(facilityId).then(
      events => { if (!stale) setRecentEvents(events) },
      (err: unknown) => { if (!stale) setEventsError(errorMessage(err)) },
    )

    return () => { stale = true }
  }, [facilityId, reloadKey])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary-200 border-t-primary-500 rounded-full animate-spin" />
      </div>
    )
  }

  // Use checklist-driven completion when available, fall back to status-based
  const completionPct = checklistStats && checklistStats.total_runs > 0
    ? checklistStats.completion_pct
    : stats && stats.total > 0
      ? Math.round(((stats.complete + stats.complete_pending) / stats.total) * 100)
      : 0

  const completionLabel = checklistStats && checklistStats.total_runs > 0
    ? `${checklistStats.focus ? checklistStats.focus.replace(/_/g, ' ') : 'Checklist'} completion`
    : 'Complete or pending verification'

  const addressParts = [
    currentFacility?.address_line_1,
    currentFacility?.city,
    currentFacility?.province_state,
  ].filter(Boolean)

  return (
    <div className="p-4 lg:p-8 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-neutral-900">{currentFacility?.name}</h1>
        <p className="text-sm text-neutral-500 mt-1">{addressParts.join(', ')}</p>
      </div>

      {error ? (
        <div role="alert" className="bg-error-50 border border-error-200 rounded-2xl p-5 mb-6">
          <p className="text-sm font-semibold text-error-700">Could not load facility totals</p>
          <p className="text-sm text-error-600 mt-1">{error}</p>
          <button
            onClick={() => setReloadKey(k => k + 1)}
            className="mt-3 text-sm font-medium text-error-700 underline hover:text-error-800 transition-colors"
          >
            Try again
          </button>
        </div>
      ) : stats && stats.total > 0 ? (
        <>
          <div className="bg-white rounded-2xl border border-neutral-200 p-5 mb-6 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-neutral-800">Overall Progress</h2>
              <span className="text-2xl font-bold text-primary-600">{completionPct}%</span>
            </div>
            <div className="w-full h-3 bg-neutral-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-primary-400 to-primary-600 rounded-full transition-all duration-500"
                style={{ width: `${completionPct}%` }}
              />
            </div>
            <p className="text-xs text-neutral-500 mt-2">
              {checklistStats && checklistStats.total_runs > 0
                ? `${checklistStats.total_runs} checklist runs — ${completionLabel.toLowerCase()}`
                : `${stats.complete + stats.complete_pending} of ${stats.total} assets ${completionLabel.toLowerCase()}`}
            </p>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            <StatCard icon={Package} label="Total Assets" value={stats.total} color="text-primary-600" bgColor="bg-primary-50" />
            <StatCard icon={CheckCircle} label="Complete" value={stats.complete} color="text-success-600" bgColor="bg-success-50" />
            <StatCard icon={Ban} label="Blocked" value={stats.blocked} color="text-error-600" bgColor="bg-error-50" />
            <StatCard icon={AlertTriangle} label="Open Cases" value={stats.open_cases} color="text-warning-600" bgColor="bg-warning-50" />
          </div>

          <div className="bg-white rounded-2xl border border-neutral-200 p-5 mb-6 shadow-sm">
            <h2 className="text-sm font-semibold text-neutral-800 mb-4">Status Breakdown</h2>
            <div className="space-y-3">
              <StatusRow label="Not Started" count={stats.not_started} total={stats.total} color="bg-neutral-300" />
              <StatusRow label="In Progress" count={stats.in_progress} total={stats.total} color="bg-primary-400" />
              <StatusRow label="Complete" count={stats.complete} total={stats.total} color="bg-success-500" />
              <StatusRow label="Pending Verification" count={stats.complete_pending} total={stats.total} color="bg-warning-500" />
              <StatusRow label="Blocked" count={stats.blocked} total={stats.total} color="bg-error-500" />
              <StatusRow label="Deficient" count={stats.deficient} total={stats.total} color="bg-error-400" />
              <StatusRow label="Ready for Next Trade" count={stats.ready_next_trade} total={stats.total} color="bg-success-400" />
            </div>
          </div>
        </>
      ) : (
        <div className="bg-white rounded-2xl border border-neutral-200 p-8 text-center mb-6 shadow-sm">
          <Package size={40} className="mx-auto text-neutral-300 mb-3" />
          <p className="text-neutral-700 font-medium">No assets yet</p>
          <p className="text-sm text-neutral-500 mt-1">Create assets from the Assets tab to get started</p>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-neutral-200 p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-neutral-800 mb-3">Recent Activity</h2>
        {eventsError ? (
          <p role="alert" className="text-sm text-error-600 text-center py-4">Could not load recent activity: {eventsError}</p>
        ) : recentEvents.length === 0 ? (
          <p className="text-sm text-neutral-400 text-center py-4">No recent activity</p>
        ) : (
          <div className="space-y-3">
            {recentEvents.map(event => (
              <div key={event.id} className="flex items-start gap-3 pb-3 border-b border-neutral-100 last:border-0 last:pb-0">
                <div className="w-2 h-2 bg-primary-400 rounded-full mt-2 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-neutral-700 truncate">{event.raw_note}</p>
                  <p className="text-xs text-neutral-400 mt-0.5">
                    {event.profiles?.name} &middot; {event.assets?.equipment_name || event.assets?.asset_tag} &middot; {new Date(event.timestamp).toLocaleDateString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

const COMPLETE_STATUSES = ['complete', 'accepted']

function errorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err && typeof err.message === 'string') return err.message
  return 'Unknown error'
}

function toCount(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

async function fetchStats(facilityId: string): Promise<DashboardStats> {
  const { data, error } = await supabase.rpc('ai_facility_summary', { p_facility_id: facilityId })
  if (error) throw error
  if (!data || typeof data !== 'object' || !('total_assets' in data) || !('open_cases' in data)) {
    throw new Error('The facility summary returned an unexpected response')
  }
  const summary = data as { total_assets: unknown; open_cases: unknown; assets_by_status?: Record<string, unknown> }
  const byStatus = summary.assets_by_status ?? {}
  const count = (status: string) => toCount(byStatus[status])
  return {
    total: toCount(summary.total_assets),
    not_started: count('not_started'),
    in_progress: count('in_progress'),
    complete: COMPLETE_STATUSES.reduce((sum, s) => sum + count(s), 0),
    complete_pending: count('complete_pending_verification'),
    blocked: count('blocked'),
    deficient: count('deficient'),
    ready_next_trade: count('ready_for_next_trade'),
    open_cases: toCount(summary.open_cases),
  }
}

async function fetchChecklistStats(facilityId: string): Promise<ChecklistStats | null> {
  const { data, error } = await supabase
    .from('checklist_run_summary')
    .select('*')
    .eq('facility_id', facilityId)
  if (error || !data || data.length === 0) return null
  const summaries = data as Array<{ completion_pct: number; run_status: string; focus: string }>
  const totalRuns = summaries.length
  const avgCompletion = totalRuns > 0
    ? Math.round(summaries.reduce((sum, s) => sum + s.completion_pct, 0) / totalRuns)
    : 0
  const blocked = summaries.filter(s => s.run_status === 'blocked').length
  const deficient = summaries.filter(s => s.run_status === 'deficient').length
  const focuses = summaries.map(s => s.focus)
  const focusCounts: Record<string, number> = {}
  for (const f of focuses) { focusCounts[f] = (focusCounts[f] || 0) + 1 }
  const topFocus = Object.entries(focusCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null
  return {
    total_runs: totalRuns,
    completion_pct: avgCompletion,
    blocked_runs: blocked,
    deficient_runs: deficient,
    focus: topFocus,
  }
}

async function fetchRecentEvents(facilityId: string): Promise<any[]> {
  const { data, error } = await supabase
    .from('events')
    .select('*, profiles!events_user_id_fkey(name), assets!inner(equipment_name, asset_tag, facility_id, deleted_at)')
    .eq('assets.facility_id', facilityId)
    .is('assets.deleted_at', null)
    .order('timestamp', { ascending: false })
    .limit(15)
  if (error) throw error
  return data ?? []
}

function StatCard({ icon: Icon, label, value, color, bgColor }: { icon: any; label: string; value: number; color: string; bgColor: string }) {
  return (
    <div className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm hover:shadow-md transition-shadow duration-200">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center mb-2 ${bgColor}`}>
        <Icon size={18} className={color} />
      </div>
      <p className="text-2xl font-bold text-neutral-900">{value}</p>
      <p className="text-xs text-neutral-500">{label}</p>
    </div>
  )
}

function StatusRow({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total > 0 ? (count / total) * 100 : 0
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-neutral-600 w-40">{label}</span>
      <div className="flex-1 h-2 bg-neutral-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-300 ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-neutral-500 w-8 text-right">{count}</span>
    </div>
  )
}
