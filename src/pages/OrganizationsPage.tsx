import { useState, useEffect } from 'react'
import { useFacility } from '../context/FacilityContext'
import { supabase } from '../lib/supabase'
import { Briefcase, Plus, Pencil, X, Check, Archive, Building2, Users, ChevronRight, MapPin } from 'lucide-react'
import type { Organization, OrganizationMember, Facility } from '../types'
import { useAuth } from '../context/AuthContext'
import { useNavigate } from 'react-router-dom'

export default function OrganizationsPage() {
  const { organizations, currentOrganization, setCurrentOrganization, createOrganization, updateOrganization, refreshAll, setCurrentFacility } = useFacility()
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [showCreate, setShowCreate] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [orgRoles, setOrgRoles] = useState<Record<string, string>>({})
  const [orgFacCounts, setOrgFacCounts] = useState<Record<string, number>>({})
  const [orgMemberCounts, setOrgMemberCounts] = useState<Record<string, number>>({})
  const [expandedOrgId, setExpandedOrgId] = useState<string | null>(null)
  const [orgFacilities, setOrgFacilities] = useState<Record<string, Facility[]>>({})

  useEffect(() => {
    if (organizations.length === 0 || !profile) return

    async function fetchOrgDetails() {
      const { data: memberships } = await supabase
        .from('organization_members')
        .select('organization_id, role')
        .eq('user_id', profile!.id)

      if (memberships) {
        const roles: Record<string, string> = {}
        for (const m of memberships) {
          roles[m.organization_id] = m.role
        }
        setOrgRoles(roles)
      }

      const facCounts: Record<string, number> = {}
      const memberCounts: Record<string, number> = {}

      for (const org of organizations) {
        const { count: facCount } = await supabase
          .from('facilities')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', org.id)
          .eq('is_active', true)
        facCounts[org.id] = facCount || 0

        const { count: memCount } = await supabase
          .from('organization_members')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', org.id)
        memberCounts[org.id] = memCount || 0
      }

      setOrgFacCounts(facCounts)
      setOrgMemberCounts(memberCounts)
    }

    fetchOrgDetails()
  }, [organizations, profile])

  async function handleCreate(name: string, description?: string) {
    const org = await createOrganization(name, description)
    if (org) setShowCreate(false)
    return !!org
  }

  async function handleArchive(orgId: string) {
    if (!confirm('Archive this organization? It will be hidden from the list.')) return
    await updateOrganization(orgId, { is_active: false })
    if (currentOrganization?.id === orgId) {
      const remaining = organizations.filter(o => o.id !== orgId && o.is_active)
      setCurrentOrganization(remaining[0] || null)
    }
    await refreshAll()
  }

  async function handleViewFacilities(org: Organization) {
    setCurrentOrganization(org)
    const { data } = await supabase
      .from('facilities')
      .select('*')
      .eq('organization_id', org.id)
      .eq('is_active', true)
      .order('name')
    setOrgFacilities(prev => ({ ...prev, [org.id]: data || [] }))
    setExpandedOrgId(expandedOrgId === org.id ? null : org.id)
  }

  function handleEnterFacility(facility: Facility) {
    setCurrentFacility(facility)
    navigate('/dashboard')
  }

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 lg:p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">Organizations</h1>
          <p className="text-sm text-neutral-500 mt-1">Manage your organizations and their settings</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-primary-600 text-white rounded-xl text-sm font-semibold hover:bg-primary-700 transition-colors shadow-sm"
        >
          <Plus size={16} />
          New Organization
        </button>
      </div>

      {showCreate && (
        <OrgForm
          onSave={handleCreate}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {organizations.length === 0 && !showCreate && (
        <div className="text-center py-16">
          <Briefcase size={48} className="mx-auto text-neutral-300 mb-4" />
          <h2 className="text-lg font-semibold text-neutral-600 mb-2">No organizations yet</h2>
          <p className="text-neutral-400 text-sm">Create your first organization to start managing facilities and assets.</p>
        </div>
      )}

      <div className="space-y-3">
        {organizations.map(org => (
          <div key={org.id}>
            {editingId === org.id ? (
              <OrgForm
                org={org}
                onSave={async (name, desc) => {
                  const ok = await updateOrganization(org.id, { name, description: desc || null })
                  if (ok) setEditingId(null)
                  return ok
                }}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <>
                <OrgCard
                  org={org}
                  isActive={currentOrganization?.id === org.id}
                  role={orgRoles[org.id]}
                  facilityCount={orgFacCounts[org.id] || 0}
                  memberCount={orgMemberCounts[org.id] || 0}
                  isExpanded={expandedOrgId === org.id}
                  onSelect={() => setCurrentOrganization(org)}
                  onEdit={() => setEditingId(org.id)}
                  onArchive={() => handleArchive(org.id)}
                  onViewFacilities={() => handleViewFacilities(org)}
                />
                {expandedOrgId === org.id && (
                  <OrgFacilitiesList
                    facilities={orgFacilities[org.id] || []}
                    currentFacilityId={undefined}
                    onEnter={handleEnterFacility}
                  />
                )}
              </>
            )}
          </div>
        ))}
      </div>

      {/* Org Members Section for active org */}
      {currentOrganization && orgRoles[currentOrganization.id] === 'admin' && (
        <OrgMembersSection
          orgId={currentOrganization.id}
          orgName={currentOrganization.name}
        />
      )}
    </div>
  )
}

function OrgCard({ org, isActive, role, facilityCount, memberCount, isExpanded, onSelect, onEdit, onArchive, onViewFacilities }: {
  org: Organization
  isActive: boolean
  role?: string
  facilityCount: number
  memberCount: number
  isExpanded: boolean
  onSelect: () => void
  onEdit: () => void
  onArchive: () => void
  onViewFacilities: () => void
}) {
  const isAdmin = role === 'admin'

  return (
    <div className={`bg-white rounded-xl border-2 transition-all ${isActive ? 'border-primary-400 shadow-md shadow-primary-100' : 'border-neutral-200 hover:border-neutral-300'}`}>
      <div className="flex items-start gap-4 p-5">
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${isActive ? 'bg-primary-100 text-primary-600' : 'bg-neutral-100 text-neutral-500'}`}>
          <Briefcase size={22} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold text-neutral-900">{org.name}</h3>
            {isActive && (
              <span className="text-xs px-2 py-0.5 bg-primary-50 text-primary-600 rounded-full font-medium">Active</span>
            )}
            {role && (
              <span className="text-xs px-2 py-0.5 bg-neutral-100 text-neutral-500 rounded-full capitalize">{role}</span>
            )}
          </div>
          {org.description && <p className="text-sm text-neutral-500 mb-2">{org.description}</p>}
          <div className="flex items-center gap-4 text-xs text-neutral-400">
            <span className="flex items-center gap-1">
              <Building2 size={12} /> {facilityCount} {facilityCount === 1 ? 'facility' : 'facilities'}
            </span>
            <span className="flex items-center gap-1">
              <Users size={12} /> {memberCount} {memberCount === 1 ? 'member' : 'members'}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onViewFacilities}
            className="px-3 py-1.5 text-xs font-medium text-primary-600 bg-primary-50 hover:bg-primary-100 rounded-lg transition-colors flex items-center gap-1"
          >
            <Building2 size={12} /> View Facilities
            <ChevronRight size={12} className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
          </button>
          {!isActive && (
            <button
              onClick={onSelect}
              className="px-3 py-1.5 text-xs font-medium text-neutral-500 bg-neutral-50 hover:bg-neutral-100 rounded-lg transition-colors flex items-center gap-1"
            >
              Set Active
            </button>
          )}
          {isAdmin && (
            <>
              <button
                onClick={onEdit}
                className="p-2 text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 rounded-lg transition-colors"
                title="Edit"
              >
                <Pencil size={14} />
              </button>
              <button
                onClick={onArchive}
                className="p-2 text-neutral-400 hover:text-error-500 hover:bg-error-50 rounded-lg transition-colors"
                title="Archive"
              >
                <Archive size={14} />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function OrgFacilitiesList({ facilities, currentFacilityId, onEnter }: {
  facilities: Facility[]
  currentFacilityId?: string
  onEnter: (f: Facility) => void
}) {
  return (
    <div className="ml-6 mb-3 bg-neutral-50 rounded-xl border border-neutral-200 p-3 space-y-2">
      {facilities.length === 0 ? (
        <p className="text-sm text-neutral-400 text-center py-4">No facilities in this organization yet</p>
      ) : facilities.map(f => (
        <button
          key={f.id}
          onClick={() => onEnter(f)}
          className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-all text-left ${
            currentFacilityId === f.id ? 'border-primary-300 bg-primary-50/50' : 'border-neutral-200 bg-white hover:border-primary-200 hover:bg-primary-50/30'
          }`}
        >
          <Building2 size={16} className="text-neutral-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-neutral-800 truncate">{f.name}</p>
            <p className="text-xs text-neutral-400 flex items-center gap-1">
              <MapPin size={10} />
              {[f.address_line_1, f.city].filter(Boolean).join(', ') || 'No address'}
            </p>
          </div>
          <ChevronRight size={14} className="text-neutral-300 shrink-0" />
        </button>
      ))}
    </div>
  )
}

function OrgForm({ org, onSave, onCancel }: {
  org?: Organization
  onSave: (name: string, description?: string) => Promise<boolean>
  onCancel: () => void
}) {
  const [name, setName] = useState(org?.name || '')
  const [description, setDescription] = useState(org?.description || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    setError('')
    const ok = await onSave(name.trim(), description.trim() || undefined)
    if (!ok) setError('Failed to save. Please try again.')
    setSaving(false)
  }

  const inputClass = 'w-full px-3 py-2.5 bg-neutral-50 border border-neutral-200 rounded-xl text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 outline-none transition-all'

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-neutral-200 p-5 mb-3 shadow-sm">
      <h3 className="font-semibold text-neutral-900 mb-4">{org ? 'Edit Organization' : 'New Organization'}</h3>

      {error && <p className="text-sm text-error-600 mb-3">{error}</p>}

      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-neutral-600 mb-1">
            Organization Name <span className="text-error-500">*</span>
          </label>
          <input type="text" value={name} onChange={e => setName(e.target.value)} className={inputClass} placeholder="e.g. Novus Entertainment Inc." required />
        </div>

        <div>
          <label className="block text-xs font-medium text-neutral-600 mb-1">Description</label>
          <input type="text" value={description} onChange={e => setDescription(e.target.value)} className={inputClass} placeholder="Brief description" />
        </div>
      </div>

      <div className="flex items-center gap-2 mt-5 pt-4 border-t border-neutral-100">
        <button
          type="submit"
          disabled={!name.trim() || saving}
          className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-xl text-sm font-semibold hover:bg-primary-700 disabled:opacity-50 transition-colors"
        >
          {saving ? (
            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <Check size={14} />
          )}
          {org ? 'Save Changes' : 'Create Organization'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex items-center gap-2 px-4 py-2 bg-neutral-100 text-neutral-600 rounded-xl text-sm font-medium hover:bg-neutral-200 transition-colors"
        >
          <X size={14} />
          Cancel
        </button>
      </div>
    </form>
  )
}

function OrgMembersSection({ orgId, orgName }: { orgId: string; orgName: string }) {
  const [members, setMembers] = useState<OrganizationMember[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchMembers() {
      setLoading(true)
      const { data: memberRows, error } = await supabase
        .from('organization_members')
        .select('*')
        .eq('organization_id', orgId)
        .order('joined_at')
      if (error || !memberRows) {
        setMembers([])
        setLoading(false)
        return
      }
      const userIds = memberRows.map(m => m.user_id)
      if (userIds.length === 0) {
        setMembers([])
        setLoading(false)
        return
      }
      const { data: profileRows } = await supabase
        .from('profiles')
        .select('id, name, email')
        .in('id', userIds)
      const profileMap = new Map<string, { id: string; name: string; email: string }>()
      for (const p of profileRows || []) {
        profileMap.set(p.id, p)
      }
      const merged = memberRows.map(m => ({
        ...m,
        profiles: profileMap.get(m.user_id) || null,
      })) as OrganizationMember[]
      setMembers(merged)
      setLoading(false)
    }
    fetchMembers()
  }, [orgId])

  async function updateRole(memberId: string, newRole: string) {
    await supabase
      .from('organization_members')
      .update({ role: newRole })
      .eq('id', memberId)
    const { data: memberRows } = await supabase
      .from('organization_members')
      .select('*')
      .eq('organization_id', orgId)
      .order('joined_at')
    if (memberRows) {
      const userIds = memberRows.map(m => m.user_id)
      const { data: profileRows } = await supabase
        .from('profiles')
        .select('id, name, email')
        .in('id', userIds)
      const profileMap = new Map<string, { id: string; name: string; email: string }>()
      for (const p of profileRows || []) {
        profileMap.set(p.id, p)
      }
      setMembers(memberRows.map(m => ({
        ...m,
        profiles: profileMap.get(m.user_id) || null,
      })) as OrganizationMember[])
    }
  }

  if (loading) return null

  return (
    <div className="mt-10">
      <h2 className="text-lg font-bold text-neutral-900 mb-1">Members of {orgName}</h2>
      <p className="text-sm text-neutral-500 mb-4">Manage who has access to this organization</p>

      <div className="bg-white rounded-xl border border-neutral-200 divide-y divide-neutral-100">
        {members.map(m => {
          const p = m.profiles as any
          return (
            <div key={m.id} className="flex items-center gap-3 p-4">
              <div className="w-9 h-9 rounded-xl bg-primary-50 flex items-center justify-center">
                <span className="text-primary-700 text-xs font-semibold">
                  {(p?.name || p?.email || '?').charAt(0).toUpperCase()}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-neutral-800 truncate">{p?.name || 'Unknown'}</p>
                <p className="text-xs text-neutral-400 truncate">{p?.email || ''}</p>
              </div>
              <select
                value={m.role}
                onChange={e => updateRole(m.id, e.target.value)}
                className="text-xs px-2 py-1 border border-neutral-200 rounded-lg bg-neutral-50 text-neutral-700 focus:ring-2 focus:ring-primary-500/20 outline-none"
              >
                <option value="admin">Admin</option>
                <option value="manager">Manager</option>
                <option value="member">Member</option>
              </select>
            </div>
          )
        })}
        {members.length === 0 && (
          <div className="p-6 text-center text-sm text-neutral-400">No members</div>
        )}
      </div>
    </div>
  )
}
