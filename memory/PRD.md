# LEO AI Studio — PRD

## Vision
A mobile (Expo) AI-powered creative studio. Users describe an idea, choose one of three LLM engines (Claude 4.5 / GPT-5.2 / Gemini 3 Pro), and the app renders the result in one of five modes. Outputs save to a personal gallery. Every generation costs **1 credit**; credits are bought via UPI.

## Personas
- **The Creative Explorer** — wants to remix ideas and have fun with generative art.
- **The Designer** — uses kinetic typography & 2D SVG for quick mood boards.
- **The Producer** — uses timeline mode to prototype short cinematic sequences.

## 5 Creative Modes
1. **3D Scene** — animated SVG geometry from a JSON spec.
2. **3D Video** — timeline + playhead.
3. **Text Video** — kinetic typography frames.
4. **3D Audio** — pulsing frequency-bar visualizer.
5. **2D Art** — raw SVG markup rendered with `react-native-svg`.

## Credits & Payments
- Each AI generation deducts **1 credit** atomically.
- Free credits on first sign-up: **5** (env `NEW_USER_FREE_CREDITS`).
- Rate: **1 INR = 1 credit**. Plans: ₹1000 Monthly (1000 credits), ₹100 / ₹500 top-up packs, plus **custom** amount.
- **Two payment methods**:
  1. **UPI Direct** (works with the merchant's UPI ID `creatergame31@oksbi` — no gateway needed). App generates a `upi://pay?...` deep-link + QR; user pays from PhonePe/GPay; submits the 12-digit UTR; admin manually approves to add credits.
  2. **Razorpay** (auto-verified via HMAC-SHA256). Opened inside a WebView with Razorpay Standard Checkout. Returns 503 until `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET` are set in `/app/backend/.env`.

## Admin
- First registered user is auto-promoted to `is_admin=true` (one-time bootstrap on startup).
- Admin sees an `ADMIN` button on the Wallet screen → `/admin/payments` to approve/reject pending UPI submissions.

## Tech
- Frontend: Expo SDK 54, expo-router, react-native-svg, react-native-qrcode-svg, react-native-webview, expo-clipboard, expo-secure-store
- Backend: FastAPI + Motor (MongoDB) + razorpay + emergentintegrations
- Auth: Emergent Google Auth (session_token, 7-day TTL)
- LLM models: `claude-sonnet-4-5-20250929`, `gpt-5.2`, `gemini-3.1-pro-preview`

## API surface
- Auth: `POST /api/auth/session`, `GET /api/auth/me`, `POST /api/auth/logout`
- Generate: `POST /api/generate` (deducts 1 credit; 402 if empty; refunds on LLM failure)
- Gallery: `GET/POST/DELETE /api/creations`
- Wallet: `GET /api/wallet`, `GET /api/payments/me`
- UPI: `POST /api/payments/upi/intent`, `POST /api/payments/upi/submit-utr`
- Razorpay: `POST /api/payments/razorpay/order`, `POST /api/payments/razorpay/verify`
- Admin: `GET /api/admin/payments/pending`, `POST /api/admin/payments/{id}/approve|reject`

## Tests
- Iteration 1: 23/23 (auth + LLM × 5 modes × 3 engines + gallery CRUD + per-user isolation)
- Iteration 2: 20/20 (wallet + credits + UPI + Razorpay 503 + admin approval e2e)

## Smart business enhancements
1. **Daily Prompt Drop** — curated rotating seed prompt on Home hub.
2. **Featured / public gallery** — opt-in showcase, viral loop.
3. **Export / share** — PNG / MP4 capture → social.
4. **Pro tier** — auto-renewal for ₹1000/mo via Razorpay subscriptions.
