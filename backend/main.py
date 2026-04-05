import base64
import json
import os
from datetime import date
from pathlib import Path
from typing import Optional

import requests
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

_env_path = Path(__file__).parent / ".env"
load_dotenv(_env_path, override=True)

# Startup diagnostic — confirms key loaded without printing it.
_key = os.environ.get("OPENROUTER_API_KEY", "")
if _key:
    print(f"[startup] OPENROUTER_API_KEY loaded: {_key[:8]}... ({len(_key)} chars)")
else:
    print(f"[startup] WARNING: OPENROUTER_API_KEY not found. Looked in: {_env_path}")

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5500", "http://localhost:5500", "null"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
MODEL = "openai/gpt-4o-mini"

# ── Rate limiting ─────────────────────────────────────────────────────────
FREE_LIMIT = 3
# {ip: {"date": "YYYY-MM-DD", "count": int}}
_usage: dict[str, dict] = {}


def _get_ip(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host


def _check_and_increment(ip: str) -> int:
    """Raises 429 JSONResponse if limit hit, otherwise increments and returns new count."""
    today = date.today().isoformat()
    entry = _usage.get(ip)
    if entry is None or entry["date"] != today:
        _usage[ip] = {"date": today, "count": 0}
    if _usage[ip]["count"] >= FREE_LIMIT:
        raise _LimitReached()
    _usage[ip]["count"] += 1
    return _usage[ip]["count"]


class _LimitReached(Exception):
    pass


@app.get("/")
def health():
    key_loaded = bool(os.environ.get("OPENROUTER_API_KEY", "").strip())
    return {"status": "ok", "key_loaded": key_loaded}


SYSTEM_PROMPT = """\
You are an intelligent visual content analyst and writer.

Your job is to analyze an uploaded image and produce a clear, accurate, \
and well-written structured output based strictly on what is visible.

────────────────────────────────────────
STEP 1 — CLASSIFY THE IMAGE
────────────────────────────────────────
Before writing anything, identify which category applies:
  A. Product (physical object being sold or promoted)
  B. Person or people (portrait, photo, selfie, group)
  C. UI / app screen / website
  D. Code / development environment
  E. Document / poster / flyer / text-based design
  F. Service or business design (logo, card, banner)
  G. General scene / place / other

Your tone, style, and "ad" field all depend on this classification.

────────────────────────────────────────
STEP 2 — WRITING QUALITY (applies to all types)
────────────────────────────────────────
No repetition:
- Each field must contribute NEW information.
- Do not restate the title in the bullets or description.
- Do not repeat the same idea across bullets.

Specificity:
- Use concrete visible elements (e.g. "wooden armrests", "dark sidebar", \
"Python function", "bold red headline").
- Never use vague atmosphere words unless unmistakably visible.
  BANNED: "nice atmosphere", "indoor setting", "relaxed ambiance",
  "cozy setting", "inviting atmosphere", "high quality", "premium feel",
  "perfect for everyone", "dynamic individual",
  "social gathering" (unless clearly shown).

Conciseness:
- Sentences must be tight. Remove filler words.
- Each bullet should be one clear idea, not a run-on.

Natural variation:
- Do not repeat the same adjective across bullets or sentences.
- Vary sentence structure — avoid three sentences starting identically.

────────────────────────────────────────
STEP 3 — TONE BY IMAGE TYPE
────────────────────────────────────────
A. Product:
   - Confident, marketing-oriented copy.
   - Highlight visible features, materials, and use cases.
   - Write a strong, punchy ad line.

B. Person / people:
   - Natural, descriptive language. No marketing.
   - Describe appearance and visible context only.
   - Do NOT invent emotions, relationships, or situations.
   - Do NOT use "charismatic", "inspiring", "dynamic" unless clearly supported.
   - "ad" field: neutral, tasteful closing sentence only.

C. UI / app / website:
   - Informative and precise.
   - Name the platform or interface if recognizable.
   - Describe visible functionality, layout, and purpose.
   - "ad" field: short feature highlight or neutral summary.

D. Code / dev environment:
   - Technical but clear.
   - Name language, tool, or IDE if visible.
   - Describe what the code appears to be doing.
   - "ad" field: informative, not promotional.

E. Document / poster / flyer:
   - Summarization tone.
   - Capture main message, heading, or purpose.
   - "ad" field: echo the document's call-to-action if one exists, \
else use a neutral summary line.

F. Service / business design:
   - Professional and descriptive.
   - Describe the service, brand identity, or visible offer.
   - "ad" field: light promotional line only if a clear offer is visible.

G. General scene / other:
   - Descriptive, journalistic tone.
   - Describe what is literally visible — setting, subjects, action.
   - "ad" field: neutral, fitting closing line. Not promotional.

────────────────────────────────────────
STEP 4 — GROUNDING (CRITICAL)
────────────────────────────────────────
- Base every sentence on what is actually visible.
- Do NOT invent features, emotions, context, or products.
- If the image is unclear or ambiguous, say so briefly and stay conservative.

────────────────────────────────────────
STEP 5 — LANGUAGE
────────────────────────────────────────
- Detect the primary language visible in the image.
- Write ALL output in that language.
- If no text is visible, default to English.
- Native-speaker level fluency. No awkward phrasing or literal translations.
- Never mix languages unless the image itself clearly does.

────────────────────────────────────────
STEP 6 — OCR
────────────────────────────────────────
- If the image contains text, read it for context.
- Do NOT copy text verbatim if it contains errors or awkward phrasing.
- Rewrite extracted text cleanly and correctly.
- Preserve meaning, not exact characters.

────────────────────────────────────────
OUTPUT FORMAT
────────────────────────────────────────
Return ONLY a valid JSON object. No markdown. No explanation. \
No text outside the JSON.
Use exactly these keys:
  "title"       – specific, accurate, one-line title (string)
  "bullets"     – exactly 3 strings; each adds new info, grounded, non-generic
  "description" – 2 to 4 sentences; no repetition of title or bullets (string)
  "ad"          – one line: strong promo for A/F, neutral closing for B/C/D/E/G (string)
  "image_type"  – one word from: product | person | ui | code | document | service | scene
  "language"    – detected language in English, e.g. "English", "Hebrew", "Arabic" (string)
"""


TONE_INSTRUCTIONS = {
    "professional": "Write in a polished, professional tone suitable for business use.",
    "concise":      "Write in a concise tone. Keep every sentence short and direct. No filler.",
    "marketing":    "Write in a bold, persuasive marketing tone. Use strong action words and highlight benefits.",
    "descriptive":  "Write in a rich, descriptive tone. Paint a clear picture with specific visible details.",
}


def build_messages(image_b64: str, content_type: str, product_name: Optional[str], tone: str = "professional") -> list:
    tone_instruction = TONE_INSTRUCTIONS.get(tone, TONE_INSTRUCTIONS["professional"])
    name_line = f'The user labeled this as: "{product_name}". Use as context only if it matches what you see. ' if product_name else ""
    user_text = (
        f"{name_line}"
        f"Analyze this image and generate the structured output. "
        f"Tone instruction: {tone_instruction} "
        "Focus on accuracy, clarity, and natural language."
    )

    return [
        {
            "role": "system",
            "content": SYSTEM_PROMPT,
        },
        {
            "role": "user",
            "content": [
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:{content_type};base64,{image_b64}"},
                },
                {
                    "type": "text",
                    "text": user_text,
                },
            ],
        },
    ]


@app.exception_handler(_LimitReached)
def _limit_handler(request: Request, exc: _LimitReached):
    return JSONResponse(
        status_code=429,
        content={"error": "Free plan limit reached. Upgrade to Pro for unlimited generations."},
    )


@app.post("/generate")
def generate(
    request: Request,
    image: UploadFile = File(...),
    product_name: Optional[str] = Form(None),
    tone: Optional[str] = Form(None),
):
    ip = _get_ip(request)
    _check_and_increment(ip)  # raises _LimitReached → 429 if over limit

    if not image.content_type or not image.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image.")

    api_key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(
            status_code=500,
            detail="OPENROUTER_API_KEY is not set. Add it to your .env file or environment.",
        )

    name = product_name.strip() if product_name else None
    tone_value = tone.strip().lower() if tone else "professional"

    try:
        image_bytes = image.file.read()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not read image: {e}")

    if not image_bytes:
        raise HTTPException(status_code=400, detail="Uploaded image is empty.")

    image_b64 = base64.b64encode(image_bytes).decode("utf-8")

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": MODEL,
        "messages": build_messages(image_b64, image.content_type, name, tone_value),
        "response_format": {"type": "json_object"},
    }

    try:
        response = requests.post(
            OPENROUTER_URL,
            headers=headers,
            json=payload,
            timeout=60,
        )
        response.raise_for_status()
    except requests.exceptions.Timeout:
        raise HTTPException(status_code=504, detail="OpenRouter request timed out.")
    except requests.exceptions.HTTPError as e:
        status = e.response.status_code
        try:
            body = e.response.json()
            message = body.get("error", {}).get("message") or e.response.text
        except Exception:
            message = e.response.text
        print(f"[generate] OpenRouter error {status}: {message}")
        raise HTTPException(status_code=502, detail=f"OpenRouter error ({status}): {message}")
    except requests.exceptions.RequestException as e:
        raise HTTPException(status_code=502, detail=f"OpenRouter request failed: {e}")

    try:
        content = response.json()["choices"][0]["message"]["content"]
        data = json.loads(content)
    except (KeyError, IndexError, json.JSONDecodeError) as e:
        raise HTTPException(status_code=502, detail=f"Failed to parse model response: {e}")

    missing = [k for k in ("title", "bullets", "description", "ad") if k not in data]
    if missing:
        raise HTTPException(status_code=502, detail=f"Model response missing keys: {missing}")

    return {
        "title": data["title"],
        "bullets": data["bullets"],
        "description": data["description"],
        "ad": data["ad"],
        "image_type": data.get("image_type", ""),
        "language": data.get("language", ""),
        "usage": _usage[ip]["count"],
        "usage_limit": FREE_LIMIT,
    }
