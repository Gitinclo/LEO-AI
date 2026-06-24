# LEO AI Studio — PRD

## Vision
A mobile (Expo) AI-powered creative studio. Users describe an idea in plain language, choose one of three LLM engines (Claude 4.5 / GPT-5.2 / Gemini 3 Pro), and the app renders that idea in one of five creative modes. All outputs are saved to a personal gallery, anchored to a Google account.

## Personas
- **The Creative Explorer** — wants to remix ideas and have fun with generative art.
- **The Designer** — uses kinetic typography & 2D SVG for quick mood boards.
- **The Producer** — uses timeline mode to prototype short cinematic sequences.

## 5 Creative Modes
1. **3D Scene** — LLM emits a JSON object spec (shapes, position, color), rendered as an animated SVG canvas.
2. **3D Video** — LLM emits a timeline (tracks + clips) rendered with a moving red playhead.
3. **Text Video** — LLM emits kinetic typography frames, rendered sequentially with fade-in motion.
4. **3D Audio** — LLM emits notes + waveform spec, rendered as a pulsing frequency-bar visualizer.
5. **2D Art** — LLM emits raw SVG markup, rendered directly with `react-native-svg`.

## Tech
- Frontend: Expo SDK 54, expo-router, react-native-svg, expo-secure-store
- Backend: FastAPI + Motor (MongoDB)
- Auth: Emergent Google Auth (session_token, 7-day TTL)
- LLM: emergentintegrations LlmChat with claude-sonnet-4-5-20250929, gpt-5.2, gemini-3.1-pro-preview

## API surface
- `POST /api/auth/session` — exchange Emergent session_id → session_token + user
- `GET /api/auth/me` — current user (Bearer auth)
- `POST /api/auth/logout`
- `POST /api/generate` — { mode, prompt, model } → { output (JSON or SVG), model_display, ... }
- `POST /api/creations` — save creation
- `GET /api/creations?mode=...` — list user's gallery
- `DELETE /api/creations/{id}` — remove

## Design
Brutalist Mobile LIGHT (per `/app/design_guidelines.json`): white surface, hard black 2pt borders,
0 corner radius, Signal Red (#FF2A00) accent, Space Grotesk display + Courier mono.

## Smart business enhancement
**Daily Prompt Drop** — a curated rotating prompt seed shown on the Home hub each day to keep
returning users engaged and demonstrate the breadth of the engines. (Not yet implemented; backlog.)
