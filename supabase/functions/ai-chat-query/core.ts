// deno-lint-ignore-file no-explicit-any
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

export const MAX_QUESTION_CHARS = 2000;
export const MAX_HISTORY_MESSAGES = 12;
export const MAX_HISTORY_MESSAGE_CHARS = 4000;
export const MAX_HISTORY_TOTAL_CHARS = 16000;
export const MODEL_TIMEOUT_MS = 20000;
export const ASSET_DETAIL_LIMIT = 200;
export const CASE_DETAIL_LIMIT = 50;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DONE_STATUSES = ["complete", "accepted"];

type Row = Record<string, any>;

export interface NamedCount { name: string; count: number; incomplete?: number }

export interface FacilitySummary {
  total_assets: number;
  assets_by_status: Record<string, number>;
  distinct_types: number;
  assets_by_type: NamedCount[];
  distinct_locations: number;
  assets_by_location: NamedCount[];
  total_cases: number;
  open_cases: number;
  cases_by_status: Record<string, number>;
  cases_by_priority: Record<string, number>;
  total_issues: number;
  open_issues: number;
}

export interface ChatDetails {
  assets: Row[];
  cases: Row[];
  issues: Row[];
  events: Row[];
  notes: Row[];
  activityPosts: Row[];
  comments: Row[];
  statusHistory: Row[];
  tags: Row[];
}

export interface ChatMessage { role: "system" | "user" | "assistant"; content: string }

export interface ChatRequest {
  question: string;
  facilityId: string;
  assetId: string | null;
  history: ChatMessage[];
  historyTrimmed: boolean;
}

export interface ChatDeps {
  getUser(): Promise<{ id: string } | null>;
  getFacilityRole(facilityId: string): Promise<string | null>;
  registerRequest(facilityId: string): Promise<{ allowed: boolean; retry_after_seconds: number }>;
  getSummary(facilityId: string): Promise<unknown>;
  assetInFacility(assetId: string, facilityId: string): Promise<boolean>;
  loadDetails(facilityId: string, assetId: string | null): Promise<ChatDetails>;
  callModel: ((messages: ChatMessage[], signal: AbortSignal) => Promise<string>) | null;
  modelTimeoutMs?: number;
}

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...extra },
  });
}

const isCount = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0;
const isCountMap = (v: unknown) =>
  !!v && typeof v === "object" && !Array.isArray(v) && Object.values(v as object).every(isCount);
const isNamedList = (v: unknown) =>
  Array.isArray(v) && v.every((x) => x && typeof x.name === "string" && isCount(x.count));

export function parseSummary(raw: unknown): FacilitySummary {
  const s = raw as Row;
  if (
    !s || typeof s !== "object" ||
    !["total_assets", "distinct_types", "distinct_locations", "total_cases", "open_cases", "total_issues", "open_issues"]
      .every((k) => isCount(s[k])) ||
    !isCountMap(s.assets_by_status) || !isCountMap(s.cases_by_status) || !isCountMap(s.cases_by_priority) ||
    !isNamedList(s.assets_by_type) || !isNamedList(s.assets_by_location)
  ) {
    throw new Error("Facility summary had an unexpected shape");
  }
  return s as FacilitySummary;
}

export function validateChatRequest(body: unknown): { ok: true; value: ChatRequest } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Request body must be a JSON object" };
  const b = body as Row;
  const question = typeof b.question === "string" ? b.question.trim() : "";
  if (!question) return { ok: false, error: "question is required" };
  if (question.length > MAX_QUESTION_CHARS) {
    return { ok: false, error: `Question is too long (max ${MAX_QUESTION_CHARS} characters)` };
  }
  if (typeof b.facility_id !== "string" || !UUID_RE.test(b.facility_id)) {
    return { ok: false, error: "A valid facility_id is required" };
  }
  let assetId: string | null = null;
  if (b.asset_id !== undefined && b.asset_id !== null && b.asset_id !== "") {
    if (typeof b.asset_id !== "string" || !UUID_RE.test(b.asset_id)) return { ok: false, error: "asset_id is invalid" };
    assetId = b.asset_id;
  }
  if (b.conversation_history !== undefined && !Array.isArray(b.conversation_history)) {
    return { ok: false, error: "conversation_history must be a list" };
  }

  const raw: unknown[] = Array.isArray(b.conversation_history) ? b.conversation_history : [];
  const valid: ChatMessage[] = [];
  let trimmed = false;
  for (const m of raw) {
    const msg = m as Row;
    if (!msg || (msg.role !== "user" && msg.role !== "assistant") || typeof msg.content !== "string") {
      trimmed = true;
      continue;
    }
    let content = msg.content;
    if (content.length > MAX_HISTORY_MESSAGE_CHARS) {
      content = content.slice(0, MAX_HISTORY_MESSAGE_CHARS);
      trimmed = true;
    }
    valid.push({ role: msg.role, content });
  }
  const history: ChatMessage[] = [];
  let total = 0;
  for (let i = valid.length - 1; i >= 0 && history.length < MAX_HISTORY_MESSAGES; i--) {
    if (total + valid[i].content.length > MAX_HISTORY_TOTAL_CHARS) break;
    total += valid[i].content.length;
    history.unshift(valid[i]);
  }
  if (history.length < valid.length) trimmed = true;

  return { ok: true, value: { question, facilityId: b.facility_id, assetId, history, historyTrimmed: trimmed } };
}

const fmtDate = (v: unknown) => (v ? new Date(String(v)).toISOString().slice(0, 10) : "unknown date");
const cut = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : "");
const label = (s: string) => s.replace(/_/g, " ");

function countMapLine(m: Record<string, number>): string {
  const entries = Object.entries(m).sort((a, b) => b[1] - a[1]);
  return entries.length ? entries.map(([k, n]) => `${label(k)}: ${n}`).join(", ") : "none";
}

export function completion(summary: FacilitySummary) {
  const done = DONE_STATUSES.reduce((n, s) => n + (summary.assets_by_status[s] || 0), 0);
  const pending = summary.assets_by_status["complete_pending_verification"] || 0;
  const pct = summary.total_assets > 0 ? Math.round(((done + pending) / summary.total_assets) * 100) : 0;
  return { done, pending, pct };
}

export function truncationNotes(summary: FacilitySummary, details: ChatDetails, isSingleAsset: boolean): string[] {
  const notes: string[] = [];
  if (!isSingleAsset && details.assets.length < summary.total_assets) {
    notes.push(`Asset details below cover ${details.assets.length} of ${summary.total_assets} active assets; totals cover all of them.`);
  }
  if (!isSingleAsset && details.cases.length < summary.total_cases) {
    notes.push(`Case details below cover the ${details.cases.length} most recent of ${summary.total_cases} cases; totals cover all of them.`);
  }
  return notes;
}

function caseLine(c: Row): string {
  const asset = c.assets?.equipment_name ? ` on ${c.assets.equipment_name}` : "";
  const who = c.assigned?.name || "Unassigned";
  let line = `- ${c.case_number ? `#${c.case_number} ` : ""}[${c.priority || "unspecified"}/${c.status || "unknown"}] "${cut(c.title || c.description, 100)}"${asset}`;
  line += ` | Created ${fmtDate(c.created_at)} | Assigned to: ${who}`;
  if (c.due_date) line += ` | Due: ${fmtDate(c.due_date)}`;
  return line;
}

function assetLine(a: Row): string {
  const loc = a.locations
    ? [a.locations.building, a.locations.floor, a.locations.room_area].filter(Boolean).join(" / ") || "No location"
    : "No location";
  let line = `- ${a.equipment_name} (${a.asset_tag || "no tag"}): Status=${a.status}, Type=${a.equipment_type || "N/A"}, Location=${loc}`;
  if (a.systems?.name) line += `, System=${a.systems.name}`;
  if (a.trades?.name) line += `, Trade=${a.trades.name}`;
  if (a.manufacturer) line += `, Mfr=${a.manufacturer}`;
  if (a.model) line += `, Model=${a.model}`;
  if (a.serial_number) line += `, SN=${a.serial_number}`;
  if (a.notes) line += ` | Notes: "${cut(a.notes, 150)}"`;
  return line;
}

export function buildContextSummary(summary: FacilitySummary, d: ChatDetails, isSingleAsset: boolean): string {
  const { done, pending, pct } = completion(summary);
  let c = "\nFACILITY TOTALS (authoritative, computed over every active asset and case in this facility):\n";
  c += `- Active assets: ${summary.total_assets}; completion ${pct}% (${done} complete/accepted, ${pending} pending verification)\n`;
  c += `- Assets by status: ${countMapLine(summary.assets_by_status)}\n`;
  c += `- Assets by type (${summary.distinct_types} types, top ${summary.assets_by_type.length}): ${summary.assets_by_type.map((t) => `${t.name}: ${t.count}`).join(", ") || "none"}\n`;
  c += `- Assets by location (${summary.distinct_locations} locations, top ${summary.assets_by_location.length}): ${summary.assets_by_location.map((l) => `${l.name}: ${l.count} (${l.incomplete ?? 0} incomplete)`).join(", ") || "none"}\n`;
  c += `- Cases: ${summary.total_cases} total, ${summary.open_cases} open; by status: ${countMapLine(summary.cases_by_status)}; by priority: ${countMapLine(summary.cases_by_priority)}\n`;
  c += `- Legacy issues: ${summary.total_issues} total, ${summary.open_issues} open\n`;

  const notes = truncationNotes(summary, d, isSingleAsset);
  if (notes.length) c += `\nDATA LIMITS:\n${notes.map((n) => `- ${n}`).join("\n")}\n`;

  c += `\n${isSingleAsset ? "Selected asset" : `Asset details (${d.assets.length} shown)`}:\n${d.assets.map(assetLine).join("\n") || "- none"}`;

  if (isSingleAsset) {
    const tagNames = d.tags.map((t) => t.tags?.name).filter(Boolean);
    if (tagNames.length) c += `\n\nAsset Tags: ${tagNames.join(", ")}`;
    if (d.statusHistory.length) {
      c += `\n\nStatus History (${d.statusHistory.length}):\n` + d.statusHistory
        .map((h) => `- [${fmtDate(h.changed_at)}] ${h.profiles?.name || "Unknown"}: ${h.old_status} -> ${h.new_status}`).join("\n");
    }
  }

  c += `\n\nCases (${d.cases.length} shown of ${isSingleAsset ? d.cases.length : summary.total_cases}):\n${d.cases.map(caseLine).join("\n") || "- none"}`;

  if (d.issues.length) {
    c += `\n\nLegacy Issues (${d.issues.length} shown):\n` + d.issues.map((i) => {
      const asset = i.assets?.equipment_name ? ` on ${i.assets.equipment_name}` : "";
      return `- [${i.priority}/${i.status}] "${cut(i.description, 100)}"${asset} | Created ${fmtDate(i.created_at)} by ${i.profiles?.name || "Unknown"} | Assigned to: ${i.assigned?.name || "Unassigned"}`;
    }).join("\n");
  }
  if (isSingleAsset && d.comments.length) {
    c += `\n\nIssue Comments (${d.comments.length}):\n` + d.comments
      .map((x) => `- [${fmtDate(x.created_at)}] ${x.profiles?.name || "Unknown"}: "${cut(x.content || x.text, 150)}"`).join("\n");
  }
  if (d.notes.length) {
    c += `\n\nAsset Notes (${d.notes.length} most recent):\n` + d.notes.map((n) => {
      const asset = n.assets?.equipment_name ? ` on ${n.assets.equipment_name}` : "";
      return `- [${fmtDate(n.created_at)}] ${n.profiles?.name || "Unknown"}${asset}: "${cut(n.content || n.note, 200)}"`;
    }).join("\n");
  }
  c += `\n\nRecent Events (${d.events.length} most recent):\n` + (d.events.slice(0, 30).map((e) => {
    let line = `- [${fmtDate(e.timestamp)}] ${e.profiles?.name || "Unknown"} on ${e.assets?.equipment_name || "asset"}: ${label(e.event_type || "event")}`;
    if (e.raw_note) line += ` - "${cut(e.raw_note, 120)}"`;
    if (e.previous_status && e.new_status) line += ` (${e.previous_status} -> ${e.new_status})`;
    return line;
  }).join("\n") || "- none");
  c += `\n\nTeam Activity Posts (${d.activityPosts.length} most recent):\n` + (d.activityPosts.map((p) => {
    const asset = p.assets?.equipment_name ? ` on ${p.assets.equipment_name}` : "";
    return `- [${fmtDate(p.created_at)}] ${p.profiles?.name || "Unknown"}${asset}: "${cut(p.message, 300)}"`;
  }).join("\n") || "- none");
  return c;
}

export function buildSystemPrompt(context: string): string {
  return `You are Xg-Fi, a field intelligence assistant for facility and asset management. You answer questions about facility assets, progress, cases, and field activity based ONLY on the provided data records.

Rules:
- Ground every answer in the provided data. Do not invent facts.
- For any count, total, percentage or "are there any" question, use FACILITY TOTALS. Detail lists are samples; never infer that something does not exist just because it is absent from a sample.
- When an answer relies on a sampled list, say that the list is partial, as described in DATA LIMITS.
- Include dates, names, asset tags, and specifics when available.
- If the data doesn't contain enough information to fully answer, say so clearly.
- Keep answers concise and practical, in plain language suitable for field workers and managers.
- Clearly distinguish recorded facts, calculated information, AI interpretation, and missing information.
- "Team Activity Posts" are informal teammate updates; surface them for "what's happening" or "who is working on" questions.
- When discussing cases, mention who they are assigned to if available.

${context}`;
}

export function generateLocalResponse(question: string, s: FacilitySummary, d: ChatDetails, isSingleAsset: boolean): string {
  const q = question.toLowerCase();
  const { done, pending, pct } = completion(s);
  const notes = truncationNotes(s, d, isSingleAsset);
  const partial = notes.length ? `\n\n_${notes.join(" ")}_` : "";

  if (/(case|issue|problem|deficien)/.test(q)) {
    if (s.total_cases === 0 && s.open_issues === 0) return "There are no cases recorded for this facility.";
    let r = `**Cases:** ${s.total_cases} total, ${s.open_cases} open\n`;
    r += `By status: ${countMapLine(s.cases_by_status)}\nBy priority: ${countMapLine(s.cases_by_priority)}\n`;
    if (s.open_issues) r += `Legacy issues still open: ${s.open_issues}\n`;
    if (d.cases.length) r += `\n${d.cases.slice(0, 15).map(caseLine).join("\n")}`;
    return r + partial;
  }

  if (/(progress|summary|overview|how are we doing|complete|done|finished)/.test(q)) {
    let r = `**Facility Progress Summary**\n\nTotal assets: ${s.total_assets}\n`;
    r += `Overall completion: ${pct}% (${done + pending}/${s.total_assets})\n\n**Status breakdown:** ${countMapLine(s.assets_by_status)}\n`;
    r += `\n**Cases:** ${s.open_cases} open of ${s.total_cases}`;
    return r;
  }

  if (/(outstanding|remaining|left|incomplete|floor|location|where)/.test(q)) {
    const lines = s.assets_by_location.map((l) => `- ${l.name}: ${l.incomplete ?? 0} incomplete of ${l.count}`);
    return `**Outstanding work by location** (${s.total_assets - done} of ${s.total_assets} assets not complete):\n\n${lines.join("\n") || "- none"}` +
      (s.distinct_locations > s.assets_by_location.length ? `\n\n_Showing the ${s.assets_by_location.length} largest of ${s.distinct_locations} locations._` : "");
  }

  if (/(blocked|blocking|stuck)/.test(q)) {
    const n = s.assets_by_status["blocked"] || 0;
    if (n === 0) return "No assets are currently blocked.";
    const shown = d.assets.filter((a) => a.status === "blocked").slice(0, 20);
    return `**Blocked assets: ${n}**\n\n${shown.map((a) => `- ${a.equipment_name} (${a.asset_tag || "no tag"})`).join("\n")}` +
      (shown.length < n ? `\n\n_Listing ${shown.length} of ${n} blocked assets._` : "");
  }

  if (/(team|working on|who is|should know|activity|recent|today|update|what happened)/.test(q)) {
    if (!d.activityPosts.length && !d.events.length && !d.notes.length) return "No recent activity has been recorded for this facility.";
    let r = "";
    if (d.activityPosts.length) {
      r += `**Team Activity Posts:**\n${d.activityPosts.slice(0, 10).map((p) => `- [${fmtDate(p.created_at)}] **${p.profiles?.name || "Unknown"}**: "${cut(p.message, 200)}"`).join("\n")}\n\n`;
    }
    if (d.events.length) {
      r += `**Recent Events:**\n${d.events.slice(0, 10).map((e) => `- [${fmtDate(e.timestamp)}] ${e.profiles?.name || "Unknown"} - ${label(e.event_type || "event")} on ${e.assets?.equipment_name || "asset"}`).join("\n")}`;
    }
    return r.trim() || "No recent activity has been recorded for this facility.";
  }

  return `Based on your facility data:\n\n- **${s.total_assets} assets** tracked\n- **${pct}% complete** (${done + pending}/${s.total_assets})\n- **${s.open_cases} open cases** of ${s.total_cases}\n` +
    `\nTry asking:\n- "Give me a progress summary"\n- "What are the open cases?"\n- "What is outstanding?"\n- "What has my team been doing?"`;
}

export async function handleChat(req: Request, deps: ChatDeps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const user = await deps.getUser();
  if (!user) return json({ error: "Unauthorized" }, 401);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Request body must be valid JSON" }, 400);
  }
  const parsed = validateChatRequest(body);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const { question, facilityId, assetId, history, historyTrimmed } = parsed.value;

  if (!(await deps.getFacilityRole(facilityId))) {
    return json({ error: "Forbidden: not a member of this facility" }, 403);
  }
  if (assetId && !(await deps.assetInFacility(assetId, facilityId))) {
    return json({ error: "Forbidden: asset does not belong to this facility or is not accessible" }, 403);
  }

  const rate = await deps.registerRequest(facilityId);
  if (!rate.allowed) {
    return json(
      { error: `You're asking questions too quickly. Please wait ${rate.retry_after_seconds} seconds and try again.` },
      429,
      { "Retry-After": String(rate.retry_after_seconds) },
    );
  }

  const [rawSummary, details] = await Promise.all([deps.getSummary(facilityId), deps.loadDetails(facilityId, assetId)]);
  const summary = parseSummary(rawSummary);
  const isSingleAsset = !!assetId;
  const notes = truncationNotes(summary, details, isSingleAsset);
  if (historyTrimmed) notes.push("Older or oversized conversation messages were left out.");

  const meta = {
    totals: { assets: summary.total_assets, cases: summary.total_cases, open_cases: summary.open_cases },
    truncated: notes.length > 0,
    truncation_notes: notes,
    sources: {
      assets_referenced: details.assets.length,
      cases_referenced: details.cases.length,
      events_referenced: details.events.length,
      issues_referenced: details.issues.length,
      activity_posts_referenced: details.activityPosts.length,
      notes_referenced: details.notes.length,
      comments_referenced: details.comments.length,
      status_changes_referenced: details.statusHistory.length,
    },
  };

  if (deps.callModel) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), deps.modelTimeoutMs ?? MODEL_TIMEOUT_MS);
    try {
      const messages: ChatMessage[] = [
        { role: "system", content: buildSystemPrompt(buildContextSummary(summary, details, isSingleAsset)) },
        ...history,
        { role: "user", content: question },
      ];
      const answer = await deps.callModel(messages, controller.signal);
      if (answer) return json({ answer, mode: "ai", ...meta });
    } catch {
      // Falls back to the deterministic summary below.
    } finally {
      clearTimeout(timer);
    }
  }

  return json({ answer: generateLocalResponse(question, summary, details, isSingleAsset), mode: "local", ...meta });
}
