# Речоград architecture

## Product boundary

Речоград is a standalone product and deployment. It can link to `cik-pogodi`
later, but it does not share runtime code, environment variables, authentication,
or a Supabase project by default. That keeps both domains independently
deployable and prevents a change in one game from breaking the other.

## Current layers

- `src/game/` contains deterministic board rules, scoring, premium layout, and
  a provisional Serbian Cyrillic distribution. The commonly published per-letter
  counts total 104 tiles including two blanks, so the bag remains configurable
  until we approve the final balance.
- `src/components/GamePrototype.tsx` owns practice state, pending browser
  placements, invite-code UI, and Realtime rendering.
- `src/components/AppModal.tsx` supplies the shared accessible popup shell used
  by Rules and Leaderboard without changing board layout or scroll position.
- `scripts/` owns repeatable dictionary extraction, normalization, audit, and
  export. Dictionary data never needs to be hand-edited in application code.
- `supabase/migrations/` contains version-controlled schema work for the future
  standalone backend and is already exercised against the local Supabase stack.
- Local anonymous users receive a profile automatically. Browser clients can
  create/join two-player lobbies through security-definer RPCs, but cannot write
  game tables directly.
- Public match state, participants, and moves are Realtime-enabled. Tile bags
  and racks are stored separately; RLS exposes a rack only to its owner and
  never exposes the bag through the browser API.
- `submit_match_move()` locks the match version, confirms the caller and turn,
  verifies rack ownership and placement geometry, derives every formed word,
  checks the dictionary, calculates premiums, refills from the private bag, and
  atomically advances the turn. Browsers cannot supply their own score.
- `get_leaderboard()` exposes completed-match aggregates only: games, wins,
  losses, total points, and average points. It does not expose private matches,
  racks, bags, or move history.

## Dictionary policy

All words are normalized to Serbian Cyrillic before import. This makes Љ, Њ,
and Џ one database character, one board tile, and one unit of word length.

- PDF headwords with 2–8 tiles become accepted candidates automatically. The
  extractor uses bold dictionary-entry lines and ignores OCR text in definitions.
  Each extracted candidate retains its source page and raw OCR spelling for
  later review; the generated list should not be treated as error-free OCR.
- The two-letter review export remains empty because the project policy accepts
  every headword extracted from the PDF without individual confirmation.
- Reviewed words missing from the PDF go in
  `data/dictionary/manual/additional-accepted.txt`.
- Existing reviewed `cik-pogodi` words are copied into a generated import file;
  the new game does not query the old game at runtime.

## Next backend phase

When the production Supabase project is available, apply the existing migrations
and set the public frontend environment values. The remaining product work is:

1. finalize the smaller 8×8 tile distribution, values, exchange, and end rules;
2. add named account upgrades for players who want persistent identity;
3. add reconnect/resume discovery and optional turn-timeout rules;
4. add rate-limited challenges and matchmaking.

The browser may preview a move, but the server must be authoritative for tile
draws, dictionary acceptance, scoring, turn order, and win state.
