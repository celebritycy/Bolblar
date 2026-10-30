# Bolblar Agent security and code review

| | |
|---|---|
| Date | 2026-10-29 |
| Repository | `celebritycy/bolblar`, branch `landing-page`, commit `8d7a591` |
| What it is | A paid Chrome extension (Manifest V3) that automates Google Flow to generate a video's visuals in one batch, sold through a static landing page at bolblar.com (GitHub Pages), distributed as a zip through a Telegram group, licensed by access code against a Supabase Edge Function, paid through Paystack, with Gemini called from the extension using the buyer's own key. |
| In the repository | `index.html` and `assets/` (landing page), `agent/src` (extension source), `agent/build.mjs` (obfuscated zip build), `.github/workflows/release-agent.yml` (release build). **Not in the repository:** the Edge Function that issues and checks licences and talks to Paystack. Everything said about it below is inferred from the client contract and from three read only requests to the live endpoint. |
| Method | White box review of every file by two parallel reviewers (extension; landing page, release chain and backend surface), with every High finding re read in the code by the coordinating reviewer. The live licence endpoint was probed read only: one OPTIONS request, one `config` call and one invalid `license` code; no checkout, email or claim actions were triggered. `npm audit` was run against the lockfile. Nothing was changed in the repository except adding this document. |
| Audience | Cy (founder). Plain language, exact file and line references. |

Convention: **Attacker model** says who can find and use a finding. *Outsider* means anyone on the internet with no purchase; *buyer* means a paying customer trying to pirate or share; *web page* means a script running on labs.google or flow.google.com (an XSS there, a compromised bundle, another Labs page); *white box* means someone who has read this public repository.

## Contents

1. Executive summary
2. What is done well
3. Master findings table
4. Attacker models in detail
5. The extension
6. Licence backend as seen from the client, landing page, release chain
7. Recommended fixes in priority order
8. Business and compliance notes
9. Things only the Edge Function and the dashboards can confirm
10. Appendix: method and limits

---

## 1. Executive summary

**Verdict: the code that ships to buyers is reasonably safe for them, but the business behind it is not protected, and buyers cannot verify what they install.** The extension is tidy: no secrets, no `eval`, no script injection into Google's pages, every template escaped, the buyer's Gemini key goes only to Google, no telemetry. Nothing in it gives an outsider a way into a buyer's browser. The problems sit around it:

1. **The licence is enforced in the buyer's own files.** The lock is an unsigned JSON object in extension storage, the device limit is a UUID the client invents, and the offline grace honours any date the storage holds. Edit one string and the product is free; copy two keys and one code serves any number of people. The README admits the server is the real lock. (EXT-01, EXT-02)
2. **The server is a public function with no rate limit visible, open to every origin, and advertising an admin header.** From the client contract alone, an outsider can enumerate who is a customer by email, send mail to any address, create checkouts at will, guess short codes, and, with any code, kick the real buyer off and open their Paystack card page. (SITE-01 to SITE-04, SITE-09)
3. **Buyers install an unsigned zip from a public Telegram group**, with the `debugger` permission, no checksum, no reproducible build and no update channel other than a link the server hands out. One malicious upload in that group compromises every buyer who trusts it. (SITE-05, SITE-06, SITE-08)
4. **There is no privacy policy, terms or refund policy**, and the landing page does not say the price is monthly. (SITE-10)

The obfuscated build changes none of this, because the readable source is public on GitHub, and it would block a Chrome Web Store listing. (SITE-07)

### Findings by severity

| Severity | Count | Meaning here |
|---|---|---|
| Critical | 0 | Remote takeover of a buyer with no preconditions |
| High | 7 | Revenue loss at scale, customer data disclosure, or a supply chain path to every buyer |
| Medium | 7 | Store rejection risk, privileged surface exposure, compliance gaps |
| Low | 6 | Hardening and hygiene |
| Info | 5 | Code quality and notes |

Confidence note: four of the seven High findings (SITE-02 to SITE-04 and part of SITE-01) describe what the *client contract allows*. Whether the Edge Function already defends against them cannot be seen from this repository. Section 9 is the exact checklist to confirm; each item either closes a finding or confirms it.

### Security ratings

Same scale as the TubBlast review: 100 means nothing found in that category. White box assumes the attacker read this repository; black box assumes they only have the landing page, the Telegram zip and the live endpoint.

| Category | White box | Black box | Why |
|---|---|---|---|
| Licence and revenue protection | 25 | 35 | Client side lock, copyable device id, offline grace honours stored dates |
| Backend exposure (as visible from the client) | 35 | 40 | Any origin, no credential, no visible rate limit, admin header on the same endpoint, email oracle |
| Extension code safety (injection, messaging, DOM) | 85 | 88 | Escaped templates, shadow root, no eval, origin checked messages; frameable panel and page controlled images are the gaps |
| Permissions and privacy | 55 | 60 | `debugger` and `tabs` at install, wide host permission, plaintext key and photos (isolated storage), no privacy policy |
| Distribution and supply chain | 30 | 40 | Unsigned zip via public Telegram, no checksum, non reproducible build, unprotected release workflow, old Drive links |
| Dependencies | 70 | 75 | Build deps clean and pinned; pdf.js two years behind (CSP contains it) |
| Legal and compliance | 25 | 25 | No privacy, terms or refund policy; monthly price not stated on the page |
| **Overall** | **48 / 100 (F)** | **55 / 100 (D)** | The extension itself would score in the B range; the licensing, distribution and compliance layers around it pull it down |

### Attack chains an outsider or a buyer could run today

**Chain 1: free Bolblar for ever** (buyer, EXT-01)
```
Install the zip with "Load unpacked". In panel/app.js change the licence api string to '' (or, keeping it, add a hosts
file entry that blocks ewlbbynxdeneevlpxywo.supabase.co and write {ok:true, code:"x", checkedAt:Date.now(),
checkAgainBy:"2099-01-01"} into chrome.storage.local["bb_license"] from the panel's DevTools). The gate opens and never asks again.
```

**Chain 2: one code, unlimited people** (buyer, EXT-02)
```
Copy chrome.storage.local["bb_device"] and ["bb_license"] from a paid install into any number of other installs.
The server sees one device. Two swaps a month are never needed.
```

**Chain 3: who are Bolblar's customers?** (outsider, SITE-01, SITE-02)
```
for email in list: curl -s -X POST https://ewlbbynxdeneevlpxywo.supabase.co/functions/v1/bolblar \
  -H 'content-type: application/json' -d '{"action":"start","email":"'$email'"}'
# reason "already_active" marks a customer; every other email gets a Paystack checkout created in your dashboard.
```
(Not executed in this review.)

**Chain 4: take over a buyer from a glimpsed code** (outsider, SITE-03)
```
A code seen in a screenshot, a screen share or the Telegram support chat:
{"action":"swap",...}   -> kicks the real buyer's devices, takes a seat
{"action":"manage",...} -> opens the buyer's Paystack card management page (change or cancel the card)
{"action":"license",...}-> returns the buyer's email
```

**Chain 5: a trojan in the group** (outsider, SITE-05)
```
Join the Telegram group from the public invite on bolblar.com. Post "Bolblar-Agent-1.0.1.zip" with one extra line in
background.js. It inherits debugger, scripting, tabs and the buyer's Gemini key. No checksum exists for buyers to compare.
```

### How this compares with TubBlast

TubBlast's problems were refinements on a sound server (a client that names its own price, a refund that fires too early). Bolblar's are structural: the thing being sold is enforced in the buyer's hands, the server that is supposed to back it up is out of view and visibly open, and the delivery channel is a chat group. The extension code is cleaner per line than TubBlast's prototype UI; the system around it is far less finished. If Bolblar earns real money, the order of work is: lock down the function (section 9 checklist), move distribution to signed releases, then the legal pages.

---

## 2. What is done well (keep it this way)

- **No secrets anywhere**: the whole history (25 commits) was scanned for Paystack, Supabase, Google and private key patterns; nothing. The client never ships a Supabase key. `.gitignore` covers `node_modules/` and `dist/` after an early mistake.
- **No dangerous code paths**: no `eval`, `new Function`, inline scripts or `javascript:` URLs outside the pdf.js guard; `selfDefending` and `debugProtection` are off so Manifest V3's CSP stays intact. Every HTML template in `panel.js` escapes user, AI and page text; the content script's only `innerHTML` is a static template inside a shadow root.
- **No injection into Google's page**: typing uses `execCommand('insertText')`, paste events and file inputs; `executeScript` only re injects the extension's own file; the debugger is limited to three input commands on the Flow tab and detached in `finally`.
- **Messaging**: the content script's `window.message` listener checks the extension origin; there is no `externally_connectable`, so pages cannot message the extension.
- **Bring your own key done right**: the Gemini key goes only to Google, with the buyer's own script, in a password field; no analytics, no telemetry, no third party scripts on the landing page.
- **Considerate automation**: pauses on "unusual activity", quota and consent texts, never clicks agreements, 12 second gaps and rest breaks by default.
- **Build hygiene**: the build refuses a zip with an empty licence API; the release workflow refuses a tag that does not match the manifest; `npm ci` with a v3 lockfile and integrity hashes; `npm audit` reports 0 advisories.
- **Honest README**: it says obfuscation is not a lock and the server is. That is the right mental model; the work now is to make the server deserve it.

---

## 3. Master findings table

| ID | Finding | Severity | Attacker model | Confidence | Section |
|---|---|---|---|---|---|
| EXT-01 | Licence state is unsigned client data; edit storage or patch one string and the lock is gone | High | buyer, white box | High | 5 |
| EXT-02 | The 2 device limit rests on a client chosen, copyable UUID | High | buyer | High | 5 |
| SITE-01 | Licence API answers every origin, needs no credential, shows no rate limiting | High | outsider | High (live) | 6 |
| SITE-02 | `start` and `resend` accept any email: customer enumeration, checkout spam, email bombing | High | outsider | High / Medium | 6 |
| SITE-03 | The access code is the whole identity, is short, and unlocks the email, card page and device control | High | outsider, buyer | Medium | 6 |
| SITE-04 | `claim` hands out the code for a payment reference | High | outsider | Medium | 6 |
| SITE-05 | Buyers get an unsigned, unverifiable zip from a public Telegram group | High | outsider impersonator | High | 6 |
| EXT-04 | `debugger` permission: justified but heavy and forced on | Medium | none directly | High | 5 |
| EXT-05 | Privileged panel page can be framed and clickjacked from labs.google | Medium | web page | Medium | 5 |
| SITE-06 | Anyone with write access, or a compromised action, can ship a release to buyers | Medium | white box | High | 6 |
| SITE-07 | Source is public, so obfuscation protects nothing and would block the Web Store | Medium | outsider | High | 6 |
| SITE-08 | Update, checkout, manage and support links from the server are opened without an allow list | Medium | white box | High | 6 |
| SITE-09 | An admin surface sits on the same public endpoint behind a shared header | Medium | outsider | High (exists) | 6 |
| SITE-10 | No privacy policy, terms or refund policy; monthly price not stated | Medium | buyer, regulators | High | 6 |
| EXT-06 | Page controlled images flow into storage and Downloads | Low | web page | High | 5 |
| EXT-07 | Bundled pdf.js 3.11.174 has CVE-2024-4367 (contained by CSP) | Low | web page | High | 5 |
| EXT-10 | `tabs` permission probably unnecessary | Low | none | Medium | 5 |
| EXT-11 | `*.googleusercontent.com` host permission wider than needed | Low | none | Medium | 5 |
| SITE-11 | Landing page hygiene: fonts without SRI, no OG tags, no headers possible | Low | outsider | High | 6 |
| SITE-12 | Old Google Drive download links in public history | Low | outsider | High | 6 |
| EXT-09 | Obfuscation is theatre; build not reproducible | Info | | | 5 |
| EXT-12 | No sender checks on runtime messages (not exploitable today) | Info | | | 5 |
| EXT-13 | Key, prompts, photos, email and code in plaintext extension storage | Info | | | 5 |
| EXT-14 | Code quality: 2,029 line controller, dead UI, no tests | Info | | | 5 |
| SITE-13 | Secret scan clean | Info | | | 6 |

---

## 4. Attacker models in detail

**Buyer.** Owns the files (installed with "Load unpacked"), owns the browser profile, can open DevTools on the panel page and edit `chrome.storage.local`. Obfuscation slows this person by minutes. Everything the client decides, this person decides. That is why EXT-01 and EXT-02 are High: the product's price is enforced here.

**Outsider.** Has the landing page, the Telegram invite (public), the zip from the group, and the live endpoint, which answers any origin with no credential. The source is public too, so the outsider also knows the exact request shape of every action. SITE-01 to SITE-05 are theirs.

**Web page.** A script running on `labs.google` or `flow.google.com`: an XSS there, a compromised Flow bundle, or another Labs page, since the content script and the web accessible resources match the whole host. It cannot message the extension, but it can frame the privileged panel (EXT-05) and feed it images (EXT-06).

**White box.** Anyone who reads this repository. It adds nothing that the outsider does not already have, except the release workflow's weaknesses (SITE-06) and the exact obfuscation settings.

**Not a model here: the Edge Function's own code.** It is the single point of trust for licences, payments, device limits and the update link, and it is not in the repository. Section 9 turns that into a checklist.

---
## 5. The extension (agent/)

Files: `agent/src/manifest.json`, `background.js`, `content/content.js` (814 lines), `panel/*.js` (`panel.js` is 2,029 lines), `panel/panel.html`, `lib/*`, `build.mjs`, `package.json`, `package-lock.json`.

Summary: tidy for a side loaded tool. No hardcoded secret, no `eval`, no script injected into Google's page, every HTML template in the panel goes through an `esc()` helper, the overlay lives in a shadow root, the only network destinations are your licence function, Gemini with the buyer's own key, and Google's image hosts. Nothing here is a remote takeover of the buyer's browser. The weak spots are the licence (removable by anyone who owns the files), the device limit (a copyable id), the privileged panel page being frameable from Google's pages, and a two year old pdf.js.

### [EXT-01] The licence state is unsigned client data; edit storage or patch one string and the lock is gone
- Severity: High (revenue) · Confidence: High (verified) · Attacker model: buyer, white box
- Where: `agent/src/panel/license.js:30,34-35,43`, `panel.js:1929-1934` (`gateCheck`), `:900` and `:991` (the only two feature gates)
  ```js
  if (!API) return (state = { ok: true, free: true });                                  // empty api string = free mode
  const fresh = saved.ok && saved.checkedAt && now - saved.checkedAt < DAY && now < new Date(saved.checkAgainBy || 0).getTime();
  if (fresh && !force) return (state = saved);                                          // trusts whatever is in storage
  if (saved.ok && now < new Date(saved.checkAgainBy || 0).getTime()) return (state = { ...saved, offline: true });
  ```
- Issue: `bb_license` in `chrome.storage.local` is plain JSON with no signature. Writing `{ok:true, code:"x", checkedAt:Date.now(), checkAgainBy:"2099-01-01"}` unlocks the panel; blocking the Supabase host in the hosts file makes the fetch throw, which takes the offline branch and keeps `ok: true` for ever because `checkAgainBy` is in the future. Simpler still: buyers install with "Load unpacked" (`agent/src/README.md:18-23`), so they own the files, and changing the obfuscated `api` string to an empty string turns on free mode. The gate only guards `startRun` and `runVideos`; `testSubmit` (`panel.js:1876-1881`) types and submits in Flow with no gate.
- Impact: one paying buyer can share a working copy with anyone. The README is honest about this ("The real lock is the server-side licence check"), but the server side check is weak too (EXT-02, SITE-01 to SITE-04).
- Fix: accept that client checks are advisory and make the server the only source of anything valuable. Give the offline grace a hard cap from `checkedAt` (3 days) rather than "until `checkAgainBy`"; gate `testSubmit`; and consider having the function return a short lived run token the client must present for each batch (still bypassable by patching, but then the patch must remove the call and the buyer loses updates and support).

### [EXT-02] The 2 device limit rests on a client chosen, copyable UUID
- Severity: High (sharing model) · Confidence: High · Attacker model: buyer
- Where: `license.js:10-14` (`id = crypto.randomUUID(); await set('bb_device', id)`), `:37` (`device_id` sent with every `license` call)
- Issue: the server identifies a device only by an id the client generates and stores. Two people who copy `bb_device` and `bb_license` into their own storage present as one device. Conversely a real buyer who reinstalls looks like a new device and gets locked out, which is why `swap` exists.
- Impact: unlimited sharing on one code while the server sees two devices.
- Fix: server side, rotate the device token on each `license` call (issue a new random token and invalidate the old one, so two machines replaying the same chain collide and one is signed out), and flag one device id seen from many networks within an hour. The client code can stay as it is.

### [EXT-03] The access code alone drives `swap`, `manage` and `release`, and it is shown in clear
Merged into SITE-03. Extension specifics: `license.js:61,90,97`; `panel.js:1951` shows the code in a toast ("Unlocked. Your access code is ..."), `:1941` shows it in Settings; a support flow that asks people to paste codes in Telegram makes leaks likely. Fix on this side: mask the code in the UI (last four characters, with a copy button for the full value).

### [EXT-04] The `debugger` permission is justified for the product, but heavy and forced on
- Severity: Medium (store review and buyer trust) · Confidence: High
- Where: `manifest.json:14`; `engine.js:44-50` (`chrome.debugger.attach`), `:54-71` (only `Input.insertText`, `Input.dispatchMouseEvent`, `Input.dispatchKeyEvent`); `panel.js:68-69` (precision engine forced on desktop on every load)
- Issue: the code uses the debugger only to send trusted input events to the Flow tab, attaches during a batch and detaches in `finally`. That is a legitimate use. But the permission lets an extension run `Runtime.evaluate`, read cookies and intercept responses on any tab it attaches to; Chrome cannot make it optional, so every buyer grants it at install and sees "started debugging this browser". A Chrome Web Store reviewer will ask why the synthetic events the code already has as a fallback (`content.js:124-151`) are not enough; listings that use `debugger` to automate a Google product are often rejected or pulled.
- Impact: a larger blast radius if a tampered zip ever reaches a buyer (SITE-05), and a likely store rejection.
- Fix: try the standard engine first and attach only after a submit was not accepted (the fallback ladder in `panel.js:594-608` already detects that); keep the attach window minimal; document exactly which three commands are used.

### [EXT-05] The privileged panel page can be framed and clickjacked by any script on labs.google or flow.google.com
- Severity: Medium · Confidence: Medium · Attacker model: web page
- Where: `manifest.json:56-67` (`"resources": ["panel/*", "lib/*", "icons/*"]` for `https://labs.google/*` and `https://flow.google.com/*`), `content.js:659` (iframe), `panel.js:420` (`postMessage(..., '*')`)
- Issue: the overlay design needs `panel.html` to be frameable from the Flow page, so any script on those origins (an XSS on labs.google, a compromised Flow bundle, any other Labs experiment page since the match is the whole host) can embed `chrome-extension://<id>/panel/panel.html` invisibly, detect the extension (`use_dynamic_url` is not set), and overlay it on fake buttons so the buyer's clicks land on "Sign out my other devices", "Start batch" or "Test submit". `lib/*` and `panel.css` do not need to be web accessible at all.
- Impact: limited (needs user interaction and a foothold on a Google origin), but an unneeded exposure of a privileged page.
- Fix: list only `panel/panel.html`, the built `panel/app.js`, `panel/panel.css` and `icons/*`; set `"use_dynamic_url": true`; in `panel.js` refuse to run when framed unless `mode=overlay` and the ancestor origin is `https://labs.google` or `https://flow.google.com`; post progress to that origin, not `*`.

### [EXT-06] Page controlled images flow into IndexedDB and the Downloads folder
- Severity: Low · Confidence: High · Attacker model: web page
- Where: `content.js:374-393` (any visible image at least 256 px wide outside the prompt area), `:449-467` (`fetch(src, { credentials: 'include' })`), `panel.js:481-489`, `:535-546`
- Issue: a compromised Flow page can present any image and the extension will fetch it, store it and save it to disk during a batch. File names are safe: `safeName` strips `\ / : * ? " < > |` (`panel.js:7`), names are built as `Slide_NN_mmSSs-mmSSs.ext` (`compose.js:122-130`), and the extension is only ever `mp4 webm mov jpg webp png` (`panel.js:471`), so no executable or path traversal is possible.
- Fix: cap stored blob size (30 MB) and check `blob.type` starts with `image/` or `video/` before storing.

### [EXT-07] Bundled pdf.js 3.11.174 is affected by CVE-2024-4367 (fixed in 4.2.67)
- Severity: Low (Medium if the CSP is ever loosened) · Confidence: High (version verified) · Attacker model: web page (a malicious PDF given to the buyer)
- Where: `agent/src/lib/pdf.min.js` (version string `"3.11.174"`, the vulnerable font path compiler is present), `panel/parse.js:149-151` (`getDocument({ data: buf })` with no `isEvalSupported: false`)
- Issue: the exploit relies on `new Function` in the font path compiler. Manifest V3 extension pages have a fixed CSP without `unsafe-eval`, and pdf.js detects that and falls back, so the known exploit does not run here. The remaining risk is a future CSP change or another unfixed 3.x bug. JSZip 3.10.1 has no known advisories.
- Fix: upgrade to current pdf.js, or drop PDF import (the drop zone already accepts `.txt`, `.md`, `.csv`, `.json`).

### [EXT-08] Backend supplied links are opened without an allow list
Merged into SITE-08. Extension specifics: `license.js:72` (checkout `url`), `:91` (`manage` link), `:106` (`updateLink`), `panel.js:1943` (`telegram`). Fix on this side: accept `updateLink` only on `https://github.com/celebritycy/bolblar/releases/`, checkout only on `https://checkout.paystack.com/`, manage only on `paystack.com`, support only on `https://t.me/`.

### [EXT-09] Obfuscation is theatre; the build is not reproducible (Info)
- `build.mjs:35-59` has no `seed`, so the string array and control flow are randomised per run and two builds of the same commit differ despite the fixed zip date (`build.mjs:100`). `controlFlowFlattening` on a `MutationObserver` that fires on every DOM change (`content.js:722-723`) is a CPU tax on every labs.google page. `npm ci` with lockfile v3 pins the build dependencies with integrity hashes. See SITE-07.

### [EXT-10] `tabs` permission is probably unnecessary and adds a scary install warning
- Severity: Low · Confidence: Medium
- Where: `manifest.json:11`; uses in `background.js:24-29` and `engine.js:10-16` (`create`, `sendMessage`, `getCurrent`, `query` with a `url` filter)
- Issue: all of those work without `tabs` when host permissions cover the URLs, which they do; `tab.url` is also exposed for permitted hosts. With `tabs` the install dialog says "Read your browsing history".
- Fix: remove `"tabs"` and retest the overlay path on Kiwi and Mises.

### [EXT-11] `https://*.googleusercontent.com/*` is wider than needed
- Severity: Low · Confidence: Medium
- Where: `manifest.json:19`; used only by `panel.js:485` (image fetch without cookies)
- Fix: list the real hosts Flow uses (`lh3.googleusercontent.com`, the `storage.googleapis.com` path).

### [EXT-12] No sender checks on runtime messages (Info)
- `background.js:36`, `content.js:727`, `panel.js:1886` never check `sender.id`. Not exploitable today: there is no `externally_connectable`, so web pages cannot message the extension, and the content script's `window.message` listener correctly checks the extension origin (`content.js:662-666`). Add `if (sender.id !== chrome.runtime.id) return;` to all three as defence in depth, and ignore `grab` for non http(s) URLs.

### [EXT-13] Gemini key, prompts, photos, email and code live in plaintext extension storage (Info)
- `ai.js:8,69` (`bb_aiKey`), `panel.js:72` (the whole state including base64 photos as `bb_state`, rewritten about every 1.2 seconds during a batch), `license.js:39` (`bb_license` with code, expiry and email). Bring your own key is done right: the key goes only to Google, with the buyer's own script, never to Bolblar; the input is `type="password"`. Extension storage is isolated from pages and other extensions. Say in the privacy text that the key and photos stay in the browser profile; debounce `save()` to state changes.

### [EXT-14] Code quality (Info)
- `panel.js` is a 2,029 line controller; `guided()` returns `true` ("one view only") while the tabbed UI it replaced still exists in `panel.html:201-345` and is bound in `bind()`; duplicate `blobToDataUrl` and `blobToDataURL`; thumbnail code duplicated between `content.js:456-463` and `panel.js:472-480`; `S.settings.engine` is overwritten on every load so the setting is dead; the licence fetch has no timeout so the gate can hang; no lint, no tests, no CI beyond the build.
- Fix: delete the dead tabbed UI, split `panel.js` into runner, cast, gate and files modules (the build already bundles), add `AbortSignal.timeout(10000)` to licence calls, add one smoke test that loads the built zip in headless Chrome and checks the gate renders.

### Permissions

| Permission | Used in | Needed? | Risk |
|---|---|---|---|
| `storage` | licence, AI key, state, lock targets | yes | plaintext (EXT-13) |
| `unlimitedStorage` | IndexedDB images, large state | yes | low |
| `downloads` | `panel.js:540` | yes | names sanitised (EXT-06) |
| `tabs` | `background.js`, `engine.js` | probably not (EXT-10) | "read browsing history" warning |
| `scripting` | re injects the extension's own content script only | yes | low |
| `sidePanel` | `background.js:14` | yes | none |
| `debugger` | three `Input.*` commands on the Flow tab | yes for precision mode (EXT-04) | high capability, store review risk |
| host `labs.google`, `flow.google.com` | content script, overlay | yes | content script on all of labs.google |
| host `*.googleusercontent.com`, `storage.googleapis.com` | image fetch | narrow it (EXT-11) | low |
| host `generativelanguage.googleapis.com` | Gemini with the buyer's key | yes | low |
| host `ewlbbynxdeneevlpxywo.supabase.co` | licence function | yes | the trust anchor (SITE-08) |
| `web_accessible_resources` `panel/*, lib/*, icons/*` | overlay iframe | too broad (EXT-05) | clickjacking, fingerprinting |

### Data flows

| Destination | What is sent | Concern |
|---|---|---|
| Licence function | action, code, random device id, a label like "Chrome on Windows", email (subscribe, resend), payment reference (claim); no auth header | code is a bearer secret (SITE-03); device id copyable (EXT-02); returned links trusted (SITE-08) |
| Gemini (`generativelanguage.googleapis.com`) | the buyer's own key, the mother prompt with the buyer's full script, cast prompts | buyer's own key and content; fine |
| Google Flow page | composed prompts typed into the box; the buyer's reference pictures uploaded into the project's asset library | photos persist in the Google project; say so; terms of service risk (section 8) |
| `*.googleusercontent.com`, `storage.googleapis.com` | GET of finished images | page controlled URLs (EXT-06) |
| Paystack, Telegram, update link | nothing; URLs come from the server | allow list (SITE-08) |
| Disk | generated files, ZIP, timeline JSON, status CSV with prompts | none |

No other network call exists (grep of `fetch(`, `XMLHttpRequest`, `sendBeacon` across `src/` excluding `lib/`).

### What is done well in the extension
- No `eval`, `new Function`, inline scripts or `javascript:` URLs; `selfDefending: false` keeps Manifest V3's CSP intact. Every HTML template in `panel.js` escapes user, AI and page text with `esc()`; page values land in `textContent`; the content script's only `innerHTML` is a static template inside a shadow root with `all: initial`.
- No injection into the page's JavaScript world: typing uses `execCommand('insertText')`, paste events and `input.files`; `executeScript` only re injects the extension's own file.
- The `window.message` listener checks the extension origin; no `externally_connectable`; downloads use sanitised names and a fixed extension set.
- Bring your own key done right; no analytics or telemetry of any kind.
- Careful with the buyer's Google account: pauses on "unusual activity", quota and consent texts, never clicks agreements (`content.js:396-402`, `panel.js:764-777`), 12 second gaps and rest breaks by default.
- The build refuses an unlocked release; the lockfile pins exact versions with integrity hashes; `npm audit` is clean; `dist/` and `node_modules/` are ignored after the early mistake.
- Debugger attach is scoped to the Flow tab, limited to input events, and detached in `finally`.

---

## 6. Licence backend as seen from the client, landing page, release chain

Files: `agent/src/panel/license.js`, `agent/src/panel/license-config.js`, `index.html`, `_config.yml`, `CNAME`, `.github/workflows/release-agent.yml`, `agent/package-lock.json`, and the live endpoint `https://ewlbbynxdeneevlpxywo.supabase.co/functions/v1/bolblar` (probed read only: one OPTIONS request, one `config` call and one invalid `license` code; no `start`, `resend` or `claim` calls were made). The Edge Function's code is not in the repository, so everything about the backend below is inferred from the client contract and the live headers.

### [SITE-01] The licence API answers every origin, needs no credential, and shows no rate limiting
- Severity: High · Confidence: High (live, confirmed twice) · Attacker model: outsider
- Where: live response headers: `access-control-allow-origin: *`, `access-control-allow-headers: content-type, x-admin-key, authorization, apikey`, `access-control-allow-methods: POST, OPTIONS`. Client: `agent/src/panel/license.js:22`
  ```js
  const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...body }) });
  ```
- Issue: the function is deployed without JWT verification (a plain POST with only `Content-Type` returns 200), which is required because the extension sends no Supabase key. That is a legitimate design, but it makes the function itself the only guard. `*` for CORS means any web page a buyer visits can call every action from the buyer's browser, and any script on the internet can hammer it. No `RateLimit-*` or `Retry-After` header was seen on the invalid code reply. Cloudflare's bot cookie is in front, which is not an application rate limit.
- Impact: every action in the table below becomes scriptable at scale: code guessing, email enumeration, checkout spam, device kicking.
- Fix: in the function, answer only `Origin: chrome-extension://<your extension id>` (curl still works, browser based abuse from other sites stops); add per IP and per email limits (a Supabase table or Upstash) and return 429 with `Retry-After`. Keep JWT verification off, but treat the function as a public internet API.

### [SITE-02] `start` and `resend` accept any email: customer enumeration, checkout spam, email bombing
- Severity: High · Confidence: High for enumeration, Medium for cost · Attacker model: outsider
- Where: `license.js:68-69` (`call('start', { email })`), `license.js:94` (`call('resend', { email })`), `panel.js:1914` (`already_active: 'This email already has an active subscription...'`)
- Issue: the server answers `start` with `reason: already_active` when the email already pays, a yes or no oracle for "is this person a Bolblar customer" against any email list. `start` also creates a Paystack transaction per call. `resend` mails any address on demand.
- Impact: customer list disclosure; mail abuse from your sending domain; Paystack dashboard noise and possible fraud flags.
- Fix: make `start` and `resend` answer the same way whether or not the email exists ("If this email has a subscription, we sent the code"); on an existing active email, `start` should email the code instead of saying so; rate limit both per email (3 an hour) and per IP; daily cap on `resend`.

### [SITE-03] The access code is the whole identity, is short, and unlocks the email, the card page and device control
- Severity: High · Confidence: Medium (entropy inferred from the placeholder; the server may generate longer codes) · Attacker model: outsider
- Where: `agent/src/panel/panel.html:31` `placeholder="Access code, like BOL-7KQ4-M2XP"`; `license.js:37` (`license` sends code, device id, label and the reply carries the buyer's email); `license.js:90` (`manage` returns a Paystack management link that is opened); `panel.js:1940` (email shown)
- Issue: the example code has 8 symbols after the prefix, about 40 bits. Anyone who learns or guesses a code gets the buyer's email, the Paystack "manage subscription" page (update card, cancel), the power to kick the real buyer's devices through `swap`, and a device slot. The code is shown in a toast and in Settings, copied to the clipboard, and kept in plain `chrome.storage.local`.
- Impact: takeover of a buyer's subscription from a guessed or shoulder surfed code; with no rate limit, a 40 bit space with thousands of live codes is a long but feasible online search.
- Fix: codes with at least 128 bits (26 base32 characters, grouped with dashes), or keep the short human code and require the email as a second factor for `manage`, `swap` and `resend`; constant time compare; rate limit `license` and `swap` per IP and per code; mask or drop the email in the `license` reply.

### [SITE-04] `claim` hands out the code for a payment reference
- Severity: High · Confidence: Medium (depends on how references are made and verified) · Attacker model: outsider
- Where: `license.js:81-82` `const c = await call('claim', { reference }); if (c.ok && c.code) { ... return activate(c.code); }` polled every 4 seconds for 20 minutes
- Issue: if references are predictable (timestamp, counter, short random) or the function accepts a Paystack reference without verifying the transaction server side (secret key `transaction/verify`, or a signed webhook), an attacker can obtain other buyers' fresh codes or mint a code for an unpaid reference.
- Fix: references must be 128 bit random, single use, bound to the email and expiring in 30 minutes; `claim` succeeds only after Paystack's webhook (HMAC SHA512 of the raw body in `x-paystack-signature`) or a server side verify marks the reference paid. Never trust the client's "I paid".

### [SITE-05] Buyers get an unsigned, unverifiable zip from a public Telegram group
- Severity: High · Confidence: High · Attacker model: outsider impersonator, buyer
- Where: `index.html:73,83` (`href="https://t.me/+sOWs1XlVckBlNTE0"`), `index.html:87` ("get it on Telegram"), `agent/src/README.md:20-38` (developer mode, Load unpacked, Mises on Android, Orion on iPhone)
- Issue: the invite link is on a public page, so the group is public. Any member can post a "Bolblar-Agent-1.0.1.zip" with a backdoor, and the extension holds `debugger`, `scripting`, `tabs` and the buyer's Gemini key. A buyer has no way to tell: no checksum, no signature, no release page, and the obfuscated build is not reproducible (`javascript-obfuscator` without a `seed` produces different bytes every run, so even you cannot regenerate a given zip). The only artefact ever committed (`e43880f:agent/dist/Bolblar-Agent-1.0.0.zip`, SHA-256 `29eb5bfe3f7c7c1c18d872089fb32d541565d14f71d3ac370886be3cd1187dd1`) was built on a laptop. Sideloading adds the "disable developer mode extensions" warning on every start, no automatic updates, and third party browsers on phones.
- Impact: one malicious upload in the group compromises every buyer who trusts it; refund disputes when installs break.
- Fix: publish every version as a GitHub Release built by the workflow, print its SHA-256 on bolblar.com and in the pinned Telegram message, make the group admin only for files, add `seed` to the obfuscator options (or drop obfuscation, SITE-07), and plan an unlisted Chrome Web Store listing, which gives signing, updates and no developer mode warning.

### [SITE-06] Anyone with write access, or a compromised action, can ship a release to buyers
- Severity: Medium · Confidence: High · Attacker model: white box
- Where: `.github/workflows/release-agent.yml:5-10` (`on: release: types: [published]`, `permissions: contents: write`), `:19,21` (`actions/checkout@v4`, `actions/setup-node@v4` by tag), `:43` (`gh release upload ... --clobber`). The GitHub API shows no rulesets, `landing-page` unprotected, no tags yet.
- Issue: publishing a release needs only write access; there is no tag protection, review or environment approval; actions are pinned to moving tags with a token that can write any branch and replace any asset. The tag versus manifest check, `npm ci` with full integrity hashes (126 packages, `npm audit` 0 advisories, javascript-obfuscator 4.2.2, jszip 3.10.2) are good, but nothing signs the result.
- Fix: pin actions by SHA; a `release` environment with a required reviewer; a tag ruleset limiting `v*` to you; `contents: write` only on the upload step; upload a `sha256sum` file (or build provenance) with the zip; two factor authentication on the account.

### [SITE-07] The source is public, so obfuscation protects nothing and would block the Web Store
- Severity: Medium · Confidence: High · Attacker model: outsider
- Where: repository is public; `_config.yml:1-3` excludes `agent` from the Jekyll build only; `agent/README.md:10`, `build.mjs:35-59`
- Issue: `agent/src/panel/license.js` and every prompt in `MOTHER_PROMPT.md` are readable by anyone on GitHub. The obfuscated build therefore only harms buyers (unverifiable code) and would be rejected by the Chrome Web Store, which has banned obfuscated code since 2018 (minification is allowed). The README already says the real lock is the server.
- Fix: either make this repository private and keep the landing page in its own public repository, or accept public source and ship the readable `build:dev` output. Either way, stop obfuscating the buyer build.

### [SITE-08] The update link from `config` is opened without any check
- Severity: Medium · Confidence: High · Attacker model: white box (whoever controls the server config or the admin key)
- Where: `license.js:104-106`, `panel.js:1987` (`bar.href = u.link`), `panel.html:11`
- Issue: today `config` returns `{"ok":true,"price":"₦5,000 / month","maxDevices":2}` with no `latest` or `updateLink`, so the bar never shows. When set, whatever URL the server holds opens as is, with no `https` check or host allow list, so anyone who controls the server secrets or the admin key can send every buyer to a malicious zip.
- Fix: accept only `https://github.com/celebritycy/bolblar/releases/...` (or your own domain) in the client and show the version and SHA-256 next to the link.

### [SITE-09] An admin surface sits on the same public endpoint behind a shared header
- Severity: Medium · Confidence: High that it exists, unknown strength · Attacker model: outsider
- Where: live header `access-control-allow-headers: content-type, x-admin-key, authorization, apikey`
- Issue: the function advertises `x-admin-key`, so admin actions (set the latest version, price, block codes) are guarded by a static key compared inside the same public function. If the compare is not constant time, the key is short, or it was ever pasted anywhere, the admin path faces the whole internet with no rate limit.
- Fix: move admin actions to a separate function requiring the service role or a JWT; rotate the key; keep it only in Supabase secrets; compare in constant time; log every admin call.

### [SITE-10] No privacy policy, terms or refund policy; the landing page hides that it is a monthly subscription
- Severity: Medium · Confidence: High · Attacker model: buyer, regulators
- Where: `index.html:81` (`₦5,000 / $3.50` with no period), live `config` (`"price":"₦5,000 / month"`), `agent/src/README.md:6` ("needs an active monthly subscription"); no hit for privacy, terms or refund anywhere in `index.html` or `agent/src`
- Issue: the recurring nature appears only inside the extension. The extension sends the buyer's email, a device UUID and a browser label and stores a Gemini key locally, with no privacy policy. A privacy policy is mandatory for the Chrome Web Store and under GDPR and UK GDPR the moment one EU or UK buyer pays; Paystack requires terms and a refund policy on the merchant site. The price is NGN; "$3.50" is a display conversion. Minor: `index.html:102` says "generated by Tubblast"; `index.html:72` brand link is `href="#"`.
- Fix: add privacy, terms and refund pages on bolblar.com, link them from the footer and the gate screen, write "₦5,000 per month, billed through Paystack, cancel any time", fix the two text issues.

### [SITE-11] Landing page hygiene
- Severity: Low · Confidence: High
- Where: `index.html:9-11` (Google Fonts stylesheet, no SRI possible)
- Issue: no inline scripts, no forms, no tracking, no mixed content, videos `preload="none"` (24 MB total). GitHub Pages sets no security headers and none can be configured (a `<meta http-equiv="Content-Security-Policy">` is possible). No Open Graph or Twitter card tags. `assets/logo-original.png` carries C2PA and XMP provenance metadata (shows which tool made it); nothing else sensitive in `assets/`.
- Fix: self host the font, add a meta CSP, add Open Graph tags.

### [SITE-12] Old Google Drive download links remain in public history
- Severity: Low · Confidence: High
- Where: history of `index.html` (commits `baf638f`, `e96f15a`): two Google Drive folder and file links.
- Issue: if those shares are still "anyone with the link", old builds keep circulating and bypass any later fix.
- Fix: remove sharing on both Drive items.

### [SITE-13] Secret scan: clean (Info)
- `git log --all -p -S` over all 25 commits for `sk_live`, `sk_test`, `eyJhbGci`, `AIza`, `service_role`, `PAYSTACK`, `SUPABASE_SERVICE`, private keys and `api_key`: no key was ever committed. `node_modules` and `dist/` were committed once (`e43880f`) and removed (`dea0c64`); they contain no secrets. `.gitignore` now covers both.

### Backend actions as seen from the client

| Action | Needs | What an outsider can do with it | Must be enforced server side |
|---|---|---|---|
| `config` | nothing | Read price, max devices, latest version, update link | Only public data; update link limited to your release host |
| `start` | `email` | Create unlimited Paystack checkouts; learn whether an email is a customer | Uniform reply, email format check, per email and per IP limits, 128 bit reference bound to the email |
| `claim` | `reference` | Poll for a code with guessed references | Succeed only after a verified Paystack webhook or server side verify; single use; expires in 30 minutes |
| `license` | `code`, `device_id`, `label` | Guess codes; with a real code: read the email, status and expiry, take a device slot | Constant time compare, rate limit per IP and per code, device limit, server issued `checkAgainBy` |
| `swap` | `code`, `device_id`, `label` | With a code: kick the real buyer's devices | Swap quota (the UI mentions 2 per 30 days), log, email notice to the buyer |
| `release` | `code`, `device_id` | Only with the victim's device UUID: low risk | Match code and device; ignore unknown pairs silently |
| `manage` | `code` | With a code: open the Paystack card management page | Require the email too; short lived link; log |
| `resend` | `email` | Mail any address at will; enumerate buyers if replies differ | Uniform reply, 3 an hour per email, daily cap, per IP limit |
| admin (`x-admin-key`) | the header | Brute force the key against a public function | Separate function with JWT or service role, constant time compare, rotation, logging |

---

## 7. Recommended fixes, in priority order

### P0: before taking more money

| Fix | Where | Change |
|---|---|---|
| Lock down the function | Edge Function | Allow only `Origin: chrome-extension://<id>`; per IP, per email and per code rate limits with 429; uniform replies for `start` and `resend`; constant time code compare; `claim` only after a verified Paystack webhook or server side verify (SITE-01 to SITE-04) |
| Longer codes or a second factor | Edge Function, `panel.html:31` | 128 bit codes, or require the email with the code for `swap`, `manage` and `resend`; mask the code in the UI (SITE-03, EXT-03) |
| Move admin off the public endpoint | Supabase | Separate function with JWT or service role, rotate `x-admin-key`, log every admin call (SITE-09) |
| Signed, verifiable releases | `.github/workflows/release-agent.yml`, bolblar.com | GitHub Releases built by the workflow, SHA-256 printed on the site and pinned in Telegram, group set to admin only for files (SITE-05) |
| Allow list server supplied links | `license.js:72,91,106`, `panel.js:1943,1987` | Update link only on your GitHub releases, checkout only on `checkout.paystack.com`, support only on `t.me` (SITE-08, EXT-08) |
| Legal pages and the price | bolblar.com, `index.html:81`, gate screen | Privacy, terms, refund pages linked from the footer and the gate; "₦5,000 per month, billed through Paystack, cancel any time" (SITE-10) |

### P1: next

| Fix | Where | Change |
|---|---|---|
| Harder to share, honest offline grace | Edge Function, `license.js:34-43` | Rotate the device token on each `license` call; cap offline grace at 3 days from `checkedAt`; gate `testSubmit` (EXT-01, EXT-02) |
| Release chain | `.github/` and repository settings | Pin actions by SHA, `release` environment with a required reviewer, tag ruleset for `v*`, `contents: write` only on the upload step, upload a `sha256sum` file, 2FA (SITE-06) |
| Decide on obfuscation | `build.mjs`, repository visibility | Either make the repo private or ship the readable build; if obfuscation stays, add a fixed `seed` so builds are reproducible (SITE-07, EXT-09) |
| Narrow the privileged surface | `manifest.json` | `web_accessible_resources` down to `panel.html`, `app.js`, `panel.css`, `icons/*` with `use_dynamic_url: true`; refuse to run framed from anything but the two Google origins; `postMessage` to that origin (EXT-05) |
| Permissions diet | `manifest.json` | Drop `tabs`; list the real image hosts instead of `*.googleusercontent.com`; attach the debugger only after the standard engine fails (EXT-04, EXT-10, EXT-11) |
| Update pdf.js or drop PDF import | `agent/src/lib`, `parse.js` | Current pdf.js, or text formats only (EXT-07) |

### P2: when convenient

| Fix | Where | Change |
|---|---|---|
| Sender checks on messages; ignore `grab` for non http(s) URLs | `background.js:36`, `content.js:727`, `panel.js:1886` | EXT-12 |
| Size and type check on stored page images | `panel.js:481-489` | EXT-06 |
| Licence fetch timeout | `license.js:22` | `AbortSignal.timeout(10000)` (EXT-14) |
| Delete the dead tabbed UI; split `panel.js`; one smoke test in CI | `panel.html:201-345`, `panel.js` | EXT-14 |
| Self host the font, meta CSP, Open Graph tags, fix "generated by Tubblast" and the `#` brand link | `index.html` | SITE-11, SITE-10 |
| Remove sharing on the two old Drive links | Google Drive | SITE-12 |
| Debounce `save()`; note in the privacy text that the key and photos stay in the browser | `panel.js:72` | EXT-13 |

---

## 8. Business and compliance notes

- **Google's terms.** Automating Google Flow with trusted input events and uploading reference pictures into a Labs project is likely against the terms for Labs tools. The pause heuristics reduce but do not remove the risk of a buyer's Google account being limited. Tell buyers this in plain words before they pay.
- **Chrome Web Store.** If a listing is ever planned: expect questions on `debugger`, `tabs`, the `googleusercontent` wildcard and the `labs.google/*` match, and a rejection for obfuscated code. An unlisted listing would still give buyers signing, automatic updates and no developer mode warning, which solves most of SITE-05.
- **Payments.** Paystack requires terms and a refund policy on the merchant site; the price is NGN and "$3.50" is a display conversion, not what a card is charged; the landing page must say "per month".
- **Privacy law.** The extension sends an email, a device UUID and a browser label to your server and keeps a Gemini key and photos in the browser profile. A privacy policy is required by the Chrome Web Store and, once one EU or UK buyer pays, by GDPR and UK GDPR.
- **Support flow.** Asking buyers to paste access codes into a Telegram chat is how codes leak (SITE-03). After the second factor exists, codes become less sensitive; until then, ask for the email instead.

---

## 9. Things only the Edge Function and the dashboards can confirm

Each item either closes a finding above or confirms it.

**Edge Function (`bolblar`)**
1. CORS: reply only to `Origin: chrome-extension://<your extension id>`; never `*` (SITE-01).
2. Rate limits: per IP on every action; per email on `start` and `resend`; per code on `license` and `swap`; 429 with `Retry-After` (SITE-01, SITE-02).
3. Codes: at least 128 bits from `crypto.getRandomValues`, stored hashed, compared in constant time (SITE-03).
4. `claim`: a code is created only after Paystack confirms payment through a webhook whose `x-paystack-signature` (HMAC SHA512 of the raw body) is verified, or through server side `transaction/verify`; references are random, single use, bound to the email, and expire after 30 minutes (SITE-04).
5. Device limit: at most 2 device ids per code enforced by a unique constraint; swaps capped at 2 per 30 days; device token rotated on each check (EXT-02).
6. `checkAgainBy` is computed server side with a short horizon (EXT-01).
7. No enumeration: `start` and `resend` return the same shape and similar timing whether or not the email exists; `license` returns the same "unknown" for bad and blocked codes (SITE-02).
8. Subscription status comes from Paystack webhooks (`charge.success`, `subscription.disable`, `invoice.payment_failed`), never from client calls; the Paystack secret lives only in Supabase secrets.
9. Admin actions: a separate function with `verify_jwt` on or service role only; `x-admin-key` rotated and never in any client; every admin call logged (SITE-09).
10. `updateLink`, checkout `url`, manage `link` and `telegram` are fixed values in secrets; `updateLink` points only at a GitHub Release of this repository (SITE-08).
11. Logging: every `start`, `claim`, `swap`, `manage`, `resend` and admin call logged with IP, email and result; alerts on spikes.

**Supabase project**
12. Row level security on every table; the anon key cannot read codes or emails; the function uses the service role internally; 2FA on the account; spend cap on; secrets reviewed (no Paystack test keys in production).

**GitHub**
13. 2FA; branch and tag rulesets; `release` environment with required approval; actions pinned by SHA (SITE-06).

**Elsewhere**
14. The two old Google Drive shares are closed (SITE-12); the Telegram group allows files from admins only (SITE-05); privacy, terms and refund pages exist and are linked (SITE-10).

---

## 10. Appendix: method and limits

- Two reviewers worked in parallel with the full repository: one on the extension source and build, one on the landing page, release chain and the backend as visible from the client. Each was asked to assess every finding against the buyer, web page and outsider attacker models and to report only High or Medium confidence findings. The coordinating reviewer re read the licence gate, the offline branch, the manifest, the download path, the content script sinks and the pdf.js version, and repeated the live OPTIONS and `config` requests.
- The live endpoint was touched read only: OPTIONS, `config`, and one `license` call with an invalid code. No `start`, `resend`, `claim`, `swap`, `manage` or `release` call was made. The attack chains in section 1 were not executed.
- The Edge Function's code, the Supabase schema, the Paystack configuration and the Telegram group's settings were not available. Every statement about them is an inference from the client, and section 9 lists what to confirm.
- Severity follows the same scale as the TubBlast review, with "High" here including revenue loss at scale for a paid product and a supply chain path to every buyer.

---

## 11. Fix status (2026-10-30)

What was done about each finding in this repository. The licence server (the Supabase Edge Function) is not in this repository, so the findings that live there are listed as server work, with the checklist in section 9. The extension was checked in Chromium after the changes: the side panel runs without errors, the panel works inside a Google Flow page, and another site can no longer load it. Two builds of the same commit now give the same zip.

| ID | Status | What changed |
|---|---|---|
| EXT-01 | Partly fixed | Offline use stops 3 days after the last check the server answered, whatever date is stored; the test prompt needs an active subscription. A buyer who edits their own copy can still remove the check: only the server can stop that (section 9). |
| EXT-02 | Server work | The device limit needs the server to rotate the device token on each check. |
| EXT-03 | Fixed in the extension | The code is shown masked (copied in full) and no longer appears in a toast. Asking for the email as well, for swap and manage, is server work. |
| EXT-04 | Not changed | The debugger permission is how precision mode types; trying the standard engine first is a product change to test on Flow. |
| EXT-05 | Fixed | Only the panel page is exposed to Google's pages; the panel refuses to run when framed by anything but Google Flow's overlay; progress messages go only to the Flow page. |
| EXT-06 | Fixed | Only pictures and videos up to 60 MB from https addresses are kept. |
| EXT-07 | Fixed | PDF import runs with isEvalSupported off, which closes CVE-2024-4367 in this pdf.js. Upgrading pdf.js is still worth doing. |
| EXT-08 | Fixed | Links from the server open only on Paystack, t.me, github.com/celebritycy/bolblar/releases or bolblar.com; the update bar can show a SHA-256. |
| EXT-09 | Fixed | Fixed obfuscator seed and no dated folder entries: the same commit builds the same zip. |
| EXT-10 | Fixed | The tabs permission is gone; host permissions cover every tab the extension reads. Checked on Chromium; Kiwi and Mises were not available to test. |
| EXT-11 | Not changed | Narrowing the Google image hosts needs the real list from Flow. |
| EXT-12 | Fixed | Every message listener checks that the sender is this extension; grab accepts only picture addresses. |
| EXT-13 | No change | Information only. |
| EXT-14 | Partly fixed | Licence calls time out after 15 seconds. Removing the old tabbed UI and splitting panel.js are refactors left for later. |
| SITE-01 | Server work | Allow only the extension's origin, rate limit every action (section 9). |
| SITE-02 | Server work | Same answer for known and unknown emails, limits on start and resend. |
| SITE-03 | Server work, extension part done | Longer codes or the email as a second factor; the extension now masks the code. |
| SITE-04 | Server work | claim must wait for a verified Paystack webhook. |
| SITE-05 | Partly fixed | Every release gets a .sha256 file and the build is reproducible; the README explains how buyers check a zip. Making the Telegram group admin only for files, and an unlisted Chrome Web Store listing, are Cy's settings. |
| SITE-06 | Partly fixed | Read only token except the upload job, actions pinned by commit, a release environment, no silent replacing of a published zip. Add yourself as the environment's required reviewer and a tag rule in GitHub settings. |
| SITE-07 | Not changed | Cy's choice: make this repository private, or ship the readable build. |
| SITE-08 | Fixed | See EXT-08. |
| SITE-09 | Server work | Move admin actions to a separate function and rotate the key. |
| SITE-10 | Partly fixed | The page says "₦5,000 / month, billed by Paystack, cancel any time" and links a privacy page written from what the code does. Terms and a refund policy need Cy's decisions. |
| SITE-11 | Fixed | A page security policy, a referrer policy and preview tags. The font still comes from Google Fonts. |
| SITE-12 | Cy's action | Turn off sharing on the two old Google Drive links. |
| SITE-13 | No change | The secret scan was clean. |
