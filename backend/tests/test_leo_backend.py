"""LEO AI Studio — Backend API tests.
Covers: health, auth, /api/generate (5 modes × 3 LLMs sampled), gallery CRUD, per-user isolation.
Auth is exercised via pre-seeded sessions in MongoDB (see seed_test_users.py).
"""
import json
import os

import pytest
import requests

BASE_URL = "http://localhost:8001"

# Read seeded creds
with open("/tmp/leo_test_creds.json") as f:
    CREDS = json.load(f)

USER_A = CREDS["user_a"]
USER_B = CREDS["user_b"]
TOKEN_A = USER_A["token"]
TOKEN_B = USER_B["token"]


def H(token: str):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ---------------- Health ----------------
class TestHealth:
    def test_root_health(self):
        r = requests.get(f"{BASE_URL}/api/")
        assert r.status_code == 200
        body = r.json()
        assert body == {"service": "leo-ai", "status": "ok"}


# ---------------- Auth ----------------
class TestAuth:
    def test_me_no_token(self):
        r = requests.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 401

    def test_me_invalid_token(self):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=H("garbage_token_xyz"))
        assert r.status_code == 401

    def test_me_malformed_bearer(self):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": "NotBearer abc"})
        assert r.status_code == 401

    def test_me_valid_session(self):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=H(TOKEN_A))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["user_id"] == USER_A["user_id"]
        assert body["email"] == "TEST_userA@leo.ai"
        assert body["name"] == "Test User A"


# ---------------- Generate input validation ----------------
class TestGenerateValidation:
    def test_invalid_mode_returns_400(self):
        r = requests.post(
            f"{BASE_URL}/api/generate",
            headers=H(TOKEN_A),
            json={"mode": "xyz", "prompt": "hi", "model": "claude"},
        )
        assert r.status_code == 400
        assert "invalid mode" in r.text.lower()

    def test_invalid_model_returns_400(self):
        r = requests.post(
            f"{BASE_URL}/api/generate",
            headers=H(TOKEN_A),
            json={"mode": "scene", "prompt": "hi", "model": "foo"},
        )
        assert r.status_code == 400
        assert "invalid model" in r.text.lower()

    def test_generate_requires_auth(self):
        r = requests.post(
            f"{BASE_URL}/api/generate",
            json={"mode": "scene", "prompt": "hi", "model": "claude"},
        )
        assert r.status_code == 401


# ---------------- Generate × 5 modes × LLMs ----------------
# Each test asserts 200, parses JSON (or SVG markup), and validates schema.
GEN_TIMEOUT = 120  # LLM calls can be slow


def _post_generate(mode, prompt, model, token=TOKEN_A):
    return requests.post(
        f"{BASE_URL}/api/generate",
        headers=H(token),
        json={"mode": mode, "prompt": prompt, "model": model},
        timeout=GEN_TIMEOUT,
    )


class TestGenerateModes:
    def test_scene_claude(self):
        r = _post_generate("scene", "floating cubes over neon ocean", "claude")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["mode"] == "scene"
        assert body["model"] == "claude"
        assert body["model_display"] == "Claude Sonnet 4.5"
        parsed = json.loads(body["output"])
        assert isinstance(parsed.get("objects"), list)
        assert len(parsed["objects"]) > 0

    def test_svg_gemini(self):
        r = _post_generate("svg", "abstract bauhaus poster", "gemini")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["mode"] == "svg"
        assert body["model"] == "gemini"
        out = body["output"].lstrip()
        assert out.lower().startswith("<svg"), f"Output didn't start with <svg: {out[:120]}"

    def test_text_video_gpt(self):
        r = _post_generate("text_video", "wildfire poem", "gpt")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["model"] == "gpt"
        parsed = json.loads(body["output"])
        assert isinstance(parsed.get("frames"), list) and len(parsed["frames"]) > 0

    def test_audio_claude(self):
        r = _post_generate("audio", "ambient techno 110 bpm", "claude")
        assert r.status_code == 200, r.text
        body = r.json()
        parsed = json.loads(body["output"])
        assert isinstance(parsed.get("notes"), list) and len(parsed["notes"]) > 0

    def test_video_claude(self):
        r = _post_generate("video", "neo-noir chase", "claude")
        assert r.status_code == 200, r.text
        body = r.json()
        parsed = json.loads(body["output"])
        assert isinstance(parsed.get("tracks"), list) and len(parsed["tracks"]) > 0


# ---------------- Gallery CRUD + isolation ----------------
class TestGalleryCRUD:
    """Save → list → filter → delete → verify gone, with per-user isolation."""

    created_ids_a = []
    created_ids_b = []

    def test_01_create_scene_for_user_a(self):
        payload = {
            "mode": "scene",
            "prompt": "TEST scene",
            "model": "claude",
            "model_display": "Claude Sonnet 4.5",
            "output": '{"title":"TEST","objects":[]}',
            "title": "TEST scene A",
        }
        r = requests.post(f"{BASE_URL}/api/creations", headers=H(TOKEN_A), json=payload)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["creation_id"].startswith("crea_")
        assert body["user_id"] == USER_A["user_id"]
        assert body["mode"] == "scene"
        TestGalleryCRUD.created_ids_a.append(body["creation_id"])

    def test_02_create_svg_for_user_a(self):
        payload = {
            "mode": "svg",
            "prompt": "TEST svg",
            "model": "gemini",
            "model_display": "Gemini 3 Pro",
            "output": "<svg></svg>",
            "title": "TEST svg A",
        }
        r = requests.post(f"{BASE_URL}/api/creations", headers=H(TOKEN_A), json=payload)
        assert r.status_code == 200, r.text
        TestGalleryCRUD.created_ids_a.append(r.json()["creation_id"])

    def test_03_create_scene_for_user_b(self):
        payload = {
            "mode": "scene",
            "prompt": "TEST scene B",
            "model": "gpt",
            "model_display": "GPT-5.2",
            "output": '{"title":"B","objects":[]}',
            "title": "TEST scene B",
        }
        r = requests.post(f"{BASE_URL}/api/creations", headers=H(TOKEN_B), json=payload)
        assert r.status_code == 200, r.text
        TestGalleryCRUD.created_ids_b.append(r.json()["creation_id"])

    def test_04_list_user_a_creations(self):
        r = requests.get(f"{BASE_URL}/api/creations", headers=H(TOKEN_A))
        assert r.status_code == 200
        items = r.json()["items"]
        # All items must belong to user A
        for it in items:
            assert it["user_id"] == USER_A["user_id"]
        ids = {it["creation_id"] for it in items}
        for cid in TestGalleryCRUD.created_ids_a:
            assert cid in ids

    def test_05_list_filter_by_mode_scene(self):
        r = requests.get(f"{BASE_URL}/api/creations?mode=scene", headers=H(TOKEN_A))
        assert r.status_code == 200
        items = r.json()["items"]
        assert all(it["mode"] == "scene" for it in items)
        # Should include scene creation, exclude svg
        ids = {it["creation_id"] for it in items}
        assert TestGalleryCRUD.created_ids_a[0] in ids  # scene
        assert TestGalleryCRUD.created_ids_a[1] not in ids  # svg filtered out

    def test_06_cross_user_isolation(self):
        """User B's gallery must not contain any of user A's creations and vice-versa."""
        rb = requests.get(f"{BASE_URL}/api/creations", headers=H(TOKEN_B))
        assert rb.status_code == 200
        b_items = rb.json()["items"]
        b_ids = {it["creation_id"] for it in b_items}
        for cid in TestGalleryCRUD.created_ids_a:
            assert cid not in b_ids, f"User A's {cid} leaked into user B's gallery!"
        # User B must only see their own user_id
        for it in b_items:
            assert it["user_id"] == USER_B["user_id"]

        ra = requests.get(f"{BASE_URL}/api/creations", headers=H(TOKEN_A))
        a_ids = {it["creation_id"] for it in ra.json()["items"]}
        for cid in TestGalleryCRUD.created_ids_b:
            assert cid not in a_ids

    def test_07_delete_creation_and_verify_gone(self):
        cid = TestGalleryCRUD.created_ids_a[0]
        r = requests.delete(f"{BASE_URL}/api/creations/{cid}", headers=H(TOKEN_A))
        assert r.status_code == 200
        assert r.json() == {"ok": True}

        # GET list — should no longer contain cid
        r2 = requests.get(f"{BASE_URL}/api/creations", headers=H(TOKEN_A))
        ids = {it["creation_id"] for it in r2.json()["items"]}
        assert cid not in ids

    def test_08_delete_other_users_creation_returns_404(self):
        """User A trying to delete user B's creation must get 404 (scoped delete)."""
        cid_b = TestGalleryCRUD.created_ids_b[0]
        r = requests.delete(f"{BASE_URL}/api/creations/{cid_b}", headers=H(TOKEN_A))
        assert r.status_code == 404
        # Confirm it still exists for B
        r2 = requests.get(f"{BASE_URL}/api/creations", headers=H(TOKEN_B))
        ids = {it["creation_id"] for it in r2.json()["items"]}
        assert cid_b in ids

    def test_09_delete_nonexistent_creation(self):
        r = requests.delete(f"{BASE_URL}/api/creations/crea_doesnotexist", headers=H(TOKEN_A))
        assert r.status_code == 404

    def test_99_cleanup(self):
        """Cleanup remaining test creations."""
        for cid in TestGalleryCRUD.created_ids_a[1:]:
            requests.delete(f"{BASE_URL}/api/creations/{cid}", headers=H(TOKEN_A))
        for cid in TestGalleryCRUD.created_ids_b:
            requests.delete(f"{BASE_URL}/api/creations/{cid}", headers=H(TOKEN_B))
