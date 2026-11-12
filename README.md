# XG-Fi (Xg-Fi) — Field Intelligence

Asset and facility management app built with React + Supabase (originally generated in Bolt.new).

## Quick start

```bash
npm install
cp .env.example .env   # fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev
```

## Required configuration

### Frontend (`.env`)

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_PUBLIC_APP_URL` — permanent HTTPS origin used for QR / NFC links

### Edge Function secrets (Bolt Secrets or Supabase)

- `RESEND_API_KEY` — Resend API key
- `RESEND_FROM` — verified sender address (domain must be verified in Resend)
- `APP_URL` — same permanent origin as `VITE_PUBLIC_APP_URL`
- `OPENAI_API_KEY` — for AI chat (optional)

## Email (Resend)

Invitation emails are sent by the `send-invitation-email` Edge Function.

**Most common failure:** the From domain is not verified in Resend.  
Verify the domain in the Resend dashboard, set `RESEND_FROM` to an address on that domain, and redeploy the function.

The function now returns the actual Resend error in the response so you can see the exact reason (403 domain not verified, invalid API key, etc.).

## Deployment

See `DEPLOYMENT_NOTES.md` for migration, QR, and secret setup details.

## Scripts

- `npm run dev` — local development
- `npm run build` — production build
- `npm run lint` — oxlint
- `npm test` — node test runner
