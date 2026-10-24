import { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, Trash2, X, Check, Layers, AlertTriangle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { AssetAttributeDefinition, AssetDesignProfile, AssetAttributeValue } from '../../types';
import DynamicAttributeFields from '../DynamicAttributeFields';

interface Props {
  assetId: string;
  assetTypeId: string | null;
  canEdit: boolean;
}

const INPUT_CLS =
  'w-full px-3 py-2.5 bg-white border border-neutral-200 rounded-xl text-sm focus:ring-2 focus:ring-primary-400/40 focus:border-primary-400 outline-none transition-shadow';

export default function TechnicalSection({ assetId, assetTypeId, canEdit }: Props) {
  const [definitions, setDefinitions] = useState<AssetAttributeDefinition[]>([]);
  const [profiles, setProfiles] = useState<AssetDesignProfile[]>([]);
  const [allValues, setAllValues] = useState<AssetAttributeValue[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [attrValues, setAttrValues] = useState<Record<string, string>>({});
  const [savedValues, setSavedValues] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  // Profile management
  const [creatingProfile, setCreatingProfile] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const promises: Promise<void>[] = [];

    if (assetTypeId) {
      promises.push(
        Promise.resolve(supabase
          .from('asset_attribute_definitions')
          .select('*')
          .eq('asset_type_id', assetTypeId)
          .eq('app_section', 'technical')
          .order('sort_order')
          .then(({ data }) => setDefinitions(data ?? [])))
      );
    }

    promises.push(
      Promise.resolve(supabase
        .from('asset_design_profiles')
        .select('*')
        .eq('asset_id', assetId)
        .order('sort_order')
        .then(({ data }) => setProfiles(data ?? []))),
      Promise.resolve(supabase
        .from('asset_attribute_values')
        .select('*, asset_attribute_definitions(*)')
        .eq('asset_id', assetId)
        .then(({ data }) => setAllValues((data as AssetAttributeValue[]) ?? [])))
    );

    await Promise.all(promises);
    setLoading(false);
  }, [assetId, assetTypeId]);

  useEffect(() => { load(); }, [load]);

  // Derive displayed values when selection or raw values change
  useEffect(() => {
    const vals: Record<string, string> = {};
    allValues.forEach((v) => {
      const def = v.asset_attribute_definitions;
      if (def?.app_section !== 'technical') return;

      const matchesProfile =
        selectedProfileId === null
          ? v.design_profile_id === null
          : v.design_profile_id === selectedProfileId;

      if (matchesProfile) {
        vals[v.attribute_definition_id] = v.value_text ?? v.value_numeric?.toString() ?? '';
      }
    });
    setAttrValues(vals);
    setSavedValues(vals);
    setEditing(false);
  }, [allValues, selectedProfileId]);

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
      if (val === (savedValues[def.id] ?? '')) continue;

      const isNumeric = def.data_type === 'number';
      const row: any = {
        asset_id: assetId,
        attribute_definition_id: def.id,
        design_profile_id: selectedProfileId,
        value_text: isNumeric ? null : val || null,
        value_numeric: isNumeric && val ? parseFloat(val) : null,
      };

      await supabase.from('asset_attribute_values').upsert(row, {
        onConflict: 'asset_id,attribute_definition_id,design_profile_id',
      });
    }
    setSaving(false);
    setEditing(false);
    load();
  };

  const cancelEdit = () => {
    setAttrValues({ ...savedValues });
    setEditing(false);
  };

  // ── Profile CRUD ──
  const createProfile = async () => {
    if (!newProfileName.trim()) return;
    const nextSort = profiles.length ? Math.max(...profiles.map((p) => p.sort_order ?? 0)) + 1 : 0;
    await supabase.from('asset_design_profiles').insert({
      asset_id: assetId,
      name: newProfileName.trim(),
      sort_order: nextSort,
    });
    setNewProfileName('');
    setCreatingProfile(false);
    load();
  };

  const renameProfile = async (id: string) => {
    if (!renameValue.trim()) return;
    await supabase.from('asset_design_profiles').update({ name: renameValue.trim() }).eq('id', id);
    setRenamingId(null);
    load();
  };

  const deleteProfile = async () => {
    if (!deleteConfirmId) return;
    await supabase.from('asset_design_profiles').delete().eq('id', deleteConfirmId);
    if (selectedProfileId === deleteConfirmId) setSelectedProfileId(null);
    setDeleteConfirmId(null);
    load();
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-8 h-8 border-2 border-primary-200 border-t-primary-500 rounded-full animate-spin" />
      </div>
    );
  }

  const hasDefs = assetTypeId && definitions.length > 0;

  if (!hasDefs) {
    return <p className="text-sm text-neutral-400 italic">No technical fields configured for this asset type.</p>;
  }

  const hasProfiles = profiles.length > 0;
  const selectedProfile = profiles.find((p) => p.id === selectedProfileId) ?? null;

  return (
    <div className="space-y-5">
      {/* ── Profile Selector ── */}
      {hasProfiles && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Layers className="w-4 h-4 text-primary-500" />
            <span className="text-xs font-semibold text-neutral-600 uppercase tracking-wide">Design Profiles</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setSelectedProfileId(null)}
              className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
                selectedProfileId === null
                  ? 'bg-primary-500 text-white border-primary-500 shadow-sm shadow-primary-200'
                  : 'bg-white text-neutral-600 border-neutral-200 hover:border-primary-300 hover:text-primary-600'
              }`}
            >
              Base Values
            </button>
            {profiles.map((p) => (
              <div key={p.id} className="flex items-center gap-1">
                {renamingId === p.id ? (
                  <div className="flex items-center gap-1">
                    <input
                      autoFocus
                      className="px-2 py-1 text-xs border border-neutral-200 rounded-lg w-28 focus:ring-2 focus:ring-primary-400/40 outline-none"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') renameProfile(p.id); if (e.key === 'Escape') setRenamingId(null); }}
                    />
                    <button onClick={() => renameProfile(p.id)} className="p-1 text-primary-500 hover:text-primary-700"><Check className="w-3.5 h-3.5" /></button>
                    <button onClick={() => setRenamingId(null)} className="p-1 text-neutral-400 hover:text-neutral-600"><X className="w-3.5 h-3.5" /></button>
                  </div>
                ) : (
                  <button
                    onClick={() => setSelectedProfileId(p.id)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
                      selectedProfileId === p.id
                        ? 'bg-primary-500 text-white border-primary-500 shadow-sm shadow-primary-200'
                        : 'bg-white text-neutral-600 border-neutral-200 hover:border-primary-300 hover:text-primary-600'
                    }`}
                  >
                    {p.name}
                    {p.sort_order != null && <span className="ml-1 opacity-50">#{p.sort_order}</span>}
                  </button>
                )}
                {canEdit && renamingId !== p.id && (
                  <>
                    <button
                      onClick={() => { setRenamingId(p.id); setRenameValue(p.name); }}
                      className="p-1 rounded-lg hover:bg-neutral-100 text-neutral-400 hover:text-primary-600"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => setDeleteConfirmId(p.id)}
                      className="p-1 rounded-lg hover:bg-red-50 text-neutral-400 hover:text-red-500"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </>
                )}
              </div>
            ))}

            {canEdit && !creatingProfile && (
              <button
                onClick={() => setCreatingProfile(true)}
                className="flex items-center gap-1 px-3 py-1.5 text-xs text-primary-600 border border-dashed border-primary-300 rounded-full hover:bg-primary-50 font-medium"
              >
                <Plus className="w-3 h-3" /> Profile
              </button>
            )}
          </div>

          {creatingProfile && (
            <div className="flex items-center gap-2 mt-2">
              <input
                autoFocus
                placeholder="Profile name"
                className={INPUT_CLS + ' max-w-xs'}
                value={newProfileName}
                onChange={(e) => setNewProfileName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') createProfile(); if (e.key === 'Escape') setCreatingProfile(false); }}
              />
              <button onClick={createProfile} disabled={!newProfileName.trim()} className="p-2 text-primary-500 hover:text-primary-700 disabled:opacity-40"><Check className="w-4 h-4" /></button>
              <button onClick={() => setCreatingProfile(false)} className="p-2 text-neutral-400 hover:text-neutral-600"><X className="w-4 h-4" /></button>
            </div>
          )}
        </div>
      )}

      {/* Add first profile button when none exist */}
      {!hasProfiles && canEdit && (
        <div>
          {creatingProfile ? (
            <div className="flex items-center gap-2">
              <input
                autoFocus
                placeholder="Profile name"
                className={INPUT_CLS + ' max-w-xs'}
                value={newProfileName}
                onChange={(e) => setNewProfileName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') createProfile(); if (e.key === 'Escape') setCreatingProfile(false); }}
              />
              <button onClick={createProfile} disabled={!newProfileName.trim()} className="p-2 text-primary-500 hover:text-primary-700 disabled:opacity-40"><Check className="w-4 h-4" /></button>
              <button onClick={() => setCreatingProfile(false)} className="p-2 text-neutral-400 hover:text-neutral-600"><X className="w-4 h-4" /></button>
            </div>
          ) : (
            <button
              onClick={() => setCreatingProfile(true)}
              className="flex items-center gap-1.5 text-xs text-primary-600 hover:text-primary-700 font-medium"
            >
              <Plus className="w-3.5 h-3.5" /> Add Design Profile
            </button>
          )}
        </div>
      )}

      {/* ── Attribute Values ── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-neutral-800">
            {selectedProfile ? selectedProfile.name : 'Base Values'}
          </h3>
          {canEdit && !editing && (
            <button onClick={() => setEditing(true)} className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700 font-medium">
              <Pencil className="w-3.5 h-3.5" /> Edit
            </button>
          )}
          {editing && (
            <div className="flex items-center gap-2">
              <button onClick={cancelEdit} className="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-700">
                <X className="w-3.5 h-3.5" /> Cancel
              </button>
              <button
                onClick={saveAttributes}
                disabled={saving}
                className="flex items-center gap-1 text-xs text-white bg-gradient-to-r from-primary-500 to-primary-600 px-3 py-1.5 rounded-lg font-medium shadow-sm shadow-primary-200 disabled:opacity-50"
              >
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

        <div className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm">
          <DynamicAttributeFields
            definitions={definitions}
            values={attrValues}
            onChange={(id, val) => setAttrValues((v) => ({ ...v, [id]: val }))}
            section="technical"
            readOnly={!editing}
          />
        </div>
      </section>

      {/* ── Delete Profile Confirm ── */}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => setDeleteConfirmId(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              <h4 className="text-sm font-semibold text-neutral-800">Delete Profile</h4>
            </div>
            <p className="text-sm text-neutral-600 mb-5">
              This will permanently delete the profile <strong className="text-neutral-800">"{profiles.find((p) => p.id === deleteConfirmId)?.name}"</strong> and all attribute values associated with it.
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setDeleteConfirmId(null)} className="px-4 py-2 text-sm text-neutral-600 hover:bg-neutral-100 rounded-xl">Cancel</button>
              <button onClick={deleteProfile} className="px-4 py-2 text-sm text-white bg-red-500 hover:bg-red-600 rounded-xl font-medium">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
