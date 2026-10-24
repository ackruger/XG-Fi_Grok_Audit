import { NavLink, Link, Outlet, useNavigate } from 'react-router-dom'
import { LayoutDashboard, AlertTriangle, Package, Sparkles, Settings, Tags, Users, Wrench, Menu, X, Briefcase, ChevronDown, Upload, FileText, MapPin } from 'lucide-react'
import { useFacility } from '../context/FacilityContext'
import { useAuth } from '../context/AuthContext'
import { useState } from 'react'

const navItems = [
  { to: '/find', icon: MapPin, label: 'Find' },
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/organizations', icon: Briefcase, label: 'Organizations' },
  { to: '/assets', icon: Package, label: 'Assets' },
  { to: '/cases', icon: AlertTriangle, label: 'Cases' },
  { to: '/tags', icon: Tags, label: 'Tags' },
  { to: '/team', icon: Users, label: 'Team' },
  { to: '/asset-types', icon: Wrench, label: 'Types' },
  { to: '/asset-import', icon: Upload, label: 'Data Import' },
  { to: '/documents', icon: FileText, label: 'Documents' },
  { to: '/ai-chat', icon: Sparkles, label: 'AI' },
  { to: '/settings', icon: Settings, label: 'Settings' },
]

const mobileNavItems = [
  { to: '/find', icon: MapPin, label: 'Find' },
  { to: '/dashboard', icon: LayoutDashboard, label: 'Home' },
  { to: '/assets', icon: Package, label: 'Assets' },
  { to: '/cases', icon: AlertTriangle, label: 'Cases' },
]

export default function AppLayout() {
  const navigate = useNavigate()
  const { currentOrganization, currentFacility, organizations, facilities, setCurrentOrganization, setCurrentFacility } = useFacility()
  const { profile } = useAuth()
  const [moreOpen, setMoreOpen] = useState(false)
  const [showSwitcher, setShowSwitcher] = useState(false)

  const moreItems = navItems.filter(n => !mobileNavItems.some(m => m.to === n.to))

  return (
    <div className="h-full flex flex-col lg:flex-row bg-neutral-50">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 bg-white border-r border-neutral-200">
        <div className="p-4 border-b border-neutral-200">
          <Link to="/dashboard" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
            <div className="w-9 h-9 bg-gradient-to-br from-primary-400 to-primary-600 rounded-xl flex items-center justify-center shadow-md shadow-primary-200">
              <span className="text-white font-bold text-xs tracking-wider">Xg</span>
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-sm font-bold text-neutral-900">Xg-Fi</h1>
              <p className="text-xs text-neutral-500 truncate">
                {currentFacility?.name || 'No facility'}
              </p>
            </div>
          </Link>

          {/* Context switcher */}
          <button
            onClick={() => setShowSwitcher(!showSwitcher)}
            className="mt-2 w-full flex items-center gap-2 px-2 py-1.5 rounded-lg bg-neutral-50 hover:bg-neutral-100 transition-colors text-left"
          >
            <Briefcase size={12} className="text-neutral-400 shrink-0" />
            <span className="text-xs text-neutral-600 truncate flex-1">
              {currentOrganization?.name || 'Select organization'}
            </span>
            <ChevronDown size={12} className={`text-neutral-400 transition-transform ${showSwitcher ? 'rotate-180' : ''}`} />
          </button>

          {showSwitcher && (
            <div className="mt-1 bg-white border border-neutral-200 rounded-xl shadow-lg p-1.5 space-y-0.5">
              {organizations.map(org => (
                <div key={org.id}>
                  <button
                    onClick={() => {
                      setCurrentOrganization(org)
                      setShowSwitcher(false)
                    }}
                    className={`w-full text-left px-2 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      currentOrganization?.id === org.id ? 'bg-primary-50 text-primary-700' : 'text-neutral-600 hover:bg-neutral-50'
                    }`}
                  >
                    {org.name}
                  </button>
                  {currentOrganization?.id === org.id && facilities.length > 0 && (
                    <div className="ml-3 mt-0.5 space-y-0.5">
                      {facilities.map(f => (
                        <button
                          key={f.id}
                          onClick={() => {
                            setCurrentFacility(f)
                            setShowSwitcher(false)
                          }}
                          className={`w-full text-left px-2 py-1 rounded text-xs transition-colors ${
                            currentFacility?.id === f.id ? 'text-primary-600 font-medium' : 'text-neutral-400 hover:text-neutral-600'
                          }`}
                        >
                          {f.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
                  isActive
                    ? 'bg-primary-50 text-primary-700 shadow-sm'
                    : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-800'
                }`
              }
            >
              <Icon size={20} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="p-4 border-t border-neutral-200">
          <button
            onClick={() => navigate('/settings')}
            className="w-full flex items-center gap-3 rounded-xl hover:bg-neutral-50 transition-colors p-1 -m-1 cursor-pointer"
          >
            <div className="w-9 h-9 rounded-xl bg-primary-50 flex items-center justify-center overflow-hidden">
              {profile?.avatar_url ? (
                <img src={profile?.avatar_url} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="text-primary-700 text-xs font-semibold">
                  {profile?.name?.charAt(0)?.toUpperCase() || '?'}
                </span>
              )}
            </div>
            <div className="flex-1 min-w-0 text-left">
              <p className="text-sm font-medium text-neutral-800 truncate">{profile?.name}</p>
              <p className="text-xs text-neutral-500 truncate">{profile?.role}</p>
            </div>
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto pb-20 lg:pb-0 bg-sunset-soft">
        <Outlet />
      </main>

      {/* Mobile More Menu */}
      {moreOpen && (
        <div className="lg:hidden fixed inset-0 z-[60]">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setMoreOpen(false)} />
          <div className="absolute bottom-16 left-2 right-2 bg-white rounded-2xl shadow-xl border border-neutral-200 p-2">
            <div className="grid grid-cols-4 gap-1">
              {moreItems.map(({ to, icon: Icon, label }) => (
                <NavLink
                  key={to}
                  to={to}
                  onClick={() => setMoreOpen(false)}
                  className={({ isActive }) =>
                    `flex flex-col items-center gap-1 py-3 px-1 rounded-xl text-xs font-medium transition-colors ${
                      isActive ? 'bg-primary-50 text-primary-700' : 'text-neutral-600 hover:bg-neutral-100'
                    }`
                  }
                >
                  <Icon size={20} />
                  {label}
                </NavLink>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Mobile Bottom Nav */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-lg border-t border-neutral-200 px-1 py-1.5 z-50">
        <div className="flex items-center justify-evenly">
          {mobileNavItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg text-[10px] font-medium transition-all duration-200 ${
                  isActive ? 'text-primary-600' : 'text-neutral-400'
                }`
              }
            >
              <Icon size={20} />
              <span>{label}</span>
            </NavLink>
          ))}
          <button
            onClick={() => setMoreOpen(!moreOpen)}
            className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg text-[10px] font-medium transition-all duration-200 ${
              moreOpen ? 'text-primary-600' : 'text-neutral-400'
            }`}
          >
            {moreOpen ? <X size={20} /> : <Menu size={20} />}
            <span>More</span>
          </button>
        </div>
      </nav>
    </div>
  )
}
