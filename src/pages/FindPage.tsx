import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Html5Qrcode } from 'html5-qrcode'
import { Camera, Search, X, Upload, QrCode, Link2, Plus, Check, Map, ScanLine } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useFacility } from '../context/FacilityContext'

type FindMode = 'menu' | 'scan' | 'search'

function sanitizeFilterValue(value: string): string {
  return value.replace(/[%_\\(),.*"']/g, '')
}

function extractQrToken(code: string): string {
  try {
    const url = new URL(code)
    const path = url.pathname
    const qMatch = path.match(/^\/q\/(.+)$/)
    if (qMatch) return qMatch[1]
    const scanMatch = path.match(/^\/scan\/(.+)$/)
    if (scanMatch) return scanMatch[1]
  } catch {
    // not a URL — treat the raw value as the token
  }
  return code
}

export default function FindPage() {
  const navigate = useNavigate()
  const { currentFacility } = useFacility()
  const [mode, setMode] = useState<FindMode>('menu')
  const [scanning, setScanning] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')
  const [uploadStatus, setUploadStatus] = useState('')
  const [planResults, setPlanResults] = useState<any[]>([])
  const [planLoading, setPlanLoading] = useState(false)
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [decodedQrId, setDecodedQrId] = useState<string | null>(null)
  const [showLinkDialog, setShowLinkDialog] = useState(false)
  const [linkSearch, setLinkSearch] = useState('')
  const [linkResults, setLinkResults] = useState<any[]>([])
  const [linkSearching, setLinkSearching] = useState(false)
  const [linking, setLinking] = useState(false)

  async function startScanner() {
    setError('')
    setMode('scan')
    setScanning(true)
  }

  async function initScanner() {
    try {
      const scanner = new Html5Qrcode('qr-reader')
      scannerRef.current = scanner
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText: string) => {
          handleScanResult(decodedText)
          stopScanner()
        },
        () => {}
      )
    } catch {
      setError('Camera access denied or not available. Use manual search or upload a QR image below.')
      setScanning(false)
    }
  }

  function stopScanner() {
    if (scannerRef.current) {
      scannerRef.current.stop().catch(() => {})
      scannerRef.current = null
    }
    setScanning(false)
  }

  async function handleScanResult(code: string) {
    const qrId = extractQrToken(code)
    if (!qrId) return
    const { data } = await supabase
      .from('assets')
      .select('id, facility_id')
      .eq('qr_code_id', qrId)
      .is('deleted_at', null)
      .maybeSingle()
    if (data) {
      if (data.facility_id !== currentFacility?.id) {
        navigate(`/q/${qrId}`)
      } else {
        navigate(`/assets/${data.id}`)
      }
    } else {
      setDecodedQrId(qrId)
      setShowLinkDialog(true)
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError('')
    setUploadStatus('Decoding QR code from image...')
    try {
      const scanner = new Html5Qrcode('qr-file-reader')
      const result = await scanner.scanFile(file, true)
      setUploadStatus('')
      const qrId = extractQrToken(result)
      if (!qrId) return
      await handleScanResult(qrId)
    } catch {
      setUploadStatus('')
      setError('Could not detect a QR code in that image. Try a clearer photo.')
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleLinkSearch(query: string) {
    setLinkSearch(query)
    if (!query.trim() || !currentFacility) { setLinkResults([]); return }
    setLinkSearching(true)
    const { data } = await supabase
      .from('assets')
      .select('id, asset_tag, equipment_name, qr_code_id, locations(building, floor, room_area)')
      .eq('facility_id', currentFacility.id)
      .is('deleted_at', null)
      .or(`asset_tag.ilike.%${sanitizeFilterValue(query)}%,equipment_name.ilike.%${sanitizeFilterValue(query)}%`)
      .limit(10)
    setLinkResults(data || [])
    setLinkSearching(false)
  }

  async function linkQrToAsset(assetId: string) {
    if (!decodedQrId) return
    setLinking(true)
    await supabase.from('assets').update({ qr_code_id: decodedQrId, updated_at: new Date().toISOString() }).eq('id', assetId)
    setLinking(false)
    setShowLinkDialog(false); setDecodedQrId(null); setLinkSearch(''); setLinkResults([])
    navigate(`/assets/${assetId}`)
  }

  function closeLinkDialog() {
    setShowLinkDialog(false); setDecodedQrId(null); setLinkSearch(''); setLinkResults([])
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    if (!searchQuery.trim() || !currentFacility) return
    setSearching(true)
    setError('')
    const q = sanitizeFilterValue(searchQuery)
    const { data, error: err } = await supabase
      .from('assets')
      .select('id, asset_tag, equipment_name, alias, equipment_type, operational_status, identification_status, locations(building, floor, room_area)')
      .eq('facility_id', currentFacility.id)
      .is('deleted_at', null)
      .or(`asset_tag.ilike.%${q}%,equipment_name.ilike.%${q}%,alias.ilike.%${q}%`)
      .limit(20)
    if (err) { setError(err.message); setSearching(false); return }
    setSearchResults(data || [])
    setSearching(false)
  }

  async function loadPlans() {
    if (!currentFacility) return
    setPlanLoading(true)
    const { data: plans } = await supabase
      .from('plan_documents')
      .select('id, name, external_url, storage_path')
      .eq('facility_id', currentFacility.id)
      .order('updated_at', { ascending: false })
      .limit(10)
    const planIds = (plans || []).map(p => p.id)
    let markers: any[] = []
    if (planIds.length > 0) {
      const { data: markerData } = await supabase
        .from('plan_markers')
        .select('id, plan_document_id, asset_id, label, page_number, x, y, z, assets!inner(id, equipment_name, asset_tag)')
        .in('plan_document_id', planIds)
        .order('created_at', { ascending: false })
        .limit(50)
      markers = markerData || []
    }
    setPlanResults((plans || []).map((p: any) => ({
      ...p,
      markers: markers.filter(m => m.plan_document_id === p.id),
    })))
    setPlanLoading(false)
  }

  useEffect(() => {
    if (mode === 'scan' && scanning && !scannerRef.current) initScanner()
  }, [mode, scanning])

  useEffect(() => {
    return () => { stopScanner() }
  }, [])

  return (
    <div className="p-4 lg:p-8 max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-neutral-900">Find</h1>
        <p className="text-sm text-neutral-500 mt-1">Scan, search, or choose a plan to locate an asset</p>
      </div>

      {/* Mode selector buttons */}
      {mode === 'menu' && (
        <div className="space-y-3">
          {/* Scan / Tap */}
          <button onClick={startScanner}
            className="w-full flex items-center gap-4 p-5 bg-white rounded-2xl border border-neutral-200 hover:border-primary-300 hover:bg-primary-50/50 transition-all shadow-sm">
            <div className="w-12 h-12 bg-primary-50 rounded-xl flex items-center justify-center shrink-0">
              <ScanLine size={24} className="text-primary-500" />
            </div>
            <div className="text-left flex-1">
              <p className="text-sm font-semibold text-neutral-800">Scan or Tap</p>
              <p className="text-xs text-neutral-500 mt-0.5">Scan a QR code or tap an NFC tag</p>
            </div>
          </button>

          {/* Search */}
          <button onClick={() => { setMode('search'); setSearchResults([]); setError('') }}
            className="w-full flex items-center gap-4 p-5 bg-white rounded-2xl border border-neutral-200 hover:border-primary-300 hover:bg-primary-50/50 transition-all shadow-sm">
            <div className="w-12 h-12 bg-primary-50 rounded-xl flex items-center justify-center shrink-0">
              <Search size={24} className="text-primary-500" />
            </div>
            <div className="text-left flex-1">
              <p className="text-sm font-semibold text-neutral-800">Search</p>
              <p className="text-xs text-neutral-500 mt-0.5">Search by Asset ID, alias, or name</p>
            </div>
          </button>

          {/* Choose Plan */}
          <button onClick={() => { loadPlans() }}
            className="w-full flex items-center gap-4 p-5 bg-white rounded-2xl border border-neutral-200 hover:border-primary-300 hover:bg-primary-50/50 transition-all shadow-sm">
            <div className="w-12 h-12 bg-primary-50 rounded-xl flex items-center justify-center shrink-0">
              <Map size={24} className="text-primary-500" />
            </div>
            <div className="text-left flex-1">
              <p className="text-sm font-semibold text-neutral-800">Choose Plan</p>
              <p className="text-xs text-neutral-500 mt-0.5">Browse plan documents and find markers</p>
            </div>
          </button>
        </div>
      )}

      {/* Scan mode */}
      {mode === 'scan' && (
        <div>
          <button onClick={() => { stopScanner(); setMode('menu') }}
            className="flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-700 mb-4">
            <X size={16} /> Back to Find
          </button>

          <div className="bg-white rounded-2xl border border-neutral-200 overflow-hidden mb-4 shadow-sm">
            {scanning ? (
              <div className="relative">
                <div id="qr-reader" className="w-full" />
                <button onClick={stopScanner}
                  className="absolute top-3 right-3 bg-white/90 p-2 rounded-full shadow-md hover:bg-white">
                  <X size={20} className="text-neutral-700" />
                </button>
              </div>
            ) : (
              <button onClick={() => setScanning(true)}
                className="w-full flex flex-col items-center justify-center py-16 gap-4 hover:bg-primary-50/50 transition-colors">
                <div className="w-20 h-20 bg-primary-50 rounded-2xl flex items-center justify-center">
                  <Camera size={36} className="text-primary-500" />
                </div>
                <div className="text-center">
                  <p className="font-medium text-neutral-800">Tap to Scan QR Code</p>
                  <p className="text-sm text-neutral-500 mt-1">Point your camera at an asset tag</p>
                </div>
              </button>
            )}
          </div>

          {/* Upload QR Image */}
          <div className="bg-white rounded-2xl border border-neutral-200 p-4 mb-4 shadow-sm">
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileUpload} className="hidden" id="qr-upload-find" />
            <button onClick={() => fileInputRef.current?.click()}
              className="w-full flex items-center gap-3 px-4 py-4 rounded-xl border-2 border-dashed border-neutral-200 hover:border-primary-300 hover:bg-primary-50/50 transition-all">
              <div className="w-10 h-10 bg-neutral-100 rounded-xl flex items-center justify-center">
                <Upload size={20} className="text-neutral-600" />
              </div>
              <div className="text-left">
                <p className="text-sm font-medium text-neutral-700">Upload QR Code Image</p>
                <p className="text-xs text-neutral-500">Select a photo from your device</p>
              </div>
              <QrCode size={18} className="text-neutral-400 ml-auto" />
            </button>
            {uploadStatus && (
              <div className="mt-3 flex items-center gap-2 text-sm text-primary-600">
                <div className="w-4 h-4 border-2 border-primary-200 border-t-primary-500 rounded-full animate-spin" />
                {uploadStatus}
              </div>
            )}
          </div>
          <div id="qr-file-reader" className="hidden" />
          {error && (
            <div className="bg-error-50 border border-error-100 text-error-700 text-sm px-4 py-3 rounded-xl mb-4">{error}</div>
          )}
        </div>
      )}

      {/* Search mode */}
      {mode === 'search' && (
        <div>
          <button onClick={() => { setMode('menu'); setSearchResults([]); setError('') }}
            className="flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-700 mb-4">
            <X size={16} /> Back to Find
          </button>

          <div className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm">
            <form onSubmit={handleSearch} className="flex gap-2">
              <div className="relative flex-1">
                <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by Asset ID, alias, or name..."
                  className="w-full pl-10 pr-4 py-2.5 border border-neutral-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-400/40 focus:border-primary-400" />
              </div>
              <button type="submit" disabled={searching}
                className="px-4 py-2.5 bg-gradient-to-r from-primary-500 to-primary-600 text-white rounded-xl text-sm font-medium hover:from-primary-600 hover:to-primary-700 transition-all disabled:opacity-50 shadow-md shadow-primary-200">
                Search
              </button>
            </form>

            {searchResults.length > 0 && (
              <div className="mt-4 space-y-2">
                <p className="text-xs text-neutral-500 font-medium">{searchResults.length} result{searchResults.length > 1 ? 's' : ''}</p>
                {searchResults.map((asset) => (
                  <div key={asset.id}
                    className="w-full text-left p-3 rounded-xl border border-neutral-200 hover:border-primary-300 hover:bg-primary-50/50 transition-all">
                    <div className="flex items-center justify-between">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-neutral-800 truncate">{asset.equipment_name || asset.asset_tag}</p>
                        <p className="text-xs text-neutral-500 mt-0.5">
                          {asset.asset_tag && <span className="font-mono mr-2">{asset.asset_tag}</span>}
                          {asset.alias && <span className="mr-2">aka {asset.alias}</span>}
                          {asset.locations?.building} {asset.locations?.floor && `/ ${asset.locations.floor}`}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0 ml-2">
                        {asset.operational_status && asset.operational_status !== 'active' && (
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-warning-50 text-warning-700">{asset.operational_status.replace(/_/g, ' ')}</span>
                        )}
                        {asset.identification_status === 'needs_review' && (
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-warning-50 text-warning-700">Needs Review</span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-3 mt-2">
                      <button onClick={() => navigate(`/assets/${asset.id}`)}
                        className="text-xs text-primary-600 hover:text-primary-700 font-medium">Open Asset</button>
                      <button onClick={() => navigate(`/plans?asset=${asset.id}`)}
                        className="text-xs text-neutral-500 hover:text-neutral-700 font-medium">Go to Plan</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {searchResults.length === 0 && searching && (
              <div className="mt-4 text-center py-8 text-neutral-500">
                <div className="w-6 h-6 border-2 border-primary-200 border-t-primary-500 rounded-full animate-spin mx-auto mb-2" />
                <p className="text-sm">Searching...</p>
              </div>
            )}

            {searchResults.length === 0 && !searching && searchQuery.trim() && (
              <div className="mt-4 text-center py-8 text-neutral-500">
                <p className="text-sm">No matches found</p>
                <p className="text-xs text-neutral-400 mt-1">Try a different Asset ID, alias, or name</p>
              </div>
            )}
          </div>
          {error && <div className="bg-error-50 border border-error-100 text-error-700 text-sm px-4 py-3 rounded-xl mt-4">{error}</div>}
        </div>
      )}

      {/* Plan results */}
      {planResults.length > 0 && (
        <div className="mt-4 bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-neutral-700 mb-3">Plan Documents</h2>
          <div className="space-y-3">
            {planResults.map((plan) => (
              <div key={plan.id} className="rounded-xl border border-neutral-200 overflow-hidden">
                <div className="flex items-center justify-between p-3 hover:bg-neutral-50 transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <Map size={18} className="text-neutral-400 shrink-0" />
                    <p className="text-sm font-medium text-neutral-800 truncate">{plan.name}</p>
                  </div>
                  {plan.external_url ? (
                    <a href={plan.external_url} target="_blank" rel="noreferrer"
                      className="text-xs text-primary-600 hover:text-primary-700 shrink-0 ml-2">Go to Plan</a>
                  ) : (
                    <span className="text-xs text-neutral-400 shrink-0 ml-2">No URL</span>
                  )}
                </div>
                {plan.markers && plan.markers.length > 0 && (
                  <div className="border-t border-neutral-100 p-2 space-y-1">
                    <p className="text-xs text-neutral-400 px-1 pt-1">Markers ({plan.markers.length})</p>
                    {plan.markers.map((marker: any) => (
                      <div key={marker.id} className="flex items-center justify-between p-2 rounded-lg hover:bg-neutral-50">
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-neutral-700 truncate">
                            {marker.label || marker.assets?.asset_tag || marker.assets?.equipment_name || 'Unlabeled'}
                          </p>
                          <p className="text-xs text-neutral-400">
                            {marker.assets?.equipment_name} {marker.page_number && `· Pg ${marker.page_number}`}
                          </p>
                        </div>
                        <div className="flex gap-2 shrink-0">
                          {marker.asset_id && (
                            <button onClick={() => navigate(`/assets/${marker.asset_id}`)}
                              className="text-xs text-primary-600 hover:text-primary-700 font-medium">Open Asset</button>
                          )}
                          {plan.external_url && (
                            <a href={plan.external_url} target="_blank" rel="noreferrer"
                              className="text-xs text-neutral-500 hover:text-neutral-700 font-medium">Plan</a>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {(!plan.markers || plan.markers.length === 0) && (
                  <div className="border-t border-neutral-100 p-2">
                    <p className="text-xs text-neutral-400 px-1 py-1">No markers on this plan</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {planLoading && (
        <div className="mt-4 text-center py-8 text-neutral-500">
          <div className="w-6 h-6 border-2 border-primary-200 border-t-primary-500 rounded-full animate-spin mx-auto mb-2" />
          <p className="text-sm">Loading plans...</p>
        </div>
      )}

      {/* Link QR Code Dialog */}
      {showLinkDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[80vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-200">
              <div>
                <h2 className="text-base font-semibold text-neutral-900">Link QR Code</h2>
                <p className="text-xs text-neutral-500 mt-0.5">QR ID: <span className="font-mono text-neutral-700">{decodedQrId}</span></p>
              </div>
              <button onClick={closeLinkDialog} className="p-1.5 hover:bg-neutral-100 rounded-lg"><X size={18} className="text-neutral-600" /></button>
            </div>
            <div className="p-5 flex-1 overflow-y-auto space-y-4">
              <p className="text-sm text-neutral-600">This QR code is not linked to any asset. Choose an option below:</p>
              <button onClick={() => { setShowLinkDialog(false); navigate('/assets?action=create') }}
                className="w-full flex items-center gap-3 p-4 rounded-xl border-2 border-dashed border-primary-200 bg-primary-50/30 hover:bg-primary-50 hover:border-primary-300 transition-all">
                <div className="w-10 h-10 bg-primary-100 rounded-xl flex items-center justify-center"><Plus size={20} className="text-primary-600" /></div>
                <div className="text-left">
                  <p className="text-sm font-medium text-primary-700">Create New Asset</p>
                  <p className="text-xs text-primary-600/70">Create a new asset with this QR code</p>
                </div>
              </button>
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-neutral-200" /><span className="text-xs text-neutral-400 font-medium">OR</span><div className="flex-1 h-px bg-neutral-200" />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Link2 size={14} className="text-neutral-500" /><p className="text-sm font-medium text-neutral-700">Link to Existing Asset</p>
                </div>
                <div className="relative">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                  <input type="text" value={linkSearch} onChange={(e) => handleLinkSearch(e.target.value)}
                    placeholder="Search assets by name or tag..."
                    className="w-full pl-9 pr-4 py-2.5 border border-neutral-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-400/40 focus:border-primary-400" />
                </div>
                {linkSearching && <div className="mt-3 flex items-center justify-center gap-2 text-sm text-neutral-500"><div className="w-4 h-4 border-2 border-neutral-200 border-t-neutral-500 rounded-full animate-spin" />Searching...</div>}
                {linkResults.length > 0 && (
                  <div className="mt-3 space-y-2 max-h-48 overflow-y-auto">
                    {linkResults.map((asset) => (
                      <button key={asset.id} onClick={() => linkQrToAsset(asset.id)} disabled={linking}
                        className="w-full text-left p-3 rounded-xl border border-neutral-200 hover:border-primary-300 hover:bg-primary-50/50 transition-all disabled:opacity-50">
                        <div className="flex items-center justify-between">
                          <div><p className="text-sm font-medium text-neutral-800">{asset.equipment_name || asset.asset_tag}</p>
                            <p className="text-xs text-neutral-500 mt-0.5">{asset.asset_tag}{asset.qr_code_id && ` - QR: ${asset.qr_code_id}`}</p></div>
                          <Check size={16} className="text-primary-500" />
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                {linkSearch.trim() && !linkSearching && linkResults.length === 0 && <p className="mt-3 text-xs text-neutral-500 text-center">No assets found</p>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
