# Шкрабај

Standalone PWA-ready foundation for a Serbian browser word game inspired by
tile-placement and board-domination games. The current build is a polished local
prototype backed by a complete local Supabase stack. Production hosting and the
authoritative online turn engine remain the next deployment phase.

## What works now

- 8×8 responsive board with double/triple letter and word squares;
- provisional Serbian Cyrillic 104-tile bag, including two configurable blanks;
- seven-tile rack, placement, undo, refill, and new-game flow;
- first-move, straight-line, gap, connection, and minimum-word validation;
- cross-word scoring with premiums applied only to newly placed tiles;
- fixed board and cell geometry, verified not to reflow when tiles are placed;
- touch-first mobile layout with 44px+ board, rack, navigation, and close targets;
- separate Rules and Leaderboard popups with keyboard and backdrop close;
- installable metadata, app icon, and a production service worker;
- repeatable PDF, `cik-pogodi`, and manual-addition dictionary pipeline;
- local anonymous Auth and server-side dictionary checks for submitted words;
- visible create/join-by-code flow for two browser players;
- server-owned shuffled bag, private racks, turn/version checks, scoring, passes,
  winner recording, Realtime synchronization, and leaderboard schema.

The page starts as a local practice game. Choose **Онлајн** to create a six-digit
invite code or join another player. Four consecutive passes currently finish a
match; this is provisional until the final game-ending rules are approved.

## Run locally

```powershell
npm install
npm run dev
```

Open `http://localhost:3000`.

Verification:

```powershell
npm run test:dictionary
npm run typecheck
npm run lint
npm run build
```

## Run the complete backend locally

The local stack includes PostgreSQL, anonymous Auth, the private dictionary RPC,
authoritative two-player matches, protected rack/bag state, move history, Realtime, a
public aggregate leaderboard, and Supabase Studio. The leaderboard ranks by
total points and returns total games, wins, losses, points, and average points
per game. Docker Desktop must be running.

For the first setup:

```powershell
npm run supabase:setup
npm run supabase:verify
npm run dev
```

Rečograd uses a dedicated port range so it can run beside another local
Supabase project:

- app: `http://localhost:3000`
- API: `http://127.0.0.1:55321`
- database: `postgresql://postgres:postgres@127.0.0.1:55322/postgres`
- Studio: `http://127.0.0.1:55323`
- test email inbox: `http://127.0.0.1:55324`

The ignored `.env.local` contains only the local public URL/key. Never reuse the
local keys in production. After schema or dictionary changes, rebuild everything
from version-controlled migrations and source data:

```powershell
npm run supabase:reset
npm run supabase:verify
```

Stop the containers when they are not needed:

```powershell
npm run supabase:stop
```

## Build the dictionary

### 1. Reuse the reviewed `cik-pogodi` words

With both repositories beside each other, run:

```powershell
npm run dictionary:import-cik
```

Or pass a different checkout path:

```powershell
npm run dictionary:import-cik -- "C:\path\to\cik-pogodi"
```

### 2. Add the PDF

Place it at `data/dictionary/source/dictionary.pdf`, then install the PDF
extractor dependency and extract only the bold dictionary headwords:

```powershell
python -m pip install -r requirements-dictionary.txt
npm run dictionary:extract-pdf
```

The extractor identifies the entry font on every page and ignores noisy OCR
tokens inside definitions. Its TSV keeps the PDF page, raw OCR spelling, and an
initial-correction flag beside every normalized headword, so uncertain entries
remain auditable. To keep the PDF outside the repository, pass its path:

```powershell
npm run dictionary:extract-pdf -- "C:\path\to\dictionary.pdf"
```

The original PDF is intentionally not tracked by Git.

### 3. Normalize, deduplicate, and export

```powershell
npm run dictionary:build
```

This creates:

- `output/dictionary/accepted-words.csv` for all 2–8-letter PDF headwords and
  words from the other approved sources;
- `output/dictionary/two-letter-review.csv` as an empty compatibility report;
- `output/dictionary/dictionary-stats.json` for counts by tile length;
- `output/dictionary/pdf-extraction-report.json` for extraction coverage and
  OCR-correction counts.

See [docs/architecture.md](docs/architecture.md) for backend boundaries and the
online multiplayer roadmap.
