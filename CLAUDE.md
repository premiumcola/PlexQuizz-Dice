# PlexDice

Display name **Plex Quiz & Dice** — two modes on top of a Plex library:

- **Würfeln (Dice)** — picks a random movie from configurable filters
  (genre, year, runtime, FSK, rating), with a slot-machine roll and
  one-tap deep links to play in Plex. Keyless "Erzähl mir was über den
  Film" pulls real facts from cached Plex metadata + a German-Wikipedia
  synopsis.
- **Quiz** — group game with rounds, scoreboard and group photos.
  Question modes include cover→title, actor→movie, movie→actor,
  plot→movie, plus series questions and audio "Hörprobe" theme samples.

PWA-installable on iOS/Android home screen. Talks to Plex live via API.
The repo, Docker container and `/data` layout keep the original
`plexdice` name — only the display name changed.

**Repo:** github.com/premiumcola/PlexQuizz-Dice (private)
**Container port:** 8090 (8099 is taken by tam-spy)

## Stack

- Backend: Python 3.11 + Flask + python-plexapi, served by gunicorn.
  Anthropic SDK is **optional** — only used for quiz theme-song
  enrichment when `ANTHROPIC_API_KEY` is set; the app runs without it.
- Frontend: Vite + React + Tailwind, served as static via Flask in prod
- Storage: JSON files in /data — `settings.json`, `library_cache.json`,
  `series_cache.json`, `movie_info_cache.json`, theme caches/seeds, and
  quiz state (`leaderboard.json`, `players.json`, `quiz_history.json`, …)
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

## Repo structure

```
plexdice/
├── docker-compose.yml            # local build + run
├── docker-compose.unraid.yml     # Unraid: pulls GHCR image, + watchtower
├── Dockerfile                    # multi-stage: node build + python runtime
├── .env.example                  # PLEX_URL/PLEX_TOKEN/LOG_LEVEL
├── .github/workflows/deploy.yml  # build + push image to GHCR
├── CLAUDE.md                     # this file
├── README.md
├── backend/
│   ├── server.py                 # Flask app: blueprints + SPA hosting
│   ├── services.py               # singletons wired into routes
│   ├── settings.py
│   ├── plex_client.py
│   ├── library_cache.py          # movie library cache
│   ├── series_cache.py / series_scan.py / series_quiz.py
│   ├── movie_info.py             # keyless facts + Wikipedia synopsis
│   ├── theme_*.py                # quiz theme-song enrichment/seed/quiz
│   ├── quiz_hints.py / fuzzy_match.py / atomic_io.py / net_setup.py
│   ├── routes/                   # library, settings, plex, plex_auth,
│   │                             #   movie_info, themes, series,
│   │                             #   quiz_solutions, cache, health
│   └── quiz/                     # quiz blueprint + game logic
│       └── routes.py, session.py, generator.py, modes.py, …
└── frontend/
    ├── src/
    │   ├── pages/Dice.jsx        # ported from reference/filmwuerfel-original.jsx
    │   ├── pages/Settings.jsx    # Seerr-style, see reference/seerr-settings.png
    │   ├── pages/Quiz/           # quiz flow (setup → play → result → review)
    │   └── components/           # AppHeader, filter panels, icons, …
    └── public/                   # manifest.json, service-worker.js, icons/, sounds/
```

## Reference files

- `reference/filmwuerfel-original.jsx` — UI vorlage for Dice page
- `reference/seerr-settings.png` — design vorlage for Settings page

Both must be read at the start of any task that touches the UI.
