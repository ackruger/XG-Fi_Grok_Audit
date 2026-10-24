import { useEffect, useState, useRef, useCallback } from 'react'
import { Printer, QrCode, CheckSquare, Square, Copy, Check } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useFacility } from '../context/FacilityContext'
import type { Asset } from '../types'
import { getAssetDeepLink, getPublicAppBaseUrl, hasConfiguredPublicAppUrl } from '../lib/appUrl'

export default function QRAdminPage() {
  const { currentFacility } = useFacility()
  const [assets, setAssets] = useState<Asset[]>([])
  const [selectedAssets, setSelectedAssets] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const printRef = useRef<HTMLDivElement>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const copyUrl = useCallback((assetQrId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const url = getAssetDeepLink(assetQrId)
    navigator.clipboard.writeText(url).then(() => {
      setCopiedId(assetQrId)
      setTimeout(() => setCopiedId(prev => prev === assetQrId ? null : prev), 2000)
    })
  }, [])

  useEffect(() => {
    fetchAssets()
  }, [currentFacility])

  async function fetchAssets() {
    if (!currentFacility) return
    const { data } = await supabase
      .from('assets')
      .select('*')
      .eq('facility_id', currentFacility.id)
      .is('deleted_at', null)
      .not('qr_code_id', 'is', null)
      .order('equipment_name', { ascending: true })
    setAssets(data || [])
    setLoading(false)
  }

  function toggleSelect(id: string) {
    setSelectedAssets(prev =>
      prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id]
    )
  }

  function selectAll() {
    if (selectedAssets.length === assets.length) {
      setSelectedAssets([])
    } else {
      setSelectedAssets(assets.map(a => a.id))
    }
  }

  function handlePrint() {
    if (!printRef.current) return
    const printWindow = window.open('', '_blank')
    if (!printWindow) return

    const canvases = printRef.current.querySelectorAll('canvas')
    const cards = printRef.current.querySelectorAll('.qr-card')
    let cardsHtml = ''

    cards.forEach((card, i) => {
      const canvas = canvases[i]
      const imgSrc = canvas ? canvas.toDataURL() : ''
      const paragraphs = card.querySelectorAll('p')
      let textHtml = ''
      paragraphs.forEach(p => {
        const escaped = p.textContent?.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') || ''
        const cls = p.className ? ` class="${p.className}"` : ''
        textHtml += `<p${cls}>${escaped}</p>`
      })
      cardsHtml += `<div class="qr-card"><img src="${imgSrc}" width="140" height="140" />${textHtml}</div>`
    })

    printWindow.document.write(`
      <html>
        <head>
          <title>Xg-Fi QR Codes</title>
          <style>
            body { font-family: system-ui, sans-serif; margin: 0; padding: 20px; }
            .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
            .qr-card { text-align: center; border: 1px solid #e5e5e5; padding: 16px; border-radius: 8px; break-inside: avoid; }
            .qr-card img { display: block; margin: 0 auto 8px; }
            .qr-card p { margin: 4px 0; font-size: 12px; color: #525252; }
            .qr-card .name { font-size: 14px; font-weight: 600; color: #171717; }
            @media print { .grid { grid-template-columns: repeat(3, 1fr); } }
          </style>
        </head>
        <body>
          <div class="grid">${cardsHtml}</div>
          <script>window.onload = () => window.print();<\/script>
        </body>
      </html>
    `)
    printWindow.document.close()
  }

  const selectedAssetsList = assets.filter(a => selectedAssets.includes(a.id))
  const publicBaseUrl = getPublicAppBaseUrl()
  const hasCanonicalBase = hasConfiguredPublicAppUrl()

  return (
    <div className="p-4 lg:p-8 max-w-5xl mx-auto bg-neutral-50 min-h-screen">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">QR Code Management</h1>
          <p className="text-sm text-neutral-500 mt-1">Generate and print QR codes for your assets</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={selectAll}
            className="px-3 py-2 border border-neutral-200 rounded-xl text-sm font-medium text-neutral-900 hover:bg-neutral-100 transition-colors"
          >
            {selectedAssets.length === assets.length && assets.length > 0 ? 'Deselect All' : 'Select All'}
          </button>
          {selectedAssets.length > 0 && (
            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3 py-2 bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-600 hover:to-primary-700 text-white rounded-xl text-sm font-medium shadow-md shadow-primary-200 transition-colors"
            >
              <Printer size={16} />
              Print ({selectedAssets.length})
            </button>
          )}
        </div>
      </div>

      <div className={`mb-5 rounded-xl border px-3 py-2.5 text-xs ${hasCanonicalBase ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-amber-50 border-amber-200 text-amber-700'}`}>
        <span className="font-medium">QR / NFC base URL:</span> <span className="font-mono">{publicBaseUrl}</span>
        {!hasCanonicalBase && (
          <span className="block mt-1">Set VITE_PUBLIC_APP_URL to your permanent production domain before programming NFC tags. Until then, links use the current browser domain.</span>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="w-8 h-8 border-2 border-primary-200 border-t-primary-500 rounded-full animate-spin" />
        </div>
      ) : assets.length === 0 ? (
        <div className="bg-white rounded-2xl border border-neutral-200 p-8 text-center shadow-sm">
          <div className="w-12 h-12 bg-neutral-100 rounded-xl flex items-center justify-center mx-auto mb-3">
            <QrCode size={24} className="text-neutral-400" />
          </div>
          <p className="text-neutral-500">No assets yet. Create assets first to generate QR codes.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {assets.map(asset => (
            <div
              key={asset.id}
              onClick={() => toggleSelect(asset.id)}
              className={`bg-white rounded-2xl border p-4 cursor-pointer transition-all shadow-sm ${
                selectedAssets.includes(asset.id)
                  ? 'border-primary-400 ring-2 ring-primary-100'
                  : 'border-neutral-200 hover:border-neutral-300 hover:shadow-md'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="shrink-0 mt-0.5">
                  {selectedAssets.includes(asset.id) ? (
                    <CheckSquare size={20} className="text-primary-600" />
                  ) : (
                    <Square size={20} className="text-neutral-300" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-neutral-900 truncate">{asset.equipment_name || asset.asset_tag}</p>
                  <p className="text-xs text-neutral-500 mt-0.5">{asset.asset_tag}</p>
                  {asset.equipment_type && (
                    <p className="text-xs text-neutral-400 mt-0.5">{asset.equipment_type}</p>
                  )}
                </div>
              </div>
              <div className="mt-3 flex justify-center bg-neutral-50 rounded-xl p-3">
                <QRCanvas value={getAssetDeepLink(asset.qr_code_id!)} size={120} />
              </div>
              <div className="mt-2 flex items-center gap-1">
                <p className="flex-1 min-w-0 text-[10px] text-neutral-400 font-mono truncate" title={getAssetDeepLink(asset.qr_code_id!)}>
                  {getAssetDeepLink(asset.qr_code_id!)}
                </p>
                <button
                  onClick={(e) => copyUrl(asset.qr_code_id!, e)}
                  className="shrink-0 p-1 rounded-lg hover:bg-neutral-100 transition-colors"
                  title="Copy URL"
                >
                  {copiedId === asset.qr_code_id ? (
                    <Check size={14} className="text-emerald-500" />
                  ) : (
                    <Copy size={14} className="text-neutral-400" />
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Off-screen print area for canvas-to-image conversion */}
      <div ref={printRef} className="fixed left-[-9999px] top-0">
        {selectedAssetsList.map(asset => (
          <div key={asset.id} className="qr-card">
            <QRCanvas value={getAssetDeepLink(asset.qr_code_id!)} size={140} />
            <p className="name">{asset.equipment_name || asset.asset_tag}</p>
            <p>{asset.asset_tag}</p>
            <p>{asset.qr_code_id}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function QRCanvas({ value, size }: { value: string; size: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (canvasRef.current) {
      import('qrcode').then(QR => {
        QR.toCanvas(canvasRef.current, value, {
          width: size,
          margin: 1,
          color: { dark: '#171717', light: '#ffffff' },
        })
      })
    }
  }, [value, size])

  return <canvas ref={canvasRef} width={size} height={size} />
}
