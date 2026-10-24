import { useState } from 'react'
import { useFacility } from '../context/FacilityContext'
import { Building2, Plus, Pencil, X, Check, MapPin, Archive } from 'lucide-react'
import type { Facility } from '../types'

export default function FacilitiesPage() {
  const { facilities, currentFacility, setCurrentFacility, currentOrganization, createFacility, updateFacility, refreshAll } = useFacility()
  const [showCreate, setShowCreate] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 lg:p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">Facilities</h1>
          {currentOrganization && (
            <p className="text-sm text-neutral-500 mt-1">{currentOrganization.name}</p>
          )}
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-primary-600 text-white rounded-xl text-sm font-semibold hover:bg-primary-700 transition-colors shadow-sm"
        >
          <Plus size={16} />
          New Facility
        </button>
      </div>

      {showCreate && currentOrganization && (
        <FacilityForm
          organizationId={currentOrganization.id}
          onSave={async (data) => {
            await createFacility({ ...data, organization_id: currentOrganization.id })
            setShowCreate(false)
          }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {facilities.length === 0 && !showCreate && (
        <div className="text-center py-16">
          <Building2 size={48} className="mx-auto text-neutral-300 mb-4" />
          <h2 className="text-lg font-semibold text-neutral-600 mb-2">No facilities yet</h2>
          <p className="text-neutral-400 text-sm">Create your first facility to start managing assets.</p>
        </div>
      )}

      <div className="space-y-3">
        {facilities.map(f => (
          <div key={f.id}>
            {editingId === f.id ? (
              <FacilityForm
                facility={f}
                organizationId={f.organization_id}
                onSave={async (data) => {
                  await updateFacility(f.id, data)
                  setEditingId(null)
                }}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <FacilityCard
                facility={f}
                isActive={currentFacility?.id === f.id}
                onSelect={() => setCurrentFacility(f)}
                onEdit={() => setEditingId(f.id)}
                onArchive={async () => {
                  if (confirm('Archive this facility? It will be hidden from the list.')) {
                    await updateFacility(f.id, { is_active: false })
                    if (currentFacility?.id === f.id) {
                      const remaining = facilities.filter(x => x.id !== f.id && x.is_active)
                      setCurrentFacility(remaining[0] || null)
                    }
                    await refreshAll()
                  }
                }}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function FacilityCard({ facility, isActive, onSelect, onEdit, onArchive }: {
  facility: Facility
  isActive: boolean
  onSelect: () => void
  onEdit: () => void
  onArchive: () => void
}) {
  const addressParts = [facility.address_line_1, facility.city, facility.province_state].filter(Boolean)
  const address = addressParts.join(', ')

  return (
    <div className={`bg-white rounded-xl border-2 transition-all ${isActive ? 'border-primary-400 shadow-md shadow-primary-100' : 'border-neutral-200 hover:border-neutral-300'}`}>
      <div className="flex items-start gap-4 p-5">
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${isActive ? 'bg-primary-100 text-primary-600' : 'bg-neutral-100 text-neutral-500'}`}>
          <Building2 size={22} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold text-neutral-900">{facility.name}</h3>
            {facility.code && (
              <span className="text-xs px-2 py-0.5 bg-neutral-100 text-neutral-500 rounded-full font-mono">{facility.code}</span>
            )}
            {isActive && (
              <span className="text-xs px-2 py-0.5 bg-primary-50 text-primary-600 rounded-full font-medium">Active</span>
            )}
          </div>
          {facility.description && <p className="text-sm text-neutral-500 mb-1">{facility.description}</p>}
          {address && (
            <p className="text-xs text-neutral-400 flex items-center gap-1">
              <MapPin size={12} /> {address}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1">
          {!isActive && (
            <button
              onClick={onSelect}
              className="px-3 py-1.5 text-xs font-medium text-primary-600 bg-primary-50 hover:bg-primary-100 rounded-lg transition-colors"
            >
              Open
            </button>
          )}
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
        </div>
      </div>
    </div>
  )
}

function FacilityForm({ facility, organizationId, onSave, onCancel }: {
  facility?: Facility
  organizationId: string
  onSave: (data: Partial<Facility> & { name: string; organization_id: string }) => Promise<void>
  onCancel: () => void
}) {
  const [name, setName] = useState(facility?.name || '')
  const [code, setCode] = useState(facility?.code || '')
  const [description, setDescription] = useState(facility?.description || '')
  const [addressLine1, setAddressLine1] = useState(facility?.address_line_1 || '')
  const [addressLine2, setAddressLine2] = useState(facility?.address_line_2 || '')
  const [city, setCity] = useState(facility?.city || '')
  const [provinceState, setProvinceState] = useState(facility?.province_state || '')
  const [postalCode, setPostalCode] = useState(facility?.postal_code || '')
  const [country, setCountry] = useState(facility?.country || '')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    await onSave({
      name: name.trim(),
      organization_id: organizationId,
      code: code.trim() || null,
      description: description.trim() || null,
      address_line_1: addressLine1.trim() || null,
      address_line_2: addressLine2.trim() || null,
      city: city.trim() || null,
      province_state: provinceState.trim() || null,
      postal_code: postalCode.trim() || null,
      country: country.trim() || null,
    } as Partial<Facility> & { name: string; organization_id: string })
    setSaving(false)
  }

  const inputClass = 'w-full px-3 py-2.5 bg-neutral-50 border border-neutral-200 rounded-xl text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 outline-none transition-all'

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-neutral-200 p-5 mb-3 shadow-sm">
      <h3 className="font-semibold text-neutral-900 mb-4">{facility ? 'Edit Facility' : 'New Facility'}</h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-neutral-600 mb-1">
            Facility Name <span className="text-error-500">*</span>
          </label>
          <input type="text" value={name} onChange={e => setName(e.target.value)} className={inputClass} placeholder="e.g. Vancouver Head Office" required />
        </div>

        <div>
          <label className="block text-xs font-medium text-neutral-600 mb-1">Code</label>
          <input type="text" value={code} onChange={e => setCode(e.target.value)} className={inputClass} placeholder="e.g. VAN-HQ" />
        </div>

        <div>
          <label className="block text-xs font-medium text-neutral-600 mb-1">Country</label>
          <input type="text" value={country} onChange={e => setCountry(e.target.value)} className={inputClass} placeholder="e.g. Canada" />
        </div>

        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-neutral-600 mb-1">Description</label>
          <input type="text" value={description} onChange={e => setDescription(e.target.value)} className={inputClass} placeholder="Brief description" />
        </div>

        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-neutral-600 mb-1">Address Line 1</label>
          <input type="text" value={addressLine1} onChange={e => setAddressLine1(e.target.value)} className={inputClass} placeholder="Street address" />
        </div>

        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-neutral-600 mb-1">Address Line 2</label>
          <input type="text" value={addressLine2} onChange={e => setAddressLine2(e.target.value)} className={inputClass} placeholder="Suite, unit, floor" />
        </div>

        <div>
          <label className="block text-xs font-medium text-neutral-600 mb-1">City</label>
          <input type="text" value={city} onChange={e => setCity(e.target.value)} className={inputClass} placeholder="City" />
        </div>

        <div>
          <label className="block text-xs font-medium text-neutral-600 mb-1">Province / State</label>
          <input type="text" value={provinceState} onChange={e => setProvinceState(e.target.value)} className={inputClass} placeholder="Province or State" />
        </div>

        <div>
          <label className="block text-xs font-medium text-neutral-600 mb-1">Postal Code</label>
          <input type="text" value={postalCode} onChange={e => setPostalCode(e.target.value)} className={inputClass} placeholder="Postal / ZIP" />
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
          {facility ? 'Save Changes' : 'Create Facility'}
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
