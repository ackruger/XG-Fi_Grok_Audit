import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import {
  ASSET_DETAIL_LIMIT,
  CASE_DETAIL_LIMIT,
  type ChatDetails,
  type ChatMessage,
  corsHeaders,
  handleChat,
} from "./core.ts";

// deno-lint-ignore no-explicit-any
function rows(res: { data: any; error: { message: string } | null }, what: string): any[] {
  if (res.error) throw new Error(`Could not load ${what}`);
  return Array.isArray(res.data) ? res.data : [];
}

const CASE_SELECT =
  "id, case_number, title, description, status, priority, category, due_date, created_at, asset_id, assigned:profiles!cases_assigned_to_fkey(name), assets(equipment_name, asset_tag)";
const ISSUE_SELECT =
  "id, asset_id, priority, category, description, status, due_date, resolution_notes, created_at, profiles!issues_created_by_fkey(name), assigned:profiles!issues_assigned_to_fkey(name)";

Deno.serve(async (req: Request) => {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const service = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    let userId = "";

    return await handleChat(req, {
      async getUser() {
        if (!authHeader) return null;
        const { data, error } = await userClient.auth.getUser();
        if (error || !data.user) return null;
        userId = data.user.id;
        return { id: data.user.id };
      },
      async getFacilityRole(facilityId) {
        const { data, error } = await userClient.rpc("get_facility_role", { p_facility_id: facilityId, p_user_id: userId });
        if (error) return null;
        return typeof data === "string" ? data : null;
      },
      async registerRequest(facilityId) {
        const { data, error } = await userClient.rpc("ai_chat_register_request", { p_facility_id: facilityId });
        if (error || !data || typeof data.allowed !== "boolean") throw new Error("Could not check request limits");
        return { allowed: data.allowed, retry_after_seconds: Number(data.retry_after_seconds) || 60 };
      },
      async getSummary(facilityId) {
        const { data, error } = await userClient.rpc("ai_facility_summary", { p_facility_id: facilityId });
        if (error) throw new Error("Could not load facility totals");
        return data;
      },
      async assetInFacility(assetId, facilityId) {
        const { data, error } = await userClient
          .from("assets").select("id").eq("id", assetId).eq("facility_id", facilityId).is("deleted_at", null).maybeSingle();
        return !error && !!data;
      },
      async loadDetails(facilityId, assetId): Promise<ChatDetails> {
        if (assetId) {
          const [asset, cases, issues, events, posts, notes, history, tags] = await Promise.all([
            service.from("assets").select("*, locations(building, floor, room_area), systems(name), trades(name)").eq("id", assetId).limit(1),
            service.from("cases").select(CASE_SELECT).eq("asset_id", assetId).eq("facility_id", facilityId).is("deleted_at", null)
              .order("created_at", { ascending: false }).limit(CASE_DETAIL_LIMIT),
            service.from("issues").select(ISSUE_SELECT).eq("asset_id", assetId).is("deleted_at", null)
              .order("created_at", { ascending: false }).limit(30),
            service.from("events").select("*, profiles!events_user_id_fkey(name)").eq("asset_id", assetId)
              .order("timestamp", { ascending: false }).limit(50),
            service.from("activity_posts").select("*, profiles(name)").eq("asset_id", assetId)
              .order("created_at", { ascending: false }).limit(30),
            service.from("asset_notes").select("*, profiles(name)").eq("asset_id", assetId)
              .order("created_at", { ascending: false }).limit(30),
            service.from("status_history").select("*, profiles(name)").eq("asset_id", assetId)
              .order("changed_at", { ascending: false }).limit(30),
            service.from("asset_tags").select("tags(name, color)").eq("asset_id", assetId),
          ]);
          const issueRows = rows(issues, "issues");
          let comments: ChatDetails["comments"] = [];
          if (issueRows.length > 0) {
            comments = rows(
              await service.from("comments").select("*, profiles(name)").in("issue_id", issueRows.map((i) => i.id))
                .order("created_at", { ascending: true }).limit(100),
              "comments",
            );
          }
          return {
            assets: rows(asset, "asset"),
            cases: rows(cases, "cases"),
            issues: issueRows,
            events: rows(events, "events"),
            activityPosts: rows(posts, "activity posts"),
            notes: rows(notes, "notes"),
            statusHistory: rows(history, "status history"),
            tags: rows(tags, "tags"),
            comments,
          };
        }

        const [assets, cases, issues, events, notes, posts] = await Promise.all([
          service.from("assets")
            .select("id, equipment_name, asset_tag, equipment_type, manufacturer, model, status, notes, locations(building, floor, room_area), systems(name), trades(name)")
            .eq("facility_id", facilityId).is("deleted_at", null)
            .order("equipment_name").order("id").limit(ASSET_DETAIL_LIMIT),
          service.from("cases").select(CASE_SELECT).eq("facility_id", facilityId).is("deleted_at", null)
            .order("created_at", { ascending: false }).limit(CASE_DETAIL_LIMIT),
          service.from("issues").select(`${ISSUE_SELECT}, assets!inner(equipment_name, asset_tag, facility_id)`)
            .eq("assets.facility_id", facilityId).is("deleted_at", null)
            .order("created_at", { ascending: false }).limit(40),
          service.from("events").select("*, profiles!events_user_id_fkey(name), assets!inner(equipment_name, asset_tag, facility_id)")
            .eq("assets.facility_id", facilityId).order("timestamp", { ascending: false }).limit(50),
          service.from("asset_notes").select("*, profiles(name), assets!inner(equipment_name, asset_tag, facility_id)")
            .eq("assets.facility_id", facilityId).order("created_at", { ascending: false }).limit(40),
          service.from("activity_posts").select("*, profiles(name), assets(equipment_name, asset_tag)")
            .eq("facility_id", facilityId).order("created_at", { ascending: false }).limit(40),
        ]);
        return {
          assets: rows(assets, "assets"),
          cases: rows(cases, "cases"),
          issues: rows(issues, "issues"),
          events: rows(events, "events"),
          notes: rows(notes, "notes"),
          activityPosts: rows(posts, "activity posts"),
          comments: [],
          statusHistory: [],
          tags: [],
        };
      },
      callModel: openaiKey
        ? async (messages: ChatMessage[], signal: AbortSignal) => {
          const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: { "Authorization": `Bearer ${openaiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ model: "gpt-4o-mini", messages, temperature: 0.4, max_tokens: 1200 }),
            signal,
          });
          if (!response.ok) throw new Error(`Model request failed (${response.status})`);
          const data = await response.json();
          const answer = data?.choices?.[0]?.message?.content;
          return typeof answer === "string" ? answer : "";
        }
        : null,
    });
  } catch (err) {
    console.error("ai-chat-query failed", err);
    return new Response(
      JSON.stringify({ error: "The assistant could not answer right now. Please try again." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
