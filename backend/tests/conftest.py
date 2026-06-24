"""Shared fixtures and setup for backend tests."""
import asyncio
import json
import os
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv("/app/backend/.env")
load_dotenv("/app/frontend/.env")

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    BASE_URL = os.environ.get("EXPO_BACKEND_URL", "http://localhost:8001").rstrip("/")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]


@pytest.fixture(scope="session")
def base_url():
    return BASE_URL


@pytest.fixture(scope="session")
def creds():
    """Seed two TEST users (A=admin, B=non-admin) with controlled credits and sessions."""
    async def setup():
        client = AsyncIOMotorClient(MONGO_URL)
        db = client[DB_NAME]
        result = {}
        for key, email, name, is_admin, credits in [
            ("user_a", "TEST_userA@leo.ai", "Test User A", True, 10),
            ("user_b", "TEST_userB@leo.ai", "Test User B", False, 0),
        ]:
            existing = await db.users.find_one({"email": email}, {"_id": 0})
            if existing:
                user_id = existing["user_id"]
                await db.users.update_one(
                    {"user_id": user_id},
                    {"$set": {"is_admin": is_admin, "credits": credits, "name": name}},
                )
            else:
                user_id = f"user_{uuid.uuid4().hex[:12]}"
                await db.users.insert_one({
                    "user_id": user_id,
                    "email": email,
                    "name": name,
                    "picture": None,
                    "credits": credits,
                    "is_admin": is_admin,
                    "created_at": datetime.now(timezone.utc),
                    "last_login": datetime.now(timezone.utc),
                })
            # Clean prior sessions
            await db.user_sessions.delete_many({"user_id": user_id})
            token = f"test_{uuid.uuid4().hex}"
            await db.user_sessions.insert_one({
                "session_token": token,
                "user_id": user_id,
                "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
                "created_at": datetime.now(timezone.utc),
            })
            # Cleanup any prior TEST payments for this user
            await db.payments.delete_many({"user_id": user_id})
            result[key] = {"user_id": user_id, "token": token, "email": email, "is_admin": is_admin, "credits": credits}
        client.close()
        return result
    return asyncio.get_event_loop().run_until_complete(setup()) if False else asyncio.new_event_loop().run_until_complete(setup())


@pytest.fixture
def client_a(creds):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {creds['user_a']['token']}", "Content-Type": "application/json"})
    return s


@pytest.fixture
def client_b(creds):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {creds['user_b']['token']}", "Content-Type": "application/json"})
    return s


@pytest.fixture
def anon_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s
