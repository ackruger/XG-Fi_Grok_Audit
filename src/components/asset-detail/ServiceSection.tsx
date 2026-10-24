import { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, Trash2, X, Check, Wrench, Package } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { AssetAttributeDefinition, AssetServicePart } from '../../types';
import DynamicAttributeFields from '../DynamicAttributeFields';

interface Props {
  assetId: string;
  assetTypeId: string | null;
  canEdit: boolean;
}

const INPUT_CLS =
  'w-full px-3 py-2.5 bg-white border border-neutral-200 rounded-xl text-sm focus:ring-2 focus:ring-primary-400/40 focus:border-primary-400 outline-none transition-shadow';

const PART_TYPE_OPTIONS = ['Filter', 'Belt', 'Consumable', 'Replacement Part', 'Other'];

const emptyPart: Omit<AssetServicePart, 'id' | 'asset_id' | 'created_at' | 'updated_at'> = {
  name: '',
  part_type: null,
  size: null,
  part_number: null,
  manufacturer: null,
  quantity: 1,
  unit_cost: null,
  lead_time_days: null,
  service_interval_days: null,
  notes: null,
  last_replaced_at: null,
  next_replacement_at: null,
};

export default function ServiceSection({ assetId, assetTypeId, canEdit }: Props) {
  const [definitions, setDefinitions] = useState<AssetAttributeDefinition[]>([]);
  const [attrValues, setAttrValues] = useState<Record<string, string>>({});
  const [savedValues, setSavedValues] = useState<Record<string, string>>({});
  const [editingAttrs, setEditingAttrs] = useState(false);
  const [parts, setParts] = useState<AssetServicePart[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingPart, setEditingPart] = useState<AssetServicePart | null>(null);
  const [form, setForm] = useState(emptyPart);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const promises: Promise<void>[] = [];

    if (assetTypeId) {
      promises.push(
        Promise.resolve(supabase
          .from('asset_attribute_definitions')
          .select('*')
          .eq('asset_type_id', assetTypeId)
          .eq('app_section', 'service')
          .order('sort_order')
          .then(({ data }) => {
            setDefinitions(data ?? []);
          })),
        Promise.resolve(supabase
          .from('asset_attribute_values')
          .select('*, asset_attribute_definitions(*)')
          .eq('asset_id', assetId)
          .is('design_profile_id', null)
          .then(({ data }) => {
            const vals: Record<string, string> = {};
            (data ?? []).forEach((v: any) => {
              const def = v.asset_attribute_definitions as AssetAttributeDefinition | null;
              if (def?.app_section === 'service') {
                vals[v.attribute_definition_id] = v.value_text ?? v.value_numeric?.toString() ?? '';
              }
            });
            setAttrValues(vals);
            setSavedValues(vals);
          }))
      );
    }

    promises.push(
      Promise.resolve(supabase
        .from('asset_service_parts')
        .select('*')
        .eq('asset_id', assetId)
        .order('name')
        .then(({ data }) => setParts(data ?? [])))
    );

    await Promise.all(promises);
    setLoading(false);
  }, [assetId, assetTypeId]);

  useEffect(() => { load(); }, [load]);

  const saveAttributes = async () => {
    const missing = definitions
      .filter(d => d.is_required && !(attrValues[d.id] ?? '').trim())
      .map(d => d.display_name);
    if (missing.length > 0) {
      setValidationErrors(missing);
      return;
    }
    setValidationErrors([]);
    setSaving(true);
    for (const def of definitions) {
      const val = attrValues[def.id] ?? '';
      const isNumeric = def.data_type === 'number';
      const existing = savedValues[def.id];

      if (val === (existing ?? '')) continue;

      const row: any = {
        asset_id: assetId,
        attribute_definition_id: def.id,
        design_profile_id: null,
        value_text: isNumeric ? null : val || null,
        value_numeric: isNumeric && val ? parseFloat(val) : null,
      };

      await supabase.from('asset_attribute_values').upsert(row, {
        onConflict: 'asset_id,attribute_definition_id,design_profile_id',
      });
    }
    setSavedValues({ ...attrValues });
    setEditingAttrs(false);
    setSaving(false);
  };

  const cancelAttrs = () => {
    setAttrValues({ ...savedValues });
    setEditingAttrs(false);
    setValidationErrors([]);
  };

  const openAddPart = () => {
    setEditingPart(null);
    setForm({ ...emptyPart });
    setModalOpen(true);
  };

  const openEditPart = (p: AssetServicePart) => {
    setEditingPart(p);
    setForm({
      name: p.name,
      part_type: p.part_type,
      size: p.size,
      part_number: p.part_number,
      manufacturer: p.manufacturer,
      quantity: p.quantity,
      unit_cost: p.unit_cost,
      lead_time_days: p.lead_time_days,
      service_interval_days: p.service_interval_days,
      notes: p.notes,
      last_replaced_at: p.last_replaced_at,
      next_replacement_at: p.next_replacement_at,
    });
    setModalOpen(true);
  };

  const savePart = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    const row = {
      asset_id: assetId,
      name: form.name.trim(),
      part_type: form.part_type || null,
      size: form.size || null,
      part_number: form.part_number || null,
      manufacturer: form.manufacturer || null,
      quantity: form.quantity ?? 1,
      unit_cost: form.unit_cost ?? null,
      lead_time_days: form.lead_time_days ?? null,
      service_interval_days: form.service_interval_days ?? null,
      notes: form.notes || null,
      last_replaced_at: form.last_replaced_at || null,
      next_replacement_at: form.next_replacement_at || null,
    };

    if (editingPart) {
      await supabase.from('asset_service_parts').update(row).eq('id', editingPart.id);
    } else {
      await supabase.from('asset_service_parts').insert(row);
    }
    setModalOpen(false);
    setSaving(false);
    load();
  };

  const deletePart = async () => {
    if (!deleteId) return;
    await supabase.from('asset_service_parts').delete().eq('id', deleteId);
    setDeleteId(null);
    load();
  };

  const setField = (key: string, value: any) => setForm((f) => ({ ...f, [key]: value }));

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-8 h-8 border-2 border-primary-200 border-t-primary-500 rounded-full animate-spin" />
      </div>
    );
  }

  const hasServiceDefs = assetTypeId && definitions.length > 0;

  return (
    <div className="space-y-8">
      {/* ── Service Attributes ── */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-neutral-800">
            <Wrench className="w-4 h-4 text-primary-500" /> Service Attributes
          </h3>
          {canEdit && hasServiceDefs && !editingAttrs && (
            <button onClick={() => setEditingAttrs(true)} className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700 font-medium">
              <Pencil className="w-3.5 h-3.5" /> Edit
            </button>
          )}
          {editingAttrs && (
            <div className="flex items-center gap-2">
              <button onClick={cancelAttrs} className="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-700">
                <X className="w-3.5 h-3.5" /> Cancel
              </button>
              <button onClick={saveAttributes} disabled={saving} className="flex items-center gap-1 text-xs text-white bg-gradient-to-r from-primary-500 to-primary-600 px-3 py-1.5 rounded-lg font-medium shadow-sm shadow-primary-200 disabled:opacity-50">
                <Check className="w-3.5 h-3.5" /> {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          )}
        </div>
        {validationErrors.length > 0 && (
          <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded-xl">
            <p className="text-xs font-semibold text-amber-800 mb-1">Required fields are missing:</p>
            {validationErrors.map(name => (
              <p key={name} className="text-xs text-amber-700">{name} is required.</p>
            ))}
          </div>
        )}
        {hasServiceDefs ? (
          <div className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm">
            <DynamicAttributeFields
              definitions={definitions}
              values={attrValues}
              onChange={(id, val) => setAttrValues((v) => ({ ...v, [id]: val }))}
              section="service"
              readOnly={!editingAttrs}
            />
          </div>
        ) : (
          <p className="text-sm text-neutral-400 italic">No service fields configured for this asset type.</p>
        )}
      </section>

      {/* ── Service Parts ── */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-neutral-800">
            <Package className="w-4 h-4 text-primary-500" /> Service Parts
          </h3>
          {canEdit && (
            <button onClick={openAddPart} className="flex items-center gap-1 text-xs text-white bg-gradient-to-r from-primary-500 to-primary-600 px-3 py-1.5 rounded-lg font-medium shadow-sm shadow-primary-200">
              <Plus className="w-3.5 h-3.5" /> Add Part
            </button>
          )}
        </div>

        {parts.length === 0 ? (
          <p className="text-sm text-neutral-400 italic">No service parts added.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {parts.map((p) => (
              <div key={p.id} className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-neutral-800 truncate">{p.name}</p>
                    {p.part_type && <p className="text-xs text-primary-600 font-medium mt-0.5">{p.part_type}</p>}
                    {p.part_number && <p className="text-xs text-neutral-500 mt-0.5">#{p.part_number}</p>}
                  </div>
                  {canEdit && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => openEditPart(p)} className="p-1.5 rounded-lg hover:bg-neutral-100 text-neutral-400 hover:text-primary-600"><Pencil className="w-3.5 h-3.5" /></button>
                      <button onClick={() => setDeleteId(p.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-neutral-400 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  )}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-neutral-500">
                  {p.manufacturer && <span>Mfr: {p.manufacturer}</span>}
                  <span>Qty: {p.quantity}</span>
                  {p.size && <span>Size: {p.size}</span>}
                  {p.unit_cost != null && <span>Cost: ${p.unit_cost.toFixed(2)}</span>}
                  {p.service_interval_days != null && <span>Service: {p.service_interval_days}d</span>}
                  {p.lead_time_days != null && <span>Lead: {p.lead_time_days}d</span>}
                </div>
                {p.notes && <p className="mt-2 text-xs text-neutral-400 line-clamp-2">{p.notes}</p>}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Part Modal ── */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => setModalOpen(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-neutral-100">
              <h4 className="text-sm font-semibold text-neutral-800">{editingPart ? 'Edit Part' : 'Add Part'}</h4>
              <button onClick={() => setModalOpen(false)} className="p-1 rounded-lg hover:bg-neutral-100 text-neutral-400"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-medium text-neutral-600">Part Type</span>
                  <select className={INPUT_CLS} value={form.part_type ?? ''} onChange={(e) => setField('part_type', e.target.value || null)}>
                    <option value="">Select type...</option>
                    {PART_TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </label>
                <label className="block"><span className="text-xs font-medium text-neutral-600">Name *</span><input className={INPUT_CLS} value={form.name} onChange={(e) => setField('name', e.target.value)} /></label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block"><span className="text-xs font-medium text-neutral-600">Manufacturer</span><input className={INPUT_CLS} value={form.manufacturer ?? ''} onChange={(e) => setField('manufacturer', e.target.value)} /></label>
                <label className="block"><span className="text-xs font-medium text-neutral-600">Part Number</span><input className={INPUT_CLS} value={form.part_number ?? ''} onChange={(e) => setField('part_number', e.target.value)} /></label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block"><span className="text-xs font-medium text-neutral-600">Size</span><input className={INPUT_CLS} value={form.size ?? ''} onChange={(e) => setField('size', e.target.value)} placeholder="e.g. 20x25x2" /></label>
                <label className="block"><span className="text-xs font-medium text-neutral-600">Quantity</span><input type="number" min={0} className={INPUT_CLS} value={form.quantity ?? 1} onChange={(e) => setField('quantity', parseInt(e.target.value) || 1)} /></label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block"><span className="text-xs font-medium text-neutral-600">Service Interval (days)</span><input type="number" min={0} className={INPUT_CLS} value={form.service_interval_days ?? ''} onChange={(e) => setField('service_interval_days', e.target.value ? parseInt(e.target.value) : null)} placeholder="How often to service" /></label>
                <label className="block"><span className="text-xs font-medium text-neutral-600">Unit Cost</span><input type="number" min={0} step="0.01" className={INPUT_CLS} value={form.unit_cost ?? ''} onChange={(e) => setField('unit_cost', e.target.value ? parseFloat(e.target.value) : null)} /></label>
              </div>
              <label className="block"><span className="text-xs font-medium text-neutral-600">Lead Time (days)</span><input type="number" min={0} className={INPUT_CLS} value={form.lead_time_days ?? ''} onChange={(e) => setField('lead_time_days', e.target.value ? parseInt(e.target.value) : null)} placeholder="How long to obtain" /></label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block"><span className="text-xs font-medium text-neutral-600">Last Replaced</span><input type="date" className={INPUT_CLS} value={form.last_replaced_at ?? ''} onChange={(e) => setField('last_replaced_at', e.target.value || null)} /></label>
                <label className="block"><span className="text-xs font-medium text-neutral-600">Next Replacement</span><input type="date" className={INPUT_CLS} value={form.next_replacement_at ?? ''} onChange={(e) => setField('next_replacement_at', e.target.value || null)} /></label>
              </div>
              <label className="block"><span className="text-xs font-medium text-neutral-600">Notes</span><textarea rows={2} className={INPUT_CLS} value={form.notes ?? ''} onChange={(e) => setField('notes', e.target.value)} /></label>
            </div>
            <div className="flex justify-end gap-2 p-4 border-t border-neutral-100">
              <button onClick={() => setModalOpen(false)} className="px-4 py-2 text-sm text-neutral-600 hover:bg-neutral-100 rounded-xl">Cancel</button>
              <button onClick={savePart} disabled={saving || !form.name.trim()} className="px-4 py-2 text-sm text-white bg-gradient-to-r from-primary-500 to-primary-600 rounded-xl font-medium shadow-sm shadow-primary-200 disabled:opacity-50">
                {saving ? 'Saving…' : editingPart ? 'Update' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Confirm ── */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => setDeleteId(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 text-center" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm text-neutral-700 mb-4">Delete this service part? This cannot be undone.</p>
            <div className="flex justify-center gap-3">
              <button onClick={() => setDeleteId(null)} className="px-4 py-2 text-sm text-neutral-600 hover:bg-neutral-100 rounded-xl">Cancel</button>
              <button onClick={deletePart} className="px-4 py-2 text-sm text-white bg-red-500 hover:bg-red-600 rounded-xl font-medium">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
