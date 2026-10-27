# Clear / Think — public Netlify deployment

This ZIP contains the static Metamod conversation site and a public, server-side Netlify Function. **Visitors can ask questions without signing in or entering a key.** The browser sends `POST /api/run` to the same site; only the Function reads the Metamod key from `METAMOD_API_KEY` and adds `x-api-key` upstream. Do not reuse the credential previously shared in chat: rotate/revoke it and make a fresh replacement. No live deployment or live Metamod call has been performed on this package.

## Step-by-step: deploy through a Git repository

1. **Prepare the source.** Unzip `metamod-decision-studio-public-netlify.zip`. Inside is one `metamod-decision-studio` folder containing `index.html`, `netlify.toml`, and `netlify/functions/run.mjs`. Create a GitHub repository and upload the **contents** of that inner folder to its repository root (not just `index.html`; the Function must be included). Do **not** upload a key or a `.env` file. Optionally run `node mock-test.cjs` and `node proxy-test.mjs` first; these are fully mocked and require no secret.
2. **Create a Netlify project.** Sign in to Netlify and choose **Add new project → Import an existing project**. Connect GitHub, authorize access to the repository, then select that repository. Depending on Netlify UI wording, this action may appear as **Add new site → Import an existing project**.
3. **Review deployment settings.** If the repository root contains `netlify.toml`, leave **Base directory** empty, leave **Build command** empty, and set **Publish directory** to `.` (repository root). `netlify.toml` also declares `functions = "netlify/functions"`. Deploy the project. **Don't use a static-only upload that excludes or fails to deploy Netlify Functions.** The Function declares its own `/api/run` route; no rewrite is required.
4. **Set the server-only credential.** In your Netlify project open **Project configuration → Environment variables** (UI wording may vary). Add key `METAMOD_API_KEY`, value = a **freshly rotated** Metamod API key; select **Functions** scope/runtime if the UI offers scopes. Do not give it a `PUBLIC_`/browser-facing name or place it in `config.js`. Save and **trigger a new deployment** so the Function sees the setting. It is normal for `/api/run` to return HTTP 503 until this is set.
5. **Check the deploy log.** Confirm Netlify bundled `netlify/functions/run.mjs`, detected its `/api/run` route, and validated the rate limit declared in the Function. A syntax or configuration error may not fail the whole deployment, so check the log's **post-processing** section for the rate-limit rule. Netlify's current docs say code-based rules are available on all plans; this package requests **5 calls per 60 seconds per IP and domain**. Requests over the limit should return 429, but enforcement can lag by up to about 10 seconds.
6. **Test as a public visitor.** Open the published `https://<your-project>.netlify.app` URL in a private/incognito browser window. There is no login and no API-key textbox. Enter a question, then a follow-up. In browser Developer Tools → Network, verify `POST /api/run` (200 for a working request) and confirm there is **no `x-api-key` in the browser request or public JS**. Test from another device if available. Never post screenshots containing private question text or secrets. The Function's streamed response should end with a canonical Metamod `end` event.
7. **Watch usage.** Check Metamod usage and Netlify Function logs/usage frequently, set provider-side spend/quota alerts or limits if available, and adjust `windowLimit` in `netlify/functions/run.mjs` to your tolerance. Rotate the key or temporarily remove `METAMOD_API_KEY` if you need to pause the service (requests then return 503). Re-deploy code changes via Git.

## Public-site security and spending trade-off

The key is **secret from site visitors**, but the public Function deliberately lets anyone call your agent and use your upstream quota. The included guardrails are request validation (12,000-character question max), a roughly 16 KB advertised body cap, method/content-type checks, no-cache responses, and Netlify's per-IP/domain rate limit. This is **not** strong abuse prevention or a hard spending cap: a determined user can switch IPs, forge Origin from outside a browser, or send requests before the rate-limit counter catches up. The rate limit also does not place a total limit across all visitors on ordinary plans. Keep the Metamod key scoped/revocable, monitor provider-side quotas, and consider CAPTCHA with **server-side verification**, stronger identity, a shared global quota in a separate store, or a stricter gateway if costs matter. Site-wide password protection would conflict with your requirement that every visitor be able to use it.

Netlify's current Functions documentation describes streaming response bodies and lists a **60-second streaming execution limit and 20 MB streamed response limit**. Long-running agent requests may terminate at that limit; this is not fixable by increasing a browser timeout. Confirm behavior on your actual deployed plan. The Function passes through the upstream NDJSON body; it does not create undocumented chart files or HITL submission endpoints.

## Troubleshooting

- **404 at `/api/run`:** ensure the repository includes `netlify/functions/run.mjs`, the project was deployed with Functions, and the deploy log lists its `/api/run` route. Redeploy.
- **503:** set fresh `METAMOD_API_KEY` for Functions and trigger a new deployment. A key in `config.js` is not a solution.
- **401:** probably an old Function build still requiring Identity or `ACCESS_POLICY`; redeploy this public package and inspect the deployed Function version. Never set an old `ACCESS_POLICY` variable as a workaround.
- **403:** check for cross-origin browser requests; this frontend uses a same-origin path. Origin is only a basic cross-site check, not authentication.
- **429:** per-IP rate limit reached; wait and retry. Verify the rule appeared in Netlify's post-processing log.
- **502 or upstream 4xx:** check whether the **server-side** Metamod key and agent endpoint are valid. Do not log or send your key to anyone for debugging.
- **No streaming or mid-answer disconnect:** compare a redacted real stream with the expected NDJSON `add_message`, `token`, `preamble_end`, `end` framing, and check Netlify's streaming duration/size limits and Function logs.
- **Charts:** only numeric Markdown comparison tables are turned into SVG charts; actual chart/image artifacts require a redacted response showing the supported transport.
- **HITL:** the UI displays an input-needed notice. A working HITL form still requires the agent's redacted field schema and documented resume endpoint/method/body; none is inferred.

## Files

- `index.html`, `styles.css`, `config.js`, `app.js`, `markdown.js`, `charts.js`: browser interface. No secrets here.
- `netlify/functions/run.mjs`, `netlify.toml`: server-side proxy and deployment settings.
- `mock-test.cjs`, `proxy-test.mjs`: local simulated tests (`node mock-test.cjs && node proxy-test.mjs`).

## Documentation consulted

- Netlify Functions API (streaming, Function `config`): https://docs.netlify.com/build/functions/api/
- Netlify rate limiting (per-IP rules, validation in deploy logs, enforcement delay): https://docs.netlify.com/manage/security/secure-access-to-sites/rate-limiting/
