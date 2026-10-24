export type UserRole = 'viewer' | 'contributor' | 'reviewer' | 'supervisor' | 'admin'
export type OrgRole = 'admin' | 'manager' | 'member'

export type AssetStatus =
  | 'not_started'
  | 'in_progress'
  | 'complete'
  | 'complete_pending_verification'
  | 'blocked'
  | 'deficient'
  | 'ready_for_next_trade'
  | 'accepted'
  | 'rejected'
  | 'closed'

export type IssuePriority = 'low' | 'medium' | 'high' | 'critical'
export type IssueStatus = 'open' | 'in_progress' | 'resolved' | 'verified' | 'closed'

export type EventType =
  | 'progress_update'
  | 'completion_note'
  | 'issue_reported'
  | 'issue_resolved'
  | 'photo_added'
  | 'inspection_requested'
  | 'inspection_completed'
  | 'commissioning_update'
  | 'material_delay'
  | 'access_issue'
  | 'design_clarification'
  | 'damage_reported'
  | 'safety_concern'
  | 'general_note'

export interface Profile {
  id: string
  name: string
  email: string
  company: string | null
  trade: string | null
  role: UserRole
  avatar_url: string | null
  created_at: string
  updated_at: string
}

export interface Organization {
  id: string
  name: string
  description: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface OrganizationMember {
  id: string
  organization_id: string
  user_id: string
  role: OrgRole
  joined_at: string
  profiles?: Profile
}

export interface Facility {
  id: string
  organization_id: string
  name: string
  code: string | null
  description: string | null
  address_line_1: string | null
  address_line_2: string | null
  city: string | null
  province_state: string | null
  postal_code: string | null
  country: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface FacilityMember {
  id: string
  facility_id: string
  user_id: string
  role: UserRole
  joined_at: string
  profiles?: Profile
}

export interface FacilityInvitation {
  id: string
  facility_id: string
  email: string
  role: string
  invited_by: string
  status: 'pending' | 'accepted' | 'declined'
  created_at: string
  accepted_at: string | null
}

export type RelationshipType = 'contains' | 'component_of' | 'serves' | 'fed_by' | 'related' | 'backup_of'

export type DocumentCategory =
  | 'shop_drawing' | 'floorplan' | 'specification' | 'om_manual' | 'commissioning'
  | 'engineering' | 'submittal' | 'drawing' | 'contractual' | 'record' | 'form' | 'other'

export type StorageProvider = 'supabase' | 'external' | 'pending'

export type DocumentRelationshipType = 'applies_to' | 'reference' | 'supports' | 'generated_from' | 'related'

export type AttributeDataType = 'text' | 'multiline' | 'number' | 'boolean' | 'date' | 'select' | 'url'

export type AttributeAppSection = 'technical' | 'service' | 'electrical_controls'

export type OperationalStatus = 'active' | 'shut_down' | 'pending'
export type LifecycleStage = 'received' | 'installed' | 'commissioned' | 'warranty'
export type IdentificationStatus = 'identified' | 'unidentified' | 'needs_review'
export type ChecklistFocus = 'rough_in' | 'startup' | 'commissioning' | 'general'

export interface Asset {
  id: string
  facility_id: string
  qr_code_id: string
  asset_tag: string
  alias: string | null
  location_id: string | null
  system_id: string | null
  trade_id: string | null
  asset_type_id: string | null
  equipment_type: string | null
  equipment_name: string
  manufacturer: string | null
  model: string | null
  serial_number: string | null
  drawing_reference: string | null
  spec_section: string | null
  notes: string | null
  static_notes: string | null
  status: AssetStatus
  operational_status: OperationalStatus
  lifecycle_stage: LifecycleStage | null
  identification_status: IdentificationStatus
  criticality: string | null
  trades: string[] | null
  system_served: string | null
  bim_x: number | null
  bim_y: number | null
  bim_z: number | null
  gridline: string | null
  zone: string | null
  space: string | null
  level: string | null
  checklist_focus: ChecklistFocus | null
  current_owner_id: string | null
  design_stage: string | null
  area_served: string | null
  source_section: string | null
  source_row: number | null
  created_at: string
  updated_at: string
  deleted_at: string | null
  asset_types?: AssetType
}

export interface Location {
  id: string
  facility_id: string
  building: string | null
  floor: string | null
  room_area: string | null
  description: string | null
  gridline: string | null
  zone: string | null
  space: string | null
}

export interface SystemRecord {
  id: string
  facility_id: string
  name: string
  type: string | null
  description: string | null
}

export interface Event {
  id: string
  asset_id: string
  user_id: string
  timestamp: string
  event_type: EventType
  raw_note: string
  ai_summary: Record<string, unknown> | null
  status_before: AssetStatus | null
  status_after: AssetStatus | null
  confidence_score: number | null
  requires_review: boolean
  created_at: string
  profiles?: Profile
}

export interface Issue {
  id: string
  asset_id: string
  created_by: string
  assigned_to: string | null
  priority: IssuePriority
  category: string | null
  description: string
  status: IssueStatus
  due_date: string | null
  resolution_notes: string | null
  verified_by: string | null
  closed_date: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
  profiles?: Profile
  assets?: Asset
}

export type CaseType = 'observation' | 'deficiency' | 'work_order'
export type CaseStatus = 'open' | 'in_progress' | 'resolved' | 'closed'

export interface Case {
  id: string
  asset_id: string
  facility_id: string
  case_type: CaseType
  title: string
  description: string
  status: CaseStatus
  priority: IssuePriority
  created_by: string
  assigned_to: string | null
  resolved_at: string | null
  closed_at: string | null
  resolution_notes: string | null
  deleted_at: string | null
  created_at: string
  updated_at: string
  profiles?: Profile
  assets?: Pick<Asset, 'id' | 'equipment_name' | 'asset_tag'>
}

export interface Photo {
  id: string
  event_id: string | null
  issue_id: string | null
  asset_id: string
  storage_path: string
  caption: string | null
  uploaded_by: string
  created_at: string
}

export interface AssetNote {
  id: string
  asset_id: string
  user_id: string
  content: string
  created_at: string
  updated_at: string
  profiles?: Profile
}

export interface Tag {
  id: string
  facility_id: string
  name: string
  color: string
  created_at: string
}

export interface AssetTag {
  id: string
  asset_id: string
  tag_id: string
  created_at: string
  tags?: Tag
}

export interface ActivityPost {
  id: string
  facility_id: string
  asset_id: string | null
  user_id: string
  message: string
  created_at: string
  profiles?: Profile
  assets?: Pick<Asset, 'id' | 'equipment_name' | 'asset_tag'>
}

export interface AssetType {
  id: string
  organization_id: string
  name: string
  code: string
  description: string | null
  icon: string | null
  sort_order: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface AssetAttributeDefinition {
  id: string
  asset_type_id: string
  name: string
  display_name: string
  app_section: AttributeAppSection
  data_type: AttributeDataType
  unit: string | null
  options: string[] | null
  sort_order: number
  is_required: boolean
  is_searchable: boolean
  source_column: string | null
  source_header: string | null
  created_at: string
  updated_at: string
}

export interface AssetDesignProfile {
  id: string
  asset_id: string
  name: string
  source_section: string | null
  sort_order: number
  created_at: string
  updated_at: string
}

export interface AssetAttributeValue {
  id: string
  asset_id: string
  attribute_definition_id: string
  design_profile_id: string | null
  value_text: string | null
  value_numeric: number | null
  created_at: string
  updated_at: string
  asset_attribute_definitions?: AssetAttributeDefinition
}

export interface AssetRelationship {
  id: string
  source_asset_id: string
  target_asset_id: string
  relationship_type: RelationshipType
  description: string | null
  source_field: string | null
  is_confirmed: boolean
  created_at: string
  source_asset?: Pick<Asset, 'id' | 'equipment_name' | 'asset_tag'>
  target_asset?: Pick<Asset, 'id' | 'equipment_name' | 'asset_tag'>
}

export interface AssetServicePart {
  id: string
  asset_id: string
  name: string
  part_type: string | null
  size: string | null
  part_number: string | null
  manufacturer: string | null
  quantity: number
  unit_cost: number | null
  lead_time_days: number | null
  service_interval_days: number | null
  notes: string | null
  last_replaced_at: string | null
  next_replacement_at: string | null
  created_at: string
  updated_at: string
}

export interface AssetDocument {
  id: string
  asset_id: string
  name: string
  category: DocumentCategory
  storage_path: string | null
  external_url: string | null
  description: string
  file_size: number | null
  mime_type: string | null
  uploaded_by: string
  created_at: string
  updated_at: string
  profiles?: Profile
}

export interface Document {
  id: string
  facility_id: string
  name: string
  category: DocumentCategory
  document_type: string | null
  discipline: string | null
  document_status: string | null
  document_reference: string | null
  revision: string | null
  description: string
  storage_provider: StorageProvider
  storage_path: string | null
  external_url: string | null
  file_size: number | null
  mime_type: string | null
  source_filename: string | null
  source_sheet: string | null
  source_row: number | null
  source_document_key: string | null
  created_by: string | null
  import_batch_id: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
  profiles?: Profile
}

export interface DocumentAssetLink {
  id: string
  document_id: string
  asset_id: string
  relationship_type: DocumentRelationshipType
  import_batch_id: string | null
  created_at: string
  documents?: Document
  assets?: Pick<Asset, 'id' | 'equipment_name' | 'asset_tag'>
}

/* ── Xg-Fi Ver2: LOTO ── */
export type LotoType = 'general_lockout' | 'formal_loto'
export type LotoStatus = 'active' | 'cleared'

export interface LotoRecord {
  id: string
  asset_id: string
  facility_id: string
  loto_type: LotoType
  status: LotoStatus
  reason: string
  applied_by_user_id: string | null
  applied_by_contact: string | null
  applied_at: string
  physical_lock_id: string | null
  isolation_points: string | null
  notes: string | null
  cleared_by_user_id: string | null
  cleared_by_contact: string | null
  cleared_at: string | null
  clearance_notes: string | null
  created_at: string
  updated_at: string
  profiles?: Profile
  cleared_by_profile?: Profile
}

export interface LotoAuditLogEntry {
  id: string
  loto_record_id: string
  action: 'created' | 'cleared' | 'note_added' | 'status_changed'
  changed_by_user_id: string | null
  changed_by_contact: string | null
  previous_values: Record<string, unknown> | null
  new_values: Record<string, unknown> | null
  created_at: string
}

/* ── Xg-Fi Ver2: Checklists ── */
export type ChecklistFocusType = 'rough_in' | 'startup' | 'commissioning' | 'general'
export type ChecklistRunStatus = 'not_started' | 'in_progress' | 'complete' | 'blocked' | 'deficient'
export type ChecklistItemState = 'pending' | 'passed' | 'failed' | 'blocked' | 'skipped'

export interface ChecklistTemplate {
  id: string
  organization_id: string
  name: string
  focus: ChecklistFocusType
  description: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface ChecklistTemplateItem {
  id: string
  template_id: string
  label: string
  sort_order: number
  is_required: boolean
  created_at: string
}

export interface ChecklistRun {
  id: string
  asset_id: string
  facility_id: string
  template_id: string | null
  focus: ChecklistFocusType
  name: string
  status: ChecklistRunStatus
  created_by: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export interface ChecklistItem {
  id: string
  run_id: string
  label: string
  sort_order: number
  state: ChecklistItemState
  is_required: boolean
  notes: string | null
  completed_by: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export interface ChecklistRunSummary {
  run_id: string
  asset_id: string
  facility_id: string
  focus: ChecklistFocusType
  run_status: ChecklistRunStatus
  total_items: number
  passed_items: number
  failed_items: number
  blocked_items: number
  pending_items: number
  completion_pct: number
}

/* ── Xg-Fi Ver2: Chat and Message Board ── */
export type ChatAuthorType = 'user' | 'ai_agent' | 'system'

export interface AssetChatMessage {
  id: string
  asset_id: string
  facility_id: string
  author_id: string | null
  author_type: ChatAuthorType
  body: string
  edited_at: string | null
  edit_history: Array<{ body: string; edited_at: string; edited_by: string | null }> | null
  promoted_to_board: boolean
  promoted_at: string | null
  promoted_by: string | null
  source_case_id: string | null
  created_at: string
  profiles?: Profile
}

export interface AssetBoardPost {
  id: string
  asset_id: string
  facility_id: string
  chat_message_id: string | null
  author_id: string
  body: string
  is_pinned: boolean
  source_case_id: string | null
  created_at: string
  profiles?: Profile
}

export interface CaseSourceLink {
  id: string
  case_id: string
  source_type: 'chat_message' | 'board_post'
  source_chat_message_id: string | null
  source_board_post_id: string | null
  asset_id: string | null
  created_by: string | null
  created_at: string
}

/* ── Xg-Fi Ver2: Plans ── */
export interface PlanDocument {
  id: string
  facility_id: string
  name: string
  storage_path: string | null
  external_url: string | null
  current_revision_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface PlanRevision {
  id: string
  plan_document_id: string
  revision_number: string
  storage_path: string | null
  external_url: string | null
  page_count: number | null
  is_current: boolean
  created_by: string | null
  created_at: string
}

export interface PlanMarker {
  id: string
  plan_document_id: string
  plan_revision_id: string | null
  asset_id: string | null
  facility_id: string
  page_number: number
  x: number
  y: number
  z: number | null
  label: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  plan_documents?: PlanDocument
  assets?: Pick<Asset, 'id' | 'equipment_name' | 'asset_tag'>
}

/* ── Xg-Fi Ver2: Import Preflight ── */
export interface ImportPreflightResult {
  id: string
  batch_id: string | null
  facility_id: string
  source_filename: string
  fingerprint: string
  total_rows: number
  rows_add: number
  rows_update: number
  rows_hold: number
  rows_skip: number
  rows_conflict: number
  missing_asset_types: string[]
  duplicate_detail_rows: Array<Record<string, unknown>>
  placeholder_urls: Array<Record<string, unknown>>
  validation_errors: Array<Record<string, unknown>>
  created_at: string
}
