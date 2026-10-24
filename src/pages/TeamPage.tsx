import { useEffect, useState } from 'react'
import { useFacility } from '../context/FacilityContext'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { Users, Mail, Crown, Shield, Eye, Wrench, UserCheck, X, Plus, Clock, Check, Trash2 } from 'lucide-react'
import type { UserRole } from '../types'

interface MemberRow {
  id: string
  user_id: string
  role: UserRole
  joined_at: string
  profiles: {
    id: string
    name: string
    email: string
    avatar_url: string | null
    company: string | null
    trade: string | null
  }
}

interface InvitationRow {
  id: string
  email: string
  role: string
  status: string
  created_at: string
  invited_by: string
}

const roleIcons: Record<string, typeof Crown> = {
  admin: Crown,
  supervisor: Shield,
  reviewer: UserCheck,
  contributor: Wrench,
  viewer: Eye,
}

const roleColors: Record<string, string> = {
  admin: 'bg-amber-50 text-amber-700 border-amber-200',
  supervisor: 'bg-blue-50 text-blue-700 border-blue-200',
  reviewer: 'bg-green-50 text-green-700 border-green-200',
  contributor: 'bg-neutral-50 text-neutral-700 border-neutral-200',
  viewer: 'bg-neutral-50 text-neutral-500 border-neutral-200',
}

export default function TeamPage() {
  const { currentFacility } = useFacility()
  const { profile } = useAuth()
  const [members, setMembers] = useState<MemberRow[]>([])
  const [invitations, setInvitations] = useState<InvitationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: 'error' | 'info'; text: string } | null>(null)

  const canManageTeam = currentUserRole === 'admin' || currentUserRole === 'supervisor'
  const isFullAdmin = currentUserRole === 'admin'

  useEffect(() => {
    if (currentFacility) {
      loadTeamData()
    }
  }, [currentFacility, profile?.id])

  async function loadTeamData() {
    if (!currentFacility || !profile?.id) return
    setLoading(true)

    const [membersRes, invitationsRes, roleRes] = await Promise.all([
      supabase
        .from('facility_members')
        .select('id, user_id, role, joined_at, profiles(id, name, email, avatar_url, company, trade)')
        .eq('facility_id', currentFacility.id)
        .order('joined_at', { ascending: true }),
      supabase
        .from('facility_invitations')
        .select('*')
        .eq('facility_id', currentFacility.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false }),
      supabase.rpc('get_facility_role', {
        p_facility_id: currentFacility.id,
        p_user_id: profile?.id,
      }),
    ])

    if (membersRes.data) {
      setMembers(membersRes.data as unknown as MemberRow[])
    }
    setCurrentUserRole(typeof roleRes.data === 'string' ? roleRes.data : null)
    if (invitationsRes.data) {
      setInvitations(invitationsRes.data)
    }
    setLoading(false)
  }

  async function handleRoleChange(memberId: string, newRole: string) {
    const { error } = await supabase
      .from('facility_members')
      .update({ role: newRole })
      .eq('id', memberId)
    if (!error) {
      setMembers(prev => prev.map(m => m.id === memberId ? { ...m, role: newRole as UserRole } : m))
    }
  }

  async function handleRemoveMember(member: MemberRow) {
    if (!confirm('Remove this member from the facility? Their invitations to this facility will also be revoked.')) return
    setNotice(null)
    const { data, error } = await supabase.rpc('remove_facility_member', { p_member_id: member.id })
    if (error) {
      setNotice({ tone: 'error', text: `Could not remove ${member.profiles.name || 'this member'}: ${error.message}` })
      return
    }
    setMembers(prev => prev.filter(m => m.id !== member.id))
    const remainingRole = data && typeof data === 'object' ? (data as { remaining_org_role?: string | null }).remaining_org_role : null
    if (remainingRole) {
      setNotice({
        tone: 'info',
        text: `${member.profiles.name || 'This person'} was removed from this facility but still has ${remainingRole} access through their organization-wide membership. Change that on the Organizations page if needed.`,
      })
    }
  }

  async function handleCancelInvitation(invitationId: string) {
    setNotice(null)
    const { error } = await supabase.rpc('revoke_facility_invitation', { p_invitation_id: invitationId })
    if (error) {
      setNotice({ tone: 'error', text: `Could not cancel the invitation: ${error.message}` })
      return
    }
    setInvitations(prev => prev.filter(i => i.id !== invitationId))
  }

  if (loading) {
    return (
      <div className="p-4 lg:p-8 max-w-3xl mx-auto">
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-3 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 lg:p-8 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">Team</h1>
          <p className="text-sm text-neutral-500 mt-0.5">
            {members.length} member{members.length !== 1 ? 's' : ''} in {currentFacility?.name}
          </p>
        </div>
        {canManageTeam && (
          <button
            onClick={() => setShowInviteModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-600 hover:to-primary-700 text-white rounded-xl text-sm font-medium shadow-md shadow-primary-200 transition-all"
          >
            <Plus size={16} />
            Invite
          </button>
        )}
      </div>

      {notice && (
        <div className={`mb-4 flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${notice.tone === 'error' ? 'border-red-200 bg-red-50 text-red-700' : 'border-blue-200 bg-blue-50 text-blue-800'}`}>
          <p className="flex-1">{notice.text}</p>
          <button onClick={() => setNotice(null)} className="p-0.5 opacity-70 hover:opacity-100" title="Dismiss">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Members List */}
      <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden mb-6">
        <div className="px-5 py-3.5 border-b border-neutral-100 bg-neutral-50/50">
          <h2 className="text-sm font-semibold text-neutral-700 flex items-center gap-2">
            <Users size={15} />
            Members
          </h2>
        </div>
        <div className="divide-y divide-neutral-100">
          {members.map(member => {
            const RoleIcon = roleIcons[member.role] || Eye
            const isSelf = member.user_id === profile?.id
            return (
              <div key={member.id} className="px-5 py-4 flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-primary-50 flex items-center justify-center overflow-hidden shrink-0">
                  {member.profiles.avatar_url ? (
                    <img src={member.profiles.avatar_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-primary-700 text-sm font-semibold">
                      {member.profiles.name?.charAt(0)?.toUpperCase() || '?'}
                    </span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-neutral-900 truncate">
                      {member.profiles.name}
                    </p>
                    {isSelf && (
                      <span className="text-[10px] font-medium bg-primary-50 text-primary-600 px-1.5 py-0.5 rounded-full">You</span>
                    )}
                  </div>
                  <p className="text-xs text-neutral-500 truncate">{member.profiles.email}</p>
                  {member.profiles.company && (
                    <p className="text-xs text-neutral-400 truncate">{member.profiles.company}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {canManageTeam && !isSelf && (isFullAdmin || member.role !== 'admin') ? (
                    <select
                      value={member.role}
                      onChange={(e) => handleRoleChange(member.id, e.target.value)}
                      className={`text-xs font-medium px-2.5 py-1.5 rounded-lg border appearance-none cursor-pointer ${roleColors[member.role]}`}
                    >
                      <option value="viewer">Viewer</option>
                      <option value="contributor">Contributor</option>
                      <option value="reviewer">Reviewer</option>
                      <option value="supervisor">Supervisor</option>
                      {isFullAdmin && <option value="admin">Admin</option>}
                    </select>
                  ) : (
                    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border ${roleColors[member.role]}`}>
                      <RoleIcon size={12} />
                      <span className="capitalize">{member.role}</span>
                    </span>
                  )}
                  {canManageTeam && !isSelf && (isFullAdmin || member.role !== 'admin') && (
                    <button
                      onClick={() => handleRemoveMember(member)}
                      className="p-1.5 text-neutral-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                      title="Remove member"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Pending Invitations */}
      {canManageTeam && invitations.length > 0 && (
        <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
          <div className="px-5 py-3.5 border-b border-neutral-100 bg-neutral-50/50">
            <h2 className="text-sm font-semibold text-neutral-700 flex items-center gap-2">
              <Clock size={15} />
              Pending Invitations
            </h2>
          </div>
          <div className="divide-y divide-neutral-100">
            {invitations.map(inv => (
              <div key={inv.id} className="px-5 py-4 flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
                  <Mail size={16} className="text-amber-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-neutral-900 truncate">{inv.email}</p>
                  <p className="text-xs text-neutral-500">
                    Invited as <span className="capitalize font-medium">{inv.role}</span>
                    {' '}-- {new Date(inv.created_at).toLocaleDateString()}
                  </p>
                </div>
                <button
                  onClick={() => handleCancelInvitation(inv.id)}
                  className="p-2 text-neutral-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                  title="Cancel invitation"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {showInviteModal && (
        <InviteModal
          facilityId={currentFacility!.id}
          callerRole={currentUserRole}
          onClose={() => setShowInviteModal(false)}
          onInvited={() => {
            setShowInviteModal(false)
            loadTeamData()
          }}
        />
      )}
    </div>
  )
}

function InviteModal({ facilityId, callerRole, onClose, onInvited }: { facilityId: string; callerRole: string | null; onClose: () => void; onInvited: () => void }) {
  const { profile } = useAuth()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<string>('contributor')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [emailWarning, setEmailWarning] = useState<string | null>(null)

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSending(true)

    const trimmedEmail = email.trim().toLowerCase()
    if (!trimmedEmail) {
      setError('Please enter an email address.')
      setSending(false)
      return
    }

    const { error: insertErr } = await supabase
      .from('facility_invitations')
      .insert({
        facility_id: facilityId,
        email: trimmedEmail,
        role,
        invited_by: profile?.id,
      })

    if (insertErr) {
      if (insertErr.code === '23505') {
        setError('This person already has a pending invitation.')
      } else {
        setError(insertErr.message)
      }
      setSending(false)
      return
    }

    const { error: emailError } = await supabase.functions.invoke('send-invitation-email', {
      body: { email: trimmedEmail, facilityId, role },
    })

    setSending(false)
    setSuccess(true)

    if (emailError) {
      let reason = ''
      const ctx = (emailError as { context?: Response }).context
      if (ctx && typeof ctx.json === 'function') {
        const body = await ctx.json().catch(() => null)
        if (body && typeof body.error === 'string') reason = ` (${body.error})`
      }
      setEmailWarning(`Invitation created, but the email could not be delivered${reason}. The person can still accept it by signing in with this email address.`)
      return
    }

    setTimeout(() => onInvited(), 1200)
  }

  const close = success ? onInvited : onClose

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={close}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-bold text-neutral-900">Invite Team Member</h3>
          <button onClick={close} className="p-1.5 hover:bg-neutral-100 rounded-lg transition-colors">
            <X size={18} className="text-neutral-500" />
          </button>
        </div>

        {success ? (
          <div className="text-center py-6">
            <div className={`w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3 ${emailWarning ? 'bg-amber-50' : 'bg-green-50'}`}>
              <Check size={24} className={emailWarning ? 'text-amber-600' : 'text-green-600'} />
            </div>
            <p className="text-sm font-medium text-neutral-900">{emailWarning ? 'Invitation created' : 'Invitation sent!'}</p>
            <p className="text-xs text-neutral-500 mt-1">They will gain access once they sign in with this email.</p>
            {emailWarning && (
              <>
                <p role="alert" className="text-xs text-amber-800 bg-amber-50 rounded-lg px-3 py-2 mt-3">{emailWarning}</p>
                <button
                  type="button"
                  onClick={onInvited}
                  className="mt-4 px-5 py-2 bg-neutral-900 text-white rounded-xl text-sm font-medium hover:bg-neutral-800 transition-colors"
                >
                  Done
                </button>
              </>
            )}
          </div>
        ) : (
          <form onSubmit={handleInvite} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1.5">Email Address</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="coworker@company.com"
                className="w-full px-3.5 py-2.5 border border-neutral-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-400/40 focus:border-primary-400"
                autoFocus
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1.5">Role</label>
              <select
                value={role}
                onChange={e => setRole(e.target.value)}
                className="w-full px-3.5 py-2.5 border border-neutral-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-400/40 focus:border-primary-400 appearance-none bg-white"
              >
                <option value="viewer">Viewer -- Can view assets and cases</option>
                <option value="contributor">Contributor -- Can add updates and notes</option>
                <option value="reviewer">Reviewer -- Can review and verify</option>
                <option value="supervisor">Supervisor -- Can manage team and settings</option>
                {callerRole === 'admin' && <option value="admin">Admin -- Full access</option>}
              </select>
            </div>
            {error && (
              <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
            )}
            <div className="flex gap-3 pt-1">
              <button
                type="submit"
                disabled={sending}
                className="flex-1 py-2.5 bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-600 hover:to-primary-700 text-white rounded-xl text-sm font-medium disabled:opacity-50 shadow-md shadow-primary-200 transition-all"
              >
                {sending ? 'Sending...' : 'Send Invitation'}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 bg-neutral-100 text-neutral-700 rounded-xl text-sm font-medium hover:bg-neutral-200 transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
