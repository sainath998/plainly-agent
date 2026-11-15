# Plainly: agentic edition

**An open agentic website whose agents explain bank letters, bills, rental agreements and lab reports in plain words, without ever seeing your personal details. In Chrome they run on Gemini Nano on your own device, with no key and no server.**

Live: https://sainath998.github.io/plainly-agent/ · Network: [`agent-manifest.json`](agent-manifest.json) → [`plainly_document_helper.network.json`](plainly_document_helper.network.json)

Built for the [Open Agentic Web Challenge](https://cognizant-agenticweb.devpost.com/) against the [Worldwide Agentic Web MVP spec](https://github.com/cognizant-ai-labs/agentic-web/blob/main/docs/worldwide_agentic_web_mvp_spec.md).

## Why
People in India get letters they can't easily read: bank re-KYC notices, disconnection notices, rental agreements and lab reports. Asking an AI for help usually means pasting their Aadhaar, PAN, account number and home address into it. Plainly's agents give the same help without that.

## What's new here

### 1. Private by construction
The site's `website_*` tools never return the original document. The page redacts it first, using exact rules: Aadhaar (Verhoeff checksum), PAN, IFSC, UPI, cards (Luhn), phone and account numbers, dates of birth, and labelled names and addresses. The agents only ever see `[NAME 1]`, `[AADHAAR 1]` and so on. When an agent pins a note, the page fills the visitor's real details back in for display. The placeholder map never leaves the page.

### 2. On-device inference for the agentic web: [`js/nano-router.js`](js/nano-router.js)
The spec's runtime talks to any OpenAI-compatible router. `nano-router.js` is a small, dependency-free module that answers those `/chat/completions` requests **inside the page**, using Chrome's built-in **Gemini Nano** (the Prompt API):
- messages become a Prompt API session (a system prompt plus a transcript, trimmed to fit)
- `tools` become a JSON-schema `responseConstraint`, with one `anyOf` variant per tool, so the model can only produce arguments that fit that tool's schema
- the reply comes back as an OpenAI SSE stream with `content` or `tool_calls`
- if a small model writes a call into its answer text instead of making it, the call is recovered

So **agent-to-agent delegation and site actions run with no key, no server and no cost**, and the visitor's words stay on their computer. Visitors without Gemini Nano can still bring their own key (`?engine=byok`). This follows the spec's "Local and browser inference" extension (§7). Any agentic site can drop the module in.

### 3. A spec-conforming agent site
- **Two-agent network.** `document_helper` (front) delegates to `rights_guide`, which has general, sourced information on Indian consumer routes: banks → RBI Ombudsman (cms.rbi.org.in) after 30 days; power → CGRF → Electricity Ombudsman; renting → Model Tenancy Act 2021 (where adopted); National Consumer Helpline 1915.
- **Site actions:**
  - `get_page_state` (read, redacted)
  - `load_sample` (write)
  - `pin_note` (write)
  - `clear_notes` (write)
- **Published files:** a manifest, the resolved network, `links.json`, `agent-mcp.json`, `.well-known/nsdeploy*.json` and the action bridge. Other agent sites can load this network, and a peer gets no `website_*` tools.

## Run locally
```bash
node <agentic-web>/skills/agentify-website/scripts/serve_site.mjs . --port 8080
```
Then open http://127.0.0.1:8080 in desktop Chrome with Gemini Nano. Turn on `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input`, then restart Chrome. The model downloads once, and the page offers a download button.

Rebuild the network after editing the HOCON:
```bash
node <agentic-web>/skills/agentify-website/scripts/build_network.mjs plainly_document_helper.hocon --manifest agent-manifest.json
```

## Honest limits
- Gemini Nano is small. It does single requests well, such as "explain this", "pin a checklist" or "where can I complain?". It is weaker at long multi-step requests. A BYOK model handles those better.
- Gemini Nano is only in desktop Chrome for now.
- The rules catch structured IDs and labelled names and addresses. An unlabelled name in free text can slip through. The "What the agents see" tab shows exactly what the agents get.
- The answers are general information, not legal, financial or medical advice.

## Credits
- The browser runtime in `runtime/` is the agentic-web skill's copy of [nsDeploy](https://github.com/cognizant-ai-lab/nsdeploy) (Apache 2.0, unchanged).
- The redaction rules come from my Plainly project.

## License
MIT (except `runtime/`, which is Apache 2.0)
