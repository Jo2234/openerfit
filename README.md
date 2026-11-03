# OpenerFit

[Live portfolio demo](https://openerfit.onrender.com) · [Release verification and known limits](https://github.com/Jo2234/openerfit/releases)

The demo runs on Render Free and may need time to wake after inactivity. Load the live example, review artist identities, build a brief, open its receipts, and export Markdown or HTML. Example venue, fees and availability are fictional inputs. Do not enter confidential information.

OpenerFit helps a venue booker rank their own artist roster by Qloo taste affinity to a headliner, confirm artist identities, explore taste-matched brand, place and podcast partners, and export a receipt-backed booking brief. Affinity is not demand, revenue, availability or a booking guarantee. Fees and bookability are supplied by the booker.

## Why Qloo is essential

Qloo supplies the taste-affinity ranking and partner insights. Without Qloo, the agent can only guess taste relationships. An optional same-model LLM-only baseline makes that difference inspectable; it is illustrative, not a benchmark or evidence of measured improvement.

## How the agent works

The planner loop proposes schema-checked tool actions within call and turn budgets. Tag signals must use observed IDs. Deterministic domain code builds a catalogue of supported claims; the model selects claim IDs instead of inventing booking claims. Labelled scripted-planner and template-writer fallbacks keep failures visible. Receipts link claims to query, response and parsing evidence.

## Modes and examples

- `QLOO_MODE=fixture|live`: synthetic fixture responses or the Qloo API. A key alone never enables live mode.
- `LLM_MODE=none|fixture|openai-compatible`: scripted/template operation, synthetic model responses, or a configured model service.

The UI labels Qloo response provenance (fixture, live or cached) and planner/writer provenance and fallbacks separately. Fixture mode is not live Qloo or real inference. The fixture example uses synthetic artists and responses. The live example uses real artist names with a fictional venue and fictional fees; these are example booking inputs, not verified availability.

## Screenshots

These screenshots come from the synthetic fixture demo: fictional artists and hand-written responses, not Qloo data.

![Synthetic fixture demo setup form](docs/media/01-setup.png)
*Booking inputs for the synthetic fixture demo, using fictional artists and hand-written responses, not Qloo data.*

![Synthetic fixture identity confirmation](docs/media/02-identity.png)
*Confirming fictional artist identities in the synthetic fixture demo; hand-written responses, not Qloo data.*

![Synthetic fixture ranking and partner shortlists](docs/media/03-results.png)
*Ranking and partner shortlists from the synthetic fixture demo: fictional artists and hand-written responses, not Qloo data.*

![Synthetic fixture receipt drawer](docs/media/04-receipt.png)
*Inspecting a receipt from the synthetic fixture demo: fictional artists and hand-written responses, not Qloo data.*

## Quick start

Use Node 24 (the Docker image’s major version) and pnpm 12.11.2. Install the full dependency set: the production start command uses `tsx`, a development dependency.

```sh
pnpm install --frozen-lockfile
pnpm dev:fixture
```

Open the URL printed by Vite, load the fixture example, resolve and confirm identities, then generate and export a brief. Production and checks:

```sh
pnpm build
pnpm start
pnpm typecheck
pnpm test
# Install Chromium if not already available:
pnpm exec playwright install chromium
# E2E serves the built files; always build first:
pnpm build
pnpm test:e2e
```

Playwright runs one Chromium worker on loopback port 5189. `pnpm check:env` prints presence only; `pnpm params:extract` regenerates the parameter schema from project-maintained factual definitions. `scripts/live-batch-core.ts` and `scripts/live-common.ts` are retained regression-test support, not supported public live-verification CLI commands.

## Environment

Set secrets on the server only. The table lists configuration names and purpose, never credentials.

| Names | Purpose / default |
|---|---|
| `QLOO_MODE`, `QLOO_API_KEY`, `QLOO_BASE_URL` | Fixture by default; live needs a private key and the hackathon API host |
| `QLOO_CACHE`, `QLOO_CACHE_DIR`, `QLOO_CACHE_TTL_HOURS` | Private server cache; on, `.cache/qloo`, 168 hours |
| `LLM_MODE`, `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY` | None by default; configure provider for real inference |
| `LLM_TIMEOUT_MS`, `LLM_LLAMACPP` | 180000 ms; optional adapter compatibility switch off |
| `LLM_SUPPORTS_SEED` | Seed on by default; disable for providers without support |
| `LLM_REASONING_EFFORT` | Omitted by default; provider-specific |
| `LLM_PLANNER_MAX_TOKENS`, `LLM_WRITER_MAX_TOKENS`, `LLM_BASELINE_MAX_TOKENS` | Default output caps: 300 / 1200 / 900 |
| `HOST`, `PORT`, `TRUST_PROXY`, `NODE_ENV` | Bind address, port, public Render/Cloudflare proxy trust and production static serving |

The existing Groq configuration used for release verification is below. These are explicit overrides of the application defaults above. This configuration completed local production verification and hosted core acceptance on 3 November 2026. See the release notes for the remaining host checks and known limits. Availability and quota are account-dependent; no throughput or recommendation-quality improvement is claimed. There is no automatic provider failover.

| Setting | Groq release configuration |
|---|---|
| `LLM_MODE` | `openai-compatible` |
| `LLM_BASE_URL` | `https://api.groq.com/openai/v1` |
| `LLM_MODEL` | `qwen/qwen3.8-27b` |
| `LLM_SUPPORTS_SEED` | `0` |
| `LLM_REASONING_EFFORT` | `none` |
| `LLM_TIMEOUT_MS` | `45000` |
| `LLM_LLAMACPP` | `0` |
| `LLM_PLANNER_MAX_TOKENS` | `512` |
| `LLM_WRITER_MAX_TOKENS` | `512` |
| `LLM_BASELINE_MAX_TOKENS` | `768` |

Supply `LLM_API_KEY` privately on the server. Consult Groq’s [structured-output documentation](https://console.groq.com/docs/structured-outputs) and [rate limits](https://console.groq.com/docs/rate-limits). A Groq schema-validation error can be retried once with the identical request. A numeric Groq quota wait is honoured only when it fits the remaining call deadline; otherwise the fallback is labelled `llm_rate_limited`. Each model call makes at most three transport requests. A disclosed fallback keeps the app usable but does not count as real-model release acceptance.

## Deployment

Follow [Render deployment](docs/deploy-render.md) for the included Dockerfile and Blueprint. Free hosting may sleep and shared API quotas can limit requests; no uptime or capacity guarantee is claimed.

`TRUST_PROXY=1` is for a public Render web service behind Cloudflare. It trusts the edge-overwritten `CF-Connecting-IP` for visitor quotas and the final `X-Forwarded-Proto` scheme for same-origin checks. IPv6 visitors share a /64 quota bucket; IPv4-mapped IPv6 shares its IPv4 bucket. Missing or invalid client-IP headers share a conservative unknown bucket, with no fallback to caller-supplied forwarding headers. Keep trust off for direct hosting. See [Render’s client-IP guidance](https://render.com/articles/host-pocketbase-on-render) and [Cloudflare’s header documentation](https://developers.cloudflare.com/fundamentals/reference/http-headers/).

## Data and privacy

No accounts, analytics or cookies are implemented. Typed form data is stored locally in the browser; runs and private server caches have separate lifetimes. Qloo and any configured model provider receive relevant inputs. Do not enter confidential information in a public demo. Read [PRIVACY.md](PRIVACY.md) for storage and provider data-use details. Never publish live Qloo response data.

## Limitations and verification

<!-- LIVE-STATUS --> Local production verification passed on 3 November 2026 with real Qloo and Groq: three ranked artists; eight partners in each of brand, place and podcast; 12 claims; all 47 receipts compared exactly against privately captured original Qloo response paths. No Qloo response dataset is published.

<!-- LIVE-STATUS --> The planner, writer and same-model baseline completed with no scripted/template fallback. The run made eight Qloo requests (all HTTP 200) and seven Groq requests (six HTTP 200 plus one token-quota 429 recovered after the requested three-second wait). Four planner decisions completed without duplicate-action rejections. Markdown/HTML exports and two receipt HTTP routes returned 200, with no additional Qloo calls. Local streaming progressed; the measured rehearsal including cleanup and offline receipt proof took about 13.4 seconds. This is one local example, not a capacity or quality benchmark.

The 3 November 2026 hosted acceptance passed a complete real-provider flow on Render Free: planner, writer and baseline with no fallback, all three partner categories, progressive proxy SSE, Markdown/HTML exports without extra per-run Qloo calls, cancellation and request-boundary errors. Desktop (1280 px) and mobile (390 px) browser flows passed, with results and receipt drawers and no horizontal overflow or unexpected console/network errors. All 47 hosted receipt routes matched the run's receipt objects. This does not turn the HTTP evaluator's 27 unavailable upstream raw paths into an independent original-response comparison; the separate local 47/47 comparison above establishes that scope. See the GitHub release notes for the exact deployed SHA, visitor-limit and cold-start outcomes, and remaining limits. Earlier failed local and hosted attempts are preserved and are not relabelled as passes.

Local checks on Node 24.22.2 after the host proxy corrections: 269 tests in 36 files, typecheck and build passed. Six earlier browser tests used synthetic fixtures. Node 26’s experimental web-storage global caused seven test-environment failures also reproduced on the unchanged source; use Node 24, or run `NODE_OPTIONS=--no-experimental-webstorage pnpm test` on Node 26.

The Qloo event has ended. Submission remains unverified; these release materials do not establish a submission or late eligibility.

Fixture tests do not establish live API compatibility, provider acceptance, recommendation quality or measured improvement. Taste affinity does not verify artist availability, fees, audience conversion or partner willingness. Identity confirmation and receipt review remain the booker's responsibility.

## Project history and provenance

OpenerFit was created on 18 October 2026 for the Qloo Agentic Hackathon, inside the 30 September–30 October 2026 submission period. The initial public commit `65630b6368ce71b16e1d08fe7e9c1a1c954770db` is a curated snapshot with no parents, drawn from a private development repository whose history runs from 18 to 24 October 2026 (135 commits at the time of the snapshot). Public release corrections must descend from that snapshot; private ancestry is not published.

Private source commit: `1951fc2153a87571ef4c866dd521e378dc5b5477` (branch tip the snapshot was taken from; this provenance note was added on top of it). <!-- SOURCE-COMMIT -->

Internal process notes and copied third-party documentation were omitted. All third-party license notices are retained in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

<!-- AI-ASSISTANCE-STATEMENT -->

## License

MIT; see [LICENSE](LICENSE) and [third-party notices](THIRD_PARTY_NOTICES.md). Upstream [Qloo documentation](https://docs.qloo.com/) is linked, not redistributed. Model services have separate terms.
