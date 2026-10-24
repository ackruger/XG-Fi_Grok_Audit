# Xg-Fi deployment notes

This package includes the troubleshooting/security fixes plus the latest UI changes:

- User-facing **Issues** terminology changed to **Cases** (`/cases` is the primary route; legacy `/issues` links still work).
- Asset CSV/Register Import entry points removed from the Assets page and navigation.
- Facility invitation acceptance fixed and made transactional.
- Parent organization membership is created/backfilled for facility members.
- Team permissions tightened: supervisors cannot grant or manage Admin access.
- Invitation email Edge Function now verifies the caller and matching pending invitation.
- AI Edge Function verifies an asset belongs to the requested facility before using service-role access.
- Viewer write access tightened at RLS/storage level.
- Facility-scoped photo/document storage policies restored/tightened.
- Password recovery now includes a Choose New Password screen.
- Cross-organization QR resolution fixed for facilities the user can access.

## Supabase deployment

Apply the new migration:

`supabase/migrations/20260922000000_050_security_and_access_fixes.sql`

Redeploy these Edge Functions:

- `supabase/functions/ai-chat-query`
- `supabase/functions/send-invitation-email`

The existing `dist/` build is intentionally not included in the final ZIP. Rebuild from source during deployment.


## QR / NFC deep-link configuration

Set the production environment variable `VITE_PUBLIC_APP_URL` to the permanent public HTTPS origin of the deployed Xg-Fi app (for example, `https://xgfi.example.com`). QR codes and NFC tag URLs use this canonical base when it is configured.

Do not program NFC tags from a temporary Bolt preview URL. The stored URL format is:

`<VITE_PUBLIC_APP_URL>/q/<stable-qr-token>`

The existing `public/_redirects` SPA fallback must remain in the build so a fresh browser navigation to `/q/:token` loads the React app and resolves the asset.

## Invitation email APP_URL secret

The `send-invitation-email` edge function uses an `APP_URL` secret to build the sign-in link in invitation emails. Add it in the Bolt Secrets tab (database icon > Secrets):

- **Name**: `APP_URL`
- **Value**: the same permanent HTTPS origin as `VITE_PUBLIC_APP_URL` (e.g. `https://your-app.bolt.host`)

If `APP_URL` is not set, the edge function returns a 503 error instead of sending an email with a wrong link.
