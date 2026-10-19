# Player usernames — draft implementation

Status: backend foundation only. Guest play and the existing random-alias leaderboard remain active. No production configuration or deployment was changed. This branch explicitly disables its automatic Vercel deployment.

## Implemented

- ASCII usernames: 3–16 characters, starting with a letter, then letters, digits or underscores. Case-insensitive uniqueness; original capitalization is displayed.
- Atomic Redis claims prevent two accounts from acquiring the same name. One current name per account; ordinary changes have a 30-day cooldown. Previous names stay reserved to their original account to prevent impersonation. Moderated names become globally reserved, including for their former owner.
- Server-side English profanity checks with Obscenity, joined/leet variants, a small core-stem denylist and reserved staff names. This is not a guarantee or multilingual moderation. Known benign exceptions are exact, not substring bypasses. The server rejects unsupported alphabets, invisible characters, spaces and punctuation rather than silently changing the requested name.
- The named submission path uses the authenticated account's profile; clients cannot supply aliases or player IDs. It remains optional and is not connected to the deployed API yet.
- Public player IDs are domain-separated HMACs. Redis holds no email addresses, provider user IDs or authentication tokens. The identity derivation secret must stay stable; rotating it needs a migration, otherwise existing claims become inaccessible.
- Named score writes recheck the current profile atomically in Lua, protecting against a simultaneous forced rename. Reads resolve names from profiles so old top-100 rows immediately reflect moderation and name changes. Existing random aliases remain compatible and do not reserve usernames.
- Authenticated reports accept only fixed reasons, deduplicate by reporter/target/name version, and expire from the queue after 30 days when a report is written. The queue returns at most 100 entries. Reports do not automatically ban a player.
- Moderator-only report review and forced rename logic. A forced rename hides the old name as `Name removed`, reserves it, and allows its owner to choose a replacement without the normal cooldown.
- Origin checks, exact request fields, streamed 2 KiB body limit, IP/account admission limits, and generic failure responses. These bound accepted work, not arbitrary hosting spend. Persistent name reservations grow with accounts and renames; monitor Redis usage and retain the existing provider budget controls.

## Pending before this feature is ready

1. Accept Clerk's Vercel Marketplace terms for team `testimonio`: <https://vercel.com/testimonio/~/integrations/accept-terms/clerk?source=cli>. The attempted installation returned `integration_terms_acceptance_required`; no Clerk resource was created. Complete that user account step before installing the SDK or connecting resources.
2. Provision an isolated development/preview Clerk application without connecting production. Configure verified email sign-in and Google as desired; explicitly validate allowed origins/authorized parties and verification status using Clerk's official SDK. No handmade JWT verifier or browser-local name ownership.
3. Add the real provider adapter, `/api/player` entry point, and explicit configuration gate; connect `PlayerServices` to the leaderboard only when the feature is fully configured. Missing auth configuration must fail closed when enabled, without falling back to anonymous named writes.
4. Build the post-run “Claim a name & submit” UI, account management, reports and moderator review UI, preserving the current run while the sign-in modal is open. Keep guest play and local records independent of authentication availability.
5. Test real sign-up, sign-in on another device, session expiry/sign-out, competing name claims, report review and forced rename in preview. Test account deletion/recovery and define a retention policy; historical scores must not be claimable by another account.
6. Review and enable production separately. Do not merge this draft as a complete username feature.

## Verification

`REDIS_SERVER=/path/to/redis-server REDIS_CLI=/path/to/redis-cli npm test` runs real Lua tests on disposable local Unix-socket Redis with persistence disabled. Tests cover concurrent case-insensitive claims, idempotence, cooldown, previous-name reservation, moderation, duplicate reports, named-score writes, denied impersonation fields and authentication/authorization failures. Without those binaries, the two local Redis tests skip explicitly. Type checks and the production build also pass.

References: [Clerk JavaScript setup](https://clerk.com/docs/js-frontend/getting-started/quickstart), [Clerk request authentication](https://clerk.com/docs/reference/backend/authenticate-request), [Obscenity](https://github.com/jo3-l/obscenity).
