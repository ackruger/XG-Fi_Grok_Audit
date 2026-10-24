import { useState, useRef, useEffect } from 'react'
import { Send, Bot, User, Sparkles, ChevronDown } from 'lucide-react'
import { useFacility } from '../context/FacilityContext'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { env } from '../lib/env'
import { fetchWithTimeout } from '../lib/fetchWithTimeout'

interface MessageSources {
  assets_referenced: number
  events_referenced: number
  issues_referenced: number
  activity_posts_referenced: number
  notes_referenced: number
  comments_referenced: number
  status_changes_referenced: number
}

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  sources?: MessageSources | null
}

export default function AIChatPage() {
  const { currentFacility } = useFacility()
  const { session } = useAuth()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null)
  const [assets, setAssets] = useState<Array<{ id: string; equipment_name: string; asset_tag: string }>>([])

  useEffect(() => {
    if (!currentFacility) {
      setAssets([])
      return
    }

    let cancelled = false

    async function loadAssets() {
      const { data, error } = await supabase
        .from('assets')
        .select('id, equipment_name, asset_tag')
        .eq('facility_id', currentFacility!.id)
        .is('deleted_at', null)
        .order('equipment_name')

      if (cancelled) return
      if (error) {
        console.error('Failed to load AI asset selector:', error.message)
        setAssets([])
        return
      }

      setAssets(data || [])
    }

    void loadAssets()
    return () => {
      cancelled = true
    }
  }, [currentFacility])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!input.trim() || loading || !currentFacility) return

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
    }
    setMessages(prev => [...prev, userMessage])
    setInput('')
    setLoading(true)

    try {
      const apiUrl = `${env.SUPABASE_URL}/functions/v1/ai-chat-query`
      const response = await fetchWithTimeout(apiUrl, {
        timeout: 30000,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session?.access_token}`,
          'apikey': env.SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          question: userMessage.content,
          facility_id: currentFacility.id,
          asset_id: selectedAssetId || undefined,
          conversation_history: messages.map(m => ({ role: m.role, content: m.content })),
        }),
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || data.details || 'Failed to get response')
      }
      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: data.answer || 'No response received.',
        timestamp: new Date(),
        sources: data.sources || null,
      }
      setMessages(prev => [...prev, assistantMessage])
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      const errorMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `Sorry, I could not process that request: ${message}. Please try again.`,
        timestamp: new Date(),
      }
      setMessages(prev => [...prev, errorMessage])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-full max-w-3xl mx-auto bg-neutral-50">
      {/* Header */}
      <div className="px-4 py-3 border-b border-neutral-200 bg-white shadow-sm">
        <h1 className="text-base font-semibold text-neutral-900 flex items-center gap-2">
          <Sparkles size={18} className="text-primary-600" />
          AI Assistant
        </h1>
        <p className="text-xs text-neutral-500">Ask questions about your facility assets, progress, and cases</p>
      </div>

      {/* Asset scope picker */}
      <div className="px-4 py-2 border-b border-neutral-200 bg-white">
        <div className="relative">
          <select
            value={selectedAssetId || ''}
            onChange={e => setSelectedAssetId(e.target.value || null)}
            className="w-full text-sm border border-neutral-200 rounded-xl px-3 py-2 bg-neutral-50 appearance-none focus:outline-none focus:ring-2 focus:ring-primary-300 focus:border-transparent pr-8"
          >
            <option value="">All facility assets</option>
            {assets.map(a => (
              <option key={a.id} value={a.id}>
                {a.equipment_name} ({a.asset_tag})
              </option>
            ))}
          </select>
          <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center py-12">
            <div className="w-16 h-16 bg-primary-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Bot size={28} className="text-primary-600" />
            </div>
            <h2 className="text-base font-semibold text-neutral-900">Ask Xg-Fi anything</h2>
            <p className="text-sm text-neutral-500 mt-2 max-w-sm mx-auto">
              I can answer questions about asset status, progress, cases, notes, team activity, and more. Ask follow-up questions — I remember the conversation.
            </p>
            <div className="mt-6 space-y-2">
              {[
                "Anything I should know about this asset?",
                "What has my team been doing?",
                "What is outstanding on the 4th floor?",
                "Show me all blocked assets",
                "Give me a progress summary",
              ].map((q) => (
                <button
                  key={q}
                  onClick={() => { setInput(q); }}
                  className="block mx-auto px-4 py-2 bg-white border border-neutral-200 rounded-xl text-sm text-neutral-800 hover:border-neutral-300 hover:bg-neutral-50 transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}>
            {msg.role === 'assistant' && (
              <div className="w-8 h-8 bg-primary-50 rounded-full flex items-center justify-center shrink-0">
                <Bot size={16} className="text-primary-600" />
              </div>
            )}
            <div className={`max-w-[80%] rounded-2xl px-4 py-3 ${
              msg.role === 'user'
                ? 'bg-gradient-to-r from-primary-500 to-primary-600 text-white'
                : 'bg-white border border-neutral-200 text-neutral-900 shadow-sm'
            }`}>
              <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</p>
              <div className={`flex items-center gap-2 mt-1.5 ${msg.role === 'user' ? 'text-primary-100' : 'text-neutral-400'}`}>
                <span className="text-xs">
                  {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                {msg.sources && (
                  <span className="text-xs opacity-70">
                    {[msg.sources.assets_referenced && `${msg.sources.assets_referenced} assets`,
                      msg.sources.issues_referenced && `${msg.sources.issues_referenced} cases`,
                      msg.sources.notes_referenced && `${msg.sources.notes_referenced} notes`,
                      msg.sources.events_referenced && `${msg.sources.events_referenced} events`
                    ].filter(Boolean).join(' · ')}
                  </span>
                )}
              </div>
            </div>
            {msg.role === 'user' && (
              <div className="w-8 h-8 bg-neutral-200 rounded-full flex items-center justify-center shrink-0">
                <User size={16} className="text-neutral-600" />
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="flex gap-3">
            <div className="w-8 h-8 bg-primary-50 rounded-full flex items-center justify-center shrink-0">
              <Bot size={16} className="text-primary-600" />
            </div>
            <div className="bg-white border border-neutral-200 rounded-2xl px-4 py-3 shadow-sm">
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 bg-neutral-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-2 h-2 bg-neutral-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 bg-neutral-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="p-4 border-t border-neutral-200 bg-white shadow-sm">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about assets, progress, cases..."
            disabled={loading}
            className="flex-1 px-4 py-2.5 bg-white border border-neutral-200 rounded-xl text-sm text-neutral-900 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-primary-400/40 focus:border-primary-400 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="px-4 py-2.5 bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-600 hover:to-primary-700 text-white rounded-xl transition-colors disabled:opacity-50 shadow-md shadow-primary-200"
          >
            <Send size={18} />
          </button>
        </form>
      </div>
    </div>
  )
}
