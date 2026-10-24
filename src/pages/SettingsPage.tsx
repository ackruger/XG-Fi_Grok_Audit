import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useFacility } from '../context/FacilityContext'
import { LogOut, User, Building, QrCode, BookOpen, Camera } from 'lucide-react'
import { supabase } from '../lib/supabase'

export default function SettingsPage() {
  const navigate = useNavigate()
  const { profile, signOut, refreshProfile } = useAuth()
  const { facilities, currentFacility, setCurrentFacility } = useFacility()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(profile?.name || '')
  const [company, setCompany] = useState(profile?.company || '')
  const [trade, setTrade] = useState(profile?.trade || '')
  const [saving, setSaving] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (profile && !editing) {
      setName(profile.name || '')
      setCompany(profile.company || '')
      setTrade(profile.trade || '')
    }
  }, [profile, editing])

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !profile) return

    setUploadingAvatar(true)
    const ext = file.name.split('.').pop()
    const path = `${profile.id}/avatar.${ext}`

    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(path, file, { upsert: true })

    if (uploadError) {
      setUploadingAvatar(false)
      return
    }

    const { data: urlData } = supabase.storage
      .from('avatars')
      .getPublicUrl(path)

    const avatarUrl = `${urlData.publicUrl}?t=${Date.now()}`

    const { error: avatarUpdateErr } = await supabase
      .from('profiles')
      .update({ avatar_url: avatarUrl, updated_at: new Date().toISOString() })
      .eq('id', profile.id)

    if (avatarUpdateErr) {
      alert('Failed to update avatar. Please try again.')
      setUploadingAvatar(false)
      return
    }

    await refreshProfile()
    setUploadingAvatar(false)
    if (avatarInputRef.current) avatarInputRef.current.value = ''
  }

  async function handleSave() {
    if (!profile) return
    setSaving(true)
    const { error } = await supabase
      .from('profiles')
      .update({ name, company, trade, updated_at: new Date().toISOString() })
      .eq('id', profile.id)
    if (error) {
      alert('Failed to save profile. Please try again.')
      setSaving(false)
      return
    }
    await refreshProfile()
    setSaving(false)
    setEditing(false)
  }

  return (
    <div className="p-4 lg:p-8 max-w-2xl mx-auto bg-neutral-50 min-h-screen">
      <h1 className="text-xl font-bold text-neutral-900 mb-6">Settings</h1>

      {/* Profile Section */}
      <div className="bg-white rounded-2xl border border-neutral-200 p-5 mb-4 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-neutral-900 flex items-center gap-2">
            <User size={16} />
            Profile
          </h2>
          {!editing && (
            <button onClick={() => setEditing(true)} className="text-xs text-primary-600 font-medium">
              Edit
            </button>
          )}
        </div>

        {/* Avatar Upload */}
        <div className="flex items-center gap-4 mb-5">
          <div className="relative group">
            <div className="w-16 h-16 rounded-2xl overflow-hidden bg-primary-50 flex items-center justify-center border-2 border-neutral-200">
              {profile?.avatar_url ? (
                <img
                  src={profile.avatar_url}
                  alt="Profile"
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="text-primary-700 text-lg font-semibold">
                  {profile?.name?.charAt(0)?.toUpperCase() || '?'}
                </span>
              )}
            </div>
            <button
              onClick={() => avatarInputRef.current?.click()}
              disabled={uploadingAvatar}
              className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 rounded-2xl flex items-center justify-center transition-opacity cursor-pointer"
            >
              {uploadingAvatar ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <Camera size={18} className="text-white" />
              )}
            </button>
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              onChange={handleAvatarUpload}
              className="hidden"
            />
          </div>
          <div>
            <p className="text-sm font-medium text-neutral-800">{profile?.name || 'No name'}</p>
            <button
              onClick={() => avatarInputRef.current?.click()}
              disabled={uploadingAvatar}
              className="text-xs text-primary-600 font-medium hover:text-primary-700 mt-0.5"
            >
              {uploadingAvatar ? 'Uploading...' : 'Change photo'}
            </button>
          </div>
        </div>

        {editing ? (
          <div className="space-y-3">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name"
              className="w-full px-3 py-2 bg-white border border-neutral-200 rounded-xl text-sm text-neutral-900 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-primary-400/40 focus:border-primary-400"
            />
            <input
              type="text"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="Company"
              className="w-full px-3 py-2 bg-white border border-neutral-200 rounded-xl text-sm text-neutral-900 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-primary-400/40 focus:border-primary-400"
            />
            <input
              type="text"
              value={trade}
              onChange={(e) => setTrade(e.target.value)}
              placeholder="Trade"
              className="w-full px-3 py-2 bg-white border border-neutral-200 rounded-xl text-sm text-neutral-900 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-primary-400/40 focus:border-primary-400"
            />
            <div className="flex gap-2">
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-600 hover:to-primary-700 text-white rounded-xl text-sm font-medium disabled:opacity-50 shadow-md shadow-primary-200"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={() => setEditing(false)}
                className="px-4 py-2 bg-neutral-200 text-neutral-900 rounded-xl text-sm font-medium hover:bg-neutral-300"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-neutral-500">Name</span>
              <span className="text-neutral-900 font-medium">{profile?.name || '-'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-500">Email</span>
              <span className="text-neutral-900">{profile?.email}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-500">Company</span>
              <span className="text-neutral-900">{profile?.company || '-'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-500">Trade</span>
              <span className="text-neutral-900">{profile?.trade || '-'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-500">Role</span>
              <span className="text-neutral-900 capitalize">{profile?.role}</span>
            </div>
          </div>
        )}
      </div>

      {/* Facility Switcher */}
      <div className="bg-white rounded-2xl border border-neutral-200 p-5 mb-4 shadow-sm">
        <h2 className="text-sm font-semibold text-neutral-900 flex items-center gap-2 mb-4">
          <Building size={16} />
          Facilities
        </h2>
        <div className="space-y-2">
          {facilities.map(facility => (
            <button
              key={facility.id}
              onClick={() => setCurrentFacility(facility)}
              className={`w-full text-left px-3 py-2.5 rounded-lg border text-sm transition-all flex items-center justify-between ${
                facility.id === currentFacility?.id
                  ? 'border-primary-400 bg-primary-50 text-primary-600'
                  : 'border-neutral-200 hover:border-neutral-300'
              }`}
            >
              <span className="font-medium">{facility.name}</span>
              {facility.id === currentFacility?.id && (
                <span className="text-xs bg-primary-50 text-primary-600 px-2 py-0.5 rounded-full">Active</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* QR Code Admin */}
      <button
        onClick={() => navigate('/qr-admin')}
        className="w-full flex items-center justify-between bg-white rounded-2xl border border-neutral-200 p-5 mb-4 hover:border-primary-400 transition-colors shadow-sm"
      >
        <div className="flex items-center gap-3">
          <QrCode size={20} className="text-primary-600" />
          <div className="text-left">
            <p className="text-sm font-semibold text-neutral-900">QR Code Management</p>
            <p className="text-xs text-neutral-500">Generate and print QR codes for assets</p>
          </div>
        </div>
      </button>

      {/* User Manual */}
      <button
        onClick={() => navigate('/user-manual')}
        className="w-full flex items-center justify-between bg-white rounded-2xl border border-neutral-200 p-5 mb-4 hover:border-primary-400 transition-colors shadow-sm"
      >
        <div className="flex items-center gap-3">
          <BookOpen size={20} className="text-primary-600" />
          <div className="text-left">
            <p className="text-sm font-semibold text-neutral-900">User Manual</p>
            <p className="text-xs text-neutral-500">View or download the complete user guide</p>
          </div>
        </div>
      </button>

      {/* Sign Out */}
      <button
        onClick={signOut}
        className="w-full flex items-center justify-center gap-2 bg-neutral-200 text-neutral-900 py-3 rounded-xl text-sm font-medium hover:bg-neutral-300 transition-colors"
      >
        <LogOut size={16} />
        Sign Out
      </button>
    </div>
  )
}
