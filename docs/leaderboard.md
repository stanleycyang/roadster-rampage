# Global leaderboard

Implementation is offline-tested and disabled by default. The deployment-disabled feature branch is published as [draft PR #2](https://github.com/stanleycyang/roadster-rampage/pull/2) with owner approval. The owner subsequently provisioned and connected the Free Redis store described below. The feature has not been deployed or merged; hosted smoke testing remains pending.

## Design

One same-origin Node 24 Vercel Function at `/api/leaderboard`, with an Upstash-compatible Redis REST adapter using built-in `fetch` and `node:crypto`. No runtime dependency, accounts, moderation service, framework migration, background job, or realtime connection was added. Vite alone serves the game; its missing API produces a non-blocking unavailable state.

- GET returns at most 100 runs. POST `start` registers a fresh run with a server-generated UUID and HMAC-signed ticket; registration sends no score. POST `submit` is only triggered by the explicit post-run button.
- The API derives a signing key from the server secret and `LEADERBOARD_PREFIX` using domain-separated HMAC-SHA256. A ticket is valid only within its datastore prefix, even if two environments share the configured secret. Changing the prefix or upgrading from the earlier unscoped signing invalidates outstanding tickets; no leaderboard deployment had occurred when this change was introduced.
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

1. Authenticated scoped metadata confirms Vercel team `testimonio` (`team_idxL5WtlJ0ci1y7tBwPL6AhC`), on the **Pro** plan, and project `roadster-rampage` (`prj_tcwMz3XsuDA1Wi2PCgOjgdUCoYq8`), using Node `24.x` and linked to `stanleycyang/roadster-rampage`. The earlier unscoped 404 was a scope mismatch. The [verified production deployment](https://vercel.com/testimonio/roadster-rampage/3M4BV4gur71z9ijzdNJKRGyiqDzY) is READY, originated from Git branch `main` at baseline commit `1b89f3b3c0a695fc7c02162ae836fd54849115aa`, and has alias `roadster-rampage-silk.vercel.app`. Complete the read-only check of current Git deployment settings and any dashboard overrides before publication; the returned metadata does not establish every deployment setting.
2. Read-only reconciliation on 2026-10-19 confirms the owner-created `roadster-rampage-redis` store (`store_DaSpofDaBahdZ4J0`) is ready on Free in `iad1`, with automatic upgrades, eviction, and ProdPack disabled. The owner connected it to Roadster preview and production, supplying the sensitive `KV_REST_API_URL` and `KV_REST_API_TOKEN` bindings. No reconnection or credential copying is required. The run-ticket signing secret, prefix, and enablement settings remain separate setup requirements. Never reuse Faroway storage. No database/schema migration is required.
3. Configure only server-side variables in the intended environment: a complete `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` pair, or the existing Vercel integration pair `KV_REST_API_URL` + `KV_REST_API_TOKEN`, plus `LEADERBOARD_SECRET` (cryptographically random, at least 32 characters), `LEADERBOARD_PREFIX` (e.g. `roadster:production:roadster-v1`), and finally `LEADERBOARD_ENABLED=true`. Never use `VITE_` names. Do not put credentials in Git or paste them into task output.

   The explicit Upstash pair takes precedence. If either explicit variable is present (even empty), both must be valid; the server never combines bindings or falls back from an incomplete explicit pair. `KV_REST_API_READ_ONLY_TOKEN`, `REDIS_URL`, and `KV_URL` are not used. This allows the existing integration bindings to work without copying credentials.

4. Previews must use a different database or at least a distinct prefix AND signing secret; never attach production credentials to an unreviewed preview. Keep the flag unset until a separately authorized preview smoke test. Verify same-origin routing, real REST EVAL, trusted IP header, limits, and failure behavior there.
5. Approve production release separately. To disable, unset the enable flag and redeploy through the approved process. Preserve Redis for recovery; do not delete keys without permission. Ruleset changes must also change the datastore prefix to avoid mixing incompatible scores.

## Safe publication plan

Inspected baseline/main: `1b89f3b3c0a695fc7c02162ae836fd54849115aa`; GitHub reported no open PRs on 2026-10-18. No repository AGENTS.md or .agents skills were present.

`.github/workflows/ci.yml` runs on **every push and pull request**, with read-only contents permission, npm install, tests and build. It contains no deployment step. Vercel Git integration is separate: unspecified branches default to deployment enabled. This branch adds `feature/global-leaderboard: false` alongside the existing release-branch block; `main` is still deployment-enabled by default. See [Vercel Git configuration](https://vercel.com/docs/project-configuration/git-configuration).

The owner approved publishing the feature branch and opening [draft PR #2](https://github.com/stanleycyang/roadster-rampage/pull/2). Before publication, remote main and open PRs were rechecked, the exact feature-branch deployment block was verified, and the repository was confirmed public with standard Ubuntu CI. After publication, the scoped Vercel deployment list returned no deployments for the feature branch. A draft PR alone is not a deployment barrier: retain the explicit branch block and keep activation variables absent. Production rollout remains gated on configuration and preview validation. This agent has performed no deployment, provisioning, credentials attachment, or hosted datastore writes; the owner-completed setup is described above.

### Historical Upstash Free setup handoff (2026-10-18)

The existing official Upstash integration offers plan ID `free` (500,000 commands/month, one database per account, no payment method required). The catalog labels even this free resource plan as type `subscription`; do not enroll or fall back to any paid plan without the required confirmation. Free-slot availability cannot be established from the exposed resource inventory tools.

The proposed provider-side action is to create a separate `roadster-rampage-leaderboard` Redis resource through the existing `testimonio` Upstash integration, selecting Free, primary region `iad1`, no extra read regions, eviction off, Prod Pack off, and automatic upgrade off. Confirm the free slot in the authenticated provider dashboard first; if unavailable, stop without purchasing or reusing Faroway storage. Creation can generate database credentials, so pause before confirming resource creation. Any subsequent attachment to Roadster environment variables is a separate credential transmission and persistent-access step requiring explicit confirmation of the destination environment. Do not select all projects, attach production credentials to previews, expose secret values, or accept new legal terms automatically.

The resource request would share the existing team/integration identity, resource name, plan and region/options with Vercel and Upstash. Attachment would make newly generated database connection credentials available to the selected Roadster server environment. It would not require repository source, saved scores, or Faroway data. No such creation, attachment, or secret generation/transmission has occurred. See the [official integration flow](https://upstash.com/docs/redis/howto/vercelintegration).

## Estimated costs — verified 2026-10-18, not an activation

- Current offline work: **$0 new hosted infrastructure**; nothing provisioned.
- Upstash's published free Redis plan: **$0/month**, 250 MB, 500,000 commands/month, 10 GB bandwidth. The authenticated integration plan catalog confirms a limit of **one free database per account**; availability of that allowance is unverified. PAYG: **$0.20 per 100,000 commands**; fixed plans start at **$10/month**. No paid plan or automatic upgrade is authorized. Source: [Upstash pricing](https://upstash.com/pricing/redis).
- Authenticated metadata confirms the existing `testimonio` team is on **Vercel Pro**, so no plan upgrade is needed and Hobby allowances do not apply. The published Pro platform fee is **$20/month**, including $20 of shared monthly usage credit. Existing usage, remaining credit, and the exact incremental bill remain unverified: the monthly billing export exceeded the tool limit, and a successful one-day summary cannot establish monthly usage or remaining credit. Published Fluid compute rates in `iad1` (the verified deployment region) are **$0.128/CPU-hour**, **$0.0106/GB-hour**, and **$0.60/million invocations**, subject to applicable credit; these are unit rates, not a measured leaderboard bill. Sources: [Vercel Pro plan](https://vercel.com/docs/plans/pro-plan), [function pricing](https://vercel.com/docs/functions/usage-and-pricing).
- Illustrative small load: 1,000 registrations + 1,000 submissions + 3,000 reads/month is roughly 50,000 Redis command operations when conservatively counting each inner Lua call and EVAL. That fits the listed free command quota only if the account's free database is available; at the published PAYG command rate it is roughly **$0.10/month for commands**, excluding storage/transfer/replication and hosting. This is an estimate, not a total bill or promise. Additional read regions replicate writes and add cost. Check actual metering and existing project usage before activating.

References: [Vercel Node functions](https://vercel.com/docs/functions/runtimes/node-js), [Vercel trusted headers](https://vercel.com/docs/headers/request-headers), [Redis REST API](https://upstash.com/docs/redis/features/restapi), [atomic Lua over HTTP](https://upstash.com/blog/lua-scripting-on-upstash-redis-atomic-operations-over-http).

## Completed verification for this implementation

On 2026-10-18, Node 24.19.0:

- 7/7 Node tests passed, including actual Redis 7.2.7 Lua execution on a temporary Unix socket with persistence disabled.
- 6/6 Chromium Playwright tests passed: title/score UI, keyboard focus, pause/resume/Sound, mobile scrolling and targets, debug/shot exclusion, actual game finish/restart integration, local record isolation, immutable submitted values, duplicate clicks, stale reads/submissions, unavailable/offline states, and tampered response aliases.
- Frontend and strict backend TypeScript checks and Vite production build passed. Vite retains its non-failing large-bundle warning for the Three.js game bundle.
- `git diff --check` passed; generated frontend assets contain none of the server credential variable names or `node:crypto` imports.
- Independent final-diff review found two issues (gameplay button focus and capped-client global quota consumption); both were fixed and re-reviewed. Reviewer independently reran all seven Node tests and reported no remaining actionable findings.
- Hosted integration/deployment smoke tests were not run: no provisioning, credentials, live datastore writes, or deployment were authorized. Subsequent read-only reconciliation resolved the scope mismatch and verified the project, Pro plan, repository link, Node version, and baseline production deployment described above. Complete datastore inventory, free-tier availability, current deployment overrides, remaining usage credit, and exact activation costs remain unverified.
