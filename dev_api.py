"""LOCAL DEVELOPMENT reward backend.

WHY THIS EXISTS
---------------
The shipped backend is `api/*.mjs` (Vercel Functions) talking to Supabase
through row-locked RPCs in `supabase/schema.sql`. Neither is reachable from a
laptop with no Supabase project, so `server.py` — a static file server — answered
every `/api/*` call with a 404. The client did exactly what it should with that:
refused to invent a reward, and said so. The player saw "Rewards are not
available in this build" on every single win.

That is a correct client talking to an absent server. The fix is a server.

WHAT THIS IS, AND IS NOT
------------------------
This mirrors the WIRE CONTRACT of `api/start-run.mjs` and `api/submit-run.mjs`
exactly, so the client code under test is the real client code, and the flow a
developer sees locally is the flow a player gets in production.

It is NOT the production backend and must never become it:

  * state is in memory and dies with the process;
  * there is no row locking, because there is one process and one lock;
  * `settings` are constants here, not a table.

`dist/` never contains it, `vercel.json` never routes to it, and it is only
ever imported by `server.py`, which is the dev server.

WHAT IT KEEPS HONEST
--------------------
The security properties that the client depends on are real here, because a
dev backend that fakes them would hide exactly the bugs this project cares
about:

  * The prize is drawn SERVER-SIDE, from the campaign manifest's weights.
  * The coupon is minted SERVER-SIDE with `secrets` — a CSPRNG, never
    `random` — and is single-use and unique.
  * Survival is RE-DERIVED here from the reported duration. The client's
    `survived` claim is read and ignored.
  * The round token is one-time: replaying it returns `invalid_token`, the
    same 409 the real endpoint returns.

The OTP is real too: generated with `secrets`, held server-side, compared
server-side, expiring, attempt-limited. It is ECHOED in the response only
because this is a local dev server with no SMS gateway — see `_otp_echo`.
"""

import json
import os
import secrets
import time
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))

# Unambiguous when read aloud at a counter: no I, O, 0 or 1. Matches
# mint_coupon_code() in supabase/schema.sql so codes look identical in dev.
COUPON_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

# Mirrors the `settings` table the real endpoints read.
SETTINGS = {
    "round_time_sec": 30,
    "survival_tolerance": 0.95,
    "min_run_ms": 5000,
    "max_plausible_score": 2_000_000,
    "otp_ttl_sec": 300,
    "otp_max_attempts": 5,
}


def _load_prizes():
    """Prize table + threshold from the campaign manifest — one source of truth.

    The manifest is what CI validates and what the real `submit-run` reads, so
    a prize added there shows up here without a code change.
    """
    path = os.path.join(HERE, "campaigns", "mcdonalds.json")
    try:
        with open(path, encoding="utf-8") as fh:
            rewards = json.load(fh).get("rewards", {})
        prizes = rewards.get("prizes") or []
        if prizes:
            return prizes, int(rewards.get("pointsThreshold", 4000))
    except (OSError, ValueError) as exc:  # pragma: no cover - dev convenience
        print(f"[dev-api] could not read campaign manifest ({exc}); using fallback")
    return [{"key": "fries", "label": "Free Fries", "weight": 1}], 4000


PRIZES, POINTS_THRESHOLD = _load_prizes()


class Store:
    """Everything the dev backend remembers. In memory, on purpose."""

    def __init__(self):
        self.players = {}       # e164 -> player dict
        self.runs = {}          # token -> run dict
        self.coupons = {}       # code  -> coupon dict
        self.otps = {}          # e164  -> otp dict


STORE = Store()


# ---- helpers ---------------------------------------------------------------


def _now():
    return time.time()


def normalize_phone(cc, phone):
    """Same rule as lib/db.mjs: digits only, 6-13 long, joined to the country code."""
    digits = "".join(ch for ch in str(phone or "") if ch.isdigit())
    code = str(cc or "").strip()
    if not code.startswith("+") or not (6 <= len(digits) <= 13):
        return False, None
    return True, f"{code}{digits}"


def _player(e164, cc=None):
    p = STORE.players.get(e164)
    if not p:
        p = {
            "id": str(uuid.uuid4()),
            "phone": e164,
            "country_code": cc,
            # Enough to be eligible immediately: a dev with no POS webhook
            # cannot earn order points, and a backend that can never pay out
            # is the problem this file exists to solve.
            "order_points": 4200,
            "high_score": 0,
            "games": 0,
            "verified": False,
            "device_token": str(uuid.uuid4()),
        }
        STORE.players[e164] = p
    if cc:
        p["country_code"] = cc
    return p


def mint_coupon_code(prefix="MC"):
    """A single-use coupon code, from a CSPRNG, unique across the store.

    `secrets`, never `random`: a coupon is a bearer token with real cash value,
    and Mersenne Twister output is reconstructable from observed draws.
    """
    for _ in range(12):
        body = "".join(secrets.choice(COUPON_ALPHABET) for _ in range(8))
        code = f"{prefix}-{body[:4]}-{body[4:]}"
        if code not in STORE.coupons:
            return code
    raise RuntimeError("mint_coupon_code: could not find a free code")


def draw_prize():
    """Weighted draw over the manifest's prizes, using the CSPRNG.

    Resolution of 1e6 keeps the 0.2% weight meaningful as an integer draw.
    """
    total = sum(float(p.get("weight", 0)) for p in PRIZES)
    if total <= 0:
        return PRIZES[0]
    roll = secrets.randbelow(1_000_000) / 1_000_000 * total
    acc = 0.0
    for p in PRIZES:
        acc += float(p.get("weight", 0))
        if roll < acc:
            return p
    return PRIZES[-1]


def _otp_echo():
    """Should the response carry the OTP itself?

    There is no SMS gateway on a laptop, so without this a developer could
    never complete sign-in. It is confined to this file — the shipped
    `api/register.mjs` has no such path — and can be switched off with
    DEV_OTP_ECHO=0 to exercise the real "check your phone" flow against the
    code printed on the server's stdout.
    """
    return os.environ.get("DEV_OTP_ECHO", "1") == "1"


# ---- endpoints -------------------------------------------------------------


def register(body):
    cc, phone = body.get("cc"), body.get("phone")
    if not body.get("consent"):
        return 400, {"ok": False, "error": "consent_required"}
    valid, e164 = normalize_phone(cc, phone)
    if not valid:
        return 400, {"ok": False, "error": "invalid_phone"}

    p = _player(e164, cc)
    return 200, {
        "ok": True,
        "playerId": p["id"],
        "deviceToken": p["device_token"],
        "verified": p["verified"],
        "profile": {
            "orderPoints": p["order_points"],
            "highScore": p["high_score"],
            "games": p["games"],
        },
    }


def send_otp(body):
    """Issue a one-time code. Server-generated, server-held, time-limited."""
    cc, phone = body.get("cc"), body.get("phone")
    valid, e164 = normalize_phone(cc, phone)
    if not valid:
        return 400, {"ok": False, "error": "invalid_phone"}

    existing = STORE.otps.get(e164)
    # Crude resend throttle: enough to make the button honest about it.
    if existing and _now() - existing["sent_at"] < 20:
        wait = int(20 - (_now() - existing["sent_at"]))
        return 429, {"ok": False, "error": "rate_limited", "retryAfter": wait}

    code = f"{secrets.randbelow(1_000_000):06d}"
    STORE.otps[e164] = {
        "code": code,
        "sent_at": _now(),
        "expires_at": _now() + SETTINGS["otp_ttl_sec"],
        "attempts": 0,
    }
    print(f"[dev-api] OTP for {e164}: {code}  (expires in {SETTINGS['otp_ttl_sec']}s)")

    out = {"ok": True, "sent": True, "expiresIn": SETTINGS["otp_ttl_sec"]}
    if _otp_echo():
        out["devCode"] = code
    return 200, out


def verify_otp(body):
    cc, phone, code = body.get("cc"), body.get("phone"), str(body.get("code") or "")
    valid, e164 = normalize_phone(cc, phone)
    if not valid:
        return 400, {"ok": False, "error": "invalid_phone"}

    rec = STORE.otps.get(e164)
    if not rec:
        return 400, {"ok": False, "error": "no_code_sent"}
    if _now() > rec["expires_at"]:
        STORE.otps.pop(e164, None)
        return 400, {"ok": False, "error": "code_expired"}

    rec["attempts"] += 1
    if rec["attempts"] > SETTINGS["otp_max_attempts"]:
        STORE.otps.pop(e164, None)
        return 429, {"ok": False, "error": "too_many_attempts"}

    # compare_digest so a wrong code cannot be found one character at a time.
    if not secrets.compare_digest(code, rec["code"]):
        return 400, {"ok": False, "error": "code_incorrect",
                     "attemptsLeft": SETTINGS["otp_max_attempts"] - rec["attempts"]}

    STORE.otps.pop(e164, None)
    p = _player(e164, cc)
    p["verified"] = True
    return 200, {
        "ok": True,
        "verified": True,
        "playerId": p["id"],
        "deviceToken": p["device_token"],
        "profile": {
            "orderPoints": p["order_points"],
            "highScore": p["high_score"],
            "games": p["games"],
        },
    }


def start_run(body):
    cc, phone, device = body.get("cc"), body.get("phone"), body.get("device")
    valid, e164 = normalize_phone(cc, phone)
    if not valid:
        return 400, {"ok": False, "error": "invalid_phone"}
    if not device:
        return 400, {"ok": False, "error": "device_required"}

    p = _player(e164, cc)
    token = str(uuid.uuid4())
    STORE.runs[token] = {
        "player": e164,
        "device": device,
        "started_at": _now(),
        "consumed": False,
    }
    return 200, {"ok": True, "granted": True, "token": token, "playsLeft": 99}


def submit_run(body):
    token = body.get("token")
    score = int(body.get("score") or 0)
    duration_ms = int(body.get("durationMs") or 0)

    run = STORE.runs.get(token)
    # One token, one submission — a replay is the same 409 the real endpoint
    # returns, so the client's session handling is exercised for real.
    if not run or run["consumed"]:
        return 409, {"ok": False, "error": "invalid_token"}
    run["consumed"] = True

    p = STORE.players[run["player"]]
    p["games"] += 1
    p["high_score"] = max(p["high_score"], score)

    wheel = [{"key": x["key"], "label": x["label"]} for x in PRIZES]

    # Survival is the SERVER's call, re-derived from the duration it was told.
    # The client's `survived` flag is deliberately not read.
    required_ms = SETTINGS["round_time_sec"] * 1000 * SETTINGS["survival_tolerance"]
    survived = duration_ms >= required_ms

    suspicious = (
        duration_ms < SETTINGS["min_run_ms"] or score > SETTINGS["max_plausible_score"]
    )

    base = {
        "ok": True,
        "survived": survived,
        "wheel": wheel,
        "orderPoints": p["order_points"],
        "pointsThreshold": POINTS_THRESHOLD,
    }

    if suspicious:
        return 200, {**base, "won": False, "suspicious": True}
    if not survived:
        return 200, {**base, "won": False, "gap": int(required_ms - duration_ms)}
    if p["order_points"] < POINTS_THRESHOLD:
        return 200, {**base, "won": False}

    # Eligible and survived: draw, mint and record together, so a code can
    # never exist without a win behind it.
    prize = draw_prize()
    code = mint_coupon_code()
    expires_at = _now() + 7 * 24 * 3600
    STORE.coupons[code] = {
        "player": run["player"],
        "prize_key": prize["key"],
        "prize_label": prize["label"],
        "issued_at": _now(),
        "expires_at": expires_at,
        "redeemed_at": None,
    }
    p["order_points"] -= POINTS_THRESHOLD  # the wheel SPENDS the points

    prize_index = next((i for i, w in enumerate(wheel) if w["key"] == prize["key"]), 0)
    return 200, {
        **base,
        "won": True,
        "prize": {"key": prize["key"], "label": prize["label"]},
        "prizeIndex": prize_index,
        "code": code,
        "expiresAt": int(expires_at * 1000),
        "orderPoints": p["order_points"],
    }


def wallet(body):
    """Coupons this player holds, newest first — real status, not a mock."""
    valid, e164 = normalize_phone(body.get("cc"), body.get("phone"))
    if not valid:
        return 400, {"ok": False, "error": "invalid_phone"}
    items = [
        {
            "code": code,
            "prize": {"key": c["prize_key"], "label": c["prize_label"]},
            "issuedAt": int(c["issued_at"] * 1000),
            "expiresAt": int(c["expires_at"] * 1000),
            "redeemedAt": int(c["redeemed_at"] * 1000) if c["redeemed_at"] else None,
            "status": _coupon_status(c),
        }
        for code, c in STORE.coupons.items()
        if c["player"] == e164
    ]
    items.sort(key=lambda i: i["issuedAt"], reverse=True)
    p = STORE.players.get(e164)
    return 200, {
        "ok": True,
        "items": items,
        "orderPoints": p["order_points"] if p else 0,
        "pointsThreshold": POINTS_THRESHOLD,
    }


def _coupon_status(c):
    if c["redeemed_at"]:
        return "redeemed"
    if _now() > c["expires_at"]:
        return "expired"
    return "active"


def redeem(body):
    """Burn a coupon. Single-use is enforced here, not in the browser."""
    code = str(body.get("code") or "").strip().upper()
    c = STORE.coupons.get(code)
    if not c:
        return 404, {"ok": False, "error": "unknown_code"}
    if c["redeemed_at"]:
        return 409, {"ok": False, "error": "already_redeemed",
                     "redeemedAt": int(c["redeemed_at"] * 1000)}
    if _now() > c["expires_at"]:
        return 409, {"ok": False, "error": "expired"}
    c["redeemed_at"] = _now()
    return 200, {"ok": True, "status": "redeemed", "redeemedAt": int(c["redeemed_at"] * 1000)}


def pos_credit(body):
    """Credit order points, the way the Foodics POS webhook does in production.

    The wheel SPENDS points, so without this the earn-and-spend loop only runs
    one way and a dev sees a real win exactly once before falling below the
    threshold forever. Idempotent on the order id, matching
    `points_ledger_order_uniq` — replaying a webhook must not pay twice.
    """
    valid, e164 = normalize_phone(body.get("cc"), body.get("phone"))
    if not valid:
        return 400, {"ok": False, "error": "invalid_phone"}
    order_id = str(body.get("orderId") or "").strip()
    if not order_id:
        return 400, {"ok": False, "error": "order_id_required"}
    points = int(body.get("points") or 0)
    if points <= 0:
        return 400, {"ok": False, "error": "invalid_points"}

    p = _player(e164)
    ledger = p.setdefault("ledger", {})
    if order_id in ledger:
        return 200, {"ok": True, "duplicate": True, "orderPoints": p["order_points"]}
    ledger[order_id] = points
    p["order_points"] += points
    return 200, {"ok": True, "credited": points, "orderPoints": p["order_points"]}


ROUTES = {
    "/api/pos-credit": pos_credit,
    "/api/register": register,
    "/api/send-otp": send_otp,
    "/api/verify-otp": verify_otp,
    "/api/start-run": start_run,
    "/api/submit-run": submit_run,
    "/api/wallet": wallet,
    "/api/redeem": redeem,
}


def handle(path, raw_body):
    """Dispatch one POST. Returns (status, payload) or None if not an API path."""
    fn = ROUTES.get(path)
    if not fn:
        return None
    try:
        body = json.loads(raw_body or b"{}")
    except ValueError:
        return 400, {"ok": False, "error": "bad_json"}
    if not isinstance(body, dict):
        return 400, {"ok": False, "error": "bad_json"}
    try:
        return fn(body)
    except Exception as exc:  # pragma: no cover - dev convenience
        print(f"[dev-api] {path} failed: {exc!r}")
        return 500, {"ok": False, "error": "server_error"}
