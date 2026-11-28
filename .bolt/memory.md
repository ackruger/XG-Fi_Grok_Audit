# Project memory

## Product intent & audience

- App name: **Xg-Fi**
- Purpose: App for managing assets and cases
- Intended to be published and shared with end users who sign in to manage assets/cases
- Built on Node.js with vite-react framework
- Includes user invitation flow via email for onboarding end users
- Organizational unit: **facilities** — users may have access to one or more facilities

## Brand personality & voice

- Email sender display name uses "Xg-Fi" as brand name
- No broader brand direction established yet

## Visual design & UX direction

- No design details inferred yet
- App includes authentication/sign-in flow and invitation onboarding for end users

## Decisions, constraints & rationale

- Framework selected: vite-react on Node.js
- Email service: **Resend** used for sending invitation emails
- Invitation sender configured as **Xg-Fi <admin@xeitgeist.ca>**
- Domain **xeitgeist.ca** must be verified in Resend before emails can be delivered
- Current assistant search is limited to asset-related records only
- Planned expansion: search across assets, cases, team members, pending invitations, notes, checklists, plans, and documents
- Search results should indicate which records support each answer
- Access control: search respects user permissions; invitation details restricted to users allowed to manage the team
- Private information from other teams/facilities must not be exposed

## Open questions & assumptions

- **xeitgeist.ca domain verification in Resend is pending** — actual email delivery unconfirmed
- **Search scope definition**: does "everywhere" mean everything in the selected facility, or all facilities the user has access to? This determines search scope without exposing another team's private information.
- Whether facility selection/filtering is part of the existing UI or still needs to be designed

¿