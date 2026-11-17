# SMSPool Alternative for OTP Tests: Moving from the SMSPool API to HeroSMS

This guide is for teams whose end-to-end tests already buy numbers through the SMSPool API and who want to try HeroSMS as an SMSPool alternative without rewriting the suite. It maps each step a typical OTP test goes through: authentication, price checks without a key, buying a number, polling or webhooks, completing and cancelling, refunds and timeouts, and rentals. The last sections give you a small Python adapter that runs the same test against either provider, chosen by one environment variable, and a checklist for the switch.

Everything below was checked on 17 November 2026 against the SMSPool OpenAPI spec ([api.smspool.net/docs](https://api.smspool.net/docs)) and the HeroSMS OpenAPI docs (`hero-sms.com/api`). No API key was used and no number was bought; the purchase, status and cancel calls are written from the docs. If you are comparing sites like SMSPool more broadly, start with [Where SMSPool is stronger](#where-smspool-is-stronger).

## HeroSMS as an SMSPool alternative: what changes

| | SMSPool | HeroSMS |
|---|---|---|
| Base URL | `https://api.smspool.net` | `https://hero-sms.com/stubs/handler_api.php` (handler API, used here); `https://hero-sms.com/api/v1` (REST API) |
| Request style | Mostly POST with form fields (a JSON body also works) | GET, with the method name in `action=` |
| Auth | `Authorization: Bearer <key>`, or a `key` field in a POST body | `api_key` query parameter; the REST API takes `Authorization: ApiKey <key>` |
| IDs | Numeric country and service IDs | Numeric country IDs, short service codes such as `tg` |
| Errors | JSON with `success: 0`, a `message` and usually a `type` | HTTP 4xx with JSON `title` and `details`; some answers are bare strings such as `NO_NUMBERS` |
| Code delivery | Polling, or signed webhooks | Polling, or unsigned webhooks from two published IP addresses |
| Coverage in the API (17 Nov 2026) | 151 countries, 1,454 services | 195 countries, 813 service codes |

Two SMSPool features have no HeroSMS counterpart: the `Idempotency-Key` header for purchases and webhook signatures. The sections on refunds and webhooks explain what to do instead.

Coverage differs in both directions. SMSPool's service list has no Discord entry, and its Compliance page (November 2026 version) says designated higher-sensitivity services are only available after staff approve a written application that states your identity and intended use. HeroSMS lists Discord as `ds`, but it can also refuse a service (`403 SERVICE_NOT_AVAILABLE`), so check your target service and country in its catalog first.

## Endpoint mapping: SMSPool to HeroSMS

| Step | SMSPool | HeroSMS handler API (`?action=`) |
|---|---|---|
| Country list | `GET /country/retrieve_all` | `getCountries` |
| Service list | `GET /service/retrieve_all` | `getServicesList` |
| Prices without a key | `POST /request/pricing`, `POST /request/price` | Public catalog: `GET /api/v1/classifiers/services/{code}/countries` (not in the docs) |
| Balance | `POST /request/balance` returns `{"balance": "5.00"}` | `getBalance` returns `ACCESS_BALANCE:<amount>` |
| Buy a number | `POST /purchase/sms` | `getNumberV2` |
| Check one order | `POST /sms/check` | `getStatus` (`getStatusV2` returns JSON) |
| List open orders | `POST /request/active` | `getActiveActivations` |
| Ask for another SMS | `POST /sms/resend` | `setStatus` with `status=3` |
| Complete | No call needed | `finishActivation`, or `setStatus` with `status=6` |
| Cancel | `POST /sms/cancel` | `cancelActivation`, or `setStatus` with `status=8` |
| Push delivery | Webhook event `order.code` | Incoming-SMS webhook |
| Rent a number | `POST /purchase/rental` | `getRentNumber` |
| Read rental SMS | `POST /rental/retrieve_messages` | `getAllSms` |
| Extend a rental | `POST /rental/extend` | `prolong` (POST) |

On 17 November 2026, `getCountries` and `getServicesList` answered without a key; the price and purchase methods need one.

Purchase parameters map like this:

| SMSPool `/purchase/sms` | HeroSMS `getNumberV2` |
|---|---|
| `country`, `service` | `country` (ID) and `service` (code), both required |
| `max_price` | `maxPrice`; add `fixedPrice=true` to buy only at that price |
| `pool` | No pool parameter; the nearest filter is `operator`, with carrier codes from `getOperators` |
| `areacode` with `exclude=1` | `phoneException`: up to 20 number prefixes to skip |
| `quantity` (1 to 20) | One number per call; the REST purchase `POST /activations` takes `amount` from 1 to 10 |
| `Idempotency-Key` header | None |

### Country and service IDs

| Country | SMSPool | HeroSMS |
|---|---|---|
| United Kingdom | 2 | 16 |
| United States | 1 | 187 |
| Indonesia | 9 | 6 |
| Brazil | 68 | 73 |
| Nigeria | 14 | 19 |
| Vietnam | 11 | 10 |

| Service | SMSPool | HeroSMS |
|---|---|---|
| Telegram | 907 | `tg` |
| Google/Gmail | 395 (YouTube is 1227) | `go` (Google, YouTube and Gmail in one code) |
| TikTok | 924 | `lf` |
| Amazon | 39 | `am` |
| OpenAI | 671 | `dr` |
| Discord | Not listed | `ds` |
| Your own app (catch-all) | 817, "Not Listed / Other / Any" | `ot`, "Any other" |

For other countries and services, read both lists: the IDs come from `/country/retrieve_all` and `/service/retrieve_all` on SMSPool, and from `getCountries` and `getServicesList` on HeroSMS.

## Authentication and keys

SMSPool reads the key from an `Authorization: Bearer <key>` header or from a `key` field in a POST body, and its docs ask you to keep the key out of URLs. The HeroSMS handler API takes it as an `api_key` query parameter on every call. A request without it gets HTTP 422 with `"field": "api_key"` and `"code": "REQUIRED"`.

A key in a query string travels with the URL. With `requests`, the URL appears in the text of connection errors, in `HTTPError` messages and in urllib3's debug log. You have two options:

- Stay on the handler API, never print `response.url` or raw exceptions, and leave debug logging off in CI. The adapter below follows these rules.
- Use the HeroSMS REST API under `/api/v1`, where the key goes in an `Authorization: ApiKey <key>` header. It covers buying (`POST /activations`), completing (`POST /activations/{id}/finish`), cancelling (`DELETE /activations/{id}`) and reading the latest code (`GET /activations/{id}/otp/last`).

Store the key as `HEROSMS_API_KEY` in your CI secrets, next to `SMSPOOL_API_KEY` while you run both.

## Prices without an API key

Both providers let a pipeline read prices before it spends anything.

- **SMSPool** documents `POST /request/pricing` as keyless. You can filter it by `service`, `country`, `pool` or `max_price`; with no filter it returns the full catalog (about 20 MB, rebuilt hourly, with `ETag` support so an unchanged catalog comes back as `304`). `POST /request/price` returns one pair's price together with a `success_rate`.
- **HeroSMS** marks `getPrices` as deprecated in favor of `GET /api/v1/activations/offers/{verificationType}`, and both need a key. Without a key, the public catalog `GET /api/v1/classifiers/services/{code}/countries?page=N` lists 25 countries at a time. Each row has `price.minAvailable` and a `price.map` whose keys are the price tiers on offer right now. The endpoint isn't in the docs, so cache it and expect it to change.

```python
# prices.py: read listed prices from both providers, no API key needed
# (pip install requests)
import requests

ACCEPT = {"Accept": "application/json"}


def smspool_lowest(service_id, country_id):
    """Lowest pool price SMSPool lists for a service in a country."""
    r = requests.post("https://api.smspool.net/request/pricing",
                      data={"service": service_id, "country": country_id},
                      headers=ACCEPT, timeout=30)
    r.raise_for_status()
    rows = r.json()
    if isinstance(rows, dict):  # an error object instead of a price list
        raise RuntimeError(rows.get("message", "unexpected answer"))
    prices = [float(row["price"]) for row in rows
              if int(row["service"]) == service_id
              and int(row["country"]) == country_id]
    return min(prices, default=None)


def herosms_lowest_tier(service_code, country_id):
    """Lowest price tier in the HeroSMS public catalog (undocumented)."""
    url = ("https://hero-sms.com/api/v1/classifiers/services/"
           f"{service_code}/countries")
    page = 1
    while True:
        r = requests.get(url, params={"page": page}, headers=ACCEPT,
                         timeout=30)
        r.raise_for_status()
        body = r.json()
        for row in body["data"]:
            if row["country"] == country_id:
                tiers = [float(price) for price in row["price"].get("map", {})]
                return min(tiers, default=None)
        meta = body["meta"]
        if not body["data"] or page * meta["size"] >= meta["total"]:
            return None
        page += 1


# OpenAI numbers in the US: service 671 and country 1 on SMSPool,
# service "dr" and country 187 on HeroSMS
print(smspool_lowest(671, 1), herosms_lowest_tier("dr", 187))
```

The table shows listed prices in USD on 17 November 2026, read from HeroSMS at 16:03:05–16:03:14 UTC and from SMSPool at 16:03:14–16:04:20 UTC. SMSPool figures are the lowest price across its pools. HeroSMS figures are the lowest tier in `price.map`, which in four of these rows sits above `price.minAvailable`. The lower price is in bold.

| Service | Country | SMSPool | HeroSMS |
|---|---|---|---|
| Telegram | Indonesia | from $0.20 | **from $0.0383** |
| Telegram | UK | from $1.80 | **from $0.3586** |
| Telegram | US | from $0.60 | **from $0.3248** |
| Google/Gmail | UK | from $0.30 | **from $0.0569** |
| Google/Gmail | US | from $0.56 | **from $0.1125** |
| TikTok | Brazil | from $0.08 | **from $0.0158** |
| OpenAI | UK | from $0.47 | **from $0.0395** |
| OpenAI | US | **from $0.11** | from $0.2475 |
| Discord | UK | Not listed | from $0.0067 |

Across five services (Telegram, Google/Gmail, TikTok, Amazon and OpenAI) in six countries (the UK, the US, Brazil, Indonesia, Nigeria and Vietnam), HeroSMS listed the lower price in 29 of 30 pairs. SMSPool was lower for OpenAI numbers in the US, at $0.11 against $0.2475. Two earlier passes, at 15:33 and 15:40 UTC, gave the same split.

These are listed prices, not final charges. On SMSPool the price depends on the pool, and `/request/price` also returns a `high_price`. The HeroSMS website's price menu reads a different endpoint and can show other figures; for OpenAI in the US it showed from $0.165 at 16:07 UTC, still above SMSPool's $0.11. The exact HeroSMS charge for a pair is only known with a key (`activations/offers`) or a purchase. Prices on both sides change through the day, so fetch them at run time instead of hardcoding them.

## The order lifecycle: buy, wait, then close

Both APIs use the same three steps, but they handle the last one differently.

1. **Buy.** SMSPool's `/purchase/sms` returns `order_id`, `cc` and `phonenumber`, plus `expires_in` (seconds) and `expiration` (Unix time). HeroSMS's `getNumberV2` returns JSON with `activationId`, `phoneNumber` (without the `+`) and `activationEndTime` (RFC 3339). With nothing in stock, SMSPool answers HTTP 422 with `type: OUT_OF_STOCK`, while HeroSMS answers HTTP 200 with the bare string `NO_NUMBERS`, so check the body before you parse it as an order.
2. **Wait.** Poll `/sms/check` or `getStatus` every few seconds, or take the webhook described in the next section. For frequent polling, SMSPool's docs suggest `/request/active`, which lists all your orders at once, because `/sms/check` can hit rate limits.
3. **Close.** On SMSPool, an order that received its code is complete and needs no call. HeroSMS expects you to close the activation: `finishActivation` after a code arrives, or `cancelActivation` when the test gives up.

| State | SMSPool `/sms/check` | HeroSMS `getStatus` |
|---|---|---|
| Waiting for the SMS | `"status": 1`, with `time_left` | `STATUS_WAIT_CODE` |
| Code received | `"status": 3`, code in `sms`, full text in `full_sms` | `STATUS_OK:<code>` |
| Refunded or cancelled | `"status": 6`, "This order has been refunded" | `STATUS_CANCEL` |

SMSPool's docs show these three values as examples rather than a full list. HeroSMS also returns `STATUS_WAIT_RETRY:<code>` and `STATUS_WAIT_RESEND`; the adapter treats any value other than a code or a cancel as "still waiting" and relies on its own deadline.

## Webhooks instead of polling

Both providers can push codes to an HTTPS endpoint, so a test can wait for an event instead of polling. The two webhook contracts differ enough that your receiver needs changes.

| | SMSPool | HeroSMS |
|---|---|---|
| Where you set it | Settings → Developer | The account's personal information page, up to 3 URLs |
| Events | `order.code`; opt-in `order.status` (expired, refunded, cancelled); `rental.sms` and others | Incoming SMS only |
| Payload | `order_code`, `code`, `full_code`, `phonenumber`, `unix_timestamp` | `activationId`, `id`, `code`, `text`, `service`, `country`, `phoneFrom`, `receivedAt` |
| Authenticity | `X-SMSPool-Signature`: HMAC-SHA256 of `<t>.<raw body>` | No signature; requests come from `84.32.223.53` and `185.138.88.87` |
| Retries | Answer 2xx within 5 s; retried after 15, 45 and 90 s; a `410` stops them | Answer 200 within 3 s; at least 7 retries, 20 to 30 s apart, for at least 3 minutes |
| Duplicates | `X-SMSPool-Event-Id` stays the same across retries | Store codes by `activationId`, so a repeat overwrites the same entry |

When you move a receiver over:

- Replace the signature check with an allowlist for the two HeroSMS addresses, and put a long random segment in the hook path so a guessed URL gets a 404.
- The hook is set per account, so it sees SMS events from every parallel CI job. Route each event by `activationId`, ignore the ones that aren't yours, and still answer 200.
- `code` and `text` are both nullable in the schema, so handle a missing code without crashing.
- The HeroSMS docs describe no event for an expired or refunded order, so the test still needs its own deadline.

The repository's Playwright example, [examples/otp-webhook.spec.ts](../examples/otp-webhook.spec.ts), shows the `activationId` filter and the always-answer-200 rule inside a test runner.

## Refunds, timeouts and cancel rules

**SMSPool**

- `/sms/cancel` refunds an order that has no code (`"action": "refunded"`). An order that already has its code is only archived, without a refund (`"action": "archived"`). The call can also answer HTTP 400 with "Your order cannot be cancelled yet, please try again later."
- The SMSPool homepage says an order that gets no SMS within its window is refunded to your balance.
- Each order's window comes back as `expires_in`; the docs' example shows 1,200 seconds.

**HeroSMS**

- HeroSMS says an activation waits up to 20 minutes, with an automatic refund to your balance when no code comes (App Store description, checked 17 November 2026).
- Some pairs run longer. The keyless `GET /api/v1/classifiers/activations/custom-durations` listed 10 services with 40, 45 or 60 minutes on 17 November 2026, Telegram in two countries among them.
- A cancel can be refused with HTTP 409: `EARLY_CANCEL_DENIED` (the docs' example gives a 120-second minimum), `OTP_RECEIVED` (a code already arrived, so finish instead), `FREE_CANCELLATION_EXPIRED` (a 40-minute limit for activations that last 24 hours or more) or `ACTIVATION_NOT_ACTIVE`.

**What this means in CI**

- Take the deadline from the purchase answer (`expiration` or `activationEndTime`) instead of hardcoding 20 minutes.
- A test that fails within its first two minutes may see HeroSMS refuse the cancel. Log it and move on: HeroSMS says an activation that never gets a code is refunded when its window closes.
- On both services, cancelling won't refund a number that already delivered its code.
- Don't retry a HeroSMS purchase blindly after a timeout. There is no idempotency key, so the first request may already have bought a number; check `getActiveActivations` before you buy again.

## Rentals

SMSPool lists rentals without a key. `POST /rental/retrieve_all` with `type=1` returned six listings at 15:38 UTC on 17 November 2026. They include US numbers from $6 for one day (Provider 1: $12 for 7 days, $18 for 28) and UK numbers at $20 for 30 days, $40 for 180 and $55 for 360. You buy with `/purchase/rental` (`id`, `days`), read messages with `/rental/retrieve_messages`, extend with `/rental/extend` and refund with `/rental/refund`. According to the listing and the docs, a refund is possible within 2 hours of purchase and only if no message has arrived; five of the six listings also require a rental of 28 days or more.

HeroSMS rentals go through the same handler API:

- `getRentServicesAndCountries` (`country`, plus `duration` in hours) returns price and stock per service. Unlike SMSPool's listing, it needs a key.
- `getRentNumber` (`service`, `country`, `duration`) returns the same JSON fields as `getNumberV2`, with `subtype: 2` marking a rental. `getServicesList` also includes `full` ("Full rent"), which HeroSMS describes as a number that takes SMS from any service.
- Read messages with `getAllSms` (`id`), and extend with `prolong` (`id`, `duration`); `prolongOptions` returns the extension price first.
- Durations are in hours. The REST purchase schema lists 24 to 4,320 hours (1 to 180 days). HeroSMS's announcements cover 1-, 3- and 7-day rentals (1 August 2026) and 30- to 180-day UK rentals (24 August 2026).
- The closest thing to a rental refund term in the docs is the cancel rule for activations that last 24 hours or more (the 40-minute limit above), so confirm it with HeroSMS support before you automate rental cancellations.

## A Python adapter for both APIs

The adapter wraps both providers in the same four methods, `buy()`, `code()`, `finish()` and `cancel()`, plus a context manager that always closes the order. `OTP_PROVIDER=smspool` or `OTP_PROVIDER=herosms` picks the provider, so one test can run against both during the switch. This repository's main example is TypeScript with Playwright; the adapter is standalone Python for pytest suites.

```python
# otp_adapter.py: one interface over SMSPool and HeroSMS (pip install requests)
import json
import time
import uuid
from contextlib import contextmanager

import requests

# ISO code -> (SMSPool country ID, HeroSMS country ID)
COUNTRIES = {
    "GB": (2, 16),
    "US": (1, 187),
    "ID": (9, 6),
    "BR": (68, 73),
    "NG": (14, 19),
    "VN": (11, 10),
}

# name -> (SMSPool service ID, HeroSMS service code); None = not listed
SERVICES = {
    "telegram": (907, "tg"),
    "google": (395, "go"),  # SMSPool lists YouTube separately (1227)
    "tiktok": (924, "lf"),
    "amazon": (39, "am"),
    "openai": (671, "dr"),
    "discord": (None, "ds"),
    "other": (817, "ot"),  # catch-all, for testing your own app
}


class ProviderError(RuntimeError):
    pass


class SmsPool:
    name = "smspool"
    BASE = "https://api.smspool.net"

    def __init__(self, api_key):
        self.http = requests.Session()
        self.http.headers["Authorization"] = f"Bearer {api_key}"

    def _post(self, path, headers=None, **fields):
        r = self.http.post(self.BASE + path, data=fields, headers=headers,
                           timeout=20)
        try:
            body = r.json()
        except ValueError:
            raise ProviderError(f"SMSPool {path}: HTTP {r.status_code}")
        if isinstance(body, dict) and body.get("success") == 0:
            kind = body.get("type", "ERROR")  # e.g. OUT_OF_STOCK
            raise ProviderError(f"SMSPool {path}: {kind}")
        if r.status_code >= 400:
            raise ProviderError(f"SMSPool {path}: HTTP {r.status_code}")
        return body

    def buy(self, country, service):
        service_id = SERVICES[service][0]
        if service_id is None:
            raise ProviderError(f"SMSPool has no {service} numbers")
        # reusing the key on a retry returns the first order, not a new one
        headers = {"Idempotency-Key": str(uuid.uuid4())}
        fields = {"country": COUNTRIES[country][0], "service": service_id}
        try:
            order = self._post("/purchase/sms", headers, **fields)
        except (requests.Timeout, requests.ConnectionError):
            order = self._post("/purchase/sms", headers, **fields)
        return order["order_id"], f"+{order['cc']}{order['phonenumber']}"

    def code(self, order_id):
        order = self._post("/sms/check", orderid=order_id)
        if order.get("status") == 3 and order.get("sms"):
            return str(order["sms"])
        if order.get("status") == 6:
            raise ProviderError(f"SMSPool order {order_id} was refunded")
        return None  # status 1: still waiting

    def finish(self, order_id):
        pass  # nothing to call: an order that got its code is complete

    def cancel(self, order_id):
        # "action" in the answer is "refunded", or "archived" if a code came
        self._post("/sms/cancel", orderid=order_id)


class HeroSms:
    name = "herosms"
    BASE = "https://hero-sms.com/stubs/handler_api.php"

    def __init__(self, api_key):
        self.api_key = api_key
        self.http = requests.Session()

    def _get(self, action, **params):
        params.update(action=action, api_key=self.api_key)
        try:
            r = self.http.get(self.BASE, params=params, timeout=20)
        except requests.RequestException as exc:
            # the exception text contains the URL, and the URL has the key
            msg = f"HeroSMS {action}: {type(exc).__name__}"
            raise ProviderError(msg) from None
        if r.status_code >= 400:
            # errors are JSON: {"title": "NO_BALANCE", "details": ...}
            raise ProviderError(f"HeroSMS {action}: {r.status_code} "
                                f"{r.text[:160]}")
        return r.text.strip().strip('"')  # string answers may come quoted

    def buy(self, country, service):
        # no idempotency key here: after a timeout, look at
        # getActiveActivations before you buy again
        body = self._get("getNumberV2", country=COUNTRIES[country][1],
                         service=SERVICES[service][1])
        if not body.startswith("{"):
            raise ProviderError(f"HeroSMS getNumberV2: {body}")  # NO_NUMBERS
        order = json.loads(body)
        return str(order["activationId"]), f"+{order['phoneNumber']}"

    def code(self, order_id):
        status = self._get("getStatus", id=order_id)
        if status.startswith("STATUS_OK:"):
            return status.split(":", 1)[1]
        if status == "STATUS_CANCEL":
            raise ProviderError(f"HeroSMS activation {order_id} is canceled")
        return None  # STATUS_WAIT_CODE and the other STATUS_WAIT_* values

    def finish(self, order_id):
        self._get("finishActivation", id=order_id)  # = setStatus status=6

    def cancel(self, order_id):
        self._get("cancelActivation", id=order_id)  # = setStatus status=8


def wait_for_code(provider, order_id, timeout=300, every=5):
    deadline = time.monotonic() + timeout
    while True:
        code = provider.code(order_id)
        if code:
            return code
        if time.monotonic() + every > deadline:
            raise TimeoutError(f"{provider.name}: no SMS for {order_id}")
        time.sleep(every)


@contextmanager
def otp_number(provider, country, service):
    """Yield (phone, read_code); complete or cancel the order on exit."""
    order_id, phone = provider.buy(country, service)
    received = []

    def read_code(timeout=300):
        received.append(wait_for_code(provider, order_id, timeout))
        return received[-1]

    try:
        yield phone, read_code
    finally:
        try:
            if received:
                provider.finish(order_id)
            else:
                provider.cancel(order_id)
        except (ProviderError, requests.RequestException) as exc:
            # early cancels can be refused (HeroSMS 409 EARLY_CANCEL_DENIED,
            # SMSPool "cannot be cancelled yet"); both providers say the
            # cost of an order with no SMS returns to your balance
            print(f"cleanup skipped for {order_id}: {exc}")


def provider_from_env(env):
    if env.get("OTP_PROVIDER", "herosms") == "smspool":
        return SmsPool(env["SMSPOOL_API_KEY"])
    return HeroSms(env["HEROSMS_API_KEY"])
```

A test then looks like this:

```python
# test_signup.py (pytest): `app` is your own fixture, an API client
# or a page object for the app under test
import os

from otp_adapter import otp_number, provider_from_env


def test_signup_with_sms_code(app):
    provider = provider_from_env(os.environ)
    with otp_number(provider, "GB", "other") as (phone, read_code):
        app.request_otp(phone)
        app.submit_otp(read_code(timeout=300))
        assert app.is_signed_in()
```

The purchase, status and cancel calls follow both providers' docs as of 17 November 2026. They were tested offline against the response examples in those docs, not against live orders.

## Migration checklist

- [ ] Find every SMSPool call in the suite (search for `api.smspool.net`).
- [ ] Map country and service IDs with the tables above, or with `getCountries` and `getServicesList`.
- [ ] Add `HEROSMS_API_KEY` to CI secrets, and make sure no log prints handler API URLs.
- [ ] Replace the `/request/pricing` pre-check with the HeroSMS catalog call, cached.
- [ ] Switch purchases to `getNumberV2`, and handle both the bare `NO_NUMBERS` string and JSON errors with a `title`.
- [ ] Map the statuses, and call `finishActivation` after a successful test.
- [ ] Let cleanup tolerate HTTP 409 on cancel (`EARLY_CANCEL_DENIED`, `OTP_RECEIVED`).
- [ ] Drop automatic purchase retries, or check `getActiveActivations` before retrying.
- [ ] Rework the webhook receiver: IP allowlist and secret path instead of signature checks, routing by `activationId`, and a 200 within 3 seconds.
- [ ] Re-price rentals with `getRentServicesAndCountries`, with durations converted to hours.
- [ ] Before you parallelize, ask HeroSMS support for your concurrent purchase limit (exceeding it returns `403 CHANNELS_LIMIT`).
- [ ] Keep both providers in the nightly run for a week and compare delivery rates for your own app.
- [ ] Remove the SMSPool key from CI once the suite runs on HeroSMS alone.

## Where SMSPool is stronger

- **OpenAI numbers in the US:** from $0.11, against from $0.2475 at HeroSMS (17 November 2026).
- **Signed webhooks** with an event ID that survives retries, plus opt-in events for expired, refunded and cancelled orders and for rental SMS.
- **Safe purchase retries:** an `Idempotency-Key` makes a repeated buy return the first order; HeroSMS has nothing similar.
- **Keys can stay out of URLs** on every endpoint. On HeroSMS, only the REST API accepts the key in a header.
- **Rental prices and refund terms** come back from one keyless call; HeroSMS needs a key for rental prices.
- **More keyless data:** per-pair success rates from `/request/price`, and a stock endpoint documented at 20 requests a minute per IP (200 with a key).
- **Bigger purchase requests:** up to 20 numbers per call (10 on the HeroSMS REST API), area-code filters in both directions, and automatic country selection.
- **A larger catalog:** 1,454 services, against 813 HeroSMS service codes.

## Next step

HeroSMS fits as an SMSPool alternative if lower listed prices in most pairs, Discord numbers and 195 countries in the API matter more to your suite than the points above. To try it, generate an API key on the [HeroSMS website](https://hero-sms.com/?utm_source=gh&utm_medium=otpauto&utm_campaign=17112026) and run the adapter with `OTP_PROVIDER=herosms` next to your current setup. Only test apps that you own or have permission to test.

Sources, all checked on 17 November 2026: the SMSPool OpenAPI spec, keyless endpoints, homepage and Compliance page; the HeroSMS OpenAPI docs, keyless endpoints and App Store listing. The HeroSMS rental durations also come from its Telegram announcements of 1 and 24 August 2026.
