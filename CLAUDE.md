# PlexDice

A web app that picks random movies from a Plex library based on
configurable filters (genre, year, runtime, FSK, rating).
PWA-installable on iOS/Android home screen. Talks to Plex live via API.

**Repo:** github.com/premiumcola/PlexQuizz-Dice (private)
**Container port:** 8090 (8099 is taken by tam-spy)

## Stack

- Backend: Python 3.11 + Flask + python-plexapi + Anthropic SDK
- Frontend: Vite + React + Tailwind, served as static via Flask in prod
- Storage: JSON files in /data (settings.json, library_cache.json, ai_cache.json)
- Runtime: Docker (multi-stage build), local dev + Unraid deploy

## Behavior

- Work fully autonomous, no clarifying questions
- On ambiguity: pick the most sensible solution and proceed
- After each task: short summary of what was done
- If something fails: try to fix yourself 2x; after 3 failures stop and explain

## Git — after each completed task, immediately

Run these as THREE SEPARATE tool calls — never combined with
`&&`, `;`, or `cd <path> && ...`. The working directory is
preserved across tool calls automatically.

1. `git add -A`
2. `git commit -m "feat/fix: short description"`
3. `git push origin main`

NEVER:
- `cd ... && git ...`         ← triggers Bash security prompt
- `Set-Location ... ; git ...` ← triggers Bash security prompt
- Multiple git commands chained with `&&` or `;`

One commit per task, not bundled. Commit messages in English,
max 60 chars.

## Code Quality

- No unused variables, no dead code
- Don't write a function twice — search first
- Python: no `print()`, only `logging`
- JavaScript: no `console.log()` in production code
- Type hints on Python function signatures

## SHELL-COMMANDS — vermeide Security-Prompts

Claude Code triggert eine Security-Heuristik bei bestimmten Shell-
Mustern. Halte dich an folgende Regeln, dann läuft alles ohne 
Bestätigungs-Dialoge:

KEINE INLINE-HEREDOCS für Skripte:
NIE so:
  python3 - <<'PY'
  import json
  ...
  PY

IMMER so:
  1) Datei schreiben (eigener Tool-Call, z.B. create_file 
     oder Write-Tool):
       backend/scratch/_quick_test.py
  2) Ausführen:
       python3 backend/scratch/_quick_test.py
  3) Aufräumen wenn nicht mehr gebraucht:
       rm backend/scratch/_quick_test.py

Der Ordner backend/scratch/ liegt in .gitignore (einmalig anlegen, 
falls nicht da). Test-Skripte landen dort, nie im versionierten Code.

WEITERE TRIGGER, die Bestätigungs-Prompts auslösen:
- "cd <pfad> && <befehl>"             → cd separat aufrufen
- "$(...)" verschachtelt in Strings   → Variable zwischenspeichern
- "eval ..."                          → niemals nutzen
- "curl ... | bash"                   → niemals nutzen
- Backticks `...`                     → durch $(...) ersetzen, 
                                         oder besser ganz vermeiden

Ein Tool-Call = ein einzelner Bash-Befehl. Verkettung via && oder ; 
nur wenn beide Teile auf der Allow-Liste stehen UND keine 
Heuristik triggert. Im Zweifel: zwei Tool-Calls.

## Design Principles

- Less text, more icons
- Classic, sophisticated, modern — no colorful chaos
- No duplications — show each info once
- Buttons: never dark-on-dark, always readable
- No thin border lines — depth through color contrast
- Rounded corners everywhere (min 8px)
- Info inline with element — no separate info pane next to it
- Mobile-first: must look good on iPhone (393px viewport)
- Accent color: `#f5a623` (PlexDice orange)
- Background: `zinc-950` (#09090b), surfaces `zinc-900` (#18181b)

## Docker / Deploy

This environment has NO Docker daemon — never run `docker` or
`docker compose` here. Building and deploying happens via CI/CD.

Flow after changes:

1. Edit code.
2. Verify locally without Docker:
   - Backend: `python3 -m py_compile` on changed files.
   - Frontend: `npm run build` in `frontend/`.
3. Commit and push to `main` (see git rules above).
4. The GitHub Action (`.github/workflows/deploy.yml`) builds the
   Dockerfile and pushes `ghcr.io/premiumcola/plexquizz-dice`
   tagged `:latest` and `:<commit-sha>`.
5. Watchtower on the Unraid server detects the new `:latest`,
   pulls it, and recreates the `plexdice` container automatically.

The Unraid stack runs from `docker-compose.unraid.yml` (pulls the
GHCR image; does not build).

## Repo structure (target)

```
plexdice/
├── docker-compose.yml
├── Dockerfile              # multi-stage: node build + python runtime
├── .env.example
├── CLAUDE.md               # this file
├── README.md
├── backend/
│   ├── server.py
│   ├── settings.py
│   ├── plex_client.py
│   ├── library_cache.py
│   ├── ai_enrich.py
│   └── routes/
└── frontend/
    ├── src/
    │   ├── pages/Dice.jsx       # ported from reference/filmwuerfel-original.jsx
    │   └── pages/Settings.jsx   # Seerr-style, see reference/seerr-settings.png
    └── public/                  # manifest.json, service-worker.js, icons/
```

## Reference files

- `reference/filmwuerfel-original.jsx` — UI vorlage for Dice page
- `reference/seerr-settings.png` — design vorlage for Settings page

Both must be read at the start of any task that touches the UI.
