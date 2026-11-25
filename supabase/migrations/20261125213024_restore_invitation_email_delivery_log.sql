/*
# Restore invitation email delivery history

## 1. New table
- invitation_email_sends records each send attempt with its invitation, sender, facility, status, error description, and creation time.
- Indexed sender and invitation timestamps support existing hourly send limits.

## 2. Security
- Enable row level security and explicitly deny all four client operations.
- Revoke client privileges; grant only SELECT, INSERT and UPDATE to the service role used by the email sender.

## 3. Notes
1. No existing invitations or memberships are changed.
2. This restores the storage required before the email sender can contact Resend.
3. Safe to reapply.
*/
CREATE TABLE IF NOT EXISTS public.invitation_email_sends (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 invitation_id uuid NOT NULL REFERENCES public.facility_invitations(id) ON DELETE CASCADE,
 sender_id uuid NOT NULL REFERENCES auth.users(id),
 facility_id uuid NOT NULL REFERENCES public.facilities(id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'attempted' CHECK (status IN ('attempted','sent','failed')),
 error text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invitation_email_sends_sender_time ON public.invitation_email_sends(sender_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invitation_email_sends_invitation_time ON public.invitation_email_sends(invitation_id,created_at DESC);
ALTER TABLE public.invitation_email_sends ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.invitation_email_sends FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.invitation_email_sends TO service_role;
DROP POLICY IF EXISTS "deny_client_select" ON public.invitation_email_sends;
CREATE POLICY "deny_client_select" ON public.invitation_email_sends FOR SELECT TO authenticated USING (false);
DROP POLICY IF EXISTS "deny_client_insert" ON public.invitation_email_sends;
CREATE POLICY "deny_client_insert" ON public.invitation_email_sends FOR INSERT TO authenticated WITH CHECK (false);
DROP POLICY IF EXISTS "deny_client_update" ON public.invitation_email_sends;
CREATE POLICY "deny_client_update" ON public.invitation_email_sends FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS "deny_client_delete" ON public.invitation_email_sends;
CREATE POLICY "deny_client_delete" ON public.invitation_email_sends FOR DELETE TO authenticated USING (false);