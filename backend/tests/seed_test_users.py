"""Seed two TEST users + sessions directly in MongoDB for backend testing."""
import asyncio
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv("/app/backend/.env")
client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = client[os.environ["DB_NAME"]]


async def seed_user(email: str, name: str):
    # Remove any existing TEST_ user to keep idempotent
    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one(
            {
                "user_id": user_id,
                "email": email,
                "name": name,
                "picture": None,
                "created_at": datetime.now(timezone.utc),
                "last_login": datetime.now(timezone.utc),
            }
        )
    token = f"test_{uuid.uuid4().hex}"
    await db.user_sessions.insert_one(
        {
            "session_token": token,
            "user_id": user_id,
            "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
            "created_at": datetime.now(timezone.utc),
        }
    )
    return user_id, token


async def main():
    u1_id, u1_tok = await seed_user("TEST_userA@leo.ai", "Test User A")
    u2_id, u2_tok = await seed_user("TEST_userB@leo.ai", "Test User B")
    # Clean up any prior creations belonging to these users
    await db.creations.delete_many({"user_id": {"$in": [u1_id, u2_id]}})
    out = {
        "user_a": {"user_id": u1_id, "token": u1_tok},
        "user_b": {"user_id": u2_id, "token": u2_tok},
    }
    print(out)
    # Write to a file the tests can read
    import json
    with open("/tmp/leo_test_creds.json", "w") as f:
        json.dump(out, f)


if __name__ == "__main__":
    asyncio.run(main())
    sys.exit(0)
