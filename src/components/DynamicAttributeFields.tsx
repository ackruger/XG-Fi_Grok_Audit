import { useMemo } from 'react'
import { ExternalLink } from 'lucide-react'
import type { AssetAttributeDefinition, AttributeAppSection } from '../types'

const SECTION_LABELS: Record<AttributeAppSection, string> = {
  technical: 'Technical / Design',
  service: 'Service',
  electrical_controls: 'Electrical & Controls',
}

const SECTION_ORDER: AttributeAppSection[] = ['technical', 'service', 'electrical_controls']

const INPUT_CLS =
  'w-full px-3 py-2.5 bg-white border border-neutral-200 rounded-xl text-sm text-neutral-900 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-primary-400/40 focus:border-primary-400'

interface DynamicAttributeFieldsProps {
  definitions: AssetAttributeDefinition[]
  values: Record<string, string>
  onChange: (definitionId: string, value: string) => void
  section?: AttributeAppSection
  readOnly?: boolean
}

export default function DynamicAttributeFields({
  definitions,
  values,
  onChange,
  section,
  readOnly = false,
}: DynamicAttributeFieldsProps) {
  const grouped = useMemo(() => {
    const filtered = section ? definitions.filter((d) => d.app_section === section) : definitions
    const groups: Partial<Record<AttributeAppSection, AssetAttributeDefinition[]>> = {}
    for (const def of filtered) {
      ;(groups[def.app_section] ??= []).push(def)
    }
    for (const key of Object.keys(groups) as AttributeAppSection[]) {
      groups[key]!.sort((a, b) => a.sort_order - b.sort_order || a.display_name.localeCompare(b.display_name))
    }
    return groups
  }, [definitions, section])

  const sectionsToRender = SECTION_ORDER.filter((s) => grouped[s]?.length)
  if (sectionsToRender.length === 0) return null

  return (
    <div className="space-y-5">
      {sectionsToRender.map((sec) => (
        <div key={sec}>
          {!section && <p className="text-sm font-medium text-neutral-800 mb-2">{SECTION_LABELS[sec]}</p>}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {grouped[sec]!.map((def) => (
              <FieldRenderer
                key={def.id}
                definition={def}
                value={values[def.id] ?? ''}
                onChange={onChange}
                readOnly={readOnly}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function FieldLabel({ def }: { def: AssetAttributeDefinition }) {
  return (
    <label className="block text-sm font-medium text-neutral-800 mb-1">
      {def.display_name}
      {def.unit && <span className="text-neutral-500 font-normal"> ({def.unit})</span>}
      {def.is_required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
  )
}

function ReadOnlyValue({ value, def }: { value: string; def: AssetAttributeDefinition }) {
  if (def.data_type === 'boolean') {
    return <p className="text-sm text-neutral-900">{value === 'true' ? 'Yes' : 'No'}</p>
  }
  if (def.data_type === 'url' && value) {
    return (
      <a href={value} target="_blank" rel="noopener noreferrer" className="text-sm text-primary-600 hover:underline inline-flex items-center gap-1">
        {value}
        <ExternalLink size={12} />
      </a>
    )
  }
  return <p className="text-sm text-neutral-900 whitespace-pre-wrap">{value || '—'}</p>
}

function FieldRenderer({
  definition: def,
  value,
  onChange,
  readOnly,
}: {
  definition: AssetAttributeDefinition
  value: string
  onChange: (id: string, v: string) => void
  readOnly: boolean
}) {
  const multiline = def.data_type === 'multiline'
  const wrapCls = multiline ? 'md:col-span-2' : ''

  return (
    <div className={wrapCls}>
      <FieldLabel def={def} />
      {readOnly ? (
        <ReadOnlyValue value={value} def={def} />
      ) : (
        <FieldInput def={def} value={value} onChange={onChange} />
      )}
    </div>
  )
}

function FieldInput({
  def,
  value,
  onChange,
}: {
  def: AssetAttributeDefinition
  value: string
  onChange: (id: string, v: string) => void
}) {
  switch (def.data_type) {
    case 'multiline':
      return (
        <textarea
          value={value}
          onChange={(e) => onChange(def.id, e.target.value)}
          rows={3}
          className={`${INPUT_CLS} resize-none`}
        />
      )
    case 'number':
      return (
        <input type="number" value={value} onChange={(e) => onChange(def.id, e.target.value)} className={INPUT_CLS} />
      )
    case 'date':
      return (
        <input type="date" value={value} onChange={(e) => onChange(def.id, e.target.value)} className={INPUT_CLS} />
      )
    case 'select':
      return (
        <select value={value} onChange={(e) => onChange(def.id, e.target.value)} className={INPUT_CLS}>
          <option value="">Select…</option>
          {(def.options ?? []).map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      )
    case 'boolean':
      return (
        <button
          type="button"
          role="switch"
          aria-checked={value === 'true'}
          onClick={() => onChange(def.id, value === 'true' ? 'false' : 'true')}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            value === 'true' ? 'bg-primary-500' : 'bg-neutral-300'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
              value === 'true' ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      )
    case 'url':
      return (
        <div className="relative">
          <input type="url" value={value} onChange={(e) => onChange(def.id, e.target.value)} placeholder="https://…" className={INPUT_CLS} />
          {value && (
            <a
              href={value}
              target="_blank"
              rel="noopener noreferrer"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-primary-500"
            >
              <ExternalLink size={14} />
            </a>
          )}
        </div>
      )
    default:
      return (
        <input type="text" value={value} onChange={(e) => onChange(def.id, e.target.value)} className={INPUT_CLS} />
      )
  }
}
