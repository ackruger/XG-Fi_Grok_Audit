import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { raw_note, asset_name, asset_type, current_status, location } = await req.json();

    if (!raw_note) {
      return new Response(
        JSON.stringify({ error: "raw_note is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      return new Response(
        JSON.stringify({ error: "OpenAI API key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const systemPrompt = `You are a field documentation assistant for construction and commissioning projects. Your job is to parse raw field notes into structured data.

Given a field note about an asset, extract and return a JSON object with these fields:
- event_type: one of [progress_update, completion_note, issue_reported, issue_resolved, photo_added, inspection_requested, inspection_completed, commissioning_update, material_delay, access_issue, design_clarification, damage_reported, safety_concern, general_note]
- suggested_status: one of [not_started, in_progress, complete, complete_pending_verification, blocked, deficient, ready_for_next_trade]
- summary: a clear 1-2 sentence plain-language summary
- work_completed: what work was done (brief)
- remaining_work: what still needs to be done (brief, or "None" if complete)
- issues_identified: any problems noted (brief, or "None")
- follow_up_required: true/false
- responsible_trade: the trade responsible for next action if obvious (or "Unknown")
- confidence: "high", "medium", or "low"
- clarifying_question: a question to ask if something is ambiguous (or null if clear)

Return ONLY valid JSON, no markdown or explanation.`;

    const userPrompt = `Asset: ${asset_name || "Unknown"}
Type: ${asset_type || "Unknown"}
Current Status: ${current_status || "Unknown"}
Location: ${location || "Unknown"}

Field Note: "${raw_note}"`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      return new Response(
        JSON.stringify({ error: "OpenAI API error", details: errBody }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    let structured;
    try {
      structured = JSON.parse(content);
    } catch {
      structured = { raw_response: content, error: "Failed to parse AI response" };
    }

    return new Response(
      JSON.stringify(structured),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
