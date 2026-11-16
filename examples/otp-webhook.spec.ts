import { test, expect } from '@playwright/test';
import axios from 'axios';
import http from 'http';

// --- Type Definitions (per https://hero-sms.com/api) ---
interface HeroSmsActivation {
  activationId: string | number;
  phoneNumber: string;
  activationCost: number;
  activationEndTime: string;
  canGetAnotherSms: boolean;
}

interface HeroSmsWebhookPayload {
  activationId: string | number;
  service: string;
  text: string | null;
  code?: string | null;
  country: number;
  receivedAt: string;
}

// HeroSMS handler_api endpoint (docs: https://hero-sms.com/api)
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
        if (payload.code && String(payload.activationId) === expectedActivationId) {
          resolveWebhook(payload.code);
        }

        // ACK every well-formed delivery with 200 (other activations included):
        // otherwise HeroSMS retries the delivery
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

    // 4. Rent a number that can receive SMS: GET ?action=getNumberV2
    const { data } = await axios.get<HeroSmsActivation | string>(HEROSMS_API_URL, {
      params: {
        api_key: HEROSMS_API_KEY,
        action: 'getNumberV2',
        service: 'ot', // 'ot' = Any other, for testing your own app (codes: ?action=getServicesList)
        country: 6     // demo value: use the country ID you test (?action=getCountries)
      }
    });

    // On failure the gateway answers with a bare string ("NO_NUMBERS"); BAD_KEY/NO_BALANCE come as JSON with HTTP 4xx and make axios throw
    expect(typeof data, `Gateway returned "${data}" instead of an activation object`).toBe('object');
    const activation = data as HeroSmsActivation;

    expectedActivationId = String(activation.activationId);
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
    // 10. Teardown: try to cancel the rented number (status 8) if the test
    // failed before completing the activation. A cancel within the first
    // ~2 minutes can be refused (EARLY_CANCEL_DENIED) and is ignored here;
    // an activation that never receives an SMS is refunded to the HeroSMS
    // balance when it expires
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
