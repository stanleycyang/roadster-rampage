# Global leaderboard

Implementation is offline-tested and disabled by default. Nothing has been provisioned, pushed, deployed, or written to a hosted datastore.

## Design

One same-origin Node 24 Vercel Function at `/api/leaderboard`, with an Upstash-compatible Redis REST adapter using built-in `fetch` and `node:crypto`. No runtime dependency, accounts, moderation service, framework migration, background job, or realtime connection was added. Vite alone serves the game; its missing API produces a non-blocking unavailable state.

- GET returns at most 100 runs. POST `start` registers a fresh run with a server-generated UUID and HMAC-signed ticket; registration sends no score. POST `submit` is only triggered by the explicit post-run button.
- Tickets expire after six hours. Scores, distance in whole metres, and active gameplay duration in milliseconds come from a frozen current-run snapshot. They never come from saved personal records. Personal records, unlocks, scoring, physics, and replay remain local and otherwise unchanged.
- Debug pages (even without pressing a cheat key), beauty mode, and all `shot` URLs are excluded from registration/submission. The API rejects true or missing eligibility flags.
- There is no name input. Only the server assigns one of 36 aliases from six colors and six animals in `shared/leaderboard.ts`. Extra fields, including `name`, `displayName`, or `alias`, are rejected. Responses are validated and rendered with `textContent`.
- The top 100 are ordered by score descending, then server run UUID descending lexicographically. Ties do not move when retried. Alias collisions are expected: aliases identify runs, not accounts.
- One atomic Lua script deduplicates, adds, and trims. Separate seen-run IDs remain even when runs fall off the top 100. Seen IDs are pruned only when their signed tickets are no longer valid. A retry cannot replace an earlier accepted score. Expired tickets cannot be refreshed for an old UUID because registration always generates a new one.
- Strict exact-field validation; 2 KiB streamed body limit; UUID v4; fixed ruleset; safe integer score 0–1 billion, distance 0–1 million m, active duration 1 ms–6 h; elapsed-time and broad 150 m/s sanity bounds. These are bounds, not proof of play.
- Redis timeout 3 seconds; browser requests timeout after 5 seconds; function maximum duration 10 seconds. No automatic retries/polling. Missing configuration/storage fails closed to 503 while play continues.
- UI generations and aborts prevent stale reads/submissions from changing another screen. Submission is locked while pending and after success; uncertain failures can be retried safely. Restarting does not upload the previous run. Keyboard activation of UI controls cannot start/jump; gameplay controls regain focus after menu/HUD actions.

**This is a casual leaderboard with unverified browser-generated scores.** A determined client can fabricate scores or falsely claim it is not in debug mode. Signed tickets limit replay and arbitrary identifiers, not cheating. The server still guarantees that arbitrary/obscene display names cannot be submitted through this API. Do not use this leaderboard for prizes or trusted competition.

## Abuse bounds and privacy

Atomic fixed-window gates permit 120 reads and 20 writes (registration plus submission) per IP per hour, 5,000 admitted requests globally per hour, and 2,000 writes globally per UTC day. A typical completed/submitted run uses two writes. Shared networks share limits. Rejected per-client requests do not consume global admission capacity.

The Vercel-provided `x-vercel-forwarded-for` address is HMAC-hashed with the hour; no raw IP is stored by this application. Missing ingress identity shares the `unknown` bucket. Do not expose this handler directly behind an untrusted proxy without revisiting the trusted header. Hash fields are allocated only after the global cap check. Hourly hashes expire after two hours of inactivity; daily counters after two days. Seen IDs expire after twelve hours of inactivity and are pruned at writes. With the daily gate their count is bounded; top rows remain at most 100 indefinitely.

These application limits bound accepted work/storage, **not hosting spend under an arbitrary flood**: rejected calls still invoke the function and may execute the rate gate. Distributed attackers can exhaust global availability. Before activation, select provider budget controls and platform firewall protection. Do not promise a hard dollar cap from this code.

## Offline verification

```sh
npm ci
npm test
npm run build                 # frontend + strict backend type checks, then Vite
CHROMIUM_PATH=/path/to/chromium npm run test:browser
```

Browser tests start only a loopback Vite server, mock the API, block external fonts/network, and use software WebGL. Chromium defaults to `/usr/bin/chromium`; set `CHROMIUM_PATH` on other machines. No credentials are needed. Tests expose the game instance by intercepting the local module in the test only; no production cheat/test hook was added.

The optional Lua integration test launches a disposable Redis process on a fresh Unix socket with TCP and persistence disabled, then stops it and removes its temporary directory. It never uses configured application credentials or a hosted database:

```sh
REDIS_SERVER=/path/to/redis-server REDIS_CLI=/path/to/redis-cli npm test
```

Without these paths, that one test is explicitly skipped; mocked tests still run. The test verifies real concurrent Lua deduplication, ties, trimming, per-client/global/daily limits, rate-key expiry, and bounded field allocation. Node tests also cover malformed/tampered submissions, expired tickets, storage failures, REST command mapping, and immutable/debug run state.

## Activation requirements — separate authorization needed

1. Confirm the actual Vercel team/project and Node 24 runtime. The connected account returned project-not-found during this task; account plan, linked repository, production branch, environment scopes, and live deployment settings remain unverified.
2. After owner approval, select/create one durable Redis database near the function. Disable eviction of leaderboard/dedup keys, confirm EVAL support, and choose explicit usage/budget limits. No database/schema migration is required.
3. Configure only server-side variables in the intended environment: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `LEADERBOARD_SECRET` (cryptographically random, at least 32 characters), `LEADERBOARD_PREFIX` (e.g. `roadster:production:roadster-v1`), and finally `LEADERBOARD_ENABLED=true`. Never use `VITE_` names. Do not put credentials in Git or paste them into task output.
4. Previews must use a different database or at least a distinct prefix AND signing secret; never attach production credentials to an unreviewed preview. Keep the flag unset until a separately authorized preview smoke test. Verify same-origin routing, real REST EVAL, trusted IP header, limits, and failure behavior there.
5. Approve production release separately. To disable, unset the enable flag and redeploy through the approved process. Preserve Redis for recovery; do not delete keys without permission. Ruleset changes must also change the datastore prefix to avoid mixing incompatible scores.

## Safe publication plan

Inspected baseline/main: `1b89f3b3c0a695fc7c02162ae836fd54849115aa`; GitHub reported no open PRs on 2026-10-18. No repository AGENTS.md or .agents skills were present.

`.github/workflows/ci.yml` runs on **every push and pull request**, with read-only contents permission, npm install, tests and build. It contains no deployment step. Vercel Git integration is separate: unspecified branches default to deployment enabled. This branch adds `feature/global-leaderboard: false` alongside the existing release-branch block; `main` is still deployment-enabled by default. See [Vercel Git configuration](https://vercel.com/docs/project-configuration/git-configuration).

Do not push or create a PR until the owner approves publication and verifies the linked Vercel project's deployment settings. Verify the branch block is honored before the first push (including account/dashboard overrides), or disable Git deployments in that project through a separately authorized action. A draft PR alone is not a deployment barrier. Keep activation variables absent. Push only the reviewed exact feature-branch commit after approval; do not merge into main until production rollout is separately approved. No push, PR, comments, merge or deployment was performed here.

## Estimated costs — verified 2026-10-18, not an activation

- Current offline work: **$0 new hosted infrastructure**; nothing provisioned.
- Upstash's published free Redis plan: **$0/month**, 250 MB, 500,000 commands/month, 10 GB bandwidth. PAYG: **$0.20 per 100,000 commands**; fixed plans start at **$10/month**. Source: [Upstash pricing](https://upstash.com/pricing/redis).
- Vercel publishes Hobby at **$0/month** and Pro at **$20/month** plus applicable usage. The actual account's eligibility, existing usage, and plan are unknown. Source: [Vercel pricing](https://vercel.com/pricing).
- Illustrative small load: 1,000 registrations + 1,000 submissions + 3,000 reads/month is roughly 50,000 Redis command operations when conservatively counting each inner Lua call and EVAL. That fits the listed free quota; at the published PAYG command rate it is roughly **$0.10/month for commands**, excluding storage/transfer/replication and hosting. This is an estimate, not a total bill or promise. Additional read regions replicate writes and add cost. Check actual metering and existing project usage before activating.

References: [Vercel Node functions](https://vercel.com/docs/functions/runtimes/node-js), [Vercel trusted headers](https://vercel.com/docs/headers/request-headers), [Redis REST API](https://upstash.com/docs/redis/features/restapi), [atomic Lua over HTTP](https://upstash.com/blog/lua-scripting-on-upstash-redis-atomic-operations-over-http).

## Completed verification for this implementation

On 2026-10-18, Node 24.19.0:

- 7/7 Node tests passed, including actual Redis 7.2.7 Lua execution on a temporary Unix socket with persistence disabled.
- 6/6 Chromium Playwright tests passed: title/score UI, keyboard focus, pause/resume/Sound, mobile scrolling and targets, debug/shot exclusion, actual game finish/restart integration, local record isolation, immutable submitted values, duplicate clicks, stale reads/submissions, unavailable/offline states, and tampered response aliases.
- Frontend and strict backend TypeScript checks and Vite production build passed. Vite retains its non-failing large-bundle warning for the Three.js game bundle.
- `git diff --check` passed; generated frontend assets contain none of the server credential variable names or `node:crypto` imports.
- Independent final-diff review found two issues (gameplay button focus and capped-client global quota consumption); both were fixed and re-reviewed. Reviewer independently reran all seven Node tests and reported no remaining actionable findings.
- Hosted integration/deployment smoke tests were not run: no provisioning, credentials, live datastore writes, or deployment were authorized. Vercel project settings could not be verified through the connected account (404 project not found).
