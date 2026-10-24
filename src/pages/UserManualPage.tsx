import { ArrowLeft, Download, Printer, Scan, LayoutDashboard, Package, AlertTriangle, Bot, QrCode, Settings, HelpCircle, Rocket, ClipboardList, Monitor } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

const downloadText = `XG-FI USER MANUAL - Field Intelligence Platform v1.0

1. OVERVIEW & WORKFLOW
Xg-Fi is a field intelligence platform that digitizes construction asset tracking. It connects physical equipment in the field to digital records via QR codes, enabling real-time status tracking, case reporting, and AI-powered insights.

How It Works (End-to-End):
  Step 1: PROJECT SETUP - Admin creates a project, team members are invited.
  Step 2: ASSET REGISTRATION - Assets are created with name, tag, location, status.
  Step 3: QR CODE GENERATION - QR codes generated and printed for each asset.
  Step 4: FIELD SCANNING - Workers scan QR codes to view asset status/history.
  Step 5: STATUS UPDATES - Workers add notes and change statuses as work progresses.
  Step 6: CASE REPORTING - Problems are reported directly from assets, prioritized and tracked.
  Step 7: MONITORING - Dashboard shows progress, AI answers project questions.

Typical Daily Workflow:
  Morning: Open app, scan QR codes on assigned equipment, review status/cases.
  During Work: Add updates, report cases, change statuses.
  End of Day: Check Dashboard, use AI for summary, review assignments.

2. REQUIREMENTS
  - Device: Modern smartphone, tablet, or computer with camera
  - Browser: Chrome, Safari, Firefox, or Edge (latest)
  - Internet: Wi-Fi or mobile data connection
  - Account: Email + password (min 6 characters)
  - No app installation needed (Progressive Web App)

  User Roles:
    Admin - Full access, create projects, manage users
    Manager - View all, add updates, manage QR codes
    Field Worker - Scan, update, report cases

3. GETTING STARTED
  Sign Up: Select "Sign Up", enter name/email/password.
  Sign In: Enter email and password.
  First-Time: Create or join a project after first sign-in.

4. SCANNING ASSETS
  QR Scan: Tap camera icon, point at QR code, auto-navigates to asset.
  Image Upload: Tap "Upload QR Code Image", select photo with QR code.
  Manual Search: Use search bar to find by tag, name, or QR ID.

5. DASHBOARD
  Progress Bar: Overall completion percentage.
  Stat Cards: Total Assets, Complete, Blocked, Open Cases.
  Status Breakdown: Visual chart of all statuses.
  Recent Activity: Latest updates across all assets.

6. MANAGING ASSETS
  View: Assets tab shows all project assets, search/filter available.
  Create: Tap "+ New Asset", fill details, select status.
  Detail: Tap asset for full info, history, and timeline.
  Update: From detail page, tap "Add Update" for notes/status changes.

  Status Flow: Not Started > In Progress > Complete > Verified
               Also: Blocked, Deficient, Pending Verification, Ready for Next Trade

7. TRACKING CASES
  View: Cases tab with filters for status and priority.
  Create: From asset detail, tap "Report Case", describe and set priority.
  Lifecycle: Open > In Progress > Resolved > Verified > Closed
  Priority: Critical (safety), High (urgent), Medium (soon), Low (convenient)

8. AI ASSISTANT
  Ask questions about project data in the AI Chat tab.
  Examples: "What's blocked?", "Today's progress?", "Status of [equipment]?"

9. QR CODE MANAGEMENT
  Access from Settings > QR Code Management.
  Generate codes for assets, print on label printers, attach to equipment.

10. SETTINGS
  Profile: Edit name, company, trade.
  Projects: Switch between projects.
  Sign Out: Bottom of Settings page.

11. TROUBLESHOOTING
  Camera issues: Check permissions, refresh page, use manual search.
  Can't find asset: Verify correct project, try different search terms.
  Updates not saving: Check internet, refresh and retry.
  Forgot password: Use reset link on Sign In page.

(c) 2026 Xg-Fi. All rights reserved.`

export default function UserManualPage() {
  const navigate = useNavigate()

  function handleDownload() {
    const blob = new Blob([downloadText], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'Xg-Fi_User_Manual.txt'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="p-4 lg:p-8 max-w-3xl mx-auto pb-24">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 print:hidden">
        <button
          onClick={() => navigate('/settings')}
          className="flex items-center gap-2 text-sm text-neutral-600 hover:text-neutral-900 transition-colors"
        >
          <ArrowLeft size={16} />
          Back to Settings
        </button>
        <div className="flex gap-2">
          <button
            onClick={() => window.print()}
            className="flex items-center gap-1.5 px-3 py-2 border border-neutral-200 rounded-xl text-sm font-medium text-neutral-700 hover:bg-neutral-100 transition-colors"
          >
            <Printer size={16} />
            Print
          </button>
          <button
            onClick={handleDownload}
            className="flex items-center gap-1.5 px-3 py-2 bg-gradient-to-r from-primary-500 to-primary-600 text-white rounded-xl text-sm font-medium hover:from-primary-600 hover:to-primary-700 transition-all shadow-md shadow-primary-200"
          >
            <Download size={16} />
            Download
          </button>
        </div>
      </div>

      {/* Title */}
      <div className="bg-gradient-to-br from-primary-500 to-primary-700 rounded-2xl p-8 mb-6 text-center shadow-lg shadow-primary-200/40">
        <h1 className="text-2xl lg:text-3xl font-bold text-white">Xg-Fi User Manual</h1>
        <p className="text-primary-100 text-sm mt-2">Field Intelligence Platform &middot; Version 1.0</p>
      </div>

      {/* Table of Contents */}
      <Section title="Table of Contents" icon={<ClipboardList size={18} />}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {[
            '1. Overview & Workflow',
            '2. Requirements',
            '3. Getting Started',
            '4. Scanning Assets',
            '5. Dashboard',
            '6. Managing Assets',
            '7. Tracking Cases',
            '8. AI Assistant',
            '9. QR Code Management',
            '10. Settings & Profile',
            '11. Troubleshooting',
          ].map(item => (
            <div key={item} className="text-sm text-neutral-700 py-1.5 px-3 rounded-lg bg-neutral-50">
              {item}
            </div>
          ))}
        </div>
      </Section>

      {/* 1. Overview & Workflow */}
      <Section title="1. Overview & Workflow" icon={<Rocket size={18} />}>
        <p className="text-sm text-neutral-700 leading-relaxed mb-6">
          Xg-Fi is a field intelligence platform that digitizes construction asset tracking.
          It connects physical equipment in the field to digital records via QR codes, enabling
          real-time status tracking, case reporting, and AI-powered insights.
        </p>

        <h4 className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-4">How It Works</h4>
        <div className="space-y-4 pl-2 mb-8">
          {[
            { step: '1', title: 'Project Setup', desc: 'Admin creates a project. Team members are invited and assigned roles.' },
            { step: '2', title: 'Asset Registration', desc: 'Assets (equipment, fixtures, systems) are created with name, tag, location, and status.' },
            { step: '3', title: 'QR Code Generation', desc: 'QR codes are generated for each asset, printed, and physically attached on-site.' },
            { step: '4', title: 'Field Scanning', desc: 'Workers scan QR codes with their phone camera to instantly view status and history.' },
            { step: '5', title: 'Status Updates', desc: 'Workers add notes and change statuses as work progresses through the lifecycle.' },
            { step: '6', title: 'Case Reporting', desc: 'Problems are reported directly from assets, prioritized, and tracked to resolution.' },
            { step: '7', title: 'Monitoring & Decisions', desc: 'Dashboard shows progress. AI Assistant answers questions about project data.' },
          ].map(item => (
            <div key={item.step} className="flex gap-3.5 items-start">
              <span className="flex-shrink-0 w-7 h-7 rounded-full bg-primary-100 text-primary-700 text-xs font-bold flex items-center justify-center">
                {item.step}
              </span>
              <div className="pt-0.5">
                <span className="text-sm font-semibold text-neutral-900">{item.title}</span>
                <p className="text-sm text-neutral-600 mt-0.5 leading-relaxed">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>

        <h4 className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-4">Typical Daily Workflow</h4>
        <div className="grid gap-3 sm:grid-cols-3 pl-2">
          <DailyCard
            title="Morning"
            items={['Open Xg-Fi on your phone', 'Navigate to assigned area', 'Scan QR codes on equipment', 'Review status & open cases']}
          />
          <DailyCard
            title="During Work"
            items={['Add updates as tasks complete', 'Report any new cases', 'Change asset statuses']}
          />
          <DailyCard
            title="End of Day"
            items={['Check Dashboard progress', 'Use AI for daily summary', 'Review new assignments']}
          />
        </div>
      </Section>

      {/* 2. Requirements */}
      <Section title="2. Requirements" icon={<Monitor size={18} />}>
        <div className="grid gap-4 sm:grid-cols-2">
          <InfoCard title="Device Requirements" items={[
            'Modern smartphone, tablet, or computer',
            'Camera access (for QR scanning)',
            'Internet connection (Wi-Fi or mobile data)',
            'Chrome, Safari, Firefox, or Edge browser',
          ]} />
          <InfoCard title="Account Requirements" items={[
            'Email address for registration',
            'Password (minimum 6 characters)',
            'Must create or be invited to a project',
          ]} />
          <InfoCard title="User Roles" items={[
            'Admin: Full access, create projects, manage users',
            'Manager: View all, add updates, manage QR codes',
            'Field Worker: Scan assets, add updates, report cases',
          ]} />
          <InfoCard title="No Installation Needed" items={[
            'Progressive Web App (PWA)',
            'Access directly via browser',
            'Add to home screen for app-like feel',
            'Previously viewed data available offline',
          ]} />
        </div>
      </Section>

      {/* 3. Getting Started */}
      <Section title="3. Getting Started" icon={<Rocket size={18} />}>
        <div className="space-y-5">
          <SubSection title="Signing Up">
            <BulletList items={[
              'Open the app and select "Sign Up"',
              'Enter your full name, email address, and password (min 6 characters)',
              'You will be signed in immediately after registration',
            ]} />
          </SubSection>
          <SubSection title="Signing In">
            <BulletList items={[
              'Enter your email and password on the Sign In screen',
              'Tap "Forgot password?" to receive a reset link if needed',
            ]} />
          </SubSection>
          <SubSection title="First-Time Setup">
            <BulletList items={[
              'After signing in, create or join a project',
              'Enter project name and optional address',
              'Switch between projects later in Settings',
            ]} />
          </SubSection>
        </div>
      </Section>

      {/* 4. Scanning Assets */}
      <Section title="4. Scanning Assets" icon={<Scan size={18} />}>
        <div className="space-y-5">
          <SubSection title="QR Code Scanning">
            <BulletList items={[
              'Tap the camera icon to activate your device camera',
              'Point at an asset\'s QR code',
              'The app auto-navigates to that asset\'s detail page',
            ]} />
          </SubSection>
          <SubSection title="Image Upload">
            <BulletList items={[
              'Tap "Upload QR Code Image"',
              'Select a photo containing a QR code from your device',
              'The app decodes and looks up the asset',
            ]} />
          </SubSection>
          <SubSection title="Manual Search">
            <BulletList items={[
              'Use the search bar on the Scan page',
              'Search by asset tag, equipment name, or QR code ID',
              'Tap any result to view full details',
            ]} />
          </SubSection>
        </div>
      </Section>

      {/* 5. Dashboard */}
      <Section title="5. Dashboard Overview" icon={<LayoutDashboard size={18} />}>
        <div className="space-y-5">
          <SubSection title="Progress Bar">
            <p className="text-sm text-neutral-600">Shows overall completion percentage including fully complete and pending-verification assets.</p>
          </SubSection>
          <SubSection title="Stat Cards">
            <BulletList items={[
              'Total Assets: All tracked assets in the project',
              'Complete: Assets marked as finished',
              'Blocked: Assets that cannot proceed',
              'Open Cases: Active cases needing attention',
            ]} />
          </SubSection>
          <SubSection title="Status Breakdown">
            <p className="text-sm text-neutral-600">
              Visual bar chart showing distribution across all statuses: Not Started, In Progress, Complete,
              Pending Verification, Blocked, Deficient, Ready for Next Trade.
            </p>
          </SubSection>
          <SubSection title="Recent Activity">
            <p className="text-sm text-neutral-600">Latest updates and events across all assets, showing who made each update and when.</p>
          </SubSection>
        </div>
      </Section>

      {/* 6. Managing Assets */}
      <Section title="6. Managing Assets" icon={<Package size={18} />}>
        <div className="space-y-5">
          <SubSection title="Viewing Assets">
            <BulletList items={[
              'The Assets tab shows all assets in your current project',
              'Use search to filter by name or tag',
              'Use the status dropdown to filter by current status',
            ]} />
          </SubSection>
          <SubSection title="Creating an Asset">
            <BulletList items={[
              'Tap "+ New Asset" button',
              'Fill in equipment name, asset tag, and location',
              'Select an initial status',
            ]} />
          </SubSection>
          <SubSection title="Adding Updates">
            <BulletList items={[
              'From asset detail page, tap "Add Update"',
              'Enter notes describing work done',
              'Select new status if it has changed',
              'Updates are timestamped and attributed to your profile',
            ]} />
          </SubSection>
          <SubSection title="Status Workflow">
            <div className="bg-neutral-50 rounded-xl p-4 text-sm text-neutral-700 font-mono leading-relaxed">
              Not Started &rarr; In Progress &rarr; Complete &rarr; Verified<br />
              <span className="text-neutral-400 ml-24">&#8627;</span> Blocked (can resume later)<br />
              <span className="text-neutral-400 ml-24">&#8627;</span> Deficient (needs rework)<br />
              <span className="text-neutral-400 ml-24">&#8627;</span> Pending Verification<br />
              <span className="text-neutral-400 ml-24">&#8627;</span> Ready for Next Trade
            </div>
          </SubSection>
        </div>
      </Section>

      {/* 7. Tracking Cases */}
      <Section title="7. Tracking Cases" icon={<AlertTriangle size={18} />}>
        <div className="space-y-5">
          <SubSection title="Creating a Case">
            <BulletList items={[
              'From an asset detail page, tap "Report Case"',
              'Describe the problem clearly',
              'Set the priority level',
              'Case is automatically linked to the asset',
            ]} />
          </SubSection>
          <SubSection title="Case Lifecycle">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {['Open', 'In Progress', 'Resolved', 'Verified', 'Closed'].map((s, i, arr) => (
                <span key={s} className="flex items-center gap-2">
                  <span className="px-2.5 py-1 bg-neutral-100 rounded-lg font-medium text-neutral-800">{s}</span>
                  {i < arr.length - 1 && <span className="text-neutral-400">&rarr;</span>}
                </span>
              ))}
            </div>
          </SubSection>
          <SubSection title="Priority Levels">
            <div className="grid grid-cols-2 gap-2">
              <PriorityBadge color="bg-red-100 text-red-800" label="Critical" desc="Safety hazard or work stoppage" />
              <PriorityBadge color="bg-orange-100 text-orange-800" label="High" desc="Needs prompt attention" />
              <PriorityBadge color="bg-yellow-100 text-yellow-800" label="Medium" desc="Address soon" />
              <PriorityBadge color="bg-green-100 text-green-800" label="Low" desc="When convenient" />
            </div>
          </SubSection>
        </div>
      </Section>

      {/* 8. AI Assistant */}
      <Section title="8. AI Assistant" icon={<Bot size={18} />}>
        <p className="text-sm text-neutral-700 leading-relaxed mb-4">
          The AI tab provides an intelligent assistant that analyzes your project data to answer questions and provide insights.
        </p>
        <SubSection title="Example Questions">
          <div className="space-y-2">
            {[
              'What assets are currently blocked?',
              'Give me a summary of today\'s progress',
              'Which areas have the most open cases?',
              'What\'s the status of [specific equipment]?',
            ].map(q => (
              <div key={q} className="text-sm bg-neutral-50 rounded-lg px-3 py-2 text-neutral-700 italic">
                "{q}"
              </div>
            ))}
          </div>
        </SubSection>
      </Section>

      {/* 9. QR Code Management */}
      <Section title="9. QR Code Management" icon={<QrCode size={18} />}>
        <div className="space-y-5">
          <SubSection title="Generating QR Codes">
            <BulletList items={[
              'Access from Settings > QR Code Management',
              'View all assets that need QR codes',
              'Select individual or batch-select multiple assets',
              'Generate printable QR code sheets',
            ]} />
          </SubSection>
          <SubSection title="Printing & Assigning">
            <BulletList items={[
              'QR codes formatted for standard label printers',
              'Each code includes the asset tag for identification',
              'Print labels and physically attach to equipment',
              'Scanning links the physical item to its digital record',
            ]} />
          </SubSection>
        </div>
      </Section>

      {/* 10. Settings */}
      <Section title="10. Settings & Profile" icon={<Settings size={18} />}>
        <div className="space-y-5">
          <SubSection title="Profile">
            <BulletList items={[
              'View and edit your name, company, and trade',
              'Email and role are displayed (managed by admins)',
            ]} />
          </SubSection>
          <SubSection title="Project Switching">
            <BulletList items={[
              'Switch between projects if you belong to multiple',
              'Active project is highlighted',
            ]} />
          </SubSection>
          <SubSection title="Sign Out">
            <p className="text-sm text-neutral-600">Tap "Sign Out" at the bottom of Settings. You will need to sign in again.</p>
          </SubSection>
        </div>
      </Section>

      {/* 11. Troubleshooting */}
      <Section title="11. Troubleshooting" icon={<HelpCircle size={18} />}>
        <div className="space-y-5">
          <SubSection title="Camera Not Working">
            <BulletList items={[
              'Ensure camera permissions are granted in browser/device settings',
              'Try refreshing the page',
              'Use image upload or manual search as alternatives',
            ]} />
          </SubSection>
          <SubSection title="Can\'t Find an Asset">
            <BulletList items={[
              'Verify you\'re in the correct project (check Settings)',
              'Try different search terms (tag, name, or QR ID)',
            ]} />
          </SubSection>
          <SubSection title="Updates Not Saving">
            <BulletList items={[
              'Check your internet connection',
              'Refresh the page and try again',
              'Contact your project admin if it persists',
            ]} />
          </SubSection>
          <SubSection title="Forgot Password">
            <BulletList items={[
              'Use "Forgot password?" link on the Sign In page',
              'Check email (including spam) for the reset link',
              'Link expires after 24 hours',
            ]} />
          </SubSection>
        </div>
      </Section>

      {/* Footer */}
      <div className="mt-8 text-center text-xs text-neutral-400 print:mt-12">
        2026 Xg-Fi. All rights reserved.
      </div>
    </div>
  )
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm p-5 lg:p-7 mb-5">
      <h2 className="text-base font-bold text-neutral-900 flex items-center gap-2.5 mb-5 pb-3 border-b border-neutral-100">
        <span className="text-primary-600">{icon}</span>
        {title}
      </h2>
      <div className="pl-2">{children}</div>
    </div>
  )
}

function SubSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="pl-4 border-l-2 border-primary-100">
      <h4 className="text-sm font-semibold text-neutral-800 mb-2">{title}</h4>
      <div className="pl-2">{children}</div>
    </div>
  )
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2 pl-1">
      {items.map(item => (
        <li key={item} className="text-sm text-neutral-600 flex items-start gap-2.5 leading-relaxed">
          <span className="w-1.5 h-1.5 rounded-full bg-primary-400 mt-2 flex-shrink-0" />
          {item}
        </li>
      ))}
    </ul>
  )
}

function InfoCard({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="bg-neutral-50 rounded-xl p-4">
      <h4 className="text-sm font-semibold text-neutral-800 mb-2">{title}</h4>
      <ul className="space-y-1">
        {items.map(item => (
          <li key={item} className="text-xs text-neutral-600 flex items-start gap-2">
            <span className="w-1 h-1 rounded-full bg-neutral-400 mt-1.5 flex-shrink-0" />
            {item}
          </li>
        ))}
      </ul>
    </div>
  )
}

function DailyCard({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="bg-primary-50/50 rounded-xl p-4 border border-primary-100">
      <h5 className="text-xs font-semibold text-primary-700 uppercase tracking-wide mb-2">{title}</h5>
      <ul className="space-y-1">
        {items.map(item => (
          <li key={item} className="text-xs text-neutral-600 flex items-start gap-1.5">
            <span className="text-primary-400 mt-0.5">&bull;</span>
            {item}
          </li>
        ))}
      </ul>
    </div>
  )
}

function PriorityBadge({ color, label, desc }: { color: string; label: string; desc: string }) {
  return (
    <div className={`rounded-lg px-3 py-2 ${color}`}>
      <span className="text-xs font-semibold">{label}</span>
      <p className="text-xs opacity-80 mt-0.5">{desc}</p>
    </div>
  )
}
