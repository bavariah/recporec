import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:55321";
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!key) {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_ANON_KEY is missing. Copy it from `supabase status -o env` into .env.local.",
  );
}

function localClient() {
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket },
  });
}

async function signInGuest(client, displayName) {
  const { data, error } = await client.auth.signInAnonymously({
    options: { data: { display_name: displayName } },
  });
  if (error) throw error;
  if (!data.user) throw new Error(`Anonymous sign-in failed for ${displayName}.`);
  if (data.session?.access_token) {
    await client.realtime.setAuth(data.session.access_token);
  }
  return data.user;
}

const playerOne = localClient();
const playerTwo = localClient();
const firstUser = await signInGuest(playerOne, "Локални тест 1");

const { data: dictionary, error: dictionaryError } = await playerOne.rpc(
  "check_dictionary_words",
  { p_words: ["забуна", "тест-реч"] },
);
if (dictionaryError) throw dictionaryError;

const { data: created, error: createError } = await playerOne.rpc("create_match", {
  p_display_name: "Локални тест 1",
});
if (createError) throw createError;
const createdMatch = created?.[0];
if (!createdMatch) throw new Error("create_match returned no match.");

let resolveRealtime;
let rejectRealtime;
const realtimeUpdate = new Promise((resolve, reject) => {
  resolveRealtime = resolve;
  rejectRealtime = reject;
});
const channel = playerOne
  .channel(`verify-match-${createdMatch.match_id}`)
  .on(
    "postgres_changes",
    {
      event: "UPDATE",
      schema: "public",
      table: "matches",
      filter: `id=eq.${createdMatch.match_id}`,
    },
    (payload) => resolveRealtime(payload.new),
  );

await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("Realtime subscription timed out.")), 10_000);
  channel.subscribe((status) => {
    if (status === "SUBSCRIBED") {
      clearTimeout(timer);
      resolve();
    }
    if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      clearTimeout(timer);
      reject(new Error(`Realtime subscription failed: ${status}`));
    }
  });
});

// Immediately after `supabase db reset`, the channel can report SUBSCRIBED
// before the rebuilt Postgres publication is ready to deliver changes. Give
// only this cold-start verifier time to finish warming; the app is unaffected.
await new Promise((resolve) => setTimeout(resolve, 15_000));

const secondUser = await signInGuest(playerTwo, "Локални тест 2");
const { error: joinError } = await playerTwo.rpc("join_match", {
  p_invite_code: createdMatch.invite_code,
  p_display_name: "Локални тест 2",
});
if (joinError) throw joinError;

const realtimeState = await Promise.race([
  realtimeUpdate,
  new Promise((_, reject) =>
    setTimeout(() => reject(new Error("No Realtime match update received.")), 10_000),
  ),
]).catch((error) => {
  rejectRealtime?.(error);
  throw error;
});

const { data: initialState, error: initialStateError } = await playerOne.rpc(
  "get_match_state",
  { p_match_id: createdMatch.match_id },
);
if (initialStateError) throw initialStateError;

const alphabet = [..."АБВГДЂЕЖЗИЈКЛЉМНЊОПРСТЋУФХЦЧЏШ"];
const candidates = new Map();
for (let first = 0; first < initialState.rack.length; first += 1) {
  for (let second = 0; second < initialState.rack.length; second += 1) {
    if (first === second) continue;
    const firstLetters = initialState.rack[first].letter
      ? [initialState.rack[first].letter]
      : alphabet;
    const secondLetters = initialState.rack[second].letter
      ? [initialState.rack[second].letter]
      : alphabet;
    for (const firstLetter of firstLetters) {
      for (const secondLetter of secondLetters) {
        const word = `${firstLetter}${secondLetter}`;
        if (!candidates.has(word)) {
          candidates.set(word, { first, second, firstLetter, secondLetter });
        }
      }
    }
  }
}

const { data: openingChecks, error: openingCheckError } = await playerOne.rpc(
  "check_dictionary_words",
  { p_words: [...candidates.keys()].map((word) => word.toLowerCase()) },
);
if (openingCheckError) throw openingCheckError;
const acceptedOpening = openingChecks.find((entry) => entry.accepted);
if (!acceptedOpening) throw new Error("Test rack could not form an accepted two-letter word.");
const opening = candidates.get(acceptedOpening.word.toUpperCase());

const { data: movedState, error: moveError } = await playerOne.rpc(
  "submit_match_move",
  {
    p_match_id: createdMatch.match_id,
    p_expected_version: initialState.match.version,
    p_placements: [
      {
        row: 3,
        col: 3,
        tileId: initialState.rack[opening.first].id,
        letter: opening.firstLetter,
      },
      {
        row: 3,
        col: 4,
        tileId: initialState.rack[opening.second].id,
        letter: opening.secondLetter,
      },
    ],
  },
);
if (moveError) throw moveError;

const { data: playerTwoState, error: playerTwoStateError } = await playerTwo.rpc(
  "get_match_state",
  { p_match_id: createdMatch.match_id },
);
if (playerTwoStateError) throw playerTwoStateError;

const { data: exchangeState, error: exchangeError } = await playerTwo.rpc(
  "exchange_match_tiles",
  {
    p_match_id: createdMatch.match_id,
    p_expected_version: movedState.match.version,
    p_tile_ids: [playerTwoState.rack[0].id],
  },
);
if (exchangeError) throw exchangeError;

const { error: repeatedExchangeError } = await playerTwo.rpc(
  "exchange_match_tiles",
  {
    p_match_id: createdMatch.match_id,
    p_expected_version: exchangeState.match.version,
    p_tile_ids: [exchangeState.rack[0].id],
  },
);

const { data: passedState, error: passError } = await playerTwo.rpc(
  "pass_match_turn",
  {
    p_match_id: createdMatch.match_id,
    p_expected_version: exchangeState.match.version,
  },
);
if (passError) throw passError;

const { data: secondPass, error: secondPassError } = await playerOne.rpc(
  "pass_match_turn",
  { p_match_id: createdMatch.match_id, p_expected_version: passedState.match.version },
);
if (secondPassError) throw secondPassError;
const { data: thirdPass, error: thirdPassError } = await playerTwo.rpc(
  "pass_match_turn",
  { p_match_id: createdMatch.match_id, p_expected_version: secondPass.match.version },
);
if (thirdPassError) throw thirdPassError;
const { data: completedState, error: finalPassError } = await playerOne.rpc(
  "pass_match_turn",
  { p_match_id: createdMatch.match_id, p_expected_version: thirdPass.match.version },
);
if (finalPassError) throw finalPassError;

const { data: participants, error: participantsError } = await playerOne
  .from("match_players")
  .select("user_id, seat, score, exchange_used")
  .eq("match_id", createdMatch.match_id)
  .order("seat");
if (participantsError) throw participantsError;

const { data: leaderboard, error: leaderboardError } = await playerOne.rpc(
  "get_leaderboard",
  { p_limit: 50 },
);
if (leaderboardError) throw leaderboardError;

const { data: moves, error: movesError } = await playerOne
  .from("moves")
  .select("turn_number, player_id, formed_words, score_delta")
  .eq("match_id", createdMatch.match_id)
  .order("turn_number");
if (movesError) throw movesError;

const { error: privateStateError } = await playerOne
  .from("match_private_state")
  .select("bag")
  .eq("match_id", createdMatch.match_id);

const winnerLeaderboardEntry = leaderboard?.find((entry) => entry.user_id === firstUser.id);
const loserLeaderboardEntry = leaderboard?.find((entry) => entry.user_id === secondUser.id);

const checks = {
  dictionaryAcceptsKnownWord: dictionary?.find((entry) => entry.word === "забуна")?.accepted,
  dictionaryRejectsInvalidWord: !dictionary?.find((entry) => entry.word === "тест-реч")?.accepted,
  participantCount: participants?.length === 2,
  realtimeConnected: realtimeState.status === "active",
  initialRackSize: initialState.rack.length === 8,
  initialBagCount: initialState.bag_count === 88,
  refilledRackSize: movedState.rack.length === 8,
  turnPassedAfterMove: movedState.match.current_player_id === secondUser.id,
  exchangeRackSize: exchangeState.rack.length === 8,
  exchangeBagUnchanged: exchangeState.bag_count === movedState.bag_count,
  exchangeKeepsTurn: exchangeState.match.current_player_id === secondUser.id,
  exchangeMarkedUsed: exchangeState.players.find((player) => player.user_id === secondUser.id)?.exchange_used,
  repeatedExchangeRejected: Boolean(repeatedExchangeError),
  passChangesTurn: passedState.match.current_player_id === firstUser.id,
  passCountIncremented: passedState.match.consecutive_passes === 1,
  matchCompleted: completedState.match.status === "completed",
  correctWinner: completedState.match.winner_id === firstUser.id,
  onlyPlacementRecorded: moves?.length === 1,
  openingWordRecorded: moves?.[0]?.formed_words?.[0]?.toLowerCase() === acceptedOpening.word,
  leaderboardHasWinner: Boolean(winnerLeaderboardEntry),
  leaderboardHasLoser: Boolean(loserLeaderboardEntry),
  winnerGameCount: winnerLeaderboardEntry?.total_games === 1,
  winnerWinCount: winnerLeaderboardEntry?.wins === 1,
  winnerLossCount: winnerLeaderboardEntry?.losses === 0,
  winnerPoints: winnerLeaderboardEntry?.total_points === moves?.[0]?.score_delta,
  loserLossCount: loserLeaderboardEntry?.losses === 1,
  privateStateProtected: Boolean(privateStateError),
};

const failedChecks = Object.entries(checks)
  .filter(([, passed]) => !passed)
  .map(([name]) => name);

if (failedChecks.length > 0) {
  throw new Error(`Supabase verification failed: ${failedChecks.join(", ")}`);
}

await playerOne.removeChannel(channel);

console.log(
  JSON.stringify(
    {
      users: [firstUser.id, secondUser.id],
      dictionary,
      createdMatch,
      realtimeStatus: realtimeState.status,
      acceptedOpening: acceptedOpening.word,
      openingScore: moves[0].score_delta,
      exchangeUsed: exchangeState.players.find((player) => player.user_id === secondUser.id)?.exchange_used,
      repeatedExchangeRejected: Boolean(repeatedExchangeError),
      bagCount: movedState.bag_count,
      finalStatus: completedState.match.status,
      winnerId: completedState.match.winner_id,
      participants,
      moves,
      leaderboard,
      privateStateProtected: true,
    },
    null,
    2,
  ),
);
