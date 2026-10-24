import { createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'
import type { Organization, Facility } from '../types'

interface FacilityContextType {
  organizations: Organization[]
  currentOrganization: Organization | null
  setCurrentOrganization: (org: Organization | null) => void
  facilities: Facility[]
  currentFacility: Facility | null
  setCurrentFacility: (facility: Facility | null) => void
  loading: boolean
  createOrganization: (name: string, description?: string) => Promise<Organization | null>
  updateOrganization: (id: string, data: Partial<Organization>) => Promise<boolean>
  createFacility: (data: Partial<Facility> & { name: string; organization_id: string }) => Promise<Facility | null>
  updateFacility: (id: string, data: Partial<Facility>) => Promise<boolean>
  refreshAll: () => Promise<void>
}

const FacilityContext = createContext<FacilityContextType | undefined>(undefined)

async function acceptPendingInvitations(): Promise<boolean> {
  try {
    const result = await Promise.race([
      supabase.rpc('accept_pending_facility_invitations'),
      new Promise<{ error: { message: string } }>(resolve =>
        setTimeout(() => resolve({ error: { message: 'Invitation check timed out' } }), 5000)
      ),
    ])
    if (result.error) {
      console.error('Could not accept pending facility invitations:', result.error.message)
      return false
    }
    return true
  } catch (error) {
    console.error('Could not accept pending facility invitations:', error)
    return false
  }
}

export function FacilityProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [currentOrganization, setCurrentOrgState] = useState<Organization | null>(null)
  const [allFacilities, setAllFacilities] = useState<Facility[]>([])
  const [currentFacility, setCurrentFacilityState] = useState<Facility | null>(null)
  const [loading, setLoading] = useState(true)
  const fetchSequence = useRef(0)

  const orgFacilities = currentOrganization
    ? allFacilities.filter(f => f.organization_id === currentOrganization.id)
    : allFacilities

  function setCurrentOrganization(org: Organization | null) {
    setCurrentOrgState(org)
    if (org) {
      localStorage.setItem('xgfi_current_org', org.id)
      const orgFacs = allFacilities.filter(f => f.organization_id === org.id)
      if (currentFacility && currentFacility.organization_id !== org.id) {
        const savedFacId = localStorage.getItem('xgfi_current_facility')
        const savedFac = savedFacId ? orgFacs.find(f => f.id === savedFacId) : null
        setCurrentFacilityState(savedFac || orgFacs[0] || null)
      } else if (!currentFacility && orgFacs.length > 0) {
        setCurrentFacilityState(orgFacs[0])
      }
    }
  }

  function setCurrentFacility(facility: Facility | null) {
    setCurrentFacilityState(facility)
    if (facility) {
      localStorage.setItem('xgfi_current_facility', facility.id)
      const org = organizations.find(o => o.id === facility.organization_id)
      if (org && org.id !== currentOrganization?.id) {
        setCurrentOrgState(org)
        localStorage.setItem('xgfi_current_org', org.id)
      }
    }
  }

  const fetchData = useCallback(async (): Promise<boolean> => {
    const requestId = ++fetchSequence.current

    try {
      const [orgsRes, facsRes] = await Promise.all([
        supabase.from('organizations').select('*').eq('is_active', true).order('name'),
        supabase.from('facilities').select('*').eq('is_active', true).order('name'),
      ])

      if (orgsRes.error) {
        console.error('Could not load organizations:', orgsRes.error.message)
      }
      if (facsRes.error) {
        console.error('Could not load facilities:', facsRes.error.message)
      }

      if (requestId !== fetchSequence.current) return false

      const orgs = orgsRes.data || []
      const facs = facsRes.data || []

      const savedOrgId = localStorage.getItem('xgfi_current_org')
      const savedFacId = localStorage.getItem('xgfi_current_facility')

      let selectedOrg: Organization | null = null
      let selectedFac: Facility | null = null

      if (savedFacId) {
        selectedFac = facs.find(f => f.id === savedFacId) || null
      }
      if (savedOrgId) {
        selectedOrg = orgs.find(o => o.id === savedOrgId) || null
      }

      if (selectedFac && !selectedOrg) {
        selectedOrg = orgs.find(o => o.id === selectedFac!.organization_id) || null
      }

      if (!selectedOrg && orgs.length > 0) {
        selectedOrg = orgs[0]
      }

      if (selectedOrg && !selectedFac) {
        const orgFacs = facs.filter(f => f.organization_id === selectedOrg!.id)
        selectedFac = orgFacs[0] || null
      }

      if (selectedFac && selectedOrg && selectedFac.organization_id !== selectedOrg.id) {
        const orgFacs = facs.filter(f => f.organization_id === selectedOrg!.id)
        selectedFac = orgFacs[0] || null
      }

      setOrganizations(orgs)
      setAllFacilities(facs)
      setCurrentOrgState(selectedOrg)
      setCurrentFacilityState(selectedFac)
      return true
    } catch (error) {
      console.error('Could not load facility context:', error)
      return false
    } finally {
      if (requestId === fetchSequence.current) {
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    if (!session) {
      fetchSequence.current += 1
      setOrganizations([])
      setAllFacilities([])
      setCurrentFacilityState(null)
      setCurrentOrgState(null)
      setLoading(false)
      return
    }

    setLoading(true)

    async function initializeFacilityContext() {
      await acceptPendingInvitations()
      if (cancelled) return
      const ok = await fetchData()
      if (cancelled) return
      if (!ok) {
        await new Promise(r => setTimeout(r, 1000))
        if (cancelled) return
        await fetchData()
      }
    }

    const safetyTimer = setTimeout(() => {
      if (!cancelled) setLoading(false)
    }, 15000)

    void initializeFacilityContext()

    return () => {
      cancelled = true
      clearTimeout(safetyTimer)
      fetchSequence.current += 1
    }
  }, [session?.user?.id, fetchData])

  useEffect(() => {
    if (currentFacility) {
      localStorage.setItem('xgfi_current_facility', currentFacility.id)
    }
  }, [currentFacility])

  async function createOrganization(name: string, description?: string): Promise<Organization | null> {
    const { data, error } = await supabase.rpc('create_organization', {
      p_name: name,
      p_description: description || null,
    })
    if (error || !data) return null

    const org = data as unknown as Organization
    await fetchData()
    setCurrentOrganization(org)
    return org
  }

  async function updateOrganization(id: string, updates: Partial<Organization>): Promise<boolean> {
    const { error } = await supabase
      .from('organizations')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) return false
    await fetchData()
    return true
  }

  async function createFacility(data: Partial<Facility> & { name: string; organization_id: string }): Promise<Facility | null> {
    const { data: result, error } = await supabase.rpc('create_facility', {
      p_name: data.name,
      p_organization_id: data.organization_id,
      p_code: data.code || null,
      p_description: data.description || null,
    })

    if (error) {
      throw new Error(`Facility creation failed: ${error.message} (code: ${error.code})`)
    }
    if (!result) {
      throw new Error('Facility creation returned no data')
    }

    const fac = result as unknown as Facility
    await fetchData()
    setCurrentFacility(fac)
    return fac
  }

  async function updateFacility(id: string, data: Partial<Facility>): Promise<boolean> {
    const { error } = await supabase
      .from('facilities')
      .update({ ...data, updated_at: new Date().toISOString() })
      .eq('id', id)

    if (error) return false
    await fetchData()
    return true
  }

  async function refreshAll() {
    await fetchData()
  }

  return (
    <FacilityContext.Provider value={{
      organizations,
      currentOrganization,
      setCurrentOrganization,
      facilities: orgFacilities,
      currentFacility,
      setCurrentFacility,
      loading,
      createOrganization,
      updateOrganization,
      createFacility,
      updateFacility,
      refreshAll,
    }}>
      {children}
    </FacilityContext.Provider>
  )
}

export function useFacility() {
  const context = useContext(FacilityContext)
  if (!context) throw new Error('useFacility must be used within FacilityProvider')
  return context
}
