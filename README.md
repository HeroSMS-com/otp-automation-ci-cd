# Automating OTP in CI/CD: Why Tests Break and How to Bulletproof Your Releases

> E2E testing of SMS verification flows with Playwright, webhooks, and real non-VoIP numbers — without flaky tests or security backdoors.

🇷🇺 [Русская версия](README.ru.md) · 🇨🇳 [简体中文](README.zh-CN.md)

When setting up end-to-end (E2E) tests for sign-up or login flows, developers invariably hit a brick wall: the CI/CD pipeline grinds to a halt at the SMS verification step. Cloud containers obviously lack physical SIM cards, leaving your tests to either hang indefinitely on a timeout or beg for manual intervention. Either way, the "automation" part goes right out the window.

In this post, we'll break down the tools that actually fix this — moving your pipeline from fragile setups to scalable, distributed test execution.

## Table of Contents

- [The Hidden Costs of Skipping SMS Automation](#the-hidden-costs-of-skipping-sms-automation)
- [Flawed Approaches (And Why They Wreck Your Pipelines)](#flawed-approaches-and-why-they-wreck-your-pipelines)
- [Effective Tools: From Quick Fixes to a Solid Foundation](#effective-tools-from-quick-fixes-to-a-solid-foundation)
- [Automating SMS Verification in E2E Tests: From Polling to Webhooks](#automating-sms-verification-in-e2e-tests-from-polling-to-webhooks)
- [Tool Selection Guide](#tool-selection-guide)
- [FAQ](#faq)

## The Hidden Costs of Skipping SMS Automation

Let's be honest: bypassing SMS verification or simply sweeping the problem under the rug is a recipe for disaster.

- For one, forcing your team into a loop of manual code entry completely defeats the purpose of automation and breaks test isolation.
- Secondly, relying on unpredictable telecom networks turns your suite into a flaky test nightmare due to random SMS gateway latency.
- Finally, relying on "synthetic" mock environments that completely bypass the actual SMS gateway creates a dangerous blind spot. If the live integration with your provider breaks, your pipeline won't catch it — meaning the bug will land squarely on your production users.

These kinds of testing trade-offs have always been around, mostly because automating SMS verification is a niche beast with very few established industry standards. As a result, most engineering teams learn the hard way through trial and error. The trick is to actually learn from those errors.

## Flawed Approaches (And Why They Wreck Your Pipelines)

We've mapped out popular SMS testing methods on a risk spectrum — ranging from relatively harmless architectural compromises to catastrophic shortcuts that can crash your production app or leave the backdoor wide open for hackers.

### 🟡 Level 1: The "Local Compromise" (Why Do Firebase Test Numbers Not Scale?)

You leverage built-in sandboxes provided by major auth vendors — hardcoding whitelisted numbers in the Firebase Auth console or utilizing Twilio's sandbox limits with fixed dummy codes.

- **The Core Idea:** It works beautifully on a developer's local machine for rapid UI prototyping and debugging.
- **Why it's a CI/CD dead end:** It simply doesn't scale for parallel CI runners. These sandboxes impose strict rate limits and harsh caps on the number of allowed phones (usually capped at 10 in Firebase). Try spinning up a parallel test suite to register 50 users simultaneously across multiple GitHub Actions runners, and your pipeline will instantly hit a wall due to API throttling. On top of that, you miss out on testing real international SMS delivery and handling cross-region network latency when testing across multiple countries.

### 🔴 Level 2: The "Infrastructure Nightmare" (Android Phone + SMS-to-Webhook / ADB / Appium)

You dust off an old Android phone, slap a corporate SIM card into it, and install a free app from Google Play (like SMS Gateway or SMS to URL) to forward incoming messages to your server via a Webhook. Alternatively, you tether the device to a machine with a cable and scrape texts directly via ADB or Appium commands.

- **The Core Idea:** You're trying to mimic real-world SMS delivery on a physical device on a shoestring budget.
- **Why it's a CI/CD dead end:** It fails completely when moving from local setups to infrastructure scaling. That phone sitting in your server closet will eventually drop Wi-Fi, Android's OS will aggressively "doze" the background forwarding app to conserve power, and the phone's battery will inevitably swell from being plugged in 24/7. Software-wise, it's just as brutal: if multiple CI jobs trigger concurrently, a single physical phone will choke on the incoming SMS traffic, infrastructure scaling breaks down, and your entire distributed test execution freezes.

### ⚫ Level 3: The Security Backdoor (Hardcoding Bypass Flags like `process.env.BYPASS_OTP`)

You inject environment checks directly into your backend code: if the application detects a test environment, it bypasses the actual SMS gateway entirely and auto-accepts any hardcoded dummy code (like 1111).

- **The Core Idea:** The fastest and most tempting way to get green builds without sending a single text.
- **Why it's dangerous:** This is a huge risk for your business. A single misconfiguration in your ephemeral environments or a split-second human error during deployment to multi-region deployments is all it takes for this testing flag to bleed into live production. Bad actors will sniff out this loophole in no time, hijacking real user accounts by simply entering the dummy code. Furthermore, this completely cuts the actual SMS module out of the equation — if your provider updates their API or their gateway goes down, your automated suite will happily stay green, blissfully unaware of the outage.

## Effective Tools: From Quick Fixes to a Solid Foundation

Robust tools require a bit of architectural prep work and a slice of the engineering budget. We've ranked these solutions from simple local practices to the ultimate foundation that ideally belongs at the core of every project.

### ⚙️ Level 1: Local Isolation

- **Type:** Mock servers like WireMock or Mockoon
- **Value:** 🟢
- **Complexity & Overhead:** 🟡 (Just the time spent configuring mocks)

Instead of injecting dangerous bypass flags directly into your backend codebase, developers spin up an isolated mock server that intercepts outbound requests to the SMS gateway within the staging or test perimeter to achieve proper test isolation.

- **The Payoff:** Complete insulation from the outside world. When the backend triggers an SMS, the request hits your local mock server, which immediately returns a valid dummy response. Your production code remains pristine, and tests complete in milliseconds.
- **Why it's often overlooked:** It requires ongoing maintenance. You have to map out the mock configurations, keep API payloads up to date, and modify them whenever your SMS provider updates their docs. Frankly, many developers get lazy and opt for a quick `if (process.env.NODE_ENV === 'test')` patch instead.

### 🔗 Level 2: Deep Integration

- **Type:** Direct OTP extraction from a test DB or Redis
- **Value:** 🟢🟢
- **Complexity & Overhead:** 🟠🟠 (Requires writing custom test plumbing)

With this strategy, the E2E test suite doesn't even bother trying to intercept the network request. When a test user requests a code, the backend generates it and stores it in the database or cache layer (Redis). The automation framework (like Playwright) hooks directly into this database via a custom connector, snatches the fresh OTP, and drops it into the UI input.

- **The Payoff:** Rock-solid speed and stability. The test is entirely immune to cell network congestion, carrier delays, or dropped signals. You test the genuine backend generation logic while avoiding eventual consistency issues in your staging infrastructure.
- **Why it's often overlooked:** It's a tough engineering nut to crack. First, SecOps teams will often block cloud-hosted CI/CD runners from poking around inside internal databases. Second, it adds heavy lifting to your testing framework, forcing you to maintain Postgres or Redis connection pools right inside your automation scripts.

### 🏛️ Level 3: The Solid Foundation

- **Type:** Programmable B2B APIs with non-VoIP numbers
- **Value:** 🟢🟢🟢 (Maximum test fidelity)
- **Complexity & Overhead:** 🔴🔴🔴 (Requires a dedicated testing budget)

This is the holy grail of E2E automation — integrating a production-grade, developer-first SMS API directly into your test suite. The script programmatically requests a real mobile number for the target market (for example, a US mobile number, a UK mobile number, or a German mobile number), feeds it into the UI, and retrieves the incoming auth code via a simple HTTP request.

- **The Payoff:** The only way to run a true, non-synthetic E2E test of your system before a release. You validate everything: from the backend outbound request down to the frontend's handling of the response. The pipeline is fully automated, scales seamlessly across dozens of concurrent GitHub Actions runners, and introduces zero security risks.
- **Why it's often overlooked:** It requires an upfront budget allocation and development time to implement the API client logic. Chasing "free" shortcuts, companies often end up burning dozens of highly-paid engineering hours playing whack-a-mole with broken pipelines.

## Automating SMS Verification in E2E Tests: From Polling to Webhooks

Dedicated B2B platforms provide developers with direct access to pools of real mobile numbers through REST APIs. However, the way you wire them up makes all the difference.

- **The Traditional Approach: Polling.** The script rents a number via the API, inputs it into the UI, and hammers the gateway every 3 seconds asking, *"Are we there yet?"*. While this mechanic technically works, it's highly inefficient — your test burns through billable CI/CD compute minutes on ceaseless idle requests and risks hitting retry policies or API throttling limits.
- **The Event-Driven Model: Webhooks.** The test script stops spamming the API altogether. Instead, it spins up a lightweight HTTP server right inside the test runner. As soon as the SMS hits the cellular network, the gateway takes the initiative and pushes an HTTP POST request with the ready-to-use OTP payload. The execution flow simply goes into async hibernation, waiting for the event and saving precious runner resources while ensuring idempotency via proper webhook retries handling.

### How Can Playwright Receive Real SMS Messages? Code Walkthrough

Let's break down what the architecture of this solution looks like under the hood, using the [HeroSMS](https://hero-sms.com/?utm_source=gh&utm_medium=otpauto&utm_campaign=20072026&utm_content=topic) service as a prime example. The gateway exposes an [SMS-Activate-compatible API](https://hero-sms.com/api) at `https://hero-sms.com/stubs/handler_api.php`: a `getNumberV2` call rents a real number and returns a JSON activation object (or a bare error string like `NO_NUMBERS`), incoming messages are pushed as `POST` webhooks, and `setStatus` completes (`6`) or cancels (`8`) the activation.

> **Prerequisite:** HeroSMS delivers webhooks to up to three HTTPS URLs configured in your account settings — not per request. Point one of them at your runner (via an ngrok tunnel during local development), and for a production-grade CI setup whitelist the gateway's source IPs: `84.32.223.53` and `185.138.88.87`.

```typescript
import { test, expect } from '@playwright/test';
import axios from 'axios';
import http from 'http';

// --- Type Definitions (per https://hero-sms.com/api) ---
interface HeroSmsActivation {
  activationId: string;
  phoneNumber: string;
  activationCost: number;
  activationEndTime: string;
  canGetAnotherSms: boolean;
}

interface HeroSmsWebhookPayload {
  activationId: string;
  service: string;
  text: string | null;
  code?: string | null;
  country: number;
  receivedAt: string;
}

// SMS-Activate-compatible endpoint of HeroSMS
const HEROSMS_API_URL = 'https://hero-sms.com/stubs/handler_api.php';
const HEROSMS_API_KEY = process.env.HEROSMS_API_KEY!;
const PORT = process.env.WEBHOOK_PORT ? parseInt(process.env.WEBHOOK_PORT, 10) : 3000;

// NOTE: HeroSMS delivers webhooks to up to 3 HTTPS URLs configured in your
// account settings (not per request). Point one of them at this runner
// (e.g. via an ngrok tunnel during local development) before running the test.

test('End-to-End Verification via Asynchronous Webhook', async ({ page }) => {
  // 1. Set up deferred promises for the webhook payload
  let resolveWebhook: (code: string) => void;
  let rejectWebhook: (reason: Error) => void;

  const webhookPromise = new Promise<string>((resolve, reject) => {
    resolveWebhook = resolve;
    rejectWebhook = reject;
  });

  // Guard: mark early rejections as handled, so a server error that fires
  // before Promise.race subscribes (e.g. a port conflict) fails this test
  // instead of crashing the whole runner process
  webhookPromise.catch(() => {});

  // Webhooks are account-wide, so parallel CI jobs receive every SMS event.
  // Each runner must only react to its own activation
  let expectedActivationId: string | null = null;

  // 2. Initialize the Ephemeral HTTP Server
  const server = http.createServer((req, res) => {
    // Reject non-POST requests immediately
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Method Not Allowed' }));
    }

    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body) as HeroSmsWebhookPayload;

        // Resolve only for our own activation; the `code` field is nullable
        if (payload.code && payload.activationId === expectedActivationId) {
          resolveWebhook(payload.code);
        }

        // Always ACK with 200 — otherwise HeroSMS retries the delivery
        // at least 7 times every 20-30 seconds
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'accepted' }));
      } catch (error) {
        // Prevent process crashes on malformed webhook payloads
        console.error('[Webhook] Failed to parse payload:', error);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON payload' }));
      }
    });
  });

  // Bubble up internal server errors to fail the test quickly
  server.on('error', (error) => rejectWebhook(error));

  let activationCompleted = false;

  try {
    // 3. Await server binding to guarantee it's ready before API calls
    await new Promise<void>((resolve, reject) => {
      server.listen(PORT, resolve);
      server.once('error', reject);
    });

    // 4. Rent a real number: GET ?action=getNumberV2
    const { data } = await axios.get<HeroSmsActivation | string>(HEROSMS_API_URL, {
      params: {
        api_key: HEROSMS_API_KEY,
        action: 'getNumberV2',
        service: 'tg', // service code from ?action=getServicesList
        country: 6     // country ID from ?action=getCountries
      }
    });

    // On failure the gateway answers with a bare string ("NO_NUMBERS", "BAD_KEY", ...)
    expect(typeof data, `Gateway returned "${data}" instead of an activation object`).toBe('object');
    const activation = data as HeroSmsActivation;

    expectedActivationId = activation.activationId;
    const { phoneNumber } = activation;

    // 5. Trigger the OTP in the UI
    await page.goto('https://your-app.com/login');
    await page.fill('input[type="tel"]', phoneNumber);
    await page.click('button#send-otp');

    // 6. Native Node.js timeout (avoiding Playwright's page.waitForTimeout)
    const TIMEOUT_MS = 15000;
    const timeoutPromise = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), TIMEOUT_MS)
    );

    // 7. Await the race condition
    const otpCode = await Promise.race([
      webhookPromise,
      timeoutPromise
    ]);

    // Provide a clear failure message if the timeout won the race
    expect(otpCode, `Failed to receive OTP webhook within ${TIMEOUT_MS}ms`).not.toBeNull();

    // 8. Complete the Login Flow
    await page.fill('input#otp-input', otpCode!);
    await page.click('button#submit-otp');
    await expect(page).toHaveURL('https://your-app.com/dashboard');

    // 9. Report success to the gateway: status 6 = complete the activation
    await axios.get(HEROSMS_API_URL, {
      params: { api_key: HEROSMS_API_KEY, action: 'setStatus', id: expectedActivationId, status: 6 }
    });
    activationCompleted = true;

  } finally {
    // 10. Money-safe teardown: cancel the rented number (status 8) if the
    // test failed before completing the activation, so a broken pipeline
    // doesn't leave paid rentals hanging
    if (expectedActivationId && !activationCompleted) {
      await axios.get(HEROSMS_API_URL, {
        params: { api_key: HEROSMS_API_KEY, action: 'setStatus', id: expectedActivationId, status: 8 }
      }).catch(() => { /* best effort */ });
    }

    // 11. Always release the port regardless of test outcome
    if (server.listening) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
});
```

### Key Design Decisions

Here's why the architecture is built this way:

- **Guaranteed Port Release (`try...finally`):** Without it, a UI assertion failure before `server.close()` would throw an exception, bypass the closure, and leave the process attached to port 3000. Wrapping the test logic in a `try...finally` block and checking `server.listening` guarantees the OS reclaims the port — preventing cascading test failures in CI environments.
- **Activation-Scoped Filtering:** HeroSMS webhook URLs are configured per account (up to three), so every parallel CI job receives every incoming SMS event. The handler resolves the promise only when `payload.activationId` matches the number rented by this very test — and still ACKs everything else with `200`, because the gateway retries undelivered webhooks at least 7 times every 20–30 seconds.
- **Money-Safe Teardown (`setStatus`):** On success the test reports `status=6` (complete); if it dies anywhere earlier, the `finally` block fires a best-effort `status=8` (cancel). HeroSMS also exposes the explicit `finishActivation` / `cancelActivation` actions as one-to-one aliases of these two statuses. A broken pipeline never leaves paid number rentals hanging on your balance.
- **No `page.waitForTimeout`:** Playwright strongly advises against using `page.waitForTimeout` in production tests because it artificially couples Node.js execution logic to the browser's event loop. A standard native Node `setTimeout` wrapped in a Promise keeps the race condition entirely in the backend logic where the HTTP server lives.
- **Awaiting Server Binding:** Before the SMS gateway can reach our instance, we must be absolutely certain the server is bound to the port. `server.listen()` is wrapped in a Promise, ensuring the server is fully ready before the number is rented.
- **Error Boundaries:** A common vulnerability with raw Node HTTP servers is that unhandled exceptions (like a `JSON.parse` error on a malformed payload) will crash the entire test runner. The JSON parser is wrapped in a `try...catch`, returns a strict `400 Bad Request` to the API, and an error listener on the server object bubbles systemic issues (like port conflicts) up to the test logger.
- **Unhandled Rejection Guard:** If the server emits an error before `Promise.race` subscribes to `webhookPromise` (a busy port is the classic case), the rejected promise has no listeners yet — and in modern Node.js an unhandled rejection takes down the whole runner process, not just the test. A no-op `.catch(() => {})` right after creating the promise marks early rejections as handled, while `Promise.race` still receives the error and fails the test cleanly.

## Tool Selection Guide

There is no silver bullet when it comes to OTP automation: your choice of approach will always depend on your team's process maturity, budget, and corporate security requirements. That said, the ultimate benchmark for a reliable pipeline remains the same: **ditching synthetic tests** in favor of testing the real deal.

### 💡 Checklist: Choosing Your Path

- **If you have a strict security perimeter and a locked-down CI environment:** Set up direct OTP extraction from your staging database or Redis instance to handle eventual consistency natively.
- **If you need to rapidly spin up frontend test coverage without sending actual texts:** Deploy local mock servers using tools like Mockoon or WireMock.
- **If you need a bulletproof, flake-free E2E test right before a production release:** Integrate a production-grade B2B API using the event-driven Webhook model showcased in the code above.

## FAQ

**Q: How do I test the webhook logic locally on a developer's machine before deploying to a cloud CI/CD pipeline?**

**A:** For local debugging of incoming webhooks, use reverse proxy tunneling tools like ngrok or localtunnel. They expose your local port (e.g., `localhost:3000`) to the public internet and generate a temporary public URL. This is the exact URL you paste into the webhook settings of your HeroSMS account (up to three URLs are supported per account).

**Q: What happens if real-world SMS delivery from the carrier takes longer than 15 seconds?**

**A:** The test implementation addresses this via `Promise.race`, which acts as a hard circuit breaker to prevent the pipeline runner from hanging indefinitely due to SMS gateway latency. If cellular networks are heavily congested in a specific region, you can safely scale this timeout up to 30–45 seconds through your runner's configuration or retry policies. The gateway itself also retries undelivered webhooks (at least 7 attempts over 3+ minutes), so a transient network hiccup between HeroSMS and your runner won't lose the code.

**Q: Is it safe to commit the API authorization token directly into the test codebase?**

**A:** Absolutely not. Hardcoding API keys directly into your repository is a critical security vulnerability. All tokens must live exclusively within your CI/CD provider's encrypted secrets store (e.g., GitHub Secrets, GitLab CI Variables) and be injected into the runner's container as environment variables (`process.env`).

---

## About

This guide uses [HeroSMS](https://hero-sms.com/?utm_source=gh&utm_medium=otpauto&utm_campaign=20072026&utm_content=topic) — a programmable SMS verification platform with real non-VoIP numbers across dozens of countries, an [SMS-Activate-compatible REST API](https://hero-sms.com/api), and webhook delivery of incoming messages — as the reference B2B provider for the Level 3 approach.

Licensed under [MIT](LICENSE).# Automating OTP in CI/CD: Why Tests Break and How to Bulletproof Your Releases

> E2E testing of SMS verification flows with Playwright, webhooks, and real non-VoIP numbers — without flaky tests or security backdoors.

🇷🇺 [Русская версия](README.ru.md) 

When setting up end-to-end (E2E) tests for sign-up or login flows, developers invariably hit a brick wall: the CI/CD pipeline grinds to a halt at the SMS verification step. Cloud containers obviously lack physical SIM cards, leaving your tests to either hang indefinitely on a timeout or beg for manual intervention. Either way, the "automation" part goes right out the window.

In this post, we'll break down the tools that actually fix this — moving your pipeline from fragile setups to scalable, distributed test execution.

## Table of Contents

- [The Hidden Costs of Skipping SMS Automation](#the-hidden-costs-of-skipping-sms-automation)
- [Flawed Approaches (And Why They Wreck Your Pipelines)](#flawed-approaches-and-why-they-wreck-your-pipelines)
- [Effective Tools: From Quick Fixes to a Solid Foundation](#effective-tools-from-quick-fixes-to-a-solid-foundation)
- [Automating SMS Verification in E2E Tests: From Polling to Webhooks](#automating-sms-verification-in-e2e-tests-from-polling-to-webhooks)
- [Tool Selection Guide](#tool-selection-guide)
- [FAQ](#faq)

## The Hidden Costs of Skipping SMS Automation

Let's be honest: bypassing SMS verification or simply sweeping the problem under the rug is a recipe for disaster.

- For one, forcing your team into a loop of manual code entry completely defeats the purpose of automation and breaks test isolation.
- Secondly, relying on unpredictable telecom networks turns your suite into a flaky test nightmare due to random SMS gateway latency.
- Finally, relying on "synthetic" mock environments that completely bypass the actual SMS gateway creates a dangerous blind spot. If the live integration with your provider breaks, your pipeline won't catch it — meaning the bug will land squarely on your production users.

These kinds of testing trade-offs have always been around, mostly because automating SMS verification is a niche beast with very few established industry standards. As a result, most engineering teams learn the hard way through trial and error. The trick is to actually learn from those errors.

## Flawed Approaches (And Why They Wreck Your Pipelines)

We've mapped out popular SMS testing methods on a risk spectrum — ranging from relatively harmless architectural compromises to catastrophic shortcuts that can crash your production app or leave the backdoor wide open for hackers.

### 🟡 Level 1: The "Local Compromise" (Why Do Firebase Test Numbers Not Scale?)

You leverage built-in sandboxes provided by major auth vendors — hardcoding whitelisted numbers in the Firebase Auth console or utilizing Twilio's sandbox limits with fixed dummy codes.

- **The Core Idea:** It works beautifully on a developer's local machine for rapid UI prototyping and debugging.
- **Why it's a CI/CD dead end:** It simply doesn't scale for parallel CI runners. These sandboxes impose strict rate limits and harsh caps on the number of allowed phones (usually capped at 10 in Firebase). Try spinning up a parallel test suite to register 50 users simultaneously across multiple GitHub Actions runners, and your pipeline will instantly hit a wall due to API throttling. On top of that, you miss out on testing real international SMS delivery and handling cross-region network latency when testing across multiple countries.

### 🔴 Level 2: The "Infrastructure Nightmare" (Android Phone + SMS-to-Webhook / ADB / Appium)

You dust off an old Android phone, slap a corporate SIM card into it, and install a free app from Google Play (like SMS Gateway or SMS to URL) to forward incoming messages to your server via a Webhook. Alternatively, you tether the device to a machine with a cable and scrape texts directly via ADB or Appium commands.

- **The Core Idea:** You're trying to mimic real-world SMS delivery on a physical device on a shoestring budget.
- **Why it's a CI/CD dead end:** It fails completely when moving from local setups to infrastructure scaling. That phone sitting in your server closet will eventually drop Wi-Fi, Android's OS will aggressively "doze" the background forwarding app to conserve power, and the phone's battery will inevitably swell from being plugged in 24/7. Software-wise, it's just as brutal: if multiple CI jobs trigger concurrently, a single physical phone will choke on the incoming SMS traffic, infrastructure scaling breaks down, and your entire distributed test execution freezes.

### ⚫ Level 3: The Security Backdoor (Hardcoding Bypass Flags like `process.env.BYPASS_OTP`)

You inject environment checks directly into your backend code: if the application detects a test environment, it bypasses the actual SMS gateway entirely and auto-accepts any hardcoded dummy code (like 1111).

- **The Core Idea:** The fastest and most tempting way to get green builds without sending a single text.
- **Why it's dangerous:** This is a huge risk for your business. A single misconfiguration in your ephemeral environments or a split-second human error during deployment to multi-region deployments is all it takes for this testing flag to bleed into live production. Bad actors will sniff out this loophole in no time, hijacking real user accounts by simply entering the dummy code. Furthermore, this completely cuts the actual SMS module out of the equation — if your provider updates their API or their gateway goes down, your automated suite will happily stay green, blissfully unaware of the outage.

## Effective Tools: From Quick Fixes to a Solid Foundation

Robust tools require a bit of architectural prep work and a slice of the engineering budget. We've ranked these solutions from simple local practices to the ultimate foundation that ideally belongs at the core of every project.

### ⚙️ Level 1: Local Isolation

- **Type:** Mock servers like WireMock or Mockoon
- **Value:** 🟢
- **Complexity & Overhead:** 🟡 (Just the time spent configuring mocks)

Instead of injecting dangerous bypass flags directly into your backend codebase, developers spin up an isolated mock server that intercepts outbound requests to the SMS gateway within the staging or test perimeter to achieve proper test isolation.

- **The Payoff:** Complete insulation from the outside world. When the backend triggers an SMS, the request hits your local mock server, which immediately returns a valid dummy response. Your production code remains pristine, and tests complete in milliseconds.
- **Why it's often overlooked:** It requires ongoing maintenance. You have to map out the mock configurations, keep API payloads up to date, and modify them whenever your SMS provider updates their docs. Frankly, many developers get lazy and opt for a quick `if (process.env.NODE_ENV === 'test')` patch instead.

### 🔗 Level 2: Deep Integration

- **Type:** Direct OTP extraction from a test DB or Redis
- **Value:** 🟢🟢
- **Complexity & Overhead:** 🟠🟠 (Requires writing custom test plumbing)

With this strategy, the E2E test suite doesn't even bother trying to intercept the network request. When a test user requests a code, the backend generates it and stores it in the database or cache layer (Redis). The automation framework (like Playwright) hooks directly into this database via a custom connector, snatches the fresh OTP, and drops it into the UI input.

- **The Payoff:** Rock-solid speed and stability. The test is entirely immune to cell network congestion, carrier delays, or dropped signals. You test the genuine backend generation logic while avoiding eventual consistency issues in your staging infrastructure.
- **Why it's often overlooked:** It's a tough engineering nut to crack. First, SecOps teams will often block cloud-hosted CI/CD runners from poking around inside internal databases. Second, it adds heavy lifting to your testing framework, forcing you to maintain Postgres or Redis connection pools right inside your automation scripts.

### 🏛️ Level 3: The Solid Foundation

- **Type:** Programmable B2B APIs with non-VoIP numbers
- **Value:** 🟢🟢🟢 (Maximum test fidelity)
- **Complexity & Overhead:** 🔴🔴🔴 (Requires a dedicated testing budget)

This is the holy grail of E2E automation — integrating a production-grade, developer-first SMS API directly into your test suite. The script programmatically requests a real mobile number for the target market (for example, a US mobile number, a UK mobile number, or a German mobile number), feeds it into the UI, and retrieves the incoming auth code via a simple HTTP request.

- **The Payoff:** The only way to run a true, non-synthetic E2E test of your system before a release. You validate everything: from the backend outbound request down to the frontend's handling of the response. The pipeline is fully automated, scales seamlessly across dozens of concurrent GitHub Actions runners, and introduces zero security risks.
- **Why it's often overlooked:** It requires an upfront budget allocation and development time to implement the API client logic. Chasing "free" shortcuts, companies often end up burning dozens of highly-paid engineering hours playing whack-a-mole with broken pipelines.

## Automating SMS Verification in E2E Tests: From Polling to Webhooks

Dedicated B2B platforms provide developers with direct access to pools of real mobile numbers through REST APIs. However, the way you wire them up makes all the difference.

- **The Traditional Approach: Polling.** The script rents a number via the API, inputs it into the UI, and hammers the gateway every 3 seconds asking, *"Are we there yet?"*. While this mechanic technically works, it's highly inefficient — your test burns through billable CI/CD compute minutes on ceaseless idle requests and risks hitting retry policies or API throttling limits.
- **The Event-Driven Model: Webhooks.** The test script stops spamming the API altogether. Instead, it spins up a lightweight HTTP server right inside the test runner. As soon as the SMS hits the cellular network, the gateway takes the initiative and pushes an HTTP POST request with the ready-to-use OTP payload. The execution flow simply goes into async hibernation, waiting for the event and saving precious runner resources while ensuring idempotency via proper webhook retries handling.

### How Can Playwright Receive Real SMS Messages? Code Walkthrough

Let's break down what the architecture of this solution looks like under the hood, using the [HeroSMS](https://hero-sms.com/?utm_source=gh&utm_medium=otpauto&utm_campaign=20072026&utm_content=topic) service as a prime example. The gateway exposes an [SMS-Activate-compatible API](https://hero-sms.com/api) at `https://hero-sms.com/stubs/handler_api.php`: a `getNumberV2` call rents a real number and returns a JSON activation object (or a bare error string like `NO_NUMBERS`), incoming messages are pushed as `POST` webhooks, and `setStatus` completes (`6`) or cancels (`8`) the activation.

> **Prerequisite:** HeroSMS delivers webhooks to up to three HTTPS URLs configured in your account settings — not per request. Point one of them at your runner (via an ngrok tunnel during local development), and for a production-grade CI setup whitelist the gateway's source IPs: `84.32.223.53` and `185.138.88.87`.

```typescript
import { test, expect } from '@playwright/test';
import axios from 'axios';
import http from 'http';

// --- Type Definitions (per https://hero-sms.com/api) ---
interface HeroSmsActivation {
  activationId: string;
  phoneNumber: string;
  activationCost: number;
  activationEndTime: string;
  canGetAnotherSms: boolean;
}

interface HeroSmsWebhookPayload {
  activationId: string;
  service: string;
  text: string | null;
  code?: string | null;
  country: number;
  receivedAt: string;
}

// SMS-Activate-compatible endpoint of HeroSMS
const HEROSMS_API_URL = 'https://hero-sms.com/stubs/handler_api.php';
const HEROSMS_API_KEY = process.env.HEROSMS_API_KEY!;
const PORT = process.env.WEBHOOK_PORT ? parseInt(process.env.WEBHOOK_PORT, 10) : 3000;

// NOTE: HeroSMS delivers webhooks to up to 3 HTTPS URLs configured in your
// account settings (not per request). Point one of them at this runner
// (e.g. via an ngrok tunnel during local development) before running the test.

test('End-to-End Verification via Asynchronous Webhook', async ({ page }) => {
  // 1. Set up deferred promises for the webhook payload
  let resolveWebhook: (code: string) => void;
  let rejectWebhook: (reason: Error) => void;

  const webhookPromise = new Promise<string>((resolve, reject) => {
    resolveWebhook = resolve;
    rejectWebhook = reject;
  });

  // Guard: mark early rejections as handled, so a server error that fires
  // before Promise.race subscribes (e.g. a port conflict) fails this test
  // instead of crashing the whole runner process
  webhookPromise.catch(() => {});

  // Webhooks are account-wide, so parallel CI jobs receive every SMS event.
  // Each runner must only react to its own activation
  let expectedActivationId: string | null = null;

  // 2. Initialize the Ephemeral HTTP Server
  const server = http.createServer((req, res) => {
    // Reject non-POST requests immediately
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Method Not Allowed' }));
    }

    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body) as HeroSmsWebhookPayload;

        // Resolve only for our own activation; the `code` field is nullable
        if (payload.code && payload.activationId === expectedActivationId) {
          resolveWebhook(payload.code);
        }

        // Always ACK with 200 — otherwise HeroSMS retries the delivery
        // at least 7 times every 20-30 seconds
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'accepted' }));
      } catch (error) {
        // Prevent process crashes on malformed webhook payloads
        console.error('[Webhook] Failed to parse payload:', error);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON payload' }));
      }
    });
  });

  // Bubble up internal server errors to fail the test quickly
  server.on('error', (error) => rejectWebhook(error));

  let activationCompleted = false;

  try {
    // 3. Await server binding to guarantee it's ready before API calls
    await new Promise<void>((resolve, reject) => {
      server.listen(PORT, resolve);
      server.once('error', reject);
    });

    // 4. Rent a real number: GET ?action=getNumberV2
    const { data } = await axios.get<HeroSmsActivation | string>(HEROSMS_API_URL, {
      params: {
        api_key: HEROSMS_API_KEY,
        action: 'getNumberV2',
        service: 'tg', // service code from ?action=getServicesList
        country: 6     // country ID from ?action=getCountries
      }
    });

    // On failure the gateway answers with a bare string ("NO_NUMBERS", "BAD_KEY", ...)
    expect(typeof data, `Gateway returned "${data}" instead of an activation object`).toBe('object');
    const activation = data as HeroSmsActivation;

    expectedActivationId = activation.activationId;
    const { phoneNumber } = activation;

    // 5. Trigger the OTP in the UI
    await page.goto('https://your-app.com/login');
    await page.fill('input[type="tel"]', phoneNumber);
    await page.click('button#send-otp');

    // 6. Native Node.js timeout (avoiding Playwright's page.waitForTimeout)
    const TIMEOUT_MS = 15000;
    const timeoutPromise = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), TIMEOUT_MS)
    );

    // 7. Await the race condition
    const otpCode = await Promise.race([
      webhookPromise,
      timeoutPromise
    ]);

    // Provide a clear failure message if the timeout won the race
    expect(otpCode, `Failed to receive OTP webhook within ${TIMEOUT_MS}ms`).not.toBeNull();

    // 8. Complete the Login Flow
    await page.fill('input#otp-input', otpCode!);
    await page.click('button#submit-otp');
    await expect(page).toHaveURL('https://your-app.com/dashboard');

    // 9. Report success to the gateway: status 6 = complete the activation
    await axios.get(HEROSMS_API_URL, {
      params: { api_key: HEROSMS_API_KEY, action: 'setStatus', id: expectedActivationId, status: 6 }
    });
    activationCompleted = true;

  } finally {
    // 10. Money-safe teardown: cancel the rented number (status 8) if the
    // test failed before completing the activation, so a broken pipeline
    // doesn't leave paid rentals hanging
    if (expectedActivationId && !activationCompleted) {
      await axios.get(HEROSMS_API_URL, {
        params: { api_key: HEROSMS_API_KEY, action: 'setStatus', id: expectedActivationId, status: 8 }
      }).catch(() => { /* best effort */ });
    }

    // 11. Always release the port regardless of test outcome
    if (server.listening) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
});
```

### Key Design Decisions

Here's why the architecture is built this way:

- **Guaranteed Port Release (`try...finally`):** Without it, a UI assertion failure before `server.close()` would throw an exception, bypass the closure, and leave the process attached to port 3000. Wrapping the test logic in a `try...finally` block and checking `server.listening` guarantees the OS reclaims the port — preventing cascading test failures in CI environments.
- **Activation-Scoped Filtering:** HeroSMS webhook URLs are configured per account (up to three), so every parallel CI job receives every incoming SMS event. The handler resolves the promise only when `payload.activationId` matches the number rented by this very test — and still ACKs everything else with `200`, because the gateway retries undelivered webhooks at least 7 times every 20–30 seconds.
- **Money-Safe Teardown (`setStatus`):** On success the test reports `status=6` (complete); if it dies anywhere earlier, the `finally` block fires a best-effort `status=8` (cancel). HeroSMS also exposes the explicit `finishActivation` / `cancelActivation` actions as one-to-one aliases of these two statuses. A broken pipeline never leaves paid number rentals hanging on your balance.
- **No `page.waitForTimeout`:** Playwright strongly advises against using `page.waitForTimeout` in production tests because it artificially couples Node.js execution logic to the browser's event loop. A standard native Node `setTimeout` wrapped in a Promise keeps the race condition entirely in the backend logic where the HTTP server lives.
- **Awaiting Server Binding:** Before the SMS gateway can reach our instance, we must be absolutely certain the server is bound to the port. `server.listen()` is wrapped in a Promise, ensuring the server is fully ready before the number is rented.
- **Error Boundaries:** A common vulnerability with raw Node HTTP servers is that unhandled exceptions (like a `JSON.parse` error on a malformed payload) will crash the entire test runner. The JSON parser is wrapped in a `try...catch`, returns a strict `400 Bad Request` to the API, and an error listener on the server object bubbles systemic issues (like port conflicts) up to the test logger.
- **Unhandled Rejection Guard:** If the server emits an error before `Promise.race` subscribes to `webhookPromise` (a busy port is the classic case), the rejected promise has no listeners yet — and in modern Node.js an unhandled rejection takes down the whole runner process, not just the test. A no-op `.catch(() => {})` right after creating the promise marks early rejections as handled, while `Promise.race` still receives the error and fails the test cleanly.

## Tool Selection Guide

There is no silver bullet when it comes to OTP automation: your choice of approach will always depend on your team's process maturity, budget, and corporate security requirements. That said, the ultimate benchmark for a reliable pipeline remains the same: **ditching synthetic tests** in favor of testing the real deal.

### 💡 Checklist: Choosing Your Path

- **If you have a strict security perimeter and a locked-down CI environment:** Set up direct OTP extraction from your staging database or Redis instance to handle eventual consistency natively.
- **If you need to rapidly spin up frontend test coverage without sending actual texts:** Deploy local mock servers using tools like Mockoon or WireMock.
- **If you need a bulletproof, flake-free E2E test right before a production release:** Integrate a production-grade B2B API using the event-driven Webhook model showcased in the code above.

## FAQ

**Q: How do I test the webhook logic locally on a developer's machine before deploying to a cloud CI/CD pipeline?**

**A:** For local debugging of incoming webhooks, use reverse proxy tunneling tools like ngrok or localtunnel. They expose your local port (e.g., `localhost:3000`) to the public internet and generate a temporary public URL. This is the exact URL you paste into the webhook settings of your HeroSMS account (up to three URLs are supported per account).

**Q: What happens if real-world SMS delivery from the carrier takes longer than 15 seconds?**

**A:** The test implementation addresses this via `Promise.race`, which acts as a hard circuit breaker to prevent the pipeline runner from hanging indefinitely due to SMS gateway latency. If cellular networks are heavily congested in a specific region, you can safely scale this timeout up to 30–45 seconds through your runner's configuration or retry policies. The gateway itself also retries undelivered webhooks (at least 7 attempts over 3+ minutes), so a transient network hiccup between HeroSMS and your runner won't lose the code.

**Q: Is it safe to commit the API authorization token directly into the test codebase?**

**A:** Absolutely not. Hardcoding API keys directly into your repository is a critical security vulnerability. All tokens must live exclusively within your CI/CD provider's encrypted secrets store (e.g., GitHub Secrets, GitLab CI Variables) and be injected into the runner's container as environment variables (`process.env`).

---

## About

This guide uses [HeroSMS](https://hero-sms.com/?utm_source=gh&utm_medium=otpauto&utm_campaign=20072026&utm_content=topic) — a programmable SMS verification platform with real non-VoIP numbers across dozens of countries, an [SMS-Activate-compatible REST API](https://hero-sms.com/api), and webhook delivery of incoming messages — as the reference B2B provider for the Level 3 approach.

Licensed under [MIT](LICENSE).
