import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, Search } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { fetchAllPages, type PageResult } from '../lib/fetchAllPages'
import { useFacility } from '../context/FacilityContext'
import type { Asset, Tag, AssetType } from '../types'
import CreateAssetModal from '../components/CreateAssetModal'

interface AssetLocation {
  building: string | null
  floor: string | null
  room_area: string | null
}

type AssetWithLocation = Asset & {
  locations?: AssetLocation | null
}

interface AssetTagJoinRow {
  asset_id: string
  tags: Tag | Tag[] | null
}

export default function AssetsPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { currentFacility, currentOrganization } = useFacility()
  const [assets, setAssets] = useState<AssetWithLocation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [assetTagsMap, setAssetTagsMap] = useState<Record<string, Tag[]>>({})
  const [assetTypes, setAssetTypes] = useState<AssetType[]>([])
  const [typeFilter, setTypeFilter] = useState('')
  const assetRequestId = useRef(0)
  const tagRequestId = useRef(0)
  const typeRequestId = useRef(0)

  useEffect(() => {
    if (searchParams.get('action') === 'create') {
      setShowCreateModal(true)
      setSearchParams({}, { replace: true })
    }
  }, [searchParams, setSearchParams])

  useEffect(() => {
    void fetchAssets()
    void fetchAssetTags()
    void fetchAssetTypes()
  }, [currentFacility?.id, currentOrganization?.id, statusFilter, typeFilter])

  async function fetchAssets() {
    const requestId = ++assetRequestId.current

    if (!currentFacility) {
      setAssets([])
      setError(null)
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const data = await fetchAllPages<AssetWithLocation>((from, to) => {
        let query = supabase
          .from('assets')
          .select('*, locations(building, floor, room_area)')
          .eq('facility_id', currentFacility.id)
          .is('deleted_at', null)
        if (statusFilter) query = query.eq('status', statusFilter)
        if (typeFilter) query = query.eq('asset_type_id', typeFilter)
        return query
          .order('created_at', { ascending: false })
          .order('id', { ascending: true })
          .range(from, to) as unknown as PromiseLike<PageResult<AssetWithLocation>>
      })
      if (requestId !== assetRequestId.current) return

      setAssets(data)
    } catch (err) {
      if (requestId !== assetRequestId.current) return
      const message = err instanceof Error ? err.message : 'Failed to load assets'
      console.error('Asset fetch failed:', message)
      setError(message)
    } finally {
      if (requestId === assetRequestId.current) setLoading(false)
    }
  }

  async function fetchAssetTypes() {
    const requestId = ++typeRequestId.current

    if (!currentOrganization) {
      setAssetTypes([])
      return
    }

    try {
      const { data, error: queryError } = await supabase
        .from('asset_types')
        .select('*')
        .eq('organization_id', currentOrganization.id)
        .eq('is_active', true)
        .order('sort_order')

      if (requestId !== typeRequestId.current) return
      if (queryError) throw queryError

      setAssetTypes(data || [])
    } catch (err) {
      if (requestId !== typeRequestId.current) return
      console.error('Failed to load asset types:', err)
      setAssetTypes([])
    }
  }

  async function fetchAssetTags() {
    const requestId = ++tagRequestId.current

    if (!currentFacility) {
      setAssetTagsMap({})
      return
    }

    try {
      const assetRows = await fetchAllPages<{ id: string }>((from, to) =>
        supabase
          .from('assets')
          .select('id')
          .eq('facility_id', currentFacility.id)
          .is('deleted_at', null)
          .order('id', { ascending: true })
          .range(from, to),
      )

      if (requestId !== tagRequestId.current) return

      const assetIds = assetRows.map(asset => asset.id)
      if (assetIds.length === 0) {
        setAssetTagsMap({})
        return
      }

      const map: Record<string, Tag[]> = {}
      const CHUNK = 300
      for (let i = 0; i < assetIds.length; i += CHUNK) {
        if (requestId !== tagRequestId.current) return
        const chunk = assetIds.slice(i, i + CHUNK)
        const data = await fetchAllPages<AssetTagJoinRow>((from, to) =>
          supabase
            .from('asset_tags')
            .select('id, asset_id, tags(*)')
            .in('asset_id', chunk)
            .order('id', { ascending: true })
            .range(from, to) as unknown as PromiseLike<PageResult<AssetTagJoinRow>>,
        )

        for (const row of data) {
          const tags = Array.isArray(row.tags) ? row.tags : row.tags ? [row.tags] : []
          if (tags.length === 0) continue
          if (!map[row.asset_id]) map[row.asset_id] = []
          map[row.asset_id].push(...tags)
        }
      }

      setAssetTagsMap(map)
    } catch (err) {
      if (requestId !== tagRequestId.current) return
      console.error('Failed to load asset tags:', err)
      setAssetTagsMap({})
    }
  }

  const filteredAssets = searchQuery
    ? assets.filter(asset => {
        const query = searchQuery.toLowerCase()
        return asset.equipment_name.toLowerCase().includes(query) ||
          (asset.asset_tag || '').toLowerCase().includes(query)
      })
    : assets

  return (
    <div className="p-4 lg:p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">Assets</h1>
          <p className="text-sm text-neutral-500">{assets.length} total</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-1.5 bg-gradient-to-r from-primary-500 to-primary-600 text-white px-3 py-2 rounded-xl text-sm font-medium hover:from-primary-600 hover:to-primary-700 transition-all shadow-md shadow-primary-200"
          >
            <Plus size={16} />
            <span className="hidden sm:inline">New Asset</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4 text-sm text-red-700 flex items-center justify-between gap-3">
          <span>Assets could not be loaded: {error}</span>
          <button
            type="button"
            onClick={() => { void fetchAssets() }}
            className="shrink-0 underline font-semibold hover:text-red-900"
          >
            Retry
          </button>
        </div>
      )}

      <div className="flex gap-2 mb-4">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search assets..."
            className="w-full pl-9 pr-3 py-2 border border-neutral-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-400/40 focus:border-primary-400"
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="px-3 py-2 border border-neutral-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-400/40 focus:border-primary-400"
        >
          <option value="">All Types</option>
          {assetTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border border-neutral-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-400/40 focus:border-primary-400"
        >
          <option value="">All Status</option>
          <option value="not_started">Not Started</option>
          <option value="in_progress">In Progress</option>
          <option value="complete">Complete</option>
          <option value="complete_pending_verification">Pending Verification</option>
          <option value="blocked">Blocked</option>
          <option value="deficient">Deficient</option>
          <option value="ready_for_next_trade">Ready for Next Trade</option>
        </select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="w-8 h-8 border-2 border-primary-200 border-t-primary-500 rounded-full animate-spin" />
        </div>
      ) : error ? null : filteredAssets.length === 0 ? (
        <div className="bg-white rounded-2xl border border-neutral-200 p-8 text-center shadow-sm">
          <p className="text-neutral-500">No assets found.</p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="text-primary-600 text-sm font-medium mt-2"
          >
            Create your first asset
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredAssets.map(asset => (
            <button
              key={asset.id}
              onClick={() => navigate(`/assets/${asset.id}`)}
              className="w-full text-left bg-white rounded-xl border border-neutral-200 p-4 hover:border-primary-300 hover:shadow-sm transition-all duration-200"
            >
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-neutral-900 truncate">
                    {asset.equipment_name || asset.asset_tag}
                  </p>
                  <p className="text-xs text-neutral-500 mt-0.5 truncate">
                    {asset.locations?.building || ''} {asset.locations?.floor ? `/ ${asset.locations.floor}` : ''} {asset.locations?.room_area ? `/ ${asset.locations.room_area}` : ''}
                    {!asset.locations && asset.asset_tag}
                  </p>
                  {assetTagsMap[asset.id]?.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {assetTagsMap[asset.id].map(tag => (
                        <span
                          key={tag.id}
                          className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium text-white"
                          style={{ backgroundColor: tag.color }}
                        >
                          {tag.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <span
                  title={getStatusTooltip(asset.status)}
                  className={`text-xs px-2.5 py-1 rounded-full font-medium shrink-0 ml-3 ${getStatusColor(asset.status)}`}
                >
                  {formatStatus(asset.status)}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      {showCreateModal && (
        <CreateAssetModal
          onClose={() => setShowCreateModal(false)}
          onComplete={() => {
            setShowCreateModal(false)
            void fetchAssets()
            void fetchAssetTags()
          }}
        />
      )}
    </div>
  )
}

function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    not_started: 'bg-neutral-100 text-neutral-600',
    in_progress: 'bg-primary-50 text-primary-700',
    complete: 'bg-success-50 text-success-700',
    complete_pending_verification: 'bg-warning-50 text-warning-600',
    blocked: 'bg-error-50 text-error-700',
    deficient: 'bg-error-50 text-error-600',
    ready_for_next_trade: 'bg-success-50 text-success-600',
    accepted: 'bg-success-50 text-success-700',
    rejected: 'bg-error-50 text-error-700',
    closed: 'bg-neutral-100 text-neutral-600',
  }
  return colors[status] || 'bg-neutral-100 text-neutral-600'
}

function formatStatus(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase())
}

function getStatusTooltip(status: string): string {
  const tooltips: Record<string, string> = {
    not_started: 'Work has not begun on this asset yet.',
    in_progress: 'Active work is currently underway.',
    complete: 'All work on this asset is finished.',
    complete_pending_verification: 'Work is done but awaiting inspector sign-off.',
    blocked: 'Progress is halted by a dependency or case.',
    deficient: 'Inspection found deficiencies that need correction.',
    ready_for_next_trade: 'Current trade is done; next trade can begin.',
    accepted: 'Formally accepted and approved after verification.',
    rejected: 'Rejected during verification; needs rework.',
    closed: 'Fully closed out, no further action needed.',
  }
  return tooltips[status] || ''
}
