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

Apply the latest migrations (especially the security-hardening ones).

Redeploy these Edge Functions after any change:

- `supabase/functions/ai-chat-query`
- `supabase/functions/send-invitation-email`

Rebuild the frontend from source on deploy. Do not rely on a committed `dist/` folder.

## QR / NFC deep-link configuration

Set the production environment variable `VITE_PUBLIC_APP_URL` to the permanent public HTTPS origin of the deployed Xg-Fi app (for example, `https://xgfi.example.com`). QR codes and NFC tag URLs use this canonical base when it is configured.

Do not program NFC tags from a temporary Bolt preview URL. The stored URL format is:

`<VITE_PUBLIC_APP_URL>/q/<stable-qr-token>`

The existing `public/_redirects` SPA fallback must remain in the build so a fresh browser navigation to `/q/:token` loads the React app and resolves the asset.

## Invitation email (Resend)

The `send-invitation-email` Edge Function sends via Resend. Required secrets (Bolt Secrets or Supabase Edge Function secrets):

| Secret | Purpose |
|--------|---------|
| `RESEND_API_KEY` | Resend API key (`re_...`) |
| `RESEND_FROM` | Verified From address, e.g. `NovusNow <commercial@novusnow.ca>` |
| `APP_URL` | Permanent HTTPS origin used in the email link (same as `VITE_PUBLIC_APP_URL`) |

### Why emails fail

1. **Domain not verified in Resend** — the From domain (`novusnow.ca` or whatever you use) must be verified in the Resend dashboard (DNS records added). Until then Resend returns 403/422.
2. **`RESEND_API_KEY` missing or invalid**.
3. **`APP_URL` not set** — function returns 503 before attempting to send.
4. **From address mismatch** — `RESEND_FROM` must be an address on a verified domain.

After the latest update the function returns the actual Resend error body (truncated) in the response `detail` field and logs it. Check the Edge Function logs or the UI error for the exact reason.

If `APP_URL` is not set, the edge function returns a 503 error instead of sending an email with a wrong link.
