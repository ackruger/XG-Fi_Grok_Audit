/*
# Invitation email send log (rate limiting and audit)

## Summary
The invitation email function had no durable rate limiting. This adds a server-only log
of send attempts so the function can cap how many invitation emails a caller (and a single
invitation) can trigger within a time window, and so delivery failures are recorded.

## 1. New table `invitation_email_sends`
- `id` uuid primary key
- `invitation_id` uuid -> facility_invitations (cascade on delete)
- `sender_id` uuid -> auth.users
- `facility_id` uuid -> facilities (cascade on delete)
- `status` text: `attempted`, `sent`, `failed`
- `error` text, short provider/timeout description on failure
- `created_at` timestamptz

## 2. Security
- RLS enabled with NO client policies: only the edge function (service role) reads/writes it.
- SELECT/INSERT/UPDATE/DELETE privileges revoked from anon and authenticated.

## 3. Notes
1. Additive and idempotent; no existing data changes.
*/

CREATE TABLE IF NOT EXISTS public.invitation_email_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id uuid NOT NULL REFERENCES public.facility_invitations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'attempted' CHECK (status IN ('attempted', 'sent', 'failed')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invitation_email_sends_sender_time
  ON public.invitation_email_sends (sender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invitation_email_sends_invitation_time
  ON public.invitation_email_sends (invitation_id, created_at DESC);

ALTER TABLE public.invitation_email_sends ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.invitation_email_sends FROM anon, authenticated;
