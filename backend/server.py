"""LEO AI Studio — Backend
Endpoints:
  - Auth: POST /api/auth/session, GET /api/auth/me, POST /api/auth/logout
  - LLM:  POST /api/generate
  - Gallery: GET/POST/DELETE /api/creations
"""
import logging
import os
import re
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import httpx
from dotenv import load_dotenv
from fastapi import APIRouter, FastAPI, Header, HTTPException, Request
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field
from starlette.middleware.cors import CORSMiddleware

from emergentintegrations.llm.chat import LlmChat, UserMessage

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
EMERGENT_LLM_KEY = os.environ["EMERGENT_LLM_KEY"]

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

app = FastAPI(title="LEO AI Studio")
api = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("leo.ai")


# ---------- Startup: indexes ----------
@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("user_id", unique=True)
    await db.user_sessions.create_index("session_token", unique=True)
    await db.user_sessions.create_index("user_id")
    await db.user_sessions.create_index("expires_at", expireAfterSeconds=0)
    await db.creations.create_index("user_id")
    await db.creations.create_index("created_at")
    logger.info("Indexes ready")


@app.on_event("shutdown")
async def shutdown():
    client.close()


# ---------- Auth helpers ----------
async def get_current_user(authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="missing token")
    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(status_code=401, detail="invalid token")
    sess = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not sess:
        raise HTTPException(status_code=401, detail="session not found")
    exp = sess["expires_at"]
    if exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)
    if exp < datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="session expired")
    user = await db.users.find_one({"user_id": sess["user_id"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="user not found")
    return user


# ---------- Auth models ----------
class SessionRequest(BaseModel):
    session_id: str


class PublicUser(BaseModel):
    user_id: str
    email: str
    name: str
    picture: Optional[str] = None


@api.post("/auth/session")
async def auth_session(req: SessionRequest):
    """Exchange Emergent session_id for our session_token + persist user."""
    if not req.session_id:
        raise HTTPException(status_code=400, detail="session_id required")
    async with httpx.AsyncClient(timeout=20) as hc:
        r = await hc.get(
            "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
            headers={"X-Session-ID": req.session_id},
        )
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail=f"oauth verify failed: {r.text}")
    data = r.json()
    email = data["email"]
    name = data.get("name") or email.split("@")[0]
    picture = data.get("picture")
    session_token = data["session_token"]

    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
        await db.users.update_one(
            {"user_id": user_id},
            {"$set": {"name": name, "picture": picture, "last_login": datetime.now(timezone.utc)}},
        )
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one(
            {
                "user_id": user_id,
                "email": email,
                "name": name,
                "picture": picture,
                "created_at": datetime.now(timezone.utc),
                "last_login": datetime.now(timezone.utc),
            }
        )

    expires_at = datetime.now(timezone.utc) + timedelta(days=7)
    await db.user_sessions.update_one(
        {"session_token": session_token},
        {
            "$set": {
                "session_token": session_token,
                "user_id": user_id,
                "expires_at": expires_at,
                "created_at": datetime.now(timezone.utc),
            }
        },
        upsert=True,
    )
    return {
        "session_token": session_token,
        "user": {"user_id": user_id, "email": email, "name": name, "picture": picture},
    }


@api.get("/auth/me", response_model=PublicUser)
async def auth_me(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    return PublicUser(
        user_id=user["user_id"],
        email=user["email"],
        name=user["name"],
        picture=user.get("picture"),
    )


@api.post("/auth/logout")
async def auth_logout(authorization: Optional[str] = Header(None)):
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1].strip()
        await db.user_sessions.delete_one({"session_token": token})
    return {"ok": True}


# ---------- LLM Generation ----------
MODE_SYSTEMS = {
    "scene": (
        "You are LEO, a generative 3D scene engine. Output ONLY a strict JSON object (no markdown, no prose) "
        "describing a stylized 3D-feeling scene. Schema: "
        '{"title": str, "background": "#hex", "objects": [{"type": "sphere|cube|ring|triangle|line", '
        '"x": 0-100, "y": 0-100, "size": 5-40, "color": "#hex", "rotation": 0-360}], "ambience": str}. '
        "Generate 6-14 visually interesting objects. Coords are percentages (0-100). Keep palette cohesive."
    ),
    "video": (
        "You are LEO, a generative timeline sequencer. Output ONLY a JSON object (no markdown). Schema: "
        '{"title": str, "duration_s": 6-30, "tracks": [{"name": str, "clips": [{"start": float, "end": float, '
        '"label": str, "color": "#hex"}]}]}. Use 2-4 tracks, 3-6 clips per track. Times within duration_s. '
        "Clips should be cinematic (e.g. 'establishing shot', 'closeup', 'transition flash')."
    ),
    "text_video": (
        "You are LEO, a kinetic typography engine. Output ONLY a JSON object (no markdown). Schema: "
        '{"title": str, "background": "#hex", "color": "#hex", "frames": [{"text": str, "size": 24-120, '
        '"x": 0-100, "y": 0-100, "rotation": -45 to 45, "weight": "regular|bold", "duration_ms": 600-2400}]}. '
        "Generate 6-12 frames forming a poetic / punchy sequence. Keep text short (1-4 words per frame)."
    ),
    "audio": (
        "You are LEO, a generative audio visualizer. Output ONLY a JSON object (no markdown). Schema: "
        '{"title": str, "bpm": 60-160, "background": "#hex", "accent": "#hex", "notes": [{"freq": 80-2000, '
        '"start_ms": 0+, "duration_ms": 100-1500, "amplitude": 0.1-1.0}], "waveform": "sine|square|saw|triangle"}. '
        "Generate 12-24 notes forming a coherent motif."
    ),
    "svg": (
        "You are LEO, a generative 2D SVG artist. Output ONLY raw valid SVG markup (no markdown fences, no prose). "
        "Use viewBox='0 0 400 400'. Be artistic — gradients, circles, polygons, paths. Cohesive palette. "
        "No external assets, no images, fonts or scripts. Just <svg>...</svg>."
    ),
}

PROVIDER_MAP = {
    "claude": ("anthropic", "claude-sonnet-4-5-20250929", "Claude Sonnet 4.5"),
    "gpt": ("openai", "gpt-5.2", "GPT-5.2"),
    "gemini": ("gemini", "gemini-3.1-pro-preview", "Gemini 3 Pro"),
}


class GenerateRequest(BaseModel):
    mode: str
    prompt: str
    model: str = "claude"  # "claude" | "gpt" | "gemini"


def _strip_fences(text: str) -> str:
    text = text.strip()
    # Remove ```json ... ``` or ``` ... ```
    fence = re.match(r"^```(?:json|svg|xml)?\s*\n?(.*?)\n?```\s*$", text, re.DOTALL)
    if fence:
        return fence.group(1).strip()
    return text


@api.post("/generate")
async def generate(req: GenerateRequest, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    if req.mode not in MODE_SYSTEMS:
        raise HTTPException(status_code=400, detail=f"invalid mode: {req.mode}")
    if req.model not in PROVIDER_MAP:
        raise HTTPException(status_code=400, detail=f"invalid model: {req.model}")
    provider, model_name, display = PROVIDER_MAP[req.model]
    system_msg = MODE_SYSTEMS[req.mode]
    session_id = f"{user['user_id']}-{req.mode}-{uuid.uuid4().hex[:8]}"

    try:
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY, session_id=session_id, system_message=system_msg
        ).with_model(provider, model_name)
        out = await chat.send_message(UserMessage(text=req.prompt))
        if hasattr(out, "content"):
            text = out.content
        else:
            text = str(out)
    except Exception as e:
        logger.exception("LLM call failed")
        raise HTTPException(status_code=502, detail=f"llm error: {e}")

    cleaned = _strip_fences(text)
    return {
        "mode": req.mode,
        "model": req.model,
        "model_display": display,
        "prompt": req.prompt,
        "output": cleaned,
        "raw": text,
    }


# ---------- Gallery (Creations) ----------
class CreationCreate(BaseModel):
    mode: str
    prompt: str
    model: str
    model_display: str
    output: str
    title: Optional[str] = None


class CreationOut(BaseModel):
    creation_id: str
    user_id: str
    mode: str
    prompt: str
    model: str
    model_display: str
    output: str
    title: Optional[str] = None
    created_at: str


@api.post("/creations", response_model=CreationOut)
async def save_creation(body: CreationCreate, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    creation_id = f"crea_{uuid.uuid4().hex[:12]}"
    now = datetime.now(timezone.utc)
    doc = {
        "creation_id": creation_id,
        "user_id": user["user_id"],
        "mode": body.mode,
        "prompt": body.prompt,
        "model": body.model,
        "model_display": body.model_display,
        "output": body.output,
        "title": body.title,
        "created_at": now,
    }
    await db.creations.insert_one(doc)
    return CreationOut(**{**doc, "created_at": now.isoformat()})


@api.get("/creations")
async def list_creations(authorization: Optional[str] = Header(None), mode: Optional[str] = None):
    user = await get_current_user(authorization)
    query = {"user_id": user["user_id"]}
    if mode:
        query["mode"] = mode
    cursor = db.creations.find(query, {"_id": 0}).sort("created_at", -1).limit(200)
    items = []
    async for d in cursor:
        d["created_at"] = d["created_at"].isoformat() if isinstance(d["created_at"], datetime) else d["created_at"]
        items.append(d)
    return {"items": items}


@api.delete("/creations/{creation_id}")
async def delete_creation(creation_id: str, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    res = await db.creations.delete_one({"creation_id": creation_id, "user_id": user["user_id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="not found")
    return {"ok": True}


# ---------- Health ----------
@api.get("/")
async def root():
    return {"service": "leo-ai", "status": "ok"}


app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
