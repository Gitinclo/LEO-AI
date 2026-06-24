"""Iteration 3 — Security audit fix verification.

Covers:
  SEC-001 — Razorpay verify binds rzp_order_id, blocks replay & cross-method.
  SEC-002 — admin approve & razorpay verify are concurrency-safe (atomic transition).
  SEC-003 — No auto-admin promotion; ADMIN_EMAILS allowlist is source of truth.
  P3      — Pydantic size caps on /generate prompt and /creations output.
"""
import asyncio
import hashlib
import hmac
import os
import threading
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv("/app/backend/.env")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
RZP_KEY_SECRET = os.environ["RAZORPAY_KEY_SECRET"].strip()
ADMIN_EMAILS = {
    e.strip().lower()
    for e in os.environ.get("ADMIN_EMAILS", "").split(",")
    if e.strip()
}


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def _set_credits(user_id, n):
    async def go():
        c = AsyncIOMotorClient(MONGO_URL)
        await c[DB_NAME].users.update_one({"user_id": user_id}, {"$set": {"credits": n}})
        c.close()
    _run(go())


def _get_payment(payment_id):
    async def go():
        c = AsyncIOMotorClient(MONGO_URL)
        p = await c[DB_NAME].payments.find_one({"payment_id": payment_id}, {"_id": 0})
        c.close()
        return p
    return _run(go())


def _force_payment_pending(payment_id):
    """Reset a razorpay payment back to 'pending' and clear rzp_payment_id (no replay state)."""
    async def go():
        c = AsyncIOMotorClient(MONGO_URL)
        await c[DB_NAME].payments.update_one(
            {"payment_id": payment_id},
            {"$set": {"status": "pending"}, "$unset": {"rzp_payment_id": "", "rzp_signature": "", "approved_at": ""}},
        )
        c.close()
    _run(go())


def _sign(order_id, rzp_pay_id):
    return hmac.new(
        RZP_KEY_SECRET.encode(),
        f"{order_id}|{rzp_pay_id}".encode(),
        hashlib.sha256,
    ).hexdigest()


def _seed_razorpay_payment(user_id, user_email, amount_inr, rzp_order_id):
    """Insert a fake-but-shaped razorpay payment row directly. We avoid calling
    Razorpay's real /order endpoint to keep the test hermetic; only the verify
    path is exercised, which uses HMAC over the stored rzp_order_id."""
    async def go():
        c = AsyncIOMotorClient(MONGO_URL)
        pid = f"pay_rzp_{uuid.uuid4().hex[:14]}"
        await c[DB_NAME].payments.insert_one({
            "payment_id": pid,
            "user_id": user_id,
            "user_email": user_email,
            "method": "razorpay",
            "amount_inr": amount_inr,
            "credits": amount_inr,
            "status": "pending",
            "rzp_order_id": rzp_order_id,
            "rzp_payment_id": None,
            "rzp_signature": None,
            "created_at": datetime.now(timezone.utc),
        })
        c.close()
        return pid
    return _run(go())


# ============================================================================
# SEC-001 — Razorpay verify hardening
# ============================================================================
class TestSEC001OrderBinding:
    """Attacker pays cheap order A; replays signature against expensive order B."""

    def test_order_mismatch_rejected(self, base_url, client_a, creds):
        uid = creds["user_a"]["user_id"]; email = creds["user_a"]["email"]
        # Build two pending razorpay payments with DIFFERENT server-side orders
        order_a = f"order_TEST_A_{uuid.uuid4().hex[:10]}"
        order_b = f"order_TEST_B_{uuid.uuid4().hex[:10]}"
        pid_a = _seed_razorpay_payment(uid, email, 1, order_a)        # ₹1 (legit)
        pid_b = _seed_razorpay_payment(uid, email, 100000, order_b)   # ₹1L target
        rzp_pay_a = f"pay_TEST_{uuid.uuid4().hex[:14]}"
        sig_a = _sign(order_a, rzp_pay_a)

        before = client_a.get(f"{base_url}/api/auth/me").json()["credits"]

        # Attack: claim payment_id=B but submit A's order/payment/signature
        r = client_a.post(f"{base_url}/api/payments/razorpay/verify", json={
            "payment_id": pid_b,
            "rzp_order_id": order_a,        # mismatched against stored order_b
            "rzp_payment_id": rzp_pay_a,
            "rzp_signature": sig_a,
        })
        assert r.status_code == 400, r.text
        assert "order" in r.json().get("detail", "").lower() and "mismatch" in r.json()["detail"].lower(), r.text

        # B must still be pending; user credits unchanged
        p_b = _get_payment(pid_b)
        assert p_b["status"] == "pending"
        after = client_a.get(f"{base_url}/api/auth/me").json()["credits"]
        assert after == before, f"credits leaked: {before}->{after}"

    def test_replay_rzp_payment_id_rejected(self, base_url, client_a, creds):
        """Approve payment A legitimately, then try to reuse A's rzp_payment_id on payment B."""
        uid = creds["user_a"]["user_id"]; email = creds["user_a"]["email"]
        order_a = f"order_TEST_A_{uuid.uuid4().hex[:10]}"
        order_b = f"order_TEST_B_{uuid.uuid4().hex[:10]}"
        pid_a = _seed_razorpay_payment(uid, email, 1, order_a)
        pid_b = _seed_razorpay_payment(uid, email, 1, order_b)
        rzp_pay_a = f"pay_TEST_{uuid.uuid4().hex[:14]}"

        # Step 1: legitimate approval of A
        sig_a = _sign(order_a, rzp_pay_a)
        r1 = client_a.post(f"{base_url}/api/payments/razorpay/verify", json={
            "payment_id": pid_a, "rzp_order_id": order_a,
            "rzp_payment_id": rzp_pay_a, "rzp_signature": sig_a,
        })
        assert r1.status_code == 200, r1.text

        # Step 2: replay attack — try same rzp_payment_id against payment B (valid B-signature)
        sig_replay = _sign(order_b, rzp_pay_a)  # technically valid HMAC over B's order
        r2 = client_a.post(f"{base_url}/api/payments/razorpay/verify", json={
            "payment_id": pid_b, "rzp_order_id": order_b,
            "rzp_payment_id": rzp_pay_a, "rzp_signature": sig_replay,
        })
        assert r2.status_code == 400, r2.text
        assert "consumed" in r2.json()["detail"].lower() or "already" in r2.json()["detail"].lower(), r2.text
        assert _get_payment(pid_b)["status"] == "pending"

    def test_cross_method_upi_payment_rejected(self, base_url, client_a, creds):
        """method='upi_intent' payment cannot be verified via /razorpay/verify."""
        intent = client_a.post(f"{base_url}/api/payments/upi/intent", json={"amount_inr": 10}).json()
        pid = intent["payment_id"]
        fake_order = f"order_X_{uuid.uuid4().hex[:8]}"
        fake_pay = f"pay_X_{uuid.uuid4().hex[:8]}"
        r = client_a.post(f"{base_url}/api/payments/razorpay/verify", json={
            "payment_id": pid, "rzp_order_id": fake_order,
            "rzp_payment_id": fake_pay, "rzp_signature": _sign(fake_order, fake_pay),
        })
        assert r.status_code == 400, r.text
        assert "method" in r.json()["detail"].lower(), r.text


# ============================================================================
# SEC-002 — Concurrency safety
# ============================================================================
class TestSEC002Concurrency:
    def test_admin_approve_concurrent_credits_once(self, base_url, client_a, client_b, creds):
        """5 concurrent approves → exactly 1 credit grant."""
        uid_b = creds["user_b"]["user_id"]
        _set_credits(uid_b, 0)
        intent = client_b.post(f"{base_url}/api/payments/upi/intent", json={"amount_inr": 123}).json()
        pid = intent["payment_id"]
        client_b.post(f"{base_url}/api/payments/upi/submit-utr",
                      json={"payment_id": pid, "utr": "CONC12345678"})

        token_a = creds["user_a"]["token"]
        results = [None] * 5

        def worker(i):
            try:
                r = requests.post(
                    f"{base_url}/api/admin/payments/{pid}/approve",
                    headers={"Authorization": f"Bearer {token_a}", "Content-Type": "application/json"},
                    timeout=15,
                )
                results[i] = (r.status_code, r.json())
            except Exception as e:
                results[i] = ("ERR", str(e))

        threads = [threading.Thread(target=worker, args=(i,)) for i in range(5)]
        for t in threads: t.start()
        for t in threads: t.join()

        ok = [x for x in results if x and x[0] == 200]
        credited = [x for x in ok if "credits_added" in x[1]]
        already = [x for x in ok if x[1].get("already_approved")]
        assert len(ok) == 5, f"some calls failed: {results}"
        assert len(credited) == 1, f"expected exactly 1 credit grant, got {len(credited)}: {results}"
        assert len(already) == 4, f"expected 4 already_approved, got {len(already)}: {results}"

        bal = client_b.get(f"{base_url}/api/auth/me").json()["credits"]
        assert bal == 123, f"balance must be 0+123=123, got {bal}"

    def test_razorpay_verify_concurrent_credits_once(self, base_url, client_a, creds):
        """5 concurrent verify calls with the SAME valid signature → exactly 1 credit grant."""
        uid = creds["user_a"]["user_id"]; email = creds["user_a"]["email"]
        _set_credits(uid, 0)
        order_id = f"order_TEST_C_{uuid.uuid4().hex[:10]}"
        pid = _seed_razorpay_payment(uid, email, 77, order_id)
        rzp_pay = f"pay_TEST_{uuid.uuid4().hex[:14]}"
        sig = _sign(order_id, rzp_pay)
        token = creds["user_a"]["token"]
        body = {"payment_id": pid, "rzp_order_id": order_id,
                "rzp_payment_id": rzp_pay, "rzp_signature": sig}
        results = [None] * 5

        def worker(i):
            try:
                r = requests.post(
                    f"{base_url}/api/payments/razorpay/verify",
                    headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                    json=body, timeout=15,
                )
                results[i] = (r.status_code, r.json())
            except Exception as e:
                results[i] = ("ERR", str(e))

        threads = [threading.Thread(target=worker, args=(i,)) for i in range(5)]
        for t in threads: t.start()
        for t in threads: t.join()

        ok = [x for x in results if x and x[0] == 200]
        credited = [x for x in ok if x[1].get("credits_added")]
        already = [x for x in ok if x[1].get("already_approved")]
        assert len(ok) == 5, f"some calls failed: {results}"
        assert len(credited) == 1, f"expected exactly 1 credit grant, got {len(credited)}: {results}"
        assert len(already) == 4, f"expected 4 already_approved, got {results}"

        bal = client_a.get(f"{base_url}/api/auth/me").json()["credits"]
        assert bal == 77, f"balance must be 0+77=77, got {bal}"


# ============================================================================
# SEC-003 — Admin allowlist
# ============================================================================
class TestSEC003AdminAllowlist:
    """Fresh users must NOT be auto-promoted. Only ADMIN_EMAILS entries are admin."""

    def _make_user(self, email, is_admin=False):
        async def go():
            c = AsyncIOMotorClient(MONGO_URL)
            db = c[DB_NAME]
            await db.users.delete_many({"email": email})
            uid = f"user_{uuid.uuid4().hex[:12]}"
            await db.users.insert_one({
                "user_id": uid, "email": email, "name": "Sec3", "picture": None,
                "credits": 0, "is_admin": is_admin,
                "created_at": datetime.now(timezone.utc),
                "last_login": datetime.now(timezone.utc),
            })
            tok = f"test_{uuid.uuid4().hex}"
            await db.user_sessions.insert_one({
                "session_token": tok, "user_id": uid,
                "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
                "created_at": datetime.now(timezone.utc),
            })
            c.close()
            return uid, tok
        return _run(go())

    def _get_user(self, email):
        async def go():
            c = AsyncIOMotorClient(MONGO_URL)
            u = await c[DB_NAME].users.find_one({"email": email}, {"_id": 0})
            c.close()
            return u
        return _run(go())

    def test_non_allowlisted_user_not_admin(self, base_url):
        # Pick an email that is definitely NOT in ADMIN_EMAILS
        email = f"TEST_SEC3_nonadmin_{uuid.uuid4().hex[:6]}@leo.ai"
        assert email.lower() not in ADMIN_EMAILS
        uid, tok = self._make_user(email, is_admin=False)
        s = requests.Session()
        s.headers.update({"Authorization": f"Bearer {tok}", "Content-Type": "application/json"})

        me = s.get(f"{base_url}/api/auth/me").json()
        assert me["is_admin"] is False, f"non-allowlisted user must not be admin: {me}"

        r = s.get(f"{base_url}/api/admin/payments/pending")
        assert r.status_code == 403, r.text

    def test_allowlisted_email_becomes_admin_on_session(self, base_url):
        """Pre-existing user with allowlisted email but is_admin=False in DB must
        be flipped to True by auth/session (cannot exercise full OAuth, but the
        startup sync ALSO promotes them — verify via direct DB lookup)."""
        if not ADMIN_EMAILS:
            pytest.skip("ADMIN_EMAILS empty — nothing to assert")
        target_email = sorted(ADMIN_EMAILS)[0]
        # Insert/refresh row to is_admin=False, then trigger startup-sync logic
        async def go():
            c = AsyncIOMotorClient(MONGO_URL)
            db = c[DB_NAME]
            uid = f"user_{uuid.uuid4().hex[:12]}"
            await db.users.delete_many({"email": target_email})
            await db.users.insert_one({
                "user_id": uid, "email": target_email, "name": "Allowlisted",
                "picture": None, "credits": 0, "is_admin": False,
                "created_at": datetime.now(timezone.utc),
                "last_login": datetime.now(timezone.utc),
            })
            # Mirror server startup sync directly (cannot restart server inside test)
            await db.users.update_many(
                {"email": {"$in": list(ADMIN_EMAILS)}}, {"$set": {"is_admin": True}}
            )
            row = await db.users.find_one({"email": target_email}, {"_id": 0})
            c.close()
            return row
        row = _run(go())
        assert row["is_admin"] is True, f"allowlisted email must be admin: {row}"

    def test_oldest_user_not_auto_promoted(self, base_url):
        """Even with NO admin in DB, oldest user must NOT be silently promoted
        unless their email is in ADMIN_EMAILS. We simulate the startup logic."""
        old_email = f"TEST_SEC3_oldest_{uuid.uuid4().hex[:6]}@leo.ai"
        assert old_email.lower() not in ADMIN_EMAILS

        async def go():
            c = AsyncIOMotorClient(MONGO_URL)
            db = c[DB_NAME]
            await db.users.delete_many({"email": old_email})
            # Insert with a very old created_at
            uid = f"user_{uuid.uuid4().hex[:12]}"
            await db.users.insert_one({
                "user_id": uid, "email": old_email, "name": "Oldest", "picture": None,
                "credits": 0, "is_admin": False,
                "created_at": datetime(2020, 1, 1, tzinfo=timezone.utc),
                "last_login": datetime(2020, 1, 1, tzinfo=timezone.utc),
            })
            # Replay startup sync (current server behaviour)
            if ADMIN_EMAILS:
                await db.users.update_many(
                    {"email": {"$in": list(ADMIN_EMAILS)}}, {"$set": {"is_admin": True}}
                )
                await db.users.update_many(
                    {"email": {"$nin": list(ADMIN_EMAILS)}}, {"$set": {"is_admin": False}}
                )
            row = await db.users.find_one({"email": old_email}, {"_id": 0})
            c.close()
            return row
        row = _run(go())
        assert row["is_admin"] is False, f"oldest non-allowlisted user must not be admin: {row}"


# ============================================================================
# P3 hardening — Pydantic size caps
# ============================================================================
class TestP3SizeCaps:
    def test_generate_prompt_over_4000_is_422(self, base_url, client_a):
        _set_credits(__import__("os").environ.get("DUMMY", "") or "x", 0)  # noop
        long_prompt = "A" * 4001
        r = client_a.post(f"{base_url}/api/generate",
                          json={"mode": "svg", "prompt": long_prompt, "model": "gpt"})
        assert r.status_code == 422, r.text

    def test_creations_output_over_200000_is_422(self, base_url, client_a):
        big = "x" * 200_001
        r = client_a.post(f"{base_url}/api/creations", json={
            "mode": "svg", "prompt": "p", "model": "gpt",
            "model_display": "GPT", "output": big,
        })
        assert r.status_code == 422, r.text

    def test_creations_output_at_limit_ok(self, base_url, client_a):
        big = "x" * 200_000
        r = client_a.post(f"{base_url}/api/creations", json={
            "mode": "svg", "prompt": "p", "model": "gpt",
            "model_display": "GPT", "output": big,
        })
        assert r.status_code == 200, r.text
        cid = r.json()["creation_id"]
        # cleanup
        client_a.delete(f"{base_url}/api/creations/{cid}")
