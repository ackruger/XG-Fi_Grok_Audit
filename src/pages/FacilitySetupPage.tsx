import { useState, useEffect } from 'react'
import { useFacility } from '../context/FacilityContext'
import { useAuth } from '../context/AuthContext'
import { Building2, ArrowRight, Briefcase, ChevronDown, RefreshCw } from 'lucide-react'

export default function FacilitySetupPage() {
  const {
    organizations, currentOrganization, createFacility,
    createOrganization, setCurrentOrganization, refreshAll, loading: facLoading,
  } = useFacility()
  const { signOut } = useAuth()

  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newOrgName, setNewOrgName] = useState('')
  const [newOrgDesc, setNewOrgDesc] = useState('')
  const [creatingOrg, setCreatingOrg] = useState(false)
  const [showCreateOrg, setShowCreateOrg] = useState(false)
  const [retrying, setRetrying] = useState(false)

  const hasOrgs = organizations.length > 0
  const selectedOrg = currentOrganization ?? (hasOrgs ? organizations[0] : null)

  useEffect(() => {
    if (!currentOrganization && hasOrgs) {
      setCurrentOrganization(organizations[0])
    }
  }, [currentOrganization, hasOrgs, organizations, setCurrentOrganization])

  async function handleRetry() {
    setRetrying(true)
    setError(null)
    await refreshAll()
    setRetrying(false)
  }

  async function handleCreateOrg() {
    if (!newOrgName.trim()) return
    setCreatingOrg(true)
    setError(null)
    const org = await createOrganization(newOrgName.trim(), newOrgDesc.trim() || undefined)
    if (!org) {
      setError('Could not create organization. Please try again.')
    } else {
      setShowCreateOrg(false)
      setNewOrgName('')
      setNewOrgDesc('')
    }
    setCreatingOrg(false)
  }

  async function handleCreateFacility() {
    if (!name.trim() || !selectedOrg) return
    setLoading(true)
    setError(null)
    try {
      const result = await createFacility({ name: name.trim(), organization_id: selectedOrg.id })
      if (!result) {
        setError('Could not create facility. Please try again.')
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'An unexpected error occurred.')
    }
    setLoading(false)
  }

  const showCreateFacility = hasOrgs && selectedOrg
  const showCreateOrgForm = !showCreateFacility

  return (
    <div className="h-full flex items-center justify-center bg-neutral-50 p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-gradient-to-br from-primary-400 to-primary-600 rounded-2xl flex items-center justify-center shadow-lg shadow-primary-200 mx-auto mb-4">
            <Building2 className="text-white" size={32} />
          </div>
          <h1 className="text-2xl font-bold text-neutral-900 mb-2">Welcome to Xg-Fi</h1>
          {showCreateOrgForm && (
            <p className="text-neutral-500">Create an organization to get started, or ask an administrator to invite you to an existing one.</p>
          )}
          {showCreateFacility && (
            <p className="text-neutral-500">
              Organization: <span className="font-medium text-neutral-700">{selectedOrg.name}</span>
            </p>
          )}
        </div>

        {error && (
          <div className="mb-6 p-4 bg-error-50 border border-error-200 rounded-xl text-sm text-error-700">
            {error}
          </div>
        )}

        {facLoading && (
          <div className="flex justify-center py-8 mb-4">
            <div className="w-8 h-8 border-2 border-primary-200 border-t-primary-500 rounded-full animate-spin" />
          </div>
        )}

        {!facLoading && showCreateOrgForm && (
          <div className="bg-white rounded-2xl shadow-sm border border-neutral-200 p-6">
            <h2 className="text-lg font-semibold text-neutral-900 mb-1">Create an Organization</h2>
            <p className="text-sm text-neutral-500 mb-5">An organization groups your facilities and asset types.</p>

            <label className="block text-sm font-medium text-neutral-700 mb-1.5">
              Organization Name <span className="text-error-500">*</span>
            </label>
            <input
              type="text"
              value={newOrgName}
              onChange={e => setNewOrgName(e.target.value)}
              placeholder="e.g. Acme Corp"
              className="w-full px-4 py-3 bg-neutral-50 border border-neutral-200 rounded-xl text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 outline-none transition-all"
              onKeyDown={e => e.key === 'Enter' && handleCreateOrg()}
            />

            <label className="block text-sm font-medium text-neutral-700 mb-1.5 mt-3">Description</label>
            <input
              type="text"
              value={newOrgDesc}
              onChange={e => setNewOrgDesc(e.target.value)}
              placeholder="Optional description"
              className="w-full px-4 py-3 bg-neutral-50 border border-neutral-200 rounded-xl text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 outline-none transition-all"
            />

            <button
              onClick={handleCreateOrg}
              disabled={!newOrgName.trim() || creatingOrg}
              className="w-full mt-4 py-3 bg-primary-600 text-white rounded-xl text-sm font-semibold hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {creatingOrg ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <Briefcase size={16} />
                  Create Organization
                </>
              )}
            </button>

            <button
              onClick={handleRetry}
              disabled={retrying}
              className="w-full mt-3 text-center text-xs text-neutral-400 hover:text-primary-600 transition-colors flex items-center justify-center gap-1.5"
            >
              <RefreshCw size={12} className={retrying ? 'animate-spin' : ''} />
              {retrying ? 'Checking...' : 'Already invited? Tap to refresh'}
            </button>
          </div>
        )}

        {!facLoading && showCreateFacility && (
          <div className="bg-white rounded-2xl shadow-sm border border-neutral-200 p-6">
            {organizations.length > 1 && (
              <div className="mb-5 pb-4 border-b border-neutral-100">
                <label className="block text-xs font-medium text-neutral-500 mb-1">Organization</label>
                <div className="relative">
                  <select
                    value={selectedOrg.id}
                    onChange={e => {
                      const org = organizations.find(o => o.id === e.target.value)
                      if (org) setCurrentOrganization(org)
                    }}
                    className="w-full appearance-none px-3 py-2 bg-neutral-50 border border-neutral-200 rounded-lg text-sm font-medium text-neutral-800 pr-8 focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 outline-none"
                  >
                    {organizations.map(o => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </select>
                  <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
                </div>
              </div>
            )}

            <h2 className="text-lg font-semibold text-neutral-900 mb-1">No facilities yet</h2>
            <p className="text-sm text-neutral-500 mb-5">Create your first facility to start managing assets.</p>

            <label className="block text-sm font-medium text-neutral-700 mb-1.5">
              Facility Name <span className="text-error-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Vancouver Head Office"
              className="w-full px-4 py-3 bg-neutral-50 border border-neutral-200 rounded-xl text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 outline-none transition-all"
              onKeyDown={e => e.key === 'Enter' && handleCreateFacility()}
            />

            <button
              onClick={handleCreateFacility}
              disabled={!name.trim() || loading}
              className="w-full mt-4 py-3 bg-primary-600 text-white rounded-xl text-sm font-semibold hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  Create Facility
                  <ArrowRight size={16} />
                </>
              )}
            </button>

            {!showCreateOrg && (
              <button
                onClick={() => setShowCreateOrg(true)}
                className="w-full mt-3 text-center text-xs text-neutral-400 hover:text-primary-600 transition-colors"
              >
                + Create a different organization
              </button>
            )}

            {showCreateOrg && (
              <div className="mt-4 pt-4 border-t border-neutral-100">
                <p className="text-sm font-medium text-neutral-700 mb-2">New Organization</p>
                <input
                  type="text"
                  value={newOrgName}
                  onChange={e => setNewOrgName(e.target.value)}
                  placeholder="Organization name"
                  className="w-full px-3 py-2.5 bg-neutral-50 border border-neutral-200 rounded-xl text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 outline-none transition-all mb-2"
                  onKeyDown={e => e.key === 'Enter' && handleCreateOrg()}
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleCreateOrg}
                    disabled={!newOrgName.trim() || creatingOrg}
                    className="flex-1 py-2 bg-primary-600 text-white rounded-xl text-xs font-semibold hover:bg-primary-700 disabled:opacity-50 transition-colors"
                  >
                    {creatingOrg ? 'Creating...' : 'Create'}
                  </button>
                  <button
                    onClick={() => { setShowCreateOrg(false); setNewOrgName(''); setNewOrgDesc('') }}
                    className="px-3 py-2 bg-neutral-100 text-neutral-600 rounded-xl text-xs font-medium hover:bg-neutral-200 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <button
          onClick={signOut}
          className="mt-6 w-full text-center text-sm text-neutral-400 hover:text-neutral-600 transition-colors"
        >
          Sign out
        </button>
      </div>
    </div>
  )
}
