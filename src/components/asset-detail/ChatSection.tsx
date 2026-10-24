import { useEffect, useState, useRef } from 'react'
import { Send, Pin, MessageCircle, AlertTriangle, X, ArrowUpRight, Sparkles } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import type { AssetChatMessage, AssetBoardPost } from '../../types'

export default function ChatSection({ assetId, facilityId, canEdit }: { assetId: string; facilityId: string; canEdit: boolean }) {
  const [tab, setTab] = useState<'chat' | 'board'>('chat')
  const [messages, setMessages] = useState<AssetChatMessage[]>([])
  const [boardPosts, setBoardPosts] = useState<AssetBoardPost[]>([])
  const [newMessage, setNewMessage] = useState('')
  const [posting, setPosting] = useState(false)
  const [userRole, setUserRole] = useState<string | null>(null)
  const [showCaseModal, setShowCaseModal] = useState<null | { type: 'chat' | 'board'; messageId: string; postBody: string }>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  async function fetchMessages() {
    const { data } = await supabase
      .from('asset_chat_messages')
      .select('*, profiles!asset_chat_messages_author_id_fkey(name)')
      .eq('asset_id', assetId)
      .order('created_at', { ascending: true })
      .limit(100)
    setMessages((data as AssetChatMessage[]) || [])
  }

  async function fetchBoardPosts() {
    const { data } = await supabase
      .from('asset_board_posts')
      .select('*, profiles!asset_board_posts_author_id_fkey(name)')
      .eq('asset_id', assetId)
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false })
    setBoardPosts((data as AssetBoardPost[]) || [])
  }

  useEffect(() => {
    fetchMessages(); fetchBoardPosts()
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase.rpc('get_facility_role', { p_facility_id: facilityId, p_user_id: user.id })
      if (data) setUserRole(data as string)
    })()
  }, [assetId, facilityId])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages])

  async function handleSendMessage(e: React.FormEvent) {
    e.preventDefault()
    if (!newMessage.trim()) return
    setPosting(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase.from('asset_chat_messages').insert({
      asset_id: assetId, facility_id: facilityId,
      author_id: user?.id || null, author_type: 'user', body: newMessage.trim(),
    })
    if (!error) { setNewMessage(''); fetchMessages() }
    setPosting(false)
  }

  async function handlePromoteToBoard(msg: AssetChatMessage) {
    if (!userRole || !['reviewer', 'supervisor', 'admin'].includes(userRole)) return
    const { data: { user } } = await supabase.auth.getUser()
    // Insert board post
    const { error: postErr } = await supabase.from('asset_board_posts').insert({
      asset_id: assetId, facility_id: facilityId,
      chat_message_id: msg.id, author_id: user?.id || null,
      body: msg.body,
    })
    if (postErr) { alert(postErr.message); return }
    // Mark chat message as promoted
    await supabase.from('asset_chat_messages').update({
      promoted_to_board: true, promoted_at: new Date().toISOString(), promoted_by: user?.id || null,
    }).eq('id', msg.id)
    fetchMessages(); fetchBoardPosts()
  }

  async function handleTogglePin(post: AssetBoardPost) {
    if (!userRole || !['supervisor', 'admin'].includes(userRole)) return
    await supabase.from('asset_board_posts').update({ is_pinned: !post.is_pinned }).eq('id', post.id)
    fetchBoardPosts()
  }

  async function handleCreateCase(type: 'chat' | 'board', sourceId: string, body: string, caseType: 'observation' | 'deficiency' | 'work_order' = 'observation') {
    const { data: { user } } = await supabase.auth.getUser()
    const { data: newCase, error } = await supabase.from('cases').insert({
      asset_id: assetId,
      facility_id: facilityId,
      case_type: caseType,
      title: body.slice(0, 120) || 'Case from chat',
      description: `From ${type === 'chat' ? 'chat' : 'message board'}: ${body.slice(0, 500)}`,
      priority: 'medium',
      status: 'open',
      created_by: user?.id || null,
    }).select('id').single()
    if (error) { alert(error.message); return }
    await supabase.from('case_source_links').insert({
      case_id: newCase.id, source_type: type === 'chat' ? 'chat_message' : 'board_post',
      source_chat_message_id: type === 'chat' ? sourceId : null,
      source_board_post_id: type === 'board' ? sourceId : null,
      asset_id: assetId, created_by: user?.id || null,
    })
    if (type === 'chat') {
      await supabase.from('asset_chat_messages').update({ source_case_id: newCase.id }).eq('id', sourceId)
    } else {
      await supabase.from('asset_board_posts').update({ source_case_id: newCase.id }).eq('id', sourceId)
    }
    setShowCaseModal(null)
    fetchMessages(); fetchBoardPosts()
  }

  const canPromote = userRole && ['reviewer', 'supervisor', 'admin'].includes(userRole)
  const canPin = userRole && ['supervisor', 'admin'].includes(userRole)

  return (
    <div className="space-y-3">
      <div className="flex gap-1 bg-neutral-200 rounded-lg p-1">
        <button onClick={() => setTab('chat')}
          className={`flex-1 py-2 text-xs font-medium rounded-md transition-colors ${tab === 'chat' ? 'bg-white shadow-sm text-neutral-900' : 'text-neutral-600'}`}>
          <MessageCircle size={14} className="inline mr-1" /> Chat ({messages.length})
        </button>
        <button onClick={() => setTab('board')}
          className={`flex-1 py-2 text-xs font-medium rounded-md transition-colors ${tab === 'board' ? 'bg-white shadow-sm text-neutral-900' : 'text-neutral-600'}`}>
          <ArrowUpRight size={14} className="inline mr-1" /> Message Board ({boardPosts.length})
        </button>
      </div>

      {tab === 'chat' && (
        <div>
          <div ref={scrollRef} className="space-y-2 max-h-96 overflow-y-auto pb-2">
            {messages.length === 0 && (
              <p className="text-center text-sm text-neutral-400 py-8">No messages yet</p>
            )}
            {messages.map((msg) => (
              <div key={msg.id} className="bg-white rounded-2xl border border-neutral-200 p-3">
                <div className="flex items-center gap-2 mb-1">
                  {msg.author_type === 'ai_agent' ? (
                    <Sparkles size={14} className="text-primary-500" />
                  ) : msg.author_type === 'system' ? (
                    <MessageCircle size={14} className="text-neutral-400" />
                  ) : (
                    <div className="w-6 h-6 bg-primary-50 rounded-full flex items-center justify-center">
                      <span className="text-[10px] font-medium text-primary-600">{(msg as any).profiles?.name?.charAt(0) || '?'}</span>
                    </div>
                  )}
                  <span className="text-xs font-medium text-neutral-800">
                    {msg.author_type === 'ai_agent' ? 'AI Agent' : (msg as any).profiles?.name || 'Unknown'}
                  </span>
                  <span className="text-xs text-neutral-400">{new Date(msg.created_at).toLocaleString([], { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' })}</span>
                  {msg.edited_at && <span className="text-xs text-neutral-400">(edited)</span>}
                  {msg.promoted_to_board && <span className="text-xs text-primary-500 font-medium">Board</span>}
                </div>
                <p className="text-sm text-neutral-800 whitespace-pre-wrap">{msg.body}</p>
                <div className="flex gap-2 mt-2">
                  {canPromote && !msg.promoted_to_board && (
                    <button onClick={() => handlePromoteToBoard(msg)}
                      className="text-xs text-primary-600 hover:text-primary-700 font-medium flex items-center gap-1">
                      <ArrowUpRight size={12} /> Promote to Board
                    </button>
                  )}
                  {canEdit && (
                    <button onClick={() => setShowCaseModal({ type: 'chat', messageId: msg.id, postBody: msg.body })}
                      className="text-xs text-neutral-500 hover:text-error-600 font-medium flex items-center gap-1">
                      <AlertTriangle size={12} /> Create Case
                    </button>
                  )}
                </div>
                {msg.source_case_id && (
                  <a href={`/cases/${msg.source_case_id}`} className="text-xs text-primary-500 hover:underline mt-1 inline-block">
                    Case created &rarr;
                  </a>
                )}
              </div>
            ))}
          </div>
          {canEdit && (
            <form onSubmit={handleSendMessage} className="flex gap-2 mt-2">
              <input value={newMessage} onChange={(e) => setNewMessage(e.target.value)}
                placeholder="Type a message..."
                className="flex-1 px-3 py-2.5 bg-white border border-neutral-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-300" />
              <button type="submit" disabled={posting || !newMessage.trim()}
                className="px-3 py-2.5 bg-gradient-to-r from-primary-500 to-primary-600 text-white rounded-xl text-sm font-medium disabled:opacity-50 shadow-md shadow-primary-200">
                <Send size={16} />
              </button>
            </form>
          )}
        </div>
      )}

      {tab === 'board' && (
        <div className="space-y-2">
          {boardPosts.length === 0 && (
            <div className="text-center py-8 text-neutral-400">
              <ArrowUpRight size={32} className="mx-auto mb-2" />
              <p className="text-sm">No promoted posts yet</p>
              <p className="text-xs mt-1">Promote important chat messages to the board</p>
            </div>
          )}
          {boardPosts.map((post) => (
            <div key={post.id} className={`bg-white rounded-2xl border p-3 ${post.is_pinned ? 'border-primary-200 bg-primary-50/30' : 'border-neutral-200'}`}>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-6 h-6 bg-primary-50 rounded-full flex items-center justify-center">
                  <span className="text-[10px] font-medium text-primary-600">{(post as any).profiles?.name?.charAt(0) || '?'}</span>
                </div>
                <span className="text-xs font-medium text-neutral-800">{(post as any).profiles?.name || 'Unknown'}</span>
                <span className="text-xs text-neutral-400">{new Date(post.created_at).toLocaleString([], { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' })}</span>
                {post.is_pinned && <Pin size={12} className="text-primary-500 fill-primary-500" />}
              </div>
              <p className="text-sm text-neutral-800 whitespace-pre-wrap">{post.body}</p>
              <div className="flex gap-2 mt-2">
                {canPin && (
                  <button onClick={() => handleTogglePin(post)}
                    className="text-xs text-primary-600 hover:text-primary-700 font-medium flex items-center gap-1">
                  <Pin size={12} /> {post.is_pinned ? 'Unpin' : 'Pin'}
                  </button>
                )}
                {canEdit && !post.source_case_id && (
                  <button onClick={() => setShowCaseModal({ type: 'board', messageId: post.id, postBody: post.body })}
                    className="text-xs text-neutral-500 hover:text-error-600 font-medium flex items-center gap-1">
                    <AlertTriangle size={12} /> Create Case
                  </button>
                )}
                {post.source_case_id && (
                  <a href={`/cases/${post.source_case_id}`} className="text-xs text-primary-500 hover:underline">Case &rarr;</a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Case creation modal */}
      {showCaseModal && (
        <CaseCreationModal
          sourceType={showCaseModal.type}
          sourceBody={showCaseModal.postBody}
          onCreate={(caseType) => handleCreateCase(showCaseModal.type, showCaseModal.messageId, showCaseModal.postBody, caseType)}
          onClose={() => setShowCaseModal(null)}
        />
      )}
    </div>
  )
}

function CaseCreationModal({ sourceType, sourceBody, onCreate, onClose }: {
  sourceType: 'chat' | 'board'
  sourceBody: string
  onCreate: (caseType: 'observation' | 'deficiency' | 'work_order') => void
  onClose: () => void
}) {
  const [caseType, setCaseType] = useState<'observation' | 'deficiency' | 'work_order'>('observation')
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-neutral-900">Create Case</h3>
              <button onClick={onClose} className="p-1 hover:bg-neutral-100 rounded-lg"><X size={18} /></button>
            </div>
            <p className="text-sm text-neutral-600 mb-1">From {sourceType === 'chat' ? 'chat message' : 'board post'}:</p>
            <p className="text-sm text-neutral-800 bg-neutral-50 rounded-xl p-3 max-h-32 overflow-y-auto mb-4">{sourceBody}</p>
            <div className="mb-4">
              <p className="text-xs font-medium text-neutral-700 mb-2">Case Type</p>
              <div className="flex gap-2">
                {(['observation', 'deficiency', 'work_order'] as const).map(t => (
                  <button key={t} onClick={() => setCaseType(t)}
                    className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                      caseType === t ? 'bg-primary-50 text-primary-700 border border-primary-200' : 'bg-neutral-50 text-neutral-600 border border-neutral-200'
                    }`}>
                    {t === 'work_order' ? 'Work Order' : t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <button onClick={() => onCreate(caseType)}
              className="mt-2 w-full flex items-center justify-center gap-2 bg-gradient-to-r from-primary-500 to-primary-600 text-white py-2.5 rounded-xl text-sm font-medium shadow-md shadow-primary-200 hover:from-primary-600 hover:to-primary-700">
              <AlertTriangle size={16} /> Create Case
            </button>
          </div>
        </div>
  )
}
