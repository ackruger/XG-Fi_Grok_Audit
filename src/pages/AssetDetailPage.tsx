import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Plus, AlertTriangle, Camera, Clock, User, QrCode, Download, X, Pencil, StickyNote, Send, Trash2, Upload, MessageCircle, Zap, Wrench, Link2, FileText, Settings, Copy, Check, ShieldAlert, ListChecks, Map, ChevronRight, MoreHorizontal, Lock } from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { Asset, Event, Issue, Photo, AssetNote, Tag, ActivityPost, LotoRecord, Case } from '../types'
import AddUpdateModal from '../components/AddUpdateModal'
import CreateIssueModal from '../components/CreateIssueModal'
import EditAssetModal from '../components/EditAssetModal'
import TechnicalSection from '../components/asset-detail/TechnicalSection'
import ServiceSection from '../components/asset-detail/ServiceSection'
import ElectricalSection from '../components/asset-detail/ElectricalSection'
import RelationshipsSection from '../components/asset-detail/RelationshipsSection'
import DocumentsSection from '../components/asset-detail/DocumentsSection'
import LotoSection from '../components/asset-detail/LotoSection'
import ChecklistSection from '../components/asset-detail/ChecklistSection'
import ChatSection from '../components/asset-detail/ChatSection'
import PlansSection from '../components/asset-detail/PlansSection'
import { getAssetDeepLink } from '../lib/appUrl'

const PRIMARY_ACTIONS = [
  { key: 'overview', label: 'Details', icon: Settings },
  { key: 'checklist', label: 'Checklist', icon: ListChecks },
  { key: 'plans', label: 'Plan View', icon: Map },
  { key: 'chat', label: 'Chat', icon: MessageCircle },
  { key: 'activity', label: 'Activity', icon: Clock },
] as const

const SECONDARY_MENUS = [
  { key: 'technical', label: 'Technical', icon: Wrench },
  { key: 'service', label: 'Service', icon: Settings },
  { key: 'electrical', label: 'Electrical', icon: Zap },
  { key: 'relationships', label: 'Relationships', icon: Link2 },
  { key: 'documents', label: 'Documents', icon: FileText },
  { key: 'cases', label: 'Cases', icon: AlertTriangle },
] as const

const MORE_MENUS = [
  { key: 'forms', label: 'Forms', icon: FileText },
  { key: 'records', label: 'Records', icon: FileText },
  { key: 'contracts', label: 'Contracts', icon: FileText },
  { key: 'engineering', label: 'Engineering', icon: Wrench },
  { key: 'drawings', label: 'Drawings', icon: FileText },
] as const

type SectionKey = typeof PRIMARY_ACTIONS[number]['key'] | typeof SECONDARY_MENUS[number]['key'] | typeof MORE_MENUS[number]['key'] | 'loto'

export default function AssetDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [asset, setAsset] = useState<Asset | null>(null)
  const [events, setEvents] = useState<Event[]>([])
  const [issues, setIssues] = useState<Issue[]>([])
  const [cases, setCases] = useState<Case[]>([])
  const [photos, setPhotos] = useState<Photo[]>([])
  const [notes, setNotes] = useState<AssetNote[]>([])
  const [assetTags, setAssetTags] = useState<Tag[]>([])
  const [location, setLocation] = useState<any>(null)
  const [systemName, setSystemName] = useState<string | null>(null)
  const [lotoRecords, setLotoRecords] = useState<LotoRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [activeSection, setActiveSection] = useState<SectionKey>('overview')
  const [activityTab, setActivityTab] = useState<'timeline' | 'activity' | 'issues' | 'photos' | 'notes'>('timeline')
  const [showUpdateModal, setShowUpdateModal] = useState(false)
  const [showIssueModal, setShowIssueModal] = useState(false)
  const [showQRModal, setShowQRModal] = useState(false)
  const [showMoreMenu, setShowMoreMenu] = useState(false)
  const [nfcCopied, setNfcCopied] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [newNote, setNewNote] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [editingNoteContent, setEditingNoteContent] = useState('')
  const [uploadingPhotos, setUploadingPhotos] = useState(false)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const [activityPosts, setActivityPosts] = useState<ActivityPost[]>([])
  const [newActivity, setNewActivity] = useState('')
  const [postingActivity, setPostingActivity] = useState(false)
  const [canEdit, setCanEdit] = useState(false)

  async function fetchAsset() {
    if (!id) return
    const { data } = await supabase.from('assets').select('*').eq('id', id).maybeSingle()
    if (data) {
      setAsset(data)
      if (data.location_id) {
        const { data: loc } = await supabase.from('locations').select('*').eq('id', data.location_id).maybeSingle()
        setLocation(loc)
      }
      if (data.system_id) {
        const { data: sys } = await supabase.from('systems').select('name').eq('id', data.system_id).maybeSingle()
        setSystemName(sys?.name || null)
      } else {
        setSystemName(null)
      }
    }
    setLoading(false)
  }

  async function fetchEvents() {
    if (!id) return
    const { data } = await supabase.from('events').select('*, profiles!events_user_id_fkey(name)')
      .eq('asset_id', id).order('timestamp', { ascending: false }).limit(50)
    setEvents(data || [])
  }

  async function fetchIssues() {
    if (!id) return
    const { data } = await supabase.from('issues').select('*, profiles!issues_created_by_fkey(name)')
      .eq('asset_id', id).is('deleted_at', null).order('created_at', { ascending: false })
    setIssues(data || [])
  }

  async function fetchCases() {
    if (!id) return
    const { data } = await supabase.from('cases').select('*, profiles!cases_created_by_fkey(name)')
      .eq('asset_id', id).is('deleted_at', null).order('created_at', { ascending: false })
    setCases(data || [])
  }

  async function fetchPhotos() {
    if (!id) return
    const { data } = await supabase.from('photos').select('*')
      .eq('asset_id', id).order('created_at', { ascending: false })
    setPhotos(data || [])
  }

  async function fetchNotes() {
    if (!id) return
    const { data } = await supabase.from('asset_notes').select('*, profiles!asset_notes_user_id_fkey(name)')
      .eq('asset_id', id).order('created_at', { ascending: false })
    setNotes(data || [])
  }

  async function fetchActivityPosts() {
    if (!id) return
    const { data } = await supabase.from('activity_posts').select('*, profiles(name)')
      .eq('asset_id', id).order('created_at', { ascending: false }).limit(50)
    setActivityPosts((data as any[]) || [])
  }

  async function fetchAssetTags() {
    if (!id) return
    const { data } = await supabase.from('asset_tags').select('*, tags(*)').eq('asset_id', id)
    if (data) setAssetTags(data.map((at: any) => at.tags).filter(Boolean))
  }

  async function fetchLoto() {
    if (!id) return
    const { data } = await supabase.from('loto_records')
      .select('*').eq('asset_id', id).eq('status', 'active').order('applied_at', { ascending: false })
    setLotoRecords((data as LotoRecord[]) || [])
  }

  useEffect(() => {
    fetchAsset(); fetchEvents(); fetchIssues(); fetchCases(); fetchPhotos(); fetchNotes(); fetchAssetTags(); fetchActivityPosts(); fetchLoto()
  }, [id])

  useEffect(() => {
    if (!asset) return
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase.from('facility_members').select('role')
        .eq('facility_id', asset.facility_id).eq('user_id', user.id).maybeSingle()
      if (data) setCanEdit(['contributor', 'reviewer', 'supervisor', 'admin'].includes(data.role))
    })()
  }, [asset?.facility_id])

  async function handlePostActivity(e: React.FormEvent) {
    e.preventDefault()
    if (!newActivity.trim() || !id || !asset) return
    setPostingActivity(true)
    const { error } = await supabase.from('activity_posts').insert({ facility_id: asset.facility_id, asset_id: id, message: newActivity.trim() })
    if (!error) { setNewActivity(''); fetchActivityPosts() }
    setPostingActivity(false)
  }

  async function handleAddNote() {
    if (!newNote.trim() || !id) return
    setSavingNote(true)
    const { error } = await supabase.from('asset_notes').insert({ asset_id: id, content: newNote.trim() })
    if (!error) { setNewNote(''); fetchNotes() }
    setSavingNote(false)
  }

  async function handleUpdateNote(noteId: string) {
    if (!editingNoteContent.trim()) return
    const { error } = await supabase.from('asset_notes')
      .update({ content: editingNoteContent.trim(), updated_at: new Date().toISOString() }).eq('id', noteId)
    if (!error) { setEditingNoteId(null); setEditingNoteContent(''); fetchNotes() }
  }

  async function handleDeleteNote(noteId: string) {
    const { error } = await supabase.from('asset_notes').delete().eq('id', noteId)
    if (!error) fetchNotes()
  }

  async function handleCopyNfcUrl() {
    if (!asset?.qr_code_id) return
    const url = getAssetDeepLink(asset.qr_code_id)
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(url)
      } else {
        const textArea = document.createElement('textarea')
        textArea.value = url
        textArea.style.position = 'fixed'
        textArea.style.opacity = '0'
        document.body.appendChild(textArea)
        textArea.focus()
        textArea.select()
        document.execCommand('copy')
        document.body.removeChild(textArea)
      }
      setNfcCopied(true)
      window.setTimeout(() => setNfcCopied(false), 2000)
    } catch (error) {
      console.error('Failed to copy NFC URL:', error)
    }
  }

  async function handleDirectPhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    if (!e.target.files || e.target.files.length === 0 || !asset) return
    setUploadingPhotos(true)
    for (const file of Array.from(e.target.files)) {
      const path = `${asset.facility_id}/${asset.id}/${Date.now()}_${file.name}`
      const { error: uploadErr } = await supabase.storage.from('photos').upload(path, file)
      if (!uploadErr) await supabase.from('photos').insert({ asset_id: asset.id, storage_path: path, caption: '' })
    }
    e.target.value = ''
    setUploadingPhotos(false)
    fetchPhotos()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary-200 border-t-primary-500 rounded-full animate-spin" />
      </div>
    )
  }

  if (!asset) {
    return (
      <div className="p-4 text-center">
        <p className="text-neutral-500">Asset not found.</p>
        <button onClick={() => navigate(-1)} className="text-primary-600 text-sm mt-2">Go back</button>
      </div>
    )
  }

  const openIssues = issues.filter(i => i.status !== 'closed' && i.status !== 'verified')
  const activeLoto = lotoRecords.filter(r => r.status === 'active')
  const hasFormalLoto = activeLoto.some(r => r.loto_type === 'formal_loto')

  return (
    <div className="max-w-4xl mx-auto bg-neutral-50 min-h-screen">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white border-b border-neutral-200 px-4 py-3 shadow-sm">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-1 hover:bg-neutral-100 rounded-lg"><ArrowLeft size={20} /></button>
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-semibold text-neutral-900 truncate">{asset.equipment_name || asset.asset_tag}</h1>
            <p className="text-xs text-neutral-500">
              {asset.asset_tag && <span className="font-mono mr-2">{asset.asset_tag}</span>}
              {asset.alias && <span className="mr-2">aka {asset.alias}</span>}
              {asset.equipment_type && <span>{asset.equipment_type}</span>}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {asset.operational_status !== 'active' && (
              <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-warning-50 text-warning-700">{asset.operational_status.replace(/_/g, ' ')}</span>
            )}
            <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${getStatusColor(asset.status)}`}>{formatStatus(asset.status)}</span>
          </div>
        </div>
      </div>

      {/* LOTO prominent banner */}
      {activeLoto.length > 0 && (
        <div className={`px-4 py-3 ${hasFormalLoto ? 'bg-error-50 border-b-2 border-error-200' : 'bg-warning-50 border-b border-warning-200'}`}>
          <div className="flex items-center gap-2">
            <ShieldAlert size={20} className={hasFormalLoto ? 'text-error-600' : 'text-warning-600'} />
            <div className="flex-1">
              <p className={`text-sm font-semibold ${hasFormalLoto ? 'text-error-700' : 'text-warning-700'}`}>
                {activeLoto.length} Active Lock-Out{activeLoto.length > 1 ? 's' : ''}
              </p>
              {activeLoto[0] && (
                <p className="text-xs text-neutral-600 mt-0.5">
                  Applied by {activeLoto[0].applied_by_contact || 'user'} on {new Date(activeLoto[0].applied_at).toLocaleDateString()}
                </p>
              )}
            </div>
            <button onClick={() => setActiveSection('loto')}
              className={`text-xs font-medium ${hasFormalLoto ? 'text-error-600' : 'text-warning-700'} flex items-center gap-1`}>
              View <ChevronRight size={14} />
            </button>
          </div>
          {hasFormalLoto && (
            <p className="text-xs text-error-600 mt-1 ml-7">This application record does NOT authorize physical lock removal.</p>
          )}
        </div>
      )}

      {/* Quick Actions */}
      <div className="px-4 py-3 flex gap-2">
        <button onClick={() => setShowUpdateModal(true)}
          className="flex-1 flex items-center justify-center gap-2 bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-600 hover:to-primary-700 text-white py-2.5 rounded-xl text-sm font-medium shadow-md shadow-primary-200">
          <Plus size={16} /> Add Update
        </button>
        <button onClick={() => setShowQRModal(true)}
          className="flex items-center justify-center gap-2 bg-neutral-100 text-neutral-700 px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-neutral-200">
          <QrCode size={16} /> QR
        </button>
        <button onClick={() => { void handleCopyNfcUrl() }} disabled={!asset.qr_code_id}
          title={asset.qr_code_id ? 'Copy NFC asset URL' : 'Assign a QR code before using NFC'}
          className="flex items-center justify-center gap-2 bg-neutral-100 text-neutral-700 px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-neutral-200 disabled:opacity-50 disabled:cursor-not-allowed">
          {nfcCopied ? <Check size={16} className="text-emerald-600" /> : <Copy size={16} />}
          {nfcCopied ? 'Copied' : 'NFC'}
        </button>
        <button onClick={() => setShowIssueModal(true)}
          className="flex items-center justify-center gap-2 bg-error-50 text-error-700 px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-error-100">
          <AlertTriangle size={16} /> Case
        </button>
      </div>

      {/* Primary Actions Navigation */}
      <div className="px-4 mb-2">
        <div className="flex gap-1 overflow-x-auto scrollbar-hide pb-1">
          {PRIMARY_ACTIONS.map(a => (
            <button key={a.key} onClick={() => setActiveSection(a.key as SectionKey)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg whitespace-nowrap transition-colors ${
                activeSection === a.key ? 'bg-primary-50 text-primary-700 border border-primary-200' : 'text-neutral-600 hover:bg-neutral-100 border border-transparent'
              }`}>
              <a.icon size={14} /> {a.label}
            </button>
          ))}
        </div>
      </div>

      {/* Secondary + More menus */}
      <div className="px-4 mb-3">
        <div className="flex gap-1 overflow-x-auto scrollbar-hide pb-1">
          {SECONDARY_MENUS.map(m => (
            <button key={m.key} onClick={() => setActiveSection(m.key as SectionKey)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap transition-colors ${
                activeSection === m.key ? 'bg-neutral-100 text-neutral-900 border border-neutral-200' : 'text-neutral-500 hover:bg-neutral-50'
              }`}>
              <m.icon size={13} /> {m.label}
            </button>
          ))}
          <button onClick={() => setShowMoreMenu(!showMoreMenu)}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg text-neutral-500 hover:bg-neutral-50">
            <MoreHorizontal size={13} /> More
          </button>
        </div>
        {showMoreMenu && (
          <div className="mt-1 bg-white border border-neutral-200 rounded-xl shadow-lg p-1.5 flex gap-1 flex-wrap">
            {MORE_MENUS.map(m => (
              <button key={m.key} onClick={() => { setActiveSection(m.key as SectionKey); setShowMoreMenu(false) }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg text-neutral-600 hover:bg-neutral-50">
                <m.icon size={13} /> {m.label}
              </button>
            ))}
            <button onClick={() => setActiveSection('loto')}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg text-neutral-600 hover:bg-neutral-50">
              <Lock size={13} /> LOTO
            </button>
          </div>
        )}
      </div>

      {/* Section Content */}
      <div className="px-4 pb-8">
        {activeSection === 'overview' && (
          <OverviewSection asset={asset} location={location} systemName={systemName} assetTags={assetTags} openIssues={openIssues}
            activeLoto={activeLoto} onEdit={() => setShowEditModal(true)} />
        )}

        {activeSection === 'checklist' && (
          <ChecklistSection assetId={asset.id} facilityId={asset.facility_id} canEdit={canEdit} />
        )}

        {activeSection === 'plans' && (
          <PlansSection assetId={asset.id} facilityId={asset.facility_id} canEdit={canEdit} />
        )}

        {activeSection === 'chat' && (
          <ChatSection assetId={asset.id} facilityId={asset.facility_id} canEdit={canEdit} />
        )}

        {activeSection === 'loto' && (
          <LotoSection assetId={asset.id} facilityId={asset.facility_id} canEdit={canEdit} />
        )}

        {activeSection === 'technical' && (
          <div className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm">
            <TechnicalSection assetId={asset.id} assetTypeId={asset.asset_type_id} canEdit={canEdit} />
          </div>
        )}

        {activeSection === 'service' && (
          <div className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm">
            <ServiceSection assetId={asset.id} assetTypeId={asset.asset_type_id} canEdit={canEdit} />
          </div>
        )}

        {activeSection === 'electrical' && (
          <div className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm">
            <ElectricalSection assetId={asset.id} assetTypeId={asset.asset_type_id} canEdit={canEdit} />
          </div>
        )}

        {activeSection === 'relationships' && (
          <div className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm">
            <RelationshipsSection assetId={asset.id} facilityId={asset.facility_id} canEdit={canEdit} />
          </div>
        )}

        {activeSection === 'documents' && (
          <div className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm">
            <DocumentsSection assetId={asset.id} facilityId={asset.facility_id} canEdit={canEdit} />
          </div>
        )}

        {activeSection === 'cases' && (
          <div className="space-y-3">
            {cases.length === 0 ? (
              <div className="text-center py-12 text-neutral-500">
                <AlertTriangle size={32} className="mx-auto mb-2" />
                <p className="text-sm">No cases reported</p>
                <p className="text-xs mt-1 text-neutral-400">Create a case from chat, board, or the Case button above</p>
              </div>
            ) : cases.map((c) => (
              <button key={c.id} onClick={() => navigate(`/cases/${c.id}`)}
                className="w-full text-left bg-white rounded-2xl border border-neutral-200 p-4 hover:border-primary-400 transition-colors shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-neutral-900">{c.title}</p>
                    <p className="text-xs text-neutral-500 mt-1">
                      {c.profiles?.name} &middot; {new Date(c.created_at).toLocaleDateString()}
                    </p>
                    <span className="inline-block mt-1 text-xs px-2 py-0.5 rounded-full font-medium bg-primary-50 text-primary-700">
                      {c.case_type === 'work_order' ? 'Work Order' : c.case_type.charAt(0).toUpperCase() + c.case_type.slice(1)}
                    </span>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${getPriorityColor(c.priority)}`}>{c.priority}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${getCaseStatusColor(c.status)}`}>{c.status.replace(/_/g, ' ')}</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        {['forms', 'records', 'contracts', 'engineering', 'drawings'].includes(activeSection) && (
          <DocumentCategoryView assetId={asset.id} facilityId={asset.facility_id} category={activeSection as 'forms' | 'records' | 'contracts' | 'engineering' | 'drawings'} canEdit={canEdit} />
        )}

        {activeSection === 'activity' && (
          <ActivitySection
            activityTab={activityTab} setActivityTab={setActivityTab}
            events={events} issues={issues} photos={photos} notes={notes}
            activityPosts={activityPosts} openIssues={openIssues}
            newActivity={newActivity} setNewActivity={setNewActivity}
            postingActivity={postingActivity} handlePostActivity={handlePostActivity}
            newNote={newNote} setNewNote={setNewNote} savingNote={savingNote}
            handleAddNote={handleAddNote} editingNoteId={editingNoteId}
            setEditingNoteId={setEditingNoteId} editingNoteContent={editingNoteContent}
            setEditingNoteContent={setEditingNoteContent} handleUpdateNote={handleUpdateNote}
            handleDeleteNote={handleDeleteNote} handleDirectPhotoUpload={handleDirectPhotoUpload}
            uploadingPhotos={uploadingPhotos} photoInputRef={photoInputRef}
            navigate={navigate} asset={asset}
          />
        )}
      </div>

      {showUpdateModal && <AddUpdateModal asset={asset} onClose={() => setShowUpdateModal(false)} onComplete={() => { setShowUpdateModal(false); fetchAsset(); fetchEvents() }} />}
      {showIssueModal && <CreateIssueModal asset={asset} onClose={() => setShowIssueModal(false)} onComplete={() => { setShowIssueModal(false); fetchIssues(); fetchCases(); fetchEvents(); fetchPhotos() }} />}
      {showQRModal && <QRCodeModal asset={asset} onClose={() => setShowQRModal(false)} onAssigned={() => { setShowQRModal(false); fetchAsset() }} />}
      {showEditModal && <EditAssetModal asset={asset} onClose={() => setShowEditModal(false)} onComplete={() => { setShowEditModal(false); fetchAsset(); fetchAssetTags() }} />}
    </div>
  )
}

/* ─── Overview Section (rebuilt with Ver2 fields) ──────────────────── */
function OverviewSection({ asset, location, systemName, assetTags, openIssues, activeLoto, onEdit }: {
  asset: Asset; location: any; systemName: string | null; assetTags: Tag[]; openIssues: Issue[]; activeLoto: LotoRecord[]; onEdit: () => void
}) {
  const infoGroups = [
    {
      title: 'Identification',
      rows: [
        { label: 'Asset ID', value: asset.asset_tag },
        { label: 'Alias', value: asset.alias },
        { label: 'Asset Type', value: asset.equipment_type },
        { label: 'Identification Status', value: asset.identification_status.replace(/_/g, ' ') },
        { label: 'Source', value: asset.source_section },
      ].filter(r => r.value),
    },
    {
      title: 'System & Location',
      rows: [
        { label: 'System Served', value: asset.system_served || systemName },
        { label: 'Area Served', value: asset.area_served },
        { label: 'Building', value: location?.building },
        { label: 'Floor / Level', value: location?.floor || asset.level },
        { label: 'Room / Area', value: location?.room_area },
        { label: 'Zone', value: asset.zone || location?.zone },
        { label: 'Space', value: asset.space || location?.space },
        { label: 'Gridline', value: asset.gridline || location?.gridline },
      ].filter(r => r.value),
    },
    {
      title: 'BIM Coordinates',
      rows: [
        { label: 'X', value: asset.bim_x != null ? asset.bim_x.toFixed(2) : null },
        { label: 'Y', value: asset.bim_y != null ? asset.bim_y.toFixed(2) : null },
        { label: 'Z', value: asset.bim_z != null ? asset.bim_z.toFixed(2) : null },
      ].filter(r => r.value),
    },
    {
      title: 'Status & Lifecycle',
      rows: [
        { label: 'Operational Status', value: asset.operational_status.replace(/_/g, ' ') },
        { label: 'Lifecycle Stage', value: asset.lifecycle_stage?.replace(/_/g, ' ') },
        { label: 'Checklist Focus', value: asset.checklist_focus?.replace(/_/g, ' ') },
        { label: 'Criticality', value: asset.criticality },
      ].filter(r => r.value),
    },
    {
      title: 'Trades',
      rows: asset.trades && asset.trades.length > 0 ? [{ label: 'Trades', value: asset.trades.join(', ') }] : [],
    },
    {
      title: 'Equipment Details',
      rows: [
        { label: 'Manufacturer', value: asset.manufacturer },
        { label: 'Model', value: asset.model },
        { label: 'Serial Number', value: asset.serial_number },
        { label: 'Drawing Reference', value: asset.drawing_reference },
        { label: 'Specification Section', value: asset.spec_section },
      ].filter(r => r.value),
    },
  ]

  return (
    <div className="space-y-3">
      {/* LOTO summary card */}
      {activeLoto.length > 0 && (
        <div className={`rounded-2xl border p-4 ${activeLoto.some(r => r.loto_type === 'formal_loto') ? 'bg-error-50 border-error-200' : 'bg-warning-50 border-warning-200'}`}>
          <div className="flex items-center gap-2">
            <ShieldAlert size={20} className={activeLoto.some(r => r.loto_type === 'formal_loto') ? 'text-error-600' : 'text-warning-600'} />
            <div>
              <p className={`text-sm font-semibold ${activeLoto.some(r => r.loto_type === 'formal_loto') ? 'text-error-700' : 'text-warning-700'}`}>
                {activeLoto.length} Active Lock-Out{activeLoto.length > 1 ? 's' : ''}
              </p>
              <p className="text-xs text-neutral-600 mt-0.5">
                {activeLoto.map(r => r.loto_type === 'formal_loto' ? 'Formal LOTO' : 'General Lock-Out').join(', ')}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-neutral-700 uppercase tracking-wide">Overview</h3>
          <button onClick={onEdit}
            className="flex items-center gap-1.5 text-xs font-medium text-primary-600 hover:text-primary-700 px-2 py-1 rounded-lg hover:bg-primary-50">
            <Pencil size={13} /> Edit
          </button>
        </div>
        <div className="space-y-4">
          {infoGroups.map(group => group.rows.length > 0 && (
            <div key={group.title}>
              <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-2">{group.title}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {group.rows.map(r => (
                  <div key={r.label}>
                    <p className="text-neutral-500 text-xs">{r.label}</p>
                    <p className="text-neutral-900 text-sm font-medium">{r.value}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {asset.qr_code_id ? (
          <div className="mt-3 pt-3 border-t border-neutral-100">
            <p className="text-neutral-500 text-xs">QR Code</p>
            <p className="text-neutral-500 text-xs font-mono mt-0.5">{asset.qr_code_id}</p>
          </div>
        ) : (
          <div className="mt-3 pt-3 border-t border-neutral-100">
            <p className="text-xs text-amber-600 font-medium">No QR assigned</p>
          </div>
        )}

        {asset.notes && (
          <div className="mt-3 pt-3 border-t border-neutral-100">
            <p className="text-neutral-500 text-xs mb-1">Operational Notes</p>
            <p className="text-sm text-neutral-800 whitespace-pre-wrap">{asset.notes}</p>
          </div>
        )}

        {asset.static_notes && (
          <div className="mt-3 pt-3 border-t border-neutral-100">
            <p className="text-neutral-500 text-xs mb-1">Static Notes (design/spec)</p>
            <p className="text-sm text-neutral-800 whitespace-pre-wrap">{asset.static_notes}</p>
          </div>
        )}

        {assetTags.length > 0 && (
          <div className="mt-3 pt-3 border-t border-neutral-100">
            <p className="text-neutral-500 text-xs mb-1.5">Tags</p>
            <div className="flex flex-wrap gap-1.5">
              {assetTags.map(tag => (
                <span key={tag.id} className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium text-white"
                  style={{ backgroundColor: tag.color }}>{tag.name}</span>
              ))}
            </div>
          </div>
        )}

        {openIssues.length > 0 && (
          <div className="mt-3 pt-3 border-t border-neutral-100">
            <p className="text-xs text-error-700 font-medium">{openIssues.length} open case{openIssues.length > 1 ? 's' : ''}</p>
          </div>
        )}
      </div>
    </div>
  )
}

/* ─── Activity Section (preserved from original) ──────────────────── */
function ActivitySection(props: any) {
  const { activityTab, setActivityTab, events, issues, photos, notes, activityPosts, openIssues,
    newActivity, setNewActivity, postingActivity, handlePostActivity,
    newNote, setNewNote, savingNote, handleAddNote, editingNoteId, setEditingNoteId,
    editingNoteContent, setEditingNoteContent, handleUpdateNote, handleDeleteNote,
    handleDirectPhotoUpload, uploadingPhotos, photoInputRef, navigate } = props

  return (
    <div>
      <div className="flex gap-1 bg-neutral-200 rounded-lg p-1 mb-3 overflow-x-auto">
        {(['timeline', 'activity', 'issues', 'photos', 'notes'] as const).map(tab => (
          <button key={tab} onClick={() => setActivityTab(tab)}
            className={`flex-1 py-2 text-xs font-medium rounded-md whitespace-nowrap px-2 transition-colors ${
              activityTab === tab ? 'bg-white shadow-sm text-neutral-900' : 'text-neutral-600'
            }`}>
            {tab === 'timeline' ? 'Timeline' : tab === 'activity' ? `Posts (${activityPosts.length})` : tab === 'issues' ? `Cases (${openIssues.length})` : tab === 'photos' ? `Photos (${photos.length})` : `Notes (${notes.length})`}
          </button>
        ))}
      </div>

      {activityTab === 'timeline' && (
        <div className="space-y-3">
          {events.length === 0 ? (
            <div className="text-center py-12 text-neutral-500"><Clock size={32} className="mx-auto mb-2" /><p className="text-sm">No activity yet</p></div>
          ) : events.map((event: any) => (
            <div key={event.id} className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 bg-primary-50 rounded-full flex items-center justify-center shrink-0 mt-0.5"><User size={14} className="text-primary-600" /></div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-neutral-900">{event.profiles?.name || 'Unknown'}</p>
                    <span className="text-xs text-neutral-500">{new Date(event.timestamp).toLocaleDateString()} {new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  <p className="text-xs text-primary-600 font-medium mt-0.5">{formatEventType(event.event_type)}</p>
                  <p className="text-sm text-neutral-800 mt-1">{event.raw_note}</p>
                  {event.status_after && event.status_after !== event.status_before && (
                    <div className="mt-2 flex items-center gap-2 text-xs">
                      <span className={`px-2 py-0.5 rounded-full ${getStatusColor(event.status_before || '')}`}>{formatStatus(event.status_before || 'none')}</span>
                      <span className="text-neutral-400">&rarr;</span>
                      <span className={`px-2 py-0.5 rounded-full ${getStatusColor(event.status_after)}`}>{formatStatus(event.status_after)}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {activityTab === 'activity' && (
        <div className="space-y-3">
          <div className="bg-white rounded-2xl border border-neutral-200 p-3 shadow-sm">
            <form onSubmit={handlePostActivity} className="flex gap-2">
              <input type="text" value={newActivity} onChange={(e: any) => setNewActivity(e.target.value)}
                placeholder="What are you working on?"
                className="flex-1 px-3 py-2 bg-neutral-50 border border-neutral-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-300 focus:border-transparent" />
              <button type="submit" disabled={!newActivity.trim() || postingActivity}
                className="px-3 py-2 bg-gradient-to-r from-primary-500 to-primary-600 text-white rounded-xl text-sm font-medium disabled:opacity-50 shadow-md shadow-primary-200">
                <Send size={16} />
              </button>
            </form>
          </div>
          {activityPosts.length === 0 ? (
            <div className="text-center py-12 text-neutral-500"><MessageCircle size={32} className="mx-auto mb-2" /><p className="text-sm">No activity posts yet</p></div>
          ) : activityPosts.map((post: any) => (
            <div key={post.id} className="bg-white rounded-2xl border border-neutral-200 p-3 shadow-sm flex gap-3">
              <div className="w-8 h-8 bg-primary-50 rounded-full flex items-center justify-center shrink-0"><User size={14} className="text-primary-600" /></div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-neutral-900">{post.profiles?.name || 'Unknown'}</span>
                  <span className="text-xs text-neutral-500">{new Date(post.created_at).toLocaleDateString()} {new Date(post.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <p className="text-sm text-neutral-800 mt-0.5">{post.message}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {activityTab === 'issues' && (
        <div className="space-y-3">
          {issues.length === 0 ? (
            <div className="text-center py-12 text-neutral-500"><AlertTriangle size={32} className="mx-auto mb-2" /><p className="text-sm">No cases reported</p></div>
          ) : issues.map((issue: any) => (
            <button key={issue.id} onClick={() => navigate(`/cases/${issue.id}`)}
              className="w-full text-left bg-white rounded-2xl border border-neutral-200 p-4 hover:border-primary-400 transition-colors shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-neutral-900">{issue.description}</p>
                  <p className="text-xs text-neutral-500 mt-1">{issue.profiles?.name} &middot; {new Date(issue.created_at).toLocaleDateString()}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${getPriorityColor(issue.priority)}`}>{issue.priority}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${getIssueStatusColor(issue.status)}`}>{issue.status}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {activityTab === 'photos' && (
        <div>
          <div className="mb-3">
            <button onClick={() => photoInputRef.current?.click()} disabled={uploadingPhotos}
              className="flex items-center gap-2 bg-white border border-neutral-200 hover:border-primary-400 text-neutral-700 px-4 py-2.5 rounded-xl text-sm font-medium shadow-sm disabled:opacity-50">
              {uploadingPhotos ? <div className="w-4 h-4 border-2 border-primary-200 border-t-primary-500 rounded-full animate-spin" /> : <Upload size={16} />}
              {uploadingPhotos ? 'Uploading...' : 'Add Photos'}
            </button>
            <input ref={photoInputRef} type="file" accept="image/*" capture="environment" multiple onChange={handleDirectPhotoUpload} className="hidden" />
          </div>
          {photos.length === 0 ? (
            <div className="text-center py-12 text-neutral-500"><Camera size={32} className="mx-auto mb-2" /><p className="text-sm">No photos yet</p></div>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
              {photos.map((photo: any) => (
                <div key={photo.id} className="aspect-square rounded-2xl overflow-hidden bg-neutral-200 shadow-sm">
                  <img src={`${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/photos/${photo.storage_path}`}
                    alt={photo.caption || 'Photo'} className="w-full h-full object-cover" />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activityTab === 'notes' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm">
            <textarea value={newNote} onChange={(e: any) => setNewNote(e.target.value)} placeholder="Add a note..." rows={3}
              className="w-full text-sm text-neutral-900 placeholder-neutral-400 resize-none border border-neutral-200 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-primary-300" />
            <div className="flex justify-end mt-2">
              <button onClick={handleAddNote} disabled={!newNote.trim() || savingNote}
                className="flex items-center gap-2 bg-gradient-to-r from-primary-500 to-primary-600 text-white px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-50 shadow-md shadow-primary-200">
                <Send size={14} /> {savingNote ? 'Saving...' : 'Add Note'}
              </button>
            </div>
          </div>
          {notes.length === 0 ? (
            <div className="text-center py-12 text-neutral-500"><StickyNote size={32} className="mx-auto mb-2" /><p className="text-sm">No notes yet</p></div>
          ) : notes.map((note: any) => (
            <div key={note.id} className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm">
              {editingNoteId === note.id ? (
                <div>
                  <textarea value={editingNoteContent} onChange={(e: any) => setEditingNoteContent(e.target.value)} rows={3}
                    className="w-full text-sm text-neutral-900 resize-none border border-neutral-200 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-primary-300" />
                  <div className="flex justify-end gap-2 mt-2">
                    <button onClick={() => { setEditingNoteId(null); setEditingNoteContent('') }} className="px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100 rounded-lg">Cancel</button>
                    <button onClick={() => handleUpdateNote(note.id)} disabled={!editingNoteContent.trim()} className="px-3 py-1.5 text-sm bg-primary-500 text-white rounded-lg disabled:opacity-50 hover:bg-primary-600">Save</button>
                  </div>
                </div>
              ) : (
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-7 h-7 bg-primary-50 rounded-full flex items-center justify-center"><User size={12} className="text-primary-600" /></div>
                      <div>
                        <p className="text-xs font-medium text-neutral-900">{note.profiles?.name || 'Unknown'}</p>
                        <p className="text-[10px] text-neutral-500">{new Date(note.created_at).toLocaleDateString()} {new Date(note.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}{note.updated_at !== note.created_at && ' (edited)'}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => { setEditingNoteId(note.id); setEditingNoteContent(note.content) }} className="p-1.5 text-neutral-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg"><Pencil size={13} /></button>
                      <button onClick={() => handleDeleteNote(note.id)} className="p-1.5 text-neutral-400 hover:text-error-600 hover:bg-error-50 rounded-lg"><Trash2 size={13} /></button>
                    </div>
                  </div>
                  <p className="text-sm text-neutral-800 whitespace-pre-wrap pl-9">{note.content}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ─── QR Code Modal ──────────────────────────────── */
function QRCodeModal({ asset, onClose, onAssigned }: { asset: Asset; onClose: () => void; onAssigned?: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [ready, setReady] = useState(false)
  const [assigning, setAssigning] = useState(false)
  const [copied, setCopied] = useState(false)
  const hasQr = !!asset.qr_code_id
  const qrUrl = hasQr ? getAssetDeepLink(asset.qr_code_id) : ''

  useEffect(() => {
    if (canvasRef.current && hasQr) {
      const qrValue = getAssetDeepLink(asset.qr_code_id)
      import('qrcode').then(QR => {
        QR.toCanvas(canvasRef.current, qrValue, { width: 240, margin: 2, color: { dark: '#171717', light: '#ffffff' } })
        setReady(true)
      })
    }
  }, [asset.qr_code_id, hasQr])

  function handleDownload() {
    if (!canvasRef.current) return
    const link = document.createElement('a')
    link.download = `qr-${asset.asset_tag || asset.id}.png`
    link.href = canvasRef.current.toDataURL('image/png')
    link.click()
  }

  async function handleAssignQr() {
    setAssigning(true)
    const newToken = crypto.randomUUID()
    const { error } = await supabase.from('assets').update({ qr_code_id: newToken }).eq('id', asset.id)
    setAssigning(false)
    if (!error) onAssigned?.()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white border border-neutral-200 w-full max-w-sm rounded-2xl shadow-lg overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-200">
          <h2 className="text-base font-semibold text-neutral-900">QR Code</h2>
          <button onClick={onClose} className="p-1 hover:bg-neutral-100 rounded-lg"><X size={20} /></button>
        </div>
        <div className="p-6 flex flex-col items-center">
          {hasQr ? (
            <>
              <div className="bg-white border border-neutral-100 rounded-xl p-4 shadow-sm"><canvas ref={canvasRef} width={240} height={240} /></div>
              <div className="mt-4 text-center">
                <p className="text-sm font-semibold text-neutral-900">{asset.equipment_name || asset.asset_tag}</p>
                <p className="text-xs text-neutral-500 mt-0.5">{asset.asset_tag}</p>
              </div>
              <div className="mt-4 w-full flex items-center gap-1.5 bg-neutral-50 border border-neutral-200 rounded-xl px-3 py-2">
                <Link2 size={14} className="shrink-0 text-neutral-400" />
                <p className="flex-1 min-w-0 text-xs text-neutral-600 font-mono truncate" title={qrUrl}>{qrUrl}</p>
                <button onClick={() => { navigator.clipboard.writeText(qrUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) }) }}
                  className="shrink-0 p-1 rounded-lg hover:bg-neutral-200 transition-colors" title="Copy URL">
                  {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} className="text-neutral-400" />}
                </button>
              </div>
              <button onClick={handleDownload} disabled={!ready}
                className="mt-5 w-full flex items-center justify-center gap-2 bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-600 hover:to-primary-700 text-white py-2.5 rounded-xl text-sm font-medium shadow-md shadow-primary-200 disabled:opacity-50">
                <Download size={16} /> Download QR Code
              </button>
            </>
          ) : (
            <>
              <div className="w-60 h-60 border-2 border-dashed border-neutral-200 rounded-xl flex items-center justify-center">
                <div className="text-center"><QrCode size={40} className="text-neutral-300 mx-auto mb-2" /><p className="text-sm text-neutral-500 font-medium">No QR Assigned</p></div>
              </div>
              <div className="mt-4 text-center">
                <p className="text-sm font-semibold text-neutral-900">{asset.equipment_name || asset.asset_tag}</p>
                <p className="text-xs text-neutral-500 mt-1">This asset does not have a QR code yet.</p>
              </div>
              <button onClick={handleAssignQr} disabled={assigning}
                className="mt-5 w-full flex items-center justify-center gap-2 bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-600 hover:to-primary-700 text-white py-2.5 rounded-xl text-sm font-medium shadow-md shadow-primary-200 disabled:opacity-50">
                <QrCode size={16} /> {assigning ? 'Assigning...' : 'Assign QR Code'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/* ─── Helper functions ──────────────────────────────── */
function getStatusColor(status: string) {
  const c: Record<string, string> = { not_started: 'bg-neutral-100 text-neutral-700', in_progress: 'bg-primary-50 text-primary-700', complete: 'bg-success-50 text-success-700', complete_pending_verification: 'bg-warning-50 text-warning-700', blocked: 'bg-error-50 text-error-700', deficient: 'bg-error-50 text-error-700', ready_for_next_trade: 'bg-success-50 text-success-700', accepted: 'bg-success-50 text-success-700', rejected: 'bg-error-50 text-error-700', closed: 'bg-neutral-100 text-neutral-700' }
  return c[status] || 'bg-neutral-100 text-neutral-700'
}
function formatStatus(s: string) { return s.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) }
function formatEventType(t: string) { return t.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) }
function getPriorityColor(p: string) { const c: Record<string, string> = { low: 'bg-neutral-100 text-neutral-700', medium: 'bg-warning-50 text-warning-700', high: 'bg-error-50 text-error-700', critical: 'bg-error-50 text-error-700' }; return c[p] || 'bg-neutral-100 text-neutral-700' }
function getIssueStatusColor(s: string) { const c: Record<string, string> = { open: 'bg-error-50 text-error-700', in_progress: 'bg-primary-50 text-primary-700', resolved: 'bg-success-50 text-success-700', verified: 'bg-success-50 text-success-700', closed: 'bg-neutral-100 text-neutral-700' }; return c[s] || 'bg-neutral-100 text-neutral-700' }
function getCaseStatusColor(s: string) { const c: Record<string, string> = { open: 'bg-error-50 text-error-700', in_progress: 'bg-primary-50 text-primary-700', resolved: 'bg-success-50 text-success-700', closed: 'bg-neutral-100 text-neutral-700' }; return c[s] || 'bg-neutral-100 text-neutral-700' }

/* ─── Document Category View (Forms/Records/Contracts/Engineering/Drawings) ─── */
const CATEGORY_MAP: Record<string, string[]> = {
  forms: ['form'],
  records: ['record'],
  contracts: ['contractual'],
  engineering: ['engineering'],
  drawings: ['drawing', 'shop_drawing'],
}

function DocumentCategoryView({ assetId, category, canEdit: _canEdit }: { assetId: string; facilityId: string; category: string; canEdit: boolean }) {
  const [docs, setDocs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchDocs() {
      setLoading(true)
      const categories = CATEGORY_MAP[category] || []
      const { data } = await supabase
        .from('document_asset_links')
        .select('*, documents!inner(id, name, category, discipline, revision, storage_path, external_url, file_url)')
        .eq('asset_id', assetId)
        .in('documents.category', categories)
        .order('created_at', { ascending: false })
      setDocs(data || [])
      setLoading(false)
    }
    fetchDocs()
  }, [assetId, category])

  const categoryLabel = category.charAt(0).toUpperCase() + category.slice(1)

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-neutral-700 uppercase tracking-wide mb-3">{categoryLabel}</h3>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="w-6 h-6 border-2 border-primary-200 border-t-primary-500 rounded-full animate-spin" />
          </div>
        ) : docs.length === 0 ? (
          <div className="text-center py-8 text-neutral-400">
            <FileText size={28} className="mx-auto mb-2" />
            <p className="text-sm">No {categoryLabel.toLowerCase()} linked to this asset</p>
            <p className="text-xs mt-1">Add documents from the Documents tab</p>
          </div>
        ) : (
          <div className="space-y-2">
            {docs.map((doc) => (
              <div key={doc.id} className="flex items-center justify-between p-3 rounded-xl border border-neutral-200 hover:border-primary-300 transition-colors">
                <div className="flex items-center gap-3 min-w-0">
                  <FileText size={16} className="text-neutral-400 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-neutral-800 truncate">{doc.documents?.name || 'Untitled'}</p>
                    <p className="text-xs text-neutral-500">{doc.documents?.discipline} {doc.documents?.revision && `· Rev ${doc.documents.revision}`}</p>
                  </div>
                </div>
                {doc.documents?.external_url || doc.documents?.file_url ? (
                  <a href={doc.documents?.external_url || doc.documents?.file_url} target="_blank" rel="noreferrer"
                    className="text-xs text-primary-600 hover:text-primary-700 shrink-0 ml-2">Open</a>
                ) : (
                  <span className="text-xs text-neutral-400 shrink-0 ml-2">No URL</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
