import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, MessageSquare, Camera, Pencil, Link2, MapPin } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useFacility } from '../context/FacilityContext'

export default function IssueDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { currentFacility } = useFacility()
  const [issue, setIssue] = useState<any>(null)
  const [photos, setPhotos] = useState<any[]>([])
  const [comments, setComments] = useState<any[]>([])
  const [newComment, setNewComment] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editDesc, setEditDesc] = useState('')
  const [editPriority, setEditPriority] = useState('')
  const [editCategory, setEditCategory] = useState('')
  const [editDueDate, setEditDueDate] = useState('')
  const [editResolution, setEditResolution] = useState('')
  const [saving, setSaving] = useState(false)
  const [members, setMembers] = useState<any[]>([])
  const [editAssignedTo, setEditAssignedTo] = useState('')
  const [sourceLink, setSourceLink] = useState<any>(null)

  useEffect(() => {
    fetchIssue()
    fetchPhotos()
    fetchComments()
    fetchSourceLink()
  }, [id])

  useEffect(() => {
    if (currentFacility) fetchMembers()
  }, [currentFacility])

  async function fetchMembers() {
    if (!currentFacility) return
    const { data } = await supabase
      .from('facility_members')
      .select('user_id, profiles(id, name)')
      .eq('facility_id', currentFacility.id)
    setMembers(data || [])
  }

  async function fetchIssue() {
    if (!id) return
    const { data: caseData } = await supabase
      .from('cases')
      .select('*, profiles!cases_created_by_fkey(name), assets(equipment_name, asset_tag)')
      .eq('id', id)
      .maybeSingle()
    if (caseData) {
      setIssue({ ...caseData, isCase: true })
      setLoading(false)
      return
    }
    const { data: issueData } = await supabase
      .from('issues')
      .select('*, profiles!issues_created_by_fkey(name), assets(equipment_name, asset_tag)')
      .eq('id', id)
      .maybeSingle()
    setIssue(issueData)
    setLoading(false)
  }

  async function fetchPhotos() {
    if (!id) return
    const { data } = await supabase
      .from('photos')
      .select('*')
      .eq('issue_id', id)
      .order('created_at', { ascending: false })
    setPhotos(data || [])
  }

  async function fetchComments() {
    if (!id) return
    const { data } = await supabase
      .from('comments')
      .select('*, profiles(name)')
      .eq('issue_id', id)
      .order('created_at', { ascending: true })
    setComments(data || [])
  }

  async function fetchSourceLink() {
    if (!id) return
    const { data } = await supabase
      .from('case_source_links')
      .select('*, asset_chat_messages(body, created_at, profiles(name)), asset_board_posts(body, created_at, profiles(name))')
      .eq('case_id', id)
      .maybeSingle()
    setSourceLink(data)
  }

  async function handleAddComment(e: React.FormEvent) {
    e.preventDefault()
    if (!newComment.trim() || !id) return
    setSubmitting(true)

    const { error } = await supabase.from('comments').insert({
      issue_id: id,
      content: newComment,
    })

    setSubmitting(false)
    if (error) return
    setNewComment('')
    fetchComments()
  }

  async function updateStatus(status: string) {
    if (!id) return
    const updates: any = { status, updated_at: new Date().toISOString() }
    if (status === 'closed') {
      updates.closed_at = new Date().toISOString()
      if (issue?.isCase) updates.resolved_at = new Date().toISOString()
    }
    if (status === 'resolved' && issue?.isCase) {
      updates.resolved_at = new Date().toISOString()
    }
    if (!issue?.isCase) {
      if (status === 'verified') updates.verified_by = profile?.id
      if (status === 'closed') { updates.closed_date = new Date().toISOString() }
    }

    await supabase.from(issue?.isCase ? 'cases' : 'issues').update(updates).eq('id', id)
    fetchIssue()
  }

  function startEditing() {
    setEditDesc(issue.isCase ? (issue.title || '') : (issue.description || ''))
    setEditPriority(issue.priority || 'medium')
    setEditCategory(issue.category || '')
    setEditDueDate(issue.due_date ? issue.due_date.split('T')[0] : '')
    setEditResolution(issue.resolution_notes || '')
    setEditAssignedTo(issue.assigned_to || '')
    setEditing(true)
  }

  async function handleSaveEdit() {
    if (!id) return
    setSaving(true)
    if (issue?.isCase) {
      await supabase
        .from('cases')
        .update({
          title: editDesc.trim(),
          priority: editPriority,
          resolution_notes: editResolution.trim() || null,
          assigned_to: editAssignedTo || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
    } else {
      await supabase
        .from('issues')
        .update({
          description: editDesc.trim(),
          priority: editPriority,
          category: editCategory.trim() || null,
          due_date: editDueDate || null,
          resolution_notes: editResolution.trim() || null,
          assigned_to: editAssignedTo || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
    }
    await fetchIssue()
    setSaving(false)
    setEditing(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary-200 border-t-primary-500 rounded-full animate-spin" />
      </div>
    )
  }

  if (!issue) {
    return (
      <div className="p-4 text-center">
        <p className="text-neutral-500">Case not found.</p>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto bg-neutral-50 min-h-screen">
      <div className="sticky top-0 z-10 bg-white border-b border-neutral-200 px-4 py-3 shadow-sm">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-1 hover:bg-neutral-100 rounded-lg">
            <ArrowLeft size={20} />
          </button>
          <div className="flex-1">
            <h1 className="text-base font-semibold text-neutral-900">Case Detail</h1>
          </div>
          {!editing && (
            <button
              onClick={startEditing}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-primary-700 bg-primary-50 rounded-xl hover:bg-primary-100 transition-colors"
            >
              <Pencil size={14} />
              Edit
            </button>
          )}
          <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${getPriorityColor(issue.priority)}`}>
            {issue.priority}
          </span>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Case Info */}
        <div className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm">
          {editing ? (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-neutral-600 mb-1">Description</label>
                <textarea
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 bg-white border border-neutral-200 rounded-xl text-sm text-neutral-900 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-primary-400/40 focus:border-primary-400 resize-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-neutral-600 mb-1">Priority</label>
                  <select
                    value={editPriority}
                    onChange={(e) => setEditPriority(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-neutral-200 rounded-xl text-sm text-neutral-900 focus:outline-none focus:ring-2 focus:ring-primary-400/40 focus:border-primary-400"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-600 mb-1">Category</label>
                  <input
                    type="text"
                    value={editCategory}
                    onChange={(e) => setEditCategory(e.target.value)}
                    placeholder="e.g. Electrical, Plumbing"
                    className="w-full px-3 py-2 bg-white border border-neutral-200 rounded-xl text-sm text-neutral-900 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-primary-400/40 focus:border-primary-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-600 mb-1">Due Date</label>
                  <input
                    type="date"
                    value={editDueDate}
                    onChange={(e) => setEditDueDate(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-neutral-200 rounded-xl text-sm text-neutral-900 focus:outline-none focus:ring-2 focus:ring-primary-400/40 focus:border-primary-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-600 mb-1">Assigned To</label>
                  <select
                    value={editAssignedTo}
                    onChange={(e) => setEditAssignedTo(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-neutral-200 rounded-xl text-sm text-neutral-900 focus:outline-none focus:ring-2 focus:ring-primary-400/40 focus:border-primary-400"
                  >
                    <option value="">Unassigned</option>
                    {members.map((m: any) => (
                      <option key={m.user_id} value={m.user_id}>
                        {m.profiles?.name || 'Unknown'}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-600 mb-1">Resolution Notes</label>
                <textarea
                  value={editResolution}
                  onChange={(e) => setEditResolution(e.target.value)}
                  rows={2}
                  placeholder="Notes on how the case was resolved..."
                  className="w-full px-3 py-2 bg-white border border-neutral-200 rounded-xl text-sm text-neutral-900 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-primary-400/40 focus:border-primary-400 resize-none"
                />
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={handleSaveEdit}
                  disabled={saving || !editDesc.trim()}
                  className="px-4 py-2 bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-600 hover:to-primary-700 text-white rounded-xl text-sm font-medium disabled:opacity-50 shadow-md shadow-primary-200"
                >
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
                <button
                  onClick={() => setEditing(false)}
                  className="px-4 py-2 bg-neutral-200 text-neutral-700 rounded-xl text-sm font-medium hover:bg-neutral-300"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="text-sm text-neutral-900 font-medium">{issue.isCase ? issue.title : issue.description}</p>
              {issue.isCase && issue.description && issue.description !== issue.title && (
                <p className="text-sm text-neutral-600 mt-1">{issue.description}</p>
              )}
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-neutral-600">
                <div>
                  <span className="font-medium text-neutral-800">Asset:</span> {issue.assets?.equipment_name || issue.assets?.asset_tag}
                </div>
                <div>
                  <span className="font-medium text-neutral-800">Status:</span>{' '}
                  <span className={`px-1.5 py-0.5 rounded ${getIssueStatusColor(issue.status)}`}>{issue.status}</span>
                </div>
                <div>
                  <span className="font-medium text-neutral-800">Created by:</span> {issue.profiles?.name}
                </div>
                <div>
                  <span className="font-medium text-neutral-800">Created:</span> {new Date(issue.created_at).toLocaleDateString()}
                </div>
                {issue.category && (
                  <div>
                    <span className="font-medium text-neutral-800">Category:</span> {issue.category}
                  </div>
                )}
                {issue.due_date && (
                  <div>
                    <span className="font-medium text-neutral-800">Due:</span> {new Date(issue.due_date).toLocaleDateString()}
                  </div>
                )}
                {issue.resolution_notes && (
                  <div className="col-span-2">
                    <span className="font-medium text-neutral-800">Resolution:</span> {issue.resolution_notes}
                  </div>
                )}
              </div>
              {sourceLink && (
                <div className="mt-3 bg-sky-50 border border-sky-200 rounded-xl p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Link2 size={14} className="text-sky-600" />
                    <span className="text-xs font-semibold text-sky-800">
                      Originated from {sourceLink.source_type === 'chat_message' ? 'Chat Message' : 'Message Board Post'}
                    </span>
                  </div>
                  {sourceLink.source_type === 'chat_message' && sourceLink.asset_chat_messages?.[0] && (
                    <p className="text-xs text-sky-700 ml-6">“{sourceLink.asset_chat_messages[0].body.slice(0, 120)}{sourceLink.asset_chat_messages[0].body.length > 120 ? '…' : ''}”</p>
                  )}
                  {sourceLink.source_type === 'board_post' && sourceLink.asset_board_posts?.[0] && (
                    <p className="text-xs text-sky-700 ml-6">“{sourceLink.asset_board_posts[0].body.slice(0, 120)}{sourceLink.asset_board_posts[0].body.length > 120 ? '…' : ''}”</p>
                  )}
                  {sourceLink.asset_id && (
                    <a href={`/assets/${sourceLink.asset_id}`} className="text-xs text-sky-600 hover:text-sky-700 ml-6 inline-flex items-center gap-1 mt-1">
                      <MapPin size={12} /> View asset
                    </a>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Status Actions */}
        <div className="flex gap-2 flex-wrap">
          {issue.status === 'open' && (
            <button onClick={() => updateStatus('in_progress')} className="px-3 py-1.5 bg-primary-50 text-primary-700 rounded-xl text-xs font-medium hover:bg-primary-100">
              Mark In Progress
            </button>
          )}
          {(issue.status === 'open' || issue.status === 'in_progress') && (
            <button onClick={() => updateStatus('resolved')} className="px-3 py-1.5 bg-success-50 text-success-700 rounded-xl text-xs font-medium hover:bg-success-100">
              Mark Resolved
            </button>
          )}
          {issue.status === 'resolved' && !issue.isCase && (
            <button onClick={() => updateStatus('verified')} className="px-3 py-1.5 bg-success-50 text-success-700 rounded-xl text-xs font-medium hover:bg-success-100">
              Verify & Close
            </button>
          )}
          {issue.status !== 'closed' && (
            <button onClick={() => updateStatus('closed')} className="px-3 py-1.5 bg-neutral-200 text-neutral-700 rounded-xl text-xs font-medium hover:bg-neutral-300">
              Close
            </button>
          )}
        </div>

        {/* Photos */}
        {photos.length > 0 && (
          <div className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-neutral-900 mb-3 flex items-center gap-2">
              <Camera size={16} />
              Photos ({photos.length})
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {photos.map((photo: any) => (
                <div key={photo.id} className="aspect-square rounded-xl overflow-hidden bg-neutral-200">
                  <img
                    src={`${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/photos/${photo.storage_path}`}
                    alt={photo.caption || 'Case photo'}
                    className="w-full h-full object-cover"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Comments */}
        <div className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-neutral-900 mb-3 flex items-center gap-2">
            <MessageSquare size={16} />
            Comments ({comments.length})
          </h3>

          {comments.length > 0 && (
            <div className="space-y-3 mb-4">
              {comments.map(c => (
                <div key={c.id} className="border-b border-neutral-200 pb-3 last:border-0 last:pb-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium text-neutral-900">{c.profiles?.name}</span>
                    <span className="text-xs text-neutral-500">{new Date(c.created_at).toLocaleDateString()}</span>
                  </div>
                  <p className="text-sm text-neutral-800">{c.content}</p>
                </div>
              ))}
            </div>
          )}

          <form onSubmit={handleAddComment} className="flex gap-2">
            <input
              type="text"
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              placeholder="Add a comment..."
              className="flex-1 px-3 py-2 bg-white border border-neutral-200 rounded-xl text-sm text-neutral-900 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-primary-400/40 focus:border-primary-400"
            />
            <button
              type="submit"
              disabled={submitting || !newComment.trim()}
              className="px-4 py-2 bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-600 hover:to-primary-700 text-white rounded-xl text-sm font-medium disabled:opacity-50 shadow-md shadow-primary-200"
            >
              Send
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

function getPriorityColor(priority: string): string {
  const colors: Record<string, string> = {
    low: 'bg-neutral-100 text-neutral-700',
    medium: 'bg-warning-50 text-warning-700',
    high: 'bg-error-50 text-error-700',
    critical: 'bg-error-50 text-error-700',
  }
  return colors[priority] || 'bg-neutral-100 text-neutral-700'
}

function getIssueStatusColor(status: string): string {
  const colors: Record<string, string> = {
    open: 'bg-error-50 text-error-700',
    in_progress: 'bg-primary-50 text-primary-700',
    resolved: 'bg-success-50 text-success-700',
    verified: 'bg-success-50 text-success-700',
    closed: 'bg-neutral-100 text-neutral-700',
  }
  return colors[status] || 'bg-neutral-100 text-neutral-700'
}
