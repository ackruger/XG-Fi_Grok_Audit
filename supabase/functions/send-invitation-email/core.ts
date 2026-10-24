export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

export const ALLOWED_ROLES = ["viewer", "contributor", "reviewer", "supervisor", "admin"] as const;
export const SEND_TIMEOUT_MS = 10_000;
export const SENDER_LIMIT_PER_HOUR = 20;
export const INVITATION_LIMIT_PER_HOUR = 3;

const ROLE_LABELS: Record<string, string> = {
  viewer: "Viewer",
  contributor: "Contributor",
  reviewer: "Reviewer",
  supervisor: "Supervisor",
  admin: "Admin",
};

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function stripControl(value: string): string {
  return Array.from(value, (ch) => {
    const code = ch.charCodeAt(0);
    return code < 0x20 || code === 0x7f ? " " : ch;
  }).join("").trim();
}

export function resolveAppOrigin(configured: string | undefined | null): string | null {
  if (configured) {
    try {
      const url = new URL(configured.trim());
      if (url.protocol === "https:" && !url.username && !url.password) return url.origin;
    } catch {
      // invalid — return null so the caller fails clearly
    }
  }
  return null;
}

export type InviteRequest = { email: string; role: string; facilityId: string };

export function validateRequest(body: unknown): { ok: true; value: InviteRequest } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Invalid request body" };
  const b = body as Record<string, unknown>;
  const rawEmail = typeof b.email === "string" ? b.email : typeof b.to === "string" ? b.to : "";
  const email = rawEmail.trim().toLowerCase();
  const role = typeof b.role === "string" ? b.role : "";
  const facilityId = typeof b.facilityId === "string" ? b.facilityId : "";
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) return { ok: false, error: "Invalid email address" };
  if (!(ALLOWED_ROLES as readonly string[]).includes(role)) return { ok: false, error: "Invalid role" };
  if (!UUID_RE.test(facilityId)) return { ok: false, error: "Invalid facility" };
  return { ok: true, value: { email, role, facilityId } };
}

export function buildInviteEmail(input: {
  facilityName: string;
  inviterName: string;
  role: string;
  email: string;
  appOrigin: string;
}): { subject: string; html: string; text: string; signInUrl: string } {
  const facility = stripControl(input.facilityName).slice(0, 200) || "a facility";
  const inviter = stripControl(input.inviterName).slice(0, 200) || "A team member";
  const roleLabel = ROLE_LABELS[input.role] ?? "Member";
  const signInUrl = `${input.appOrigin}/dashboard`;
  const f = escapeHtml(facility);
  const i = escapeHtml(inviter);
  const e = escapeHtml(input.email);
  const r = escapeHtml(roleLabel);
  const link = escapeHtml(signInUrl);

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden;">
<tr><td style="background:#0f172a;padding:28px 32px;"><h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:600;">You're invited to join ${f}</h1></td></tr>
<tr><td style="padding:32px;">
<p style="margin:0 0 16px;color:#334155;font-size:15px;line-height:1.6;"><strong>${i}</strong> has invited you to join <strong>${f}</strong> as a <strong>${r}</strong>.</p>
<p style="margin:0 0 24px;color:#334155;font-size:15px;line-height:1.6;">Sign in or create an account using <strong>${e}</strong> and the invitation will be applied automatically.</p>
<p style="margin:0 0 24px;"><a href="${link}" style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 24px;border-radius:8px;">Sign in to accept</a></p>
<p style="margin:0;color:#64748b;font-size:13px;line-height:1.5;">Or open this address: ${link}</p>
</td></tr>
<tr><td style="padding:20px 32px;border-top:1px solid #e2e8f0;"><p style="margin:0;color:#94a3b8;font-size:12px;">If you weren't expecting this invitation, you can ignore this email.</p></td></tr>
</table></td></tr></table></body></html>`;

  const text = `${inviter} has invited you to join ${facility} as a ${roleLabel}.\n\nSign in or create an account using ${input.email} and the invitation will be applied automatically:\n${signInUrl}\n\nIf you weren't expecting this invitation, you can ignore this email.`;

  return { subject: `You're invited to join ${facility}`.slice(0, 200), html, text, signInUrl };
}

export type SendResult = { ok: true } | { ok: false; detail: string };

export type InviteDeps = {
  resendKey: string | undefined;
  appUrl: string | undefined;
  getUser: () => Promise<{ id: string; email: string | null } | null>;
  getFacilityRole: (facilityId: string, userId: string) => Promise<string | null>;
  findPendingInvitation: (q: { facilityId: string; email: string; role: string; invitedBy: string }) => Promise<{ id: string } | null>;
  getFacilityName: (facilityId: string) => Promise<string | null>;
  getInviterName: (userId: string) => Promise<string | null>;
  countSenderSends: (senderId: string, sinceIso: string) => Promise<number>;
  countInvitationSends: (invitationId: string, sinceIso: string) => Promise<number>;
  logSend: (row: { invitationId: string; senderId: string; facilityId: string }) => Promise<string>;
  finishSend: (id: string, status: "sent" | "failed", error: string | null) => Promise<void>;
  sendEmail: (msg: { to: string; subject: string; html: string; text: string }, signal: AbortSignal) => Promise<SendResult>;
  now?: () => number;
  timeoutMs?: number;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export async function handleInvite(req: Request, deps: InviteDeps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    if (!deps.resendKey) return json({ error: "Email service is not configured" }, 503);

    const user = await deps.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid request body" }, 400);
    }
    const parsed = validateRequest(body);
    if (!parsed.ok) return json({ error: parsed.error }, 400);
    const { email, role, facilityId } = parsed.value;

    const callerRole = await deps.getFacilityRole(facilityId, user.id);
    if (callerRole !== "admin" && callerRole !== "supervisor") {
      return json({ error: "You do not have permission to invite members to this facility" }, 403);
    }
    if (callerRole === "supervisor" && role === "admin") {
      return json({ error: "Supervisors cannot invite admins" }, 403);
    }

    const invitation = await deps.findPendingInvitation({ facilityId, email, role, invitedBy: user.id });
    if (!invitation) return json({ error: "No matching pending invitation found for this caller" }, 403);

    const now = deps.now ? deps.now() : Date.now();
    const since = new Date(now - 60 * 60 * 1000).toISOString();
    const [senderCount, invitationCount] = await Promise.all([
      deps.countSenderSends(user.id, since),
      deps.countInvitationSends(invitation.id, since),
    ]);
    if (senderCount >= SENDER_LIMIT_PER_HOUR || invitationCount >= INVITATION_LIMIT_PER_HOUR) {
      return json({ error: "Too many invitation emails sent recently. Please try again later." }, 429);
    }

    const [facilityName, inviterName] = await Promise.all([
      deps.getFacilityName(facilityId),
      deps.getInviterName(user.id),
    ]);
    if (!facilityName) return json({ error: "Facility not found" }, 404);

    const appOrigin = resolveAppOrigin(deps.appUrl);
    if (!appOrigin) return json({ error: "APP_URL is not configured. Set it to the published app URL." }, 503 );

    const message = buildInviteEmail({
      facilityName,
      inviterName: inviterName || user.email || "A team member",
      role,
      email,
      appOrigin,
    });

    const logId = await deps.logSend({ invitationId: invitation.id, senderId: user.id, facilityId });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? SEND_TIMEOUT_MS);
    let result: SendResult;
    try {
      result = await deps.sendEmail({ to: email, subject: message.subject, html: message.html, text: message.text }, controller.signal);
    } catch (err) {
      const aborted = controller.signal.aborted || (err instanceof Error && err.name === "AbortError");
      result = { ok: false, detail: aborted ? "Email provider timed out" : "Email provider request failed" };
    } finally {
      clearTimeout(timer);
    }

    if (!result.ok) {
      await deps.finishSend(logId, "failed", result.detail.slice(0, 500));
      return json({ error: "The invitation was saved, but the email could not be sent", detail: result.detail }, 502);
    }

    await deps.finishSend(logId, "sent", null);
    return json({ success: true });
  } catch (err) {
    console.error("send-invitation-email error", err);
    return json({ error: "Internal server error" }, 500);
  }
}
