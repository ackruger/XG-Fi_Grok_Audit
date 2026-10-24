import { useEffect, useState } from 'react'
import { Map, MapPin } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import type { PlanDocument, PlanMarker } from '../../types'

export default function PlansSection({ assetId, facilityId }: { assetId: string; facilityId: string; canEdit: boolean }) {
  const [plans, setPlans] = useState<PlanDocument[]>([])
  const [markers, setMarkers] = useState<PlanMarker[]>([])
  const [loading, setLoading] = useState(true)

  async function fetchData() {
    // Get plans for this facility
    const { data: planData } = await supabase
      .from('plan_documents')
      .select('*')
      .eq('facility_id', facilityId)
      .order('updated_at', { ascending: false })
    setPlans((planData as PlanDocument[]) || [])

    // Get markers for this asset
    const { data: markerData } = await supabase
      .from('plan_markers')
      .select('*, plan_documents(id, name, external_url)')
      .eq('asset_id', assetId)
      .order('created_at', { ascending: false })
    setMarkers((markerData as PlanMarker[]) || [])
    setLoading(false)
  }

  useEffect(() => { fetchData() }, [assetId, facilityId])

  if (loading) return <div className="text-center py-8"><div className="w-6 h-6 border-2 border-primary-200 border-t-primary-500 rounded-full animate-spin mx-auto" /></div>

  return (
    <div className="space-y-4">
      {/* Asset markers */}
      <div>
        <h3 className="text-sm font-semibold text-neutral-700 mb-2">This Asset on Plans</h3>
        {markers.length === 0 ? (
          <div className="text-center py-6 text-neutral-400">
            <MapPin size={28} className="mx-auto mb-2" />
            <p className="text-sm">No plan markers for this asset</p>
          </div>
        ) : (
          <div className="space-y-2">
            {markers.map((marker) => (
              <div key={marker.id} className="bg-white rounded-xl border border-neutral-200 p-3 flex items-center gap-3">
                <MapPin size={18} className="text-primary-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-neutral-800 truncate">
                    {marker.plan_documents?.name || 'Unknown plan'}
                  </p>
                  <p className="text-xs text-neutral-500">
                    Page {marker.page_number} &middot; X: {marker.x.toFixed(1)}, Y: {marker.y.toFixed(1)}
                    {marker.z != null && `, Z: ${marker.z.toFixed(1)}`}
                    {marker.label && ` &middot; ${marker.label}`}
                  </p>
                </div>
                {marker.plan_documents?.external_url && (
                  <a href={marker.plan_documents.external_url} target="_blank" rel="noreferrer"
                    className="text-xs text-primary-600 hover:text-primary-700 shrink-0">Open Plan</a>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Available plans */}
      <div>
        <h3 className="text-sm font-semibold text-neutral-700 mb-2">Facility Plans</h3>
        {plans.length === 0 ? (
          <div className="text-center py-6 text-neutral-400">
            <Map size={28} className="mx-auto mb-2" />
            <p className="text-sm">No plan documents yet</p>
            <p className="text-xs mt-1">Plans can be added from the facility documents page</p>
          </div>
        ) : (
          <div className="space-y-2">
            {plans.map((plan) => (
              <div key={plan.id} className="bg-white rounded-xl border border-neutral-200 p-3 flex items-center gap-3">
                <Map size={18} className="text-neutral-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-neutral-800 truncate">{plan.name}</p>
                </div>
                {plan.external_url ? (
                  <a href={plan.external_url} target="_blank" rel="noreferrer"
                    className="text-xs text-primary-600 hover:text-primary-700 shrink-0">Open</a>
                ) : (
                  <span className="text-xs text-neutral-400 shrink-0">No URL</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
