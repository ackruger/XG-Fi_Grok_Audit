import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Html5Qrcode } from 'html5-qrcode'
import { Camera, Search, X, Upload, QrCode, Link2, Plus, Check } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useFacility } from '../context/FacilityContext'

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

export default function ScanPage() {
  const navigate = useNavigate()
  const { currentFacility } = useFacility()
  const [scanning, setScanning] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')
  const [uploadStatus, setUploadStatus] = useState('')
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
    setScanning(true)
  }

  async function initScanner() {
    try {
      const scanner = new Html5Qrcode('qr-reader')
      scannerRef.current = scanner

      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
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
      setError(`No asset found for QR code: ${qrId}`)
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
    } catch {
      setUploadStatus('')
      setError('Could not detect a QR code in that image. Try a clearer photo.')
    }

    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleLinkSearch(query: string) {
    setLinkSearch(query)
    if (!query.trim() || !currentFacility) {
      setLinkResults([])
      return
    }
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

    await supabase
      .from('assets')
      .update({ qr_code_id: decodedQrId, updated_at: new Date().toISOString() })
      .eq('id', assetId)

    setLinking(false)
    setShowLinkDialog(false)
    setDecodedQrId(null)
    setLinkSearch('')
    setLinkResults([])
    navigate(`/assets/${assetId}`)
  }

  function handleCreateNewAsset() {
    setShowLinkDialog(false)
    navigate('/assets?action=create')
  }

  function closeLinkDialog() {
    setShowLinkDialog(false)
    setDecodedQrId(null)
    setLinkSearch('')
    setLinkResults([])
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    if (!searchQuery.trim() || !currentFacility) return
    setSearching(true)

    const { data } = await supabase
      .from('assets')
      .select('id, asset_tag, equipment_name, status, locations(building, floor, room_area)')
      .eq('facility_id', currentFacility.id)
      .is('deleted_at', null)
      .or(`asset_tag.ilike.%${sanitizeFilterValue(searchQuery)}%,equipment_name.ilike.%${sanitizeFilterValue(searchQuery)}%,qr_code_id.ilike.%${sanitizeFilterValue(searchQuery)}%`)
      .limit(20)

    setSearchResults(data || [])
    setSearching(false)
  }

  useEffect(() => {
    if (scanning && !scannerRef.current) {
      initScanner()
    }
  }, [scanning])

  useEffect(() => {
    return () => { stopScanner() }
  }, [])

  return (
    <div className="p-4 lg:p-8 max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-neutral-900">Scan Asset</h1>
        <p className="text-sm text-neutral-500 mt-1">Scan a QR code, upload an image, or search by tag</p>
      </div>

      {/* QR Scanner Area */}
      <div className="bg-white rounded-2xl border border-neutral-200 overflow-hidden mb-4 shadow-sm">
        {scanning ? (
          <div className="relative">
            <div id="qr-reader" className="w-full" />
            <button
              onClick={stopScanner}
              className="absolute top-3 right-3 bg-white/90 p-2 rounded-full shadow-md hover:bg-white"
            >
              <X size={20} className="text-neutral-700" />
            </button>
          </div>
        ) : (
          <button
            onClick={startScanner}
            className="w-full flex flex-col items-center justify-center py-16 gap-4 hover:bg-primary-50/50 transition-colors"
          >
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
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileUpload}
          className="hidden"
          id="qr-upload"
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          className="w-full flex items-center gap-3 px-4 py-4 rounded-xl border-2 border-dashed border-neutral-200 hover:border-primary-300 hover:bg-primary-50/50 transition-all"
        >
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

      {/* Hidden element for file-based QR scanning */}
      <div id="qr-file-reader" className="hidden" />

      {error && (
        <div className="bg-error-50 border border-error-100 text-error-700 text-sm px-4 py-3 rounded-xl mb-4">
          {error}
        </div>
      )}

      {/* Search Fallback */}
      <div className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm">
        <form onSubmit={handleSearch} className="flex gap-2">
          <div className="relative flex-1">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by asset tag, name, or QR ID..."
              className="w-full pl-10 pr-4 py-2.5 border border-neutral-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-400/40 focus:border-primary-400"
            />
          </div>
          <button
            type="submit"
            disabled={searching}
            className="px-4 py-2.5 bg-gradient-to-r from-primary-500 to-primary-600 text-white rounded-xl text-sm font-medium hover:from-primary-600 hover:to-primary-700 transition-all disabled:opacity-50 shadow-md shadow-primary-200"
          >
            Search
          </button>
        </form>

        {searchResults.length > 0 && (
          <div className="mt-4 space-y-2">
            {searchResults.map((asset) => (
              <button
                key={asset.id}
                onClick={() => navigate(`/assets/${asset.id}`)}
                className="w-full text-left p-3 rounded-xl border border-neutral-200 hover:border-primary-300 hover:bg-primary-50/50 transition-all"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-neutral-800">{asset.equipment_name || asset.asset_tag}</p>
                    <p className="text-xs text-neutral-500 mt-0.5">
                      {asset.locations?.building} {asset.locations?.floor && `/ ${asset.locations.floor}`} {asset.locations?.room_area && `/ ${asset.locations.room_area}`}
                    </p>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full font-medium ${getStatusColor(asset.status)}`}>
                    {formatStatus(asset.status)}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Link QR Code Dialog */}
      {showLinkDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[80vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-200">
              <div>
                <h2 className="text-base font-semibold text-neutral-900">Link QR Code</h2>
                <p className="text-xs text-neutral-500 mt-0.5">
                  QR ID: <span className="font-mono text-neutral-700">{decodedQrId}</span>
                </p>
              </div>
              <button onClick={closeLinkDialog} className="p-1.5 hover:bg-neutral-100 rounded-lg">
                <X size={18} className="text-neutral-600" />
              </button>
            </div>

            <div className="p-5 flex-1 overflow-y-auto space-y-4">
              <p className="text-sm text-neutral-600">
                This QR code is not linked to any asset. Choose an option below:
              </p>

              {/* Create New Asset */}
              <button
                onClick={handleCreateNewAsset}
                className="w-full flex items-center gap-3 p-4 rounded-xl border-2 border-dashed border-primary-200 bg-primary-50/30 hover:bg-primary-50 hover:border-primary-300 transition-all"
              >
                <div className="w-10 h-10 bg-primary-100 rounded-xl flex items-center justify-center">
                  <Plus size={20} className="text-primary-600" />
                </div>
                <div className="text-left">
                  <p className="text-sm font-medium text-primary-700">Create New Asset</p>
                  <p className="text-xs text-primary-600/70">Create a new asset with this QR code</p>
                </div>
              </button>

              {/* Divider */}
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-neutral-200" />
                <span className="text-xs text-neutral-400 font-medium">OR</span>
                <div className="flex-1 h-px bg-neutral-200" />
              </div>

              {/* Link to Existing */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Link2 size={14} className="text-neutral-500" />
                  <p className="text-sm font-medium text-neutral-700">Link to Existing Asset</p>
                </div>
                <div className="relative">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                  <input
                    type="text"
                    value={linkSearch}
                    onChange={(e) => handleLinkSearch(e.target.value)}
                    placeholder="Search assets by name or tag..."
                    className="w-full pl-9 pr-4 py-2.5 border border-neutral-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-400/40 focus:border-primary-400"
                  />
                </div>

                {linkSearching && (
                  <div className="mt-3 flex items-center justify-center gap-2 text-sm text-neutral-500">
                    <div className="w-4 h-4 border-2 border-neutral-200 border-t-neutral-500 rounded-full animate-spin" />
                    Searching...
                  </div>
                )}

                {linkResults.length > 0 && (
                  <div className="mt-3 space-y-2 max-h-48 overflow-y-auto">
                    {linkResults.map((asset) => (
                      <button
                        key={asset.id}
                        onClick={() => linkQrToAsset(asset.id)}
                        disabled={linking}
                        className="w-full text-left p-3 rounded-xl border border-neutral-200 hover:border-primary-300 hover:bg-primary-50/50 transition-all disabled:opacity-50"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium text-neutral-800">
                              {asset.equipment_name || asset.asset_tag}
                            </p>
                            <p className="text-xs text-neutral-500 mt-0.5">
                              {asset.asset_tag}
                              {asset.qr_code_id && ` - QR: ${asset.qr_code_id}`}
                            </p>
                          </div>
                          <Check size={16} className="text-primary-500 opacity-0 group-hover:opacity-100" />
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {linkSearch.trim() && !linkSearching && linkResults.length === 0 && (
                  <p className="mt-3 text-xs text-neutral-500 text-center">No assets found</p>
                )}
              </div>
            </div>
          </div>
        </div>
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
  return status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
}
