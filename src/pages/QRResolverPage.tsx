import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useFacility } from '../context/FacilityContext'
import { AlertTriangle, Loader2 } from 'lucide-react'

type ResolverState =
  | { phase: 'resolving' }
  | { phase: 'not_found' }
  | { phase: 'no_access' }
  | { phase: 'error'; message: string }

export default function QRResolverPage() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const { session, loading: authLoading } = useAuth()
  const { currentFacility, setCurrentFacility, refreshAll, loading: facLoading } = useFacility()
  const [state, setState] = useState<ResolverState>({ phase: 'resolving' })

  useEffect(() => {
    if (authLoading || facLoading) return
    if (!session) return
    if (!token) {
      setState({ phase: 'not_found' })
      return
    }

    resolveAsset()
  }, [session, authLoading, facLoading, token])

  async function resolveAsset() {
    if (!token) return

    const { data: asset, error } = await supabase
      .from('assets')
      .select('id, facility_id')
      .eq('qr_code_id', token)
      .is('deleted_at', null)
      .maybeSingle()

    if (error) {
      setState({ phase: 'error', message: 'Could not look up the scanned code.' })
      return
    }

    if (!asset) {
      setState({ phase: 'not_found' })
      return
    }

    if (currentFacility && asset.facility_id === currentFacility.id) {
      navigate(`/assets/${asset.id}`, { replace: true })
      return
    }

    const { data: targetFacility } = await supabase
      .from('facilities')
      .select('*')
      .eq('id', asset.facility_id)
      .maybeSingle()

    if (targetFacility) {
      await refreshAll()
      setCurrentFacility(targetFacility)
      navigate(`/assets/${asset.id}`, { replace: true })
      return
    }

    setState({ phase: 'no_access' })
  }

  if (authLoading || facLoading || state.phase === 'resolving') {
    return (
      <div className="h-screen flex items-center justify-center bg-neutral-50">
        <div className="text-center">
          <Loader2 className="w-10 h-10 text-primary-600 animate-spin mx-auto mb-3" />
          <p className="text-neutral-600 text-sm">Looking up asset...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen flex items-center justify-center bg-neutral-50 px-4">
      <div className="bg-white rounded-xl shadow-md p-6 max-w-sm w-full text-center">
        <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto mb-3" />
        {state.phase === 'not_found' && (
          <>
            <h2 className="text-lg font-semibold text-neutral-900 mb-2">Asset Not Found</h2>
            <p className="text-sm text-neutral-600 mb-4">
              No asset is linked to this QR code yet. You can link it from the scan page.
            </p>
          </>
        )}
        {state.phase === 'no_access' && (
          <>
            <h2 className="text-lg font-semibold text-neutral-900 mb-2">No Access</h2>
            <p className="text-sm text-neutral-600 mb-4">
              This asset belongs to a facility you don't have access to.
              Ask the facility administrator to invite you.
            </p>
          </>
        )}
        {state.phase === 'error' && (
          <>
            <h2 className="text-lg font-semibold text-neutral-900 mb-2">Something Went Wrong</h2>
            <p className="text-sm text-neutral-600 mb-4">{state.message}</p>
          </>
        )}
        <button
          onClick={() => navigate('/dashboard', { replace: true })}
          className="px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 transition-colors"
        >
          Go to Dashboard
        </button>
      </div>
    </div>
  )
}
