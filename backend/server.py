"""LEO AI Studio — Backend
Endpoints:
  - Auth:      POST /api/auth/session, GET /api/auth/me, POST /api/auth/logout
  - LLM:       POST /api/generate              (deducts 1 credit; 402 if empty)
  - Gallery:   GET/POST/DELETE /api/creations
  - Wallet:    GET /api/wallet
  - Payments:  POST /api/payments/upi/intent
               POST /api/payments/upi/submit-utr
               POST /api/payments/razorpay/order
               POST /api/payments/razorpay/verify
               GET  /api/payments/me
  - Admin:     GET  /api/admin/payments/pending
               POST /api/admin/payments/{payment_id}/approve
               POST /api/admin/payments/{payment_id}/reject
"""
import hashlib
import hmac
import logging
import os
import re
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Literal, Optional
from urllib.parse import quote

import httpx
import razorpay
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
MERCHANT_UPI_ID = os.environ.get("MERCHANT_UPI_ID", "")
MERCHANT_NAME = os.environ.get("MERCHANT_NAME", "LEO AI Studio")
NEW_USER_FREE_CREDITS = int(os.environ.get("NEW_USER_FREE_CREDITS", "5"))
RAZORPAY_KEY_ID = os.environ.get("RAZORPAY_KEY_ID", "").strip()
RAZORPAY_KEY_SECRET = os.environ.get("RAZORPAY_KEY_SECRET", "").strip()
RAZORPAY_WEBHOOK_SECRET = os.environ.get("RAZORPAY_WEBHOOK_SECRET", "").strip()

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

razorpay_client = None
if RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET:
    try:
        razorpay_client = razorpay.Client(auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET))
    except Exception as e:
        logging.warning(f"Razorpay init failed: {e}")

app = FastAPI(title="LEO AI Studio")
api = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("leo.ai")


# ---------- Startup ----------
@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("user_id", unique=True)
    await db.user_sessions.create_index("session_token", unique=True)
    await db.user_sessions.create_index("user_id")
    await db.user_sessions.create_index("expires_at", expireAfterSeconds=0)
    await db.creations.create_index("user_id")
    await db.creations.create_index("created_at")
    await db.payments.create_index("user_id")
    await db.payments.create_index("payment_id", unique=True)
    await db.payments.create_index("status")
    # Ensure first registered user becomes admin (one-time bootstrap)
    has_admin = await db.users.find_one({"is_admin": True}, {"_id": 0})
    if not has_admin:
        first_user = await db.users.find_one({}, sort=[("created_at", 1)])
        if first_user:
            await db.users.update_one({"user_id": first_user["user_id"]}, {"$set": {"is_admin": True}})
            logger.info(f"Bootstrapped admin: {first_user['email']}")
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


async def require_admin(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    if not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="admin only")
    return user


# ---------- Auth models ----------
class SessionRequest(BaseModel):
    session_id: str


class PublicUser(BaseModel):
    user_id: str
    email: str
    name: str
    picture: Optional[str] = None
    credits: int = 0
    is_admin: bool = False


@api.post("/auth/session")
async def auth_session(req: SessionRequest):
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
        # First user becomes admin
        is_admin = (await db.users.count_documents({})) == 0
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one(
            {
                "user_id": user_id,
                "email": email,
                "name": name,
                "picture": picture,
                "credits": NEW_USER_FREE_CREDITS,
                "is_admin": is_admin,
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
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    return {
        "session_token": session_token,
        "user": {
            "user_id": user["user_id"],
            "email": user["email"],
            "name": user["name"],
            "picture": user.get("picture"),
            "credits": user.get("credits", 0),
            "is_admin": bool(user.get("is_admin")),
        },
    }


@api.get("/auth/me", response_model=PublicUser)
async def auth_me(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    return PublicUser(
        user_id=user["user_id"],
        email=user["email"],
        name=user["name"],
        picture=user.get("picture"),
        credits=user.get("credits", 0),
        is_admin=bool(user.get("is_admin")),
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
    model: str = "claude"


def _strip_fences(text: str) -> str:
    text = text.strip()
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

    # Atomic credit deduction (-1 if credits >= 1)
    updated = await db.users.find_one_and_update(
        {"user_id": user["user_id"], "credits": {"$gte": 1}},
        {"$inc": {"credits": -1}},
        projection={"_id": 0, "credits": 1},
        return_document=True,
    )
    if not updated:
        raise HTTPException(
            status_code=402,
            detail="insufficient credits — top up your wallet to generate more",
        )

    provider, model_name, display = PROVIDER_MAP[req.model]
    system_msg = MODE_SYSTEMS[req.mode]
    session_id = f"{user['user_id']}-{req.mode}-{uuid.uuid4().hex[:8]}"

    try:
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY, session_id=session_id, system_message=system_msg
        ).with_model(provider, model_name)
        out = await chat.send_message(UserMessage(text=req.prompt))
        text = getattr(out, "content", None) or str(out)
    except Exception as e:
        # Refund credit on generation failure
        await db.users.update_one({"user_id": user["user_id"]}, {"$inc": {"credits": 1}})
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
        "credits_remaining": updated.get("credits", 0) - 0,  # post-decrement value (returned doc already decremented)
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


# ============= WALLET & PAYMENTS =============

@api.get("/wallet")
async def wallet(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    return {
        "credits": user.get("credits", 0),
        "is_admin": bool(user.get("is_admin")),
        "plans": [
            {"id": "monthly", "label": "MONTHLY PRO", "amount_inr": 1000, "credits": 1000, "description": "₹1000 → 1000 credits"},
            {"id": "topup_100", "label": "TOP-UP 100", "amount_inr": 100, "credits": 100, "description": "₹100 → 100 credits"},
            {"id": "topup_500", "label": "TOP-UP 500", "amount_inr": 500, "credits": 500, "description": "₹500 → 500 credits"},
        ],
        "rate": {"credits_per_inr": 1},
        "razorpay_enabled": bool(razorpay_client),
        "upi_enabled": bool(MERCHANT_UPI_ID),
    }


class UPIIntentRequest(BaseModel):
    amount_inr: int = Field(ge=1, le=100000)


@api.post("/payments/upi/intent")
async def create_upi_intent(body: UPIIntentRequest, authorization: Optional[str] = Header(None)):
    """Create a pending UPI payment record and return the upi:// deep link + QR payload."""
    user = await get_current_user(authorization)
    if not MERCHANT_UPI_ID:
        raise HTTPException(status_code=503, detail="UPI not configured")
    payment_id = f"pay_upi_{uuid.uuid4().hex[:14]}"
    credits = body.amount_inr  # 1 INR = 1 credit
    now = datetime.now(timezone.utc)

    # Build canonical upi:// link
    note = f"LEO credits {credits}"
    upi_uri = (
        f"upi://pay?pa={quote(MERCHANT_UPI_ID)}"
        f"&pn={quote(MERCHANT_NAME)}"
        f"&am={body.amount_inr}.00"
        f"&cu=INR"
        f"&tn={quote(note)}"
        f"&tr={payment_id}"
    )

    await db.payments.insert_one(
        {
            "payment_id": payment_id,
            "user_id": user["user_id"],
            "user_email": user["email"],
            "method": "upi_intent",
            "amount_inr": body.amount_inr,
            "credits": credits,
            "status": "pending",  # pending → utr_submitted → approved | rejected
            "upi_id": MERCHANT_UPI_ID,
            "utr": None,
            "created_at": now,
        }
    )
    return {
        "payment_id": payment_id,
        "amount_inr": body.amount_inr,
        "credits": credits,
        "upi_uri": upi_uri,
        "upi_id": MERCHANT_UPI_ID,
        "merchant_name": MERCHANT_NAME,
        "note": note,
    }


class UTRSubmitRequest(BaseModel):
    payment_id: str
    utr: str = Field(min_length=6, max_length=24)


@api.post("/payments/upi/submit-utr")
async def submit_utr(body: UTRSubmitRequest, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    p = await db.payments.find_one({"payment_id": body.payment_id, "user_id": user["user_id"]}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="payment not found")
    if p["status"] not in ("pending", "utr_submitted"):
        raise HTTPException(status_code=400, detail=f"cannot submit UTR; status={p['status']}")
    utr = body.utr.strip().upper()
    await db.payments.update_one(
        {"payment_id": body.payment_id},
        {"$set": {"utr": utr, "status": "utr_submitted", "utr_submitted_at": datetime.now(timezone.utc)}},
    )
    return {"ok": True, "payment_id": body.payment_id, "status": "utr_submitted"}


# ---------- Razorpay ----------
class RzpOrderRequest(BaseModel):
    amount_inr: int = Field(ge=1, le=100000)


@api.post("/payments/razorpay/order")
async def razorpay_order(body: RzpOrderRequest, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    if not razorpay_client:
        raise HTTPException(status_code=503, detail="razorpay not configured")
    amount_paise = body.amount_inr * 100
    receipt = f"leo_{uuid.uuid4().hex[:24]}"[:40]
    try:
        order = razorpay_client.order.create(
            {
                "amount": amount_paise,
                "currency": "INR",
                "receipt": receipt,
                "payment_capture": 1,
                "notes": {"user_id": user["user_id"], "email": user["email"], "credits": str(body.amount_inr)},
            }
        )
    except Exception as e:
        logger.exception("razorpay order failed")
        raise HTTPException(status_code=502, detail=f"razorpay order failed: {e}")

    payment_id = f"pay_rzp_{uuid.uuid4().hex[:14]}"
    await db.payments.insert_one(
        {
            "payment_id": payment_id,
            "user_id": user["user_id"],
            "user_email": user["email"],
            "method": "razorpay",
            "amount_inr": body.amount_inr,
            "credits": body.amount_inr,
            "status": "pending",
            "rzp_order_id": order["id"],
            "rzp_payment_id": None,
            "rzp_signature": None,
            "created_at": datetime.now(timezone.utc),
        }
    )
    return {
        "payment_id": payment_id,
        "rzp_order_id": order["id"],
        "rzp_key_id": RAZORPAY_KEY_ID,
        "amount_inr": body.amount_inr,
        "amount_paise": amount_paise,
        "merchant_name": MERCHANT_NAME,
        "user_email": user["email"],
        "user_name": user["name"],
    }


class RzpVerifyRequest(BaseModel):
    payment_id: str  # our internal id
    rzp_order_id: str
    rzp_payment_id: str
    rzp_signature: str


@api.post("/payments/razorpay/verify")
async def razorpay_verify(body: RzpVerifyRequest, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    if not razorpay_client:
        raise HTTPException(status_code=503, detail="razorpay not configured")
    p = await db.payments.find_one({"payment_id": body.payment_id, "user_id": user["user_id"]}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="payment not found")
    if p["status"] == "approved":
        return {"ok": True, "already_approved": True, "credits": p["credits"]}

    # Verify HMAC-SHA256
    expected = hmac.new(
        RAZORPAY_KEY_SECRET.encode(),
        f"{body.rzp_order_id}|{body.rzp_payment_id}".encode(),
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(expected, body.rzp_signature):
        await db.payments.update_one(
            {"payment_id": body.payment_id},
            {"$set": {"status": "rejected", "rejected_reason": "bad signature"}},
        )
        raise HTTPException(status_code=400, detail="signature verification failed")

    now = datetime.now(timezone.utc)
    await db.payments.update_one(
        {"payment_id": body.payment_id},
        {
            "$set": {
                "rzp_payment_id": body.rzp_payment_id,
                "rzp_signature": body.rzp_signature,
                "status": "approved",
                "approved_at": now,
            }
        },
    )
    await db.users.update_one({"user_id": user["user_id"]}, {"$inc": {"credits": p["credits"]}})
    new_user = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0, "credits": 1})
    return {"ok": True, "credits_added": p["credits"], "credits_balance": new_user.get("credits", 0)}


@api.get("/payments/me")
async def my_payments(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    cursor = db.payments.find({"user_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1).limit(100)
    items = []
    async for d in cursor:
        if isinstance(d.get("created_at"), datetime):
            d["created_at"] = d["created_at"].isoformat()
        if isinstance(d.get("approved_at"), datetime):
            d["approved_at"] = d["approved_at"].isoformat()
        if isinstance(d.get("utr_submitted_at"), datetime):
            d["utr_submitted_at"] = d["utr_submitted_at"].isoformat()
        items.append(d)
    return {"items": items}


# ---------- Admin (manual UPI approval) ----------
@api.get("/admin/payments/pending")
async def admin_pending(authorization: Optional[str] = Header(None)):
    await require_admin(authorization)
    cursor = (
        db.payments.find({"status": {"$in": ["utr_submitted", "pending"]}}, {"_id": 0})
        .sort("created_at", -1)
        .limit(200)
    )
    items = []
    async for d in cursor:
        if isinstance(d.get("created_at"), datetime):
            d["created_at"] = d["created_at"].isoformat()
        if isinstance(d.get("utr_submitted_at"), datetime):
            d["utr_submitted_at"] = d["utr_submitted_at"].isoformat()
        items.append(d)
    return {"items": items}


@api.post("/admin/payments/{payment_id}/approve")
async def admin_approve(payment_id: str, authorization: Optional[str] = Header(None)):
    admin = await require_admin(authorization)
    p = await db.payments.find_one({"payment_id": payment_id}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="not found")
    if p["status"] == "approved":
        return {"ok": True, "already_approved": True}
    now = datetime.now(timezone.utc)
    await db.payments.update_one(
        {"payment_id": payment_id},
        {"$set": {"status": "approved", "approved_at": now, "approved_by": admin["email"]}},
    )
    await db.users.update_one({"user_id": p["user_id"]}, {"$inc": {"credits": p["credits"]}})
    return {"ok": True, "credits_added": p["credits"]}


@api.post("/admin/payments/{payment_id}/reject")
async def admin_reject(payment_id: str, authorization: Optional[str] = Header(None)):
    admin = await require_admin(authorization)
    p = await db.payments.find_one({"payment_id": payment_id}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="not found")
    await db.payments.update_one(
        {"payment_id": payment_id},
        {"$set": {"status": "rejected", "rejected_at": datetime.now(timezone.utc), "rejected_by": admin["email"]}},
    )
    return {"ok": True}


# ---------- Health ----------
@api.get("/")
async def root():
    return {"service": "leo-ai", "status": "ok", "razorpay": bool(razorpay_client), "upi": bool(MERCHANT_UPI_ID)}


app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
