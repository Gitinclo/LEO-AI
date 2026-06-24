"""Tests for wallet, UPI payments, Razorpay 503 fallback, admin approval flows, and credit deduction on /generate."""
import os
import asyncio
import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]


def _set_credits(user_id, n):
    async def go():
        c = AsyncIOMotorClient(MONGO_URL)
        await c[DB_NAME].users.update_one({"user_id": user_id}, {"$set": {"credits": n}})
        c.close()
    asyncio.new_event_loop().run_until_complete(go())


# ---------- Wallet ----------
class TestWallet:
    def test_wallet_shape(self, base_url, client_a):
        r = client_a.get(f"{base_url}/api/wallet")
        assert r.status_code == 200, r.text
        d = r.json()
        assert "credits" in d and isinstance(d["credits"], int)
        assert d["is_admin"] is True
        assert isinstance(d["plans"], list) and len(d["plans"]) == 3
        ids = {p["id"] for p in d["plans"]}
        assert ids == {"monthly", "topup_100", "topup_500"}
        assert d["rate"]["credits_per_inr"] == 1
        assert d["razorpay_enabled"] is False
        assert d["upi_enabled"] is True

    def test_wallet_non_admin_flag(self, base_url, client_b):
        r = client_b.get(f"{base_url}/api/wallet")
        assert r.status_code == 200
        assert r.json()["is_admin"] is False

    def test_wallet_unauthorized(self, base_url, anon_client):
        r = anon_client.get(f"{base_url}/api/wallet")
        assert r.status_code == 401


# ---------- Generate credit deduction ----------
class TestGenerateCredits:
    def test_generate_402_when_zero(self, base_url, client_b, creds):
        # user_b starts at 0 credits per fixture
        _set_credits(creds["user_b"]["user_id"], 0)
        r = client_b.post(f"{base_url}/api/generate", json={"mode": "svg", "prompt": "a star", "model": "gpt"})
        assert r.status_code == 402, f"expected 402 got {r.status_code}: {r.text}"
        # Verify credit NOT deducted (still 0)
        me = client_b.get(f"{base_url}/api/auth/me").json()
        assert me["credits"] == 0

    def test_generate_deducts_one(self, base_url, client_a, creds):
        _set_credits(creds["user_a"]["user_id"], 10)
        before = client_a.get(f"{base_url}/api/auth/me").json()["credits"]
        assert before == 10
        r = client_a.post(f"{base_url}/api/generate", json={"mode": "svg", "prompt": "red circle", "model": "gpt"}, timeout=120)
        # Tolerate occasional LLM 502; otherwise must be 200 and credit decremented
        if r.status_code == 502:
            after = client_a.get(f"{base_url}/api/auth/me").json()["credits"]
            assert after == before, f"credit not refunded on 502; before={before} after={after}"
            pytest.skip("LLM returned 502; refund verified instead.")
        assert r.status_code == 200, r.text
        body = r.json()
        assert "output" in body and body["output"]
        after = client_a.get(f"{base_url}/api/auth/me").json()["credits"]
        assert after == before - 1, f"expected {before-1} got {after}"


# ---------- UPI ----------
class TestUPI:
    def test_upi_intent_happy(self, base_url, client_a):
        r = client_a.post(f"{base_url}/api/payments/upi/intent", json={"amount_inr": 100})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["payment_id"].startswith("pay_upi_")
        assert d["upi_uri"].startswith("upi://pay?")
        assert d["upi_id"] == os.environ.get("MERCHANT_UPI_ID", "creatergame31@oksbi")
        assert d["credits"] == 100
        assert d["merchant_name"] == "LEO AI Studio"
        assert d["amount_inr"] == 100
        # upi_uri must include pa, am=100.00, tr=payment_id
        assert "pa=creatergame31%40oksbi" in d["upi_uri"]
        assert "am=100.00" in d["upi_uri"]
        assert f"tr={d['payment_id']}" in d["upi_uri"]

    def test_upi_intent_zero_rejected(self, base_url, client_a):
        r = client_a.post(f"{base_url}/api/payments/upi/intent", json={"amount_inr": 0})
        assert r.status_code == 422

    def test_upi_intent_negative_rejected(self, base_url, client_a):
        r = client_a.post(f"{base_url}/api/payments/upi/intent", json={"amount_inr": -50})
        assert r.status_code == 422

    def test_upi_submit_utr_happy(self, base_url, client_a):
        intent = client_a.post(f"{base_url}/api/payments/upi/intent", json={"amount_inr": 200}).json()
        pid = intent["payment_id"]
        r = client_a.post(f"{base_url}/api/payments/upi/submit-utr", json={"payment_id": pid, "utr": "ABC123456"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["status"] == "utr_submitted"
        # Verify status persisted via GET /api/payments/me
        mine = client_a.get(f"{base_url}/api/payments/me").json()["items"]
        rec = next(x for x in mine if x["payment_id"] == pid)
        assert rec["status"] == "utr_submitted"
        assert rec["utr"] == "ABC123456"

    def test_upi_submit_utr_cross_user_404(self, base_url, client_a, client_b, creds):
        # A creates intent
        _set_credits(creds["user_b"]["user_id"], 0)
        intent = client_a.post(f"{base_url}/api/payments/upi/intent", json={"amount_inr": 50}).json()
        # B tries to submit UTR -> 404
        r = client_b.post(f"{base_url}/api/payments/upi/submit-utr", json={"payment_id": intent["payment_id"], "utr": "OTHER1234"})
        assert r.status_code == 404, r.text

    def test_upi_submit_utr_short_422(self, base_url, client_a):
        intent = client_a.post(f"{base_url}/api/payments/upi/intent", json={"amount_inr": 25}).json()
        r = client_a.post(f"{base_url}/api/payments/upi/submit-utr", json={"payment_id": intent["payment_id"], "utr": "abc"})
        assert r.status_code == 422


# ---------- Razorpay 503 ----------
class TestRazorpay503:
    def test_order_503(self, base_url, client_a):
        r = client_a.post(f"{base_url}/api/payments/razorpay/order", json={"amount_inr": 500})
        assert r.status_code == 503, r.text

    def test_verify_503(self, base_url, client_a):
        r = client_a.post(f"{base_url}/api/payments/razorpay/verify", json={
            "payment_id": "pay_rzp_xxx",
            "rzp_order_id": "order_x",
            "rzp_payment_id": "pay_x",
            "rzp_signature": "sig",
        })
        assert r.status_code == 503, r.text


# ---------- Payments listing ----------
class TestPaymentsMe:
    def test_lists_user_payments(self, base_url, client_a):
        r = client_a.get(f"{base_url}/api/payments/me")
        assert r.status_code == 200
        items = r.json()["items"]
        assert isinstance(items, list)
        # Should contain at least our UPI intents from earlier tests
        assert any(x["method"] == "upi_intent" for x in items)


# ---------- Admin ----------
class TestAdmin:
    def test_pending_non_admin_403(self, base_url, client_b):
        r = client_b.get(f"{base_url}/api/admin/payments/pending")
        assert r.status_code == 403

    def test_pending_admin_200(self, base_url, client_a):
        r = client_a.get(f"{base_url}/api/admin/payments/pending")
        assert r.status_code == 200
        assert "items" in r.json()

    def test_approve_non_admin_403(self, base_url, client_a, client_b):
        intent = client_a.post(f"{base_url}/api/payments/upi/intent", json={"amount_inr": 30}).json()
        r = client_b.post(f"{base_url}/api/admin/payments/{intent['payment_id']}/approve")
        assert r.status_code == 403

    def test_reject_flow(self, base_url, client_a, client_b, creds):
        # Create intent as user_b (so we can check b's credits don't change)
        _set_credits(creds["user_b"]["user_id"], 0)
        intent = client_b.post(f"{base_url}/api/payments/upi/intent", json={"amount_inr": 77}).json()
        client_b.post(f"{base_url}/api/payments/upi/submit-utr", json={"payment_id": intent["payment_id"], "utr": "REJ123456"})
        before = client_b.get(f"{base_url}/api/auth/me").json()["credits"]
        r = client_a.post(f"{base_url}/api/admin/payments/{intent['payment_id']}/reject")
        assert r.status_code == 200, r.text
        # Verify status='rejected' via admin pending list absence + payments/me
        mine = client_b.get(f"{base_url}/api/payments/me").json()["items"]
        rec = next(x for x in mine if x["payment_id"] == intent["payment_id"])
        assert rec["status"] == "rejected"
        after = client_b.get(f"{base_url}/api/auth/me").json()["credits"]
        assert after == before, "credits must not change on reject"

    def test_approve_e2e_and_spend(self, base_url, client_a, client_b, creds):
        # End-to-end approve flow for user_b
        _set_credits(creds["user_b"]["user_id"], 0)
        before = client_b.get(f"{base_url}/api/auth/me").json()["credits"]
        intent = client_b.post(f"{base_url}/api/payments/upi/intent", json={"amount_inr": 50}).json()
        client_b.post(f"{base_url}/api/payments/upi/submit-utr", json={"payment_id": intent["payment_id"], "utr": "TEST123456"})
        r = client_a.post(f"{base_url}/api/admin/payments/{intent['payment_id']}/approve")
        assert r.status_code == 200, r.text
        assert r.json()["credits_added"] == 50
        # Verify user_b's balance via /api/auth/me
        after = client_b.get(f"{base_url}/api/auth/me").json()["credits"]
        assert after == before + 50, f"expected {before+50} got {after}"
        # Now spend one credit via /api/generate
        g = client_b.post(f"{base_url}/api/generate", json={"mode": "svg", "prompt": "blue square", "model": "gpt"}, timeout=120)
        # Tolerate LLM hiccup; ensure non-402 (since balance is positive)
        assert g.status_code != 402, f"expected positive balance to allow generate, got 402: {g.text}"
        bal = client_b.get(f"{base_url}/api/auth/me").json()["credits"]
        if g.status_code == 200:
            assert bal == after - 1
        else:
            # refund expected on 502
            assert bal == after

    def test_approve_404_unknown(self, base_url, client_a):
        r = client_a.post(f"{base_url}/api/admin/payments/pay_upi_does_not_exist/approve")
        assert r.status_code == 404
