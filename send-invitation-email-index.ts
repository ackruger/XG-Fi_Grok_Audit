import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { corsHeaders, handleInvite } from "./core.ts";

const DEFAULT_FROM = "NovusNow <commercial@novusnow.ca>";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const authClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const serviceClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const fromAddress = (Deno.env.get("RESEND_FROM") || DEFAULT_FROM).trim();

    return await handleInvite(req, {
      resendKey,
      appUrl: Deno.env.get("APP_URL"),
      getUser: async () => {
        if (!authHeader) return null;
        const { data, error } = await authClient.auth.getUser();
        if (error || !data.user) return null;
        return { id: data.user.id, email: data.user.email ?? null };
      },
      getFacilityRole: async (facilityId, userId) => {
        const { data, error } = await authClient.rpc("get_facility_role", {
          p_facility_id: facilityId,
          p_user_id: userId,
        });
        if (error) return null;
        return typeof data === "string" ? data : null;
      },
      findPendingInvitation: async ({ facilityId, email, role, invitedBy }) => {
        const { data, error } = await authClient
          .from("facility_invitations")
          .select("id")
          .eq("facility_id", facilityId)
          .eq("email", email)
          .eq("role", role)
          .eq("invited_by", invitedBy)
          .eq("status", "pending")
          .order("created_at", { ascending: false })
          .limit(1);
        if (error || !data || data.length === 0) return null;
        return { id: data[0].id as string };
      },
      getFacilityName: async (facilityId) => {
        const { data, error } = await serviceClient.from("facilities").select("name").eq("id", facilityId).maybeSingle();
        if (error || !data) return null;
        return (data.name as string) ?? null;
      },
      getInviterName: async (userId) => {
        const { data } = await serviceClient.from("profiles").select("name").eq("id", userId).maybeSingle();
        return (data?.name as string | undefined) ?? null;
      },
      countSenderSends: async (senderId, sinceIso) => {
        const { count, error } = await serviceClient
          .from("invitation_email_sends")
          .select("id", { count: "exact", head: true })
          .eq("sender_id", senderId)
          .gte("created_at", sinceIso);
        if (error) throw error;
        return count ?? 0;
      },
      countInvitationSends: async (invitationId, sinceIso) => {
        const { count, error } = await serviceClient
          .from("invitation_email_sends")
          .select("id", { count: "exact", head: true })
          .eq("invitation_id", invitationId)
          .gte("created_at", sinceIso);
        if (error) throw error;
        return count ?? 0;
      },
      logSend: async ({ invitationId, senderId, facilityId }) => {
        const { data, error } = await serviceClient
          .from("invitation_email_sends")
          .insert({ invitation_id: invitationId, sender_id: senderId, facility_id: facilityId })
          .select("id")
          .single();
        if (error || !data) throw error ?? new Error("Could not record send attempt");
        return data.id as string;
      },
      finishSend: async (id, status, errorText) => {
        await serviceClient.from("invitation_email_sends").update({ status, error: errorText }).eq("id", id);
      },
      sendEmail: async ({ to, subject, html, text }, signal) => {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resendKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: fromAddress,
            to: [to],
            subject,
            html,
            text,
          }),
          signal,
        });

        if (!res.ok) {
          let detail = `Resend returned status ${res.status}`;
          try {
            const body = await res.text();
            // Keep a short, safe snippet for debugging (Resend errors are usually JSON)
            const snippet = body.replace(/\s+/g, " ").slice(0, 400);
            if (snippet) detail = `${detail}: ${snippet}`;
            console.error("Resend error", res.status, snippet);
          } catch {
            console.error("Resend error", res.status);
          }
          return { ok: false, detail };
        }

        return { ok: true };
      },
    });
  } catch (err) {
    console.error("send-invitation-email fatal", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
