"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, DragEvent } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  BOARD_SIZE,
  getPremium,
  PREMIUM_LABELS,
  RACK_SIZE,
  SERBIAN_ALPHABET,
  START_CELL,
} from "@/game/config";
import {
  cloneBoard,
  commitMove,
  createEmptyBoard,
  evaluateMove,
  getPendingPositions,
} from "@/game/engine";
import { createTileBag, drawTilesForRack, shuffleTiles } from "@/game/tiles";
import { findBotMove } from "@/game/bot";
import { sanitizeDraftPositions } from "@/game/draft";
import type { Board, BoardPosition, RackTile, SerbianLetter } from "@/game/types";
import { isSupabaseReachable, supabase } from "@/lib/supabase/client";
import { LeaderboardModal, type LeaderboardEntry } from "@/components/LeaderboardModal";
import { GameResultModal, type GameResultKind } from "@/components/GameResultModal";
import {
  OnlineGameModal,
  type GameMode,
  type PlayerHub,
} from "@/components/OnlineGameModal";
import { RulesModal } from "@/components/RulesModal";
import { SoundSettingsModal } from "@/components/SoundSettingsModal";
import { GameIcon } from "@/components/GameIcon";
import { DailyChallengeModal } from "@/components/DailyChallengeModal";
import { playGameSound, type SoundPalette } from "@/game/sound";
import { checkLocalWords, loadLocalDictionary } from "@/lib/localDictionary";

type BackendStatus = "connecting" | "ready" | "offline";

interface DictionaryCheckResult {
  word: string;
  accepted: boolean;
}

interface PendingWordCheck {
  key: string;
  status: "idle" | "checking" | "accepted" | "rejected";
}

interface GameState {
  board: Board;
  bag: RackTile[];
  exchangeUsed: boolean;
  rack: RackTile[];
  score: number;
  turn: number;
}

interface OnlinePlayer {
  user_id: string;
  seat: number;
  score: number;
  exchange_used: boolean;
  display_name: string;
}

interface OnlineMatchRecord {
  id: string;
  invite_code: string;
  status: "waiting" | "active" | "completed" | "abandoned";
  current_player_id: string | null;
  winner_id: string | null;
  board: Board | [];
  turn_number: number;
  version: number;
  consecutive_passes: number;
  game_mode: GameMode;
  match_source: "invite" | "quick";
  turn_deadline: string | null;
}

interface OnlineMatchState {
  match: OnlineMatchRecord;
  rack: RackTile[];
  players: OnlinePlayer[];
  bag_count: number;
  viewer_id: string;
  moves?: Array<{
    id: number;
    placements: Array<{ tileId?: string; tile_id?: string }>;
    player_id: string;
    player_name: string;
    score: number;
    turn: number;
    words: string[];
  }>;
}

interface OpenMatch {
  invite_code: string;
  match_id: string;
  status: string;
  updated_at: string;
  game_mode: GameMode;
  match_source: "invite" | "quick";
  opponent_name: string | null;
}

interface DailyChallengeData {
  best: number;
  date: string;
  entries: Array<{ display_name: string; rank: number; score: number; user_id: string }>;
  rank: number | null;
  streak: number;
}

interface MoveFeedback {
  kind: "accepted" | "rejected";
  sequence: number;
  tileIds: string[];
}

interface GameMove {
  id: string;
  playerName: string;
  score: number;
  tileIds: string[];
  turn: number;
  words: Array<{ score: number; word: string }>;
}

const MAX_ROUNDS = 5;
const TURNS_PER_ROUND = 2;
const MAX_TURNS = MAX_ROUNDS * TURNS_PER_ROUND;
const WORD_REPORTS_STORAGE_KEY = "skrabaj-word-reports";

function readQueuedWordReports() {
  try {
    return JSON.parse(window.localStorage.getItem(WORD_REPORTS_STORAGE_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

function writeQueuedWordReports(words: string[]) {
  window.localStorage.setItem(WORD_REPORTS_STORAGE_KEY, JSON.stringify([...new Set(words)]));
}

function dailySeed() {
  return Number(new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Belgrade" }).replaceAll("-", ""));
}

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function buildNewGame(random: () => number = Math.random): GameState {
  const shuffledBag = shuffleTiles(createTileBag(), random);
  const firstDraw = drawTilesForRack(shuffledBag, RACK_SIZE, []);

  return {
    board: createEmptyBoard(),
    bag: firstDraw.bag,
    exchangeUsed: false,
    rack: firstDraw.drawn,
    score: 0,
    turn: 1,
  };
}

function buildBotGame(random: () => number = Math.random) {
  const shuffledBag = shuffleTiles(createTileBag(), random);
  const playerDraw = drawTilesForRack(shuffledBag, RACK_SIZE, []);
  const botDraw = drawTilesForRack(playerDraw.bag, RACK_SIZE, []);
  return {
    botRack: botDraw.drawn,
    game: {
      board: createEmptyBoard(),
      bag: botDraw.bag,
      exchangeUsed: false,
      rack: playerDraw.drawn,
      score: 0,
      turn: 1,
    } satisfies GameState,
  };
}

export function GamePrototype() {
  const [game, setGame] = useState<GameState>(() =>
    buildNewGame(seededRandom(16072026)),
  );
  const [selectedTileId, setSelectedTileId] = useState<string | null>(null);
  const [exchangeMode, setExchangeMode] = useState(false);
  const [exchangeTileIds, setExchangeTileIds] = useState<string[]>([]);
  const [blankLetter, setBlankLetter] = useState<SerbianLetter | null>(null);
  const [notice, setNotice] = useState(
    "Постави прву реч преко звезде. Локални речник ће проверити потез.",
  );
  const [backendStatus, setBackendStatus] =
    useState<BackendStatus>("connecting");
  const [submitting, setSubmitting] = useState(false);
  const [openModal, setOpenModal] = useState<"daily" | "rules" | "leaderboard" | "sound" | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [onlineModalOpen, setOnlineModalOpen] = useState(false);
  const [onlineDisplayName, setOnlineDisplayName] = useState("");
  const [onlineLoading, setOnlineLoading] = useState(false);
  const [onlineNotice, setOnlineNotice] = useState("");
  const [account, setAccount] = useState<{ email: string | null; isAnonymous: boolean }>({ email: null, isAnonymous: true });
  const [playerHub, setPlayerHub] = useState<PlayerHub | null>(null);
  const [playerHubLoading, setPlayerHubLoading] = useState(false);
  const [activeMatchId, setActiveMatchId] = useState<string | null>(null);
  const [initialInviteCode, setInitialInviteCode] = useState("");
  const [onlineState, setOnlineState] = useState<OnlineMatchState | null>(null);
  const [resultModalOpen, setResultModalOpen] = useState(false);
  const [moveFeedback, setMoveFeedback] = useState<MoveFeedback | null>(null);
  const [moveHistory, setMoveHistory] = useState<GameMove[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [soundPalette, setSoundPalette] = useState<SoundPalette>("tactile");
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [localMode, setLocalMode] = useState<"practice" | "daily" | "bot">("practice");
  const [dailyBest, setDailyBest] = useState(0);
  const [dailyData, setDailyData] = useState<DailyChallengeData | null>(null);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [lastRejectedWords, setLastRejectedWords] = useState<string[]>([]);
  const [pendingWordCheck, setPendingWordCheck] = useState<PendingWordCheck>({ key: "", status: "idle" });
  const [botRack, setBotRack] = useState<RackTile[]>([]);
  const [botScore, setBotScore] = useState(0);
  const [botThinking, setBotThinking] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [rivalDraftPositions, setRivalDraftPositions] = useState<BoardPosition[]>([]);
  const [draftChannelReady, setDraftChannelReady] = useState(false);
  const moveFeedbackSequence = useRef(0);
  const draftChannelRef = useRef<RealtimeChannel | null>(null);
  const rivalDraftTimeoutRef = useRef<number | null>(null);
  const expiringVersionRef = useRef<number | null>(null);

  useEffect(() => {
    void loadLocalDictionary().catch(() => undefined);
    const timer = window.setTimeout(() => {
      setSoundEnabled(window.localStorage.getItem("skrabaj-sound") !== "off");
      const savedPalette = window.localStorage.getItem("skrabaj-sound-palette-v2");
      if (savedPalette === "tactile" || savedPalette === "arcade") {
        setSoundPalette(savedPalette);
      }
      setTutorialOpen(window.localStorage.getItem("skrabaj-tutorial-seen") !== "yes");
      setDailyBest(Number(window.localStorage.getItem(`skrabaj-daily-${dailySeed()}`) ?? 0));
      setNotificationsEnabled(typeof Notification !== "undefined" && window.localStorage.getItem("skrabaj-notifications") === "on" && Notification.permission === "granted");
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (
      notificationsEnabled &&
      typeof Notification !== "undefined" &&
      onlineState?.match.status === "active" &&
      onlineState.match.current_player_id === userId &&
      document.visibilityState === "hidden"
    ) {
      new Notification("Твој потез у Шкрабају", { body: `Партија ${onlineState.match.invite_code} те чека.` });
    }
  }, [notificationsEnabled, onlineState?.match.current_player_id, onlineState?.match.invite_code, onlineState?.match.status, userId]);

  const applyOnlineMatchState = useCallback((nextState: OnlineMatchState) => {
    setOnlineState(nextState);
    const board = nextState.match.board.length === BOARD_SIZE && nextState.match.board.every((row) => row.length === BOARD_SIZE)
      ? nextState.match.board as Board
      : createEmptyBoard();
    const currentViewer = nextState.players.find((player) => player.user_id === nextState.viewer_id);
    setGame((current) => ({
      ...current,
      board,
      rack: nextState.rack,
      score: currentViewer?.score ?? 0,
      turn: Math.max(1, nextState.match.turn_number),
    }));
    setSelectedTileId(null);
    setBlankLetter(null);
    setExchangeMode(false);
    setExchangeTileIds([]);
    setMoveHistory((nextState.moves ?? []).map((move) => ({
      id: `online-${move.id}`,
      playerName: move.player_name,
      score: move.score,
      tileIds: move.placements.map((placement) => placement.tileId ?? placement.tile_id ?? "").filter(Boolean),
      turn: move.turn,
      words: move.words.map((word) => ({ score: 0, word })),
    })));
    if (nextState.match.status === "waiting" || nextState.match.status === "active") {
      window.localStorage.setItem("skrabaj-active-match", nextState.match.id);
    } else {
      window.localStorage.removeItem("skrabaj-active-match");
    }
    setRivalDraftPositions([]);
    if (nextState.match.status !== "waiting") setOnlineModalOpen(false);

    if (nextState.match.status === "waiting") {
      setNotice(nextState.match.match_source === "quick"
        ? "Тражимо противника за брзу игру."
        : "Партија је направљена. Пошаљи позивни код другом играчу.");
    } else if (nextState.match.status === "completed" || nextState.match.status === "abandoned") {
      setResultModalOpen(true);
      setNotice(
        nextState.match.winner_id === null
          ? "Партија је завршена нерешеним резултатом."
          : nextState.match.winner_id === nextState.viewer_id
            ? "Победа! Партија је завршена."
            : "Партија је завршена. Победио је ривал.",
      );
    } else if (nextState.match.current_player_id === nextState.viewer_id) {
      setNotice("Твој потез. Изабери слово, па поље на табли.");
    } else {
      setNotice("Ривал је на потезу. Табла ће се освежити аутоматски.");
    }
  }, []);

  useEffect(() => {
    let active = true;

    async function connectLocalBackend() {
      if (!supabase) {
        if (active) setBackendStatus("offline");
        return;
      }

      if (!(await isSupabaseReachable())) {
        if (active) {
          setUserId(null);
          setBackendStatus("offline");
        }
        return;
      }

      try {
        const { data } = await supabase.auth.getSession();
        let session = data.session;
        if (session) {
          const { error: userError } = await supabase.auth.getUser();
          if (userError) {
            await supabase.auth.signOut({ scope: "local" });
            session = null;
          }
        }
        if (!session) {
          const { data: signedIn, error } = await supabase.auth.signInAnonymously({
            options: { data: { display_name: "Локални играч" } },
          });
          if (error) {
            if (active) {
              setBackendStatus("offline");
              setNotice("Онлајн игра тренутно није доступна, али офлајн режими раде нормално.");
            }
            return;
          }
          session = signedIn.session;
        }

        if (session?.access_token) await supabase.realtime.setAuth(session.access_token);
        if (active) {
          setUserId(session?.user.id ?? null);
          setAccount({
            email: session?.user.email ?? null,
            isAnonymous: session?.user.is_anonymous ?? !session?.user.email,
          });
          setBackendStatus("ready");
          const requestedCode = new URLSearchParams(window.location.search).get("match")?.toUpperCase() ?? "";
          if (/^[A-F0-9]{6}$/.test(requestedCode)) {
            setInitialInviteCode(requestedCode);
            setOnlineModalOpen(true);
          }
          const savedMatchId = window.localStorage.getItem("skrabaj-active-match");
          const { data: openMatches } = await supabase.rpc("list_my_open_matches");
          const matches = (openMatches ?? []) as OpenMatch[];
          const resumable = savedMatchId
            ? matches.find((match) => match.match_id === savedMatchId)
            : null;
          if (active && resumable?.match_id) {
            setActiveMatchId(resumable.match_id);
          } else if (savedMatchId) {
            window.localStorage.removeItem("skrabaj-active-match");
          }
          const { data: hubData } = await supabase.rpc("get_player_hub");
          if (active && hubData) {
            const nextHub = hubData as PlayerHub;
            setPlayerHub(nextHub);
            const savedName = window.localStorage.getItem("skrabaj-display-name");
            setOnlineDisplayName(savedName || nextHub.profile?.display_name || "");
          }
          const { data: dailyResult } = await supabase.rpc("get_daily_challenge");
          if (active && dailyResult) {
            const nextDaily = dailyResult as DailyChallengeData;
            setDailyData(nextDaily);
            setDailyBest((current) => Math.max(current, nextDaily.best));
          }
        }
      } catch {
        if (active) {
          setUserId(null);
          setBackendStatus("offline");
        }
      }
    }

    void connectLocalBackend();
    const { data: authListener } = supabase?.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setUserId(session?.user.id ?? null);
      setAccount({ email: session?.user.email ?? null, isAnonymous: session?.user.is_anonymous ?? !session?.user.email });
      if (session?.access_token) void supabase?.realtime.setAuth(session.access_token);
    }) ?? { data: { subscription: null } };
    return () => {
      active = false;
      authListener.subscription?.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!supabase || !userId) return;
    const queuedWords = readQueuedWordReports();
    if (queuedWords.length === 0) return;
    const client = supabase;
    let active = true;

    void Promise.all(queuedWords.map((word) => client.rpc("report_dictionary_word", {
      p_word: word,
      p_match_id: null,
    }))).then((results) => {
      if (!active) return;
      writeQueuedWordReports(queuedWords.filter((_, index) => Boolean(results[index].error)));
    });

    return () => {
      active = false;
    };
  }, [userId]);

  useEffect(() => {
    if (!supabase || !activeMatchId) return;
    const client = supabase;
    let active = true;

    async function refreshMatch() {
      const { data, error } = await client.rpc("get_match_state", {
        p_match_id: activeMatchId,
      });
      if (!active) return;
      if (error) {
        setNotice(`Онлајн партија није доступна: ${error.message}`);
        return;
      }
      applyOnlineMatchState(data as OnlineMatchState);
    }

    void refreshMatch();
    const channel = client
      .channel(`match-ui-${activeMatchId}`, { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "draft-placement" }, ({ payload }) => {
        const draft = payload as { playerId?: unknown; positions?: unknown };
        if (draft.playerId === userId) return;
        const positions = sanitizeDraftPositions(draft.positions);
        setRivalDraftPositions(positions);
        if (rivalDraftTimeoutRef.current !== null) {
          window.clearTimeout(rivalDraftTimeoutRef.current);
        }
        rivalDraftTimeoutRef.current = positions.length
          ? window.setTimeout(() => setRivalDraftPositions([]), 12_000)
          : null;
      })
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "matches", filter: `id=eq.${activeMatchId}` },
        () => void refreshMatch(),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "match_players", filter: `match_id=eq.${activeMatchId}` },
        () => void refreshMatch(),
      )
      .subscribe((status) => setDraftChannelReady(status === "SUBSCRIBED"));
    draftChannelRef.current = channel;

    return () => {
      active = false;
      if (rivalDraftTimeoutRef.current !== null) {
        window.clearTimeout(rivalDraftTimeoutRef.current);
        rivalDraftTimeoutRef.current = null;
      }
      draftChannelRef.current = null;
      setDraftChannelReady(false);
      setRivalDraftPositions([]);
      void client.removeChannel(channel);
    };
  }, [activeMatchId, applyOnlineMatchState, userId]);

  const selectedTile = game.rack.find((tile) => tile.id === selectedTileId) ?? null;
  const evaluation = useMemo(() => evaluateMove(game.board), [game.board]);
  const pendingWordKey = evaluation.valid
    ? evaluation.words.map(({ word }) => word.toLocaleLowerCase("sr-Cyrl")).join("|")
    : "";
  const pendingPositions = useMemo(() => getPendingPositions(game.board), [game.board]);
  const pendingCount = pendingPositions.length;
  const rivalDraftCells = useMemo(
    () => new Set(rivalDraftPositions.map(({ row, col }) => `${row}-${col}`)),
    [rivalDraftPositions],
  );
  const pendingWordStatus = !evaluation.valid || !pendingWordKey
    ? "idle"
    : pendingWordCheck.key === pendingWordKey
      ? pendingWordCheck.status
      : "checking";
  const pendingMoveAccepted = Boolean(
    evaluation.valid && pendingWordStatus === "accepted",
  );
  const pendingMoveRejected = Boolean(evaluation.valid && pendingWordStatus === "rejected");

  useEffect(() => {
    let active = true;
    if (!pendingWordKey) return;

    const words = pendingWordKey.split("|");

    async function checkPendingWords() {
      if (supabase && backendStatus === "ready") {
        const { data, error } = await supabase.rpc("check_dictionary_words", { p_words: words });
        if (!error) {
          const acceptedWords = new Set(
            ((data ?? []) as DictionaryCheckResult[])
              .filter(({ accepted }) => accepted)
              .map(({ word }) => word),
          );
          if (active) {
            setPendingWordCheck({
              key: pendingWordKey,
              status: words.every((word) => acceptedWords.has(word)) ? "accepted" : "rejected",
            });
          }
          return;
        }
      }

      try {
        const rejected = await checkLocalWords(words);
        if (active) {
          setPendingWordCheck({
            key: pendingWordKey,
            status: rejected.length === 0 ? "accepted" : "rejected",
          });
        }
      } catch {
        if (active) setPendingWordCheck({ key: pendingWordKey, status: "idle" });
      }
    }

    void checkPendingWords();
    return () => {
      active = false;
    };
  }, [backendStatus, pendingWordKey]);
  const lastMoveTileIds = moveHistory.at(-1)?.tileIds ?? [];
  const viewer = onlineState?.players.find((player) => player.user_id === userId) ?? null;
  const opponent = onlineState?.players.find((player) => player.user_id !== userId) ?? null;
  const isOnline = Boolean(activeMatchId && onlineState);
  const canPlayOnline = Boolean(
    isOnline && onlineState?.match.status === "active" && onlineState.match.current_player_id === userId,
  );
  const isTimedMatch = onlineState?.match.game_mode === "quick";
  const remainingSeconds = isTimedMatch && onlineState?.match.turn_deadline
    ? Math.max(0, Math.ceil((new Date(onlineState.match.turn_deadline).getTime() - clockNow) / 1000))
    : null;

  useEffect(() => {
    if (!isTimedMatch || onlineState?.match.status !== "active" || !onlineState.match.turn_deadline) return;
    const timer = window.setInterval(() => setClockNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [isTimedMatch, onlineState?.match.status, onlineState?.match.turn_deadline]);

  useEffect(() => {
    if (!supabase || !onlineState || remainingSeconds !== 0 || onlineState.match.status !== "active") return;
    if (expiringVersionRef.current === onlineState.match.version) return;
    expiringVersionRef.current = onlineState.match.version;
    void supabase.rpc("expire_match_turn", { p_match_id: onlineState.match.id }).then(({ data, error }) => {
      if (error) {
        expiringVersionRef.current = null;
        return;
      }
      applyOnlineMatchState(data as OnlineMatchState);
      setNotice("Време за потез је истекло — потез је аутоматски прескочен.");
    });
  }, [applyOnlineMatchState, onlineState, remainingSeconds]);

  useEffect(() => {
    if (!isOnline || !canPlayOnline || !userId || !draftChannelReady) return;
    const channel = draftChannelRef.current;
    if (!channel) return;
    void channel.send({
      type: "broadcast",
      event: "draft-placement",
      payload: {
        playerId: userId,
        positions: pendingPositions.map(({ row, col }) => ({ row, col })),
      },
    });
  }, [canPlayOnline, draftChannelReady, isOnline, pendingPositions, userId]);
  const matchComplete = isOnline
    ? onlineState?.match.status === "completed" || onlineState?.match.status === "abandoned"
    : game.turn > (localMode === "bot" ? MAX_TURNS : MAX_ROUNDS);
  const currentRound = Math.min(
    MAX_ROUNDS,
    isOnline || localMode === "bot" ? Math.ceil(Math.min(game.turn, MAX_TURNS) / TURNS_PER_ROUND) : Math.min(game.turn, MAX_ROUNDS),
  );
  const playerIsActive = !matchComplete && (!botThinking && (!isOnline || canPlayOnline));
  const opponentIsActive = Boolean(
    !matchComplete && ((isOnline && onlineState?.match.status === "active" && !canPlayOnline) || botThinking),
  );
  const exchangeUsed = isOnline ? (viewer?.exchange_used ?? true) : game.exchangeUsed;
  const bagCount = onlineState?.bag_count ?? game.bag.length;
  const exchangeAvailable = Boolean(
    !matchComplete && playerIsActive && !botThinking && !exchangeUsed && bagCount > 0 && pendingCount === 0,
  );
  const resultKind: GameResultKind = localMode === "bot"
    ? game.score === botScore ? "draw" : game.score > botScore ? "win" : "lose"
    : isOnline
    ? onlineState?.match.winner_id === null
      ? "draw"
      : onlineState?.match.winner_id === onlineState?.viewer_id
        ? "win"
        : "lose"
    : "summary";

  function triggerMoveFeedback(kind: MoveFeedback["kind"], tileIds: string[]) {
    if (tileIds.length > 0) {
      moveFeedbackSequence.current += 1;
      setMoveFeedback({ kind, tileIds, sequence: moveFeedbackSequence.current });
    }
    if (soundEnabled) {
      navigator.vibrate?.(kind === "accepted" ? 24 : [20, 35, 20]);
      void playGameSound(kind, soundPalette);
    }
  }

  function closeResultModal() {
    if (isOnline && matchComplete) {
      startNewGame();
      return;
    }
    setResultModalOpen(false);
  }

  function closeTutorial() {
    window.localStorage.setItem("skrabaj-tutorial-seen", "yes");
    setTutorialOpen(false);
  }

  function setSound(next: boolean) {
    setSoundEnabled(next);
    window.localStorage.setItem("skrabaj-sound", next ? "on" : "off");
  }

  function chooseSoundPalette(next: SoundPalette) {
    setSoundPalette(next);
    window.localStorage.setItem("skrabaj-sound-palette-v2", next);
  }

  async function enableTurnNotifications() {
    if (typeof Notification === "undefined") {
      setNotice("Овај прегледач не подржава обавештења.");
      return;
    }
    const permission = await Notification.requestPermission();
    const enabled = permission === "granted";
    window.localStorage.setItem("skrabaj-notifications", enabled ? "on" : "off");
    setNotificationsEnabled(enabled);
    setNotice(enabled ? "Обавестићемо те када поново будеш на потезу." : "Обавештења нису укључена.");
  }

  function resetSelection() {
    setSelectedTileId(null);
    setBlankLetter(null);
  }

  function cancelExchange() {
    setExchangeMode(false);
    setExchangeTileIds([]);
    setNotice("Замена је отказана. Изабери слово за потез.");
  }

  function beginExchange() {
    if (!exchangeAvailable) {
      setNotice(exchangeUsed ? "Замену слова си већ искористио у овој партији." : "Слова сада не могу да се замене.");
      return;
    }
    resetSelection();
    setExchangeMode(true);
    setExchangeTileIds([]);
    setNotice("Изабери слова која желиш да замениш, па потврди. После замене настављаш исти потез.");
  }

  function startNewGame() {
    window.localStorage.removeItem("skrabaj-active-match");
    setActiveMatchId(null);
    setOnlineState(null);
    setResultModalOpen(false);
    setMoveFeedback(null);
    setMoveHistory([]);
    setHistoryOpen(false);
    setLastRejectedWords([]);
    setLocalMode("practice");
    setBotRack([]);
    setBotScore(0);
    setBotThinking(false);
    setRivalDraftPositions([]);
    setGame(buildNewGame());
    resetSelection();
    setNotice("Нова партија је спремна. Прва реч иде преко звезде.");
  }

  function startDailyChallenge() {
    window.localStorage.removeItem("skrabaj-active-match");
    setActiveMatchId(null);
    setOnlineState(null);
    setResultModalOpen(false);
    setMoveFeedback(null);
    setMoveHistory([]);
    setHistoryOpen(false);
    setLastRejectedWords([]);
    setLocalMode("daily");
    setGame(buildNewGame(seededRandom(dailySeed())));
    resetSelection();
    setNotice("Дневни изазов је почео. Имаш пет потеза са истим словима као и сви данас.");
  }

  async function shareDailyResult() {
    const score = Math.max(dailyBest, dailyData?.best ?? 0, localMode === "daily" ? game.score : 0);
    const streak = dailyData?.streak ?? 0;
    const text = `Шкрабај · Дневни изазов\n${score} поена · низ ${streak} дана\n${window.location.origin}`;
    if (navigator.share) {
      await navigator.share({ title: "Шкрабај · Дневни изазов", text });
      return;
    }
    await navigator.clipboard.writeText(text);
    setNotice("Резултат је копиран — спреман је за дељење.");
  }

  function startBotGame() {
    const session = buildBotGame();
    window.localStorage.removeItem("skrabaj-active-match");
    setActiveMatchId(null);
    setOnlineState(null);
    setResultModalOpen(false);
    setMoveFeedback(null);
    setMoveHistory([]);
    setHistoryOpen(false);
    setLastRejectedWords([]);
    setLocalMode("bot");
    setGame(session.game);
    setBotRack(session.botRack);
    setBotScore(0);
    setBotThinking(false);
    resetSelection();
    setNotice("Игра против Букварка је спремна. Имате по пет потеза.");
  }

  async function playBotTurn(stateAfterPlayer: GameState) {
    setBotThinking(true);
    setNotice("Букварко тражи најбољу реч…");
    await new Promise((resolve) => window.setTimeout(resolve, 260));
    const dictionary = await loadLocalDictionary();
    const move = findBotMove(stateAfterPlayer.board, botRack, dictionary);
    if (!move) {
      const next = { ...stateAfterPlayer, turn: stateAfterPlayer.turn + 1 };
      setGame(next);
      setMoveHistory((current) => [...current, { id: `bot-${stateAfterPlayer.turn}`, playerName: "Букварко", score: 0, tileIds: [], turn: stateAfterPlayer.turn, words: [] }]);
      setNotice("Букварко прескаче. Твој потез.");
      setBotThinking(false);
      if (next.turn > MAX_TURNS) setResultModalOpen(true);
      return;
    }
    const remainingRack = botRack.filter((tile) => !move.usedTileIds.includes(tile.id));
    const refill = drawTilesForRack(stateAfterPlayer.bag, RACK_SIZE - remainingRack.length, remainingRack);
    const next = {
      ...stateAfterPlayer,
      bag: refill.bag,
      board: commitMove(move.board),
      turn: stateAfterPlayer.turn + 1,
    };
    setBotRack([...remainingRack, ...refill.drawn]);
    setBotScore((current) => current + move.score);
    setGame(next);
    setMoveHistory((current) => [...current, {
      id: `bot-${stateAfterPlayer.turn}`,
      playerName: "Букварко",
      score: move.score,
      tileIds: move.tileIds,
      turn: stateAfterPlayer.turn,
      words: move.words,
    }]);
    triggerMoveFeedback("accepted", move.tileIds);
    setNotice(`Букварко: ${move.words.map(({ word }) => word).join(" + ")} · +${move.score}. Твој потез.`);
    setBotThinking(false);
    if (next.turn > MAX_TURNS) setResultModalOpen(true);
  }

  async function reportRejectedWords() {
    if (lastRejectedWords.length === 0) return;
    const words = [...new Set(lastRejectedWords.map((word) => word.toLocaleLowerCase("sr-Cyrl")))];
    let failedWords = words;

    if (supabase && userId) {
      const client = supabase;
      const results = await Promise.all(words.map((word) => client.rpc("report_dictionary_word", {
        p_word: word,
        p_match_id: isOnline ? onlineState?.match.id ?? null : null,
      })));
      failedWords = words.filter((_, index) => Boolean(results[index].error));
    }

    if (failedWords.length > 0) {
      writeQueuedWordReports([...readQueuedWordReports(), ...failedWords]);
      setNotice("Хвала — реч је сачувана и биће послата на проверу.");
    } else {
      writeQueuedWordReports(readQueuedWordReports().filter((word) => !words.includes(word)));
      setNotice("Хвала — реч је послата на проверу.");
    }
    setLastRejectedWords([]);
  }

  async function refreshPlayerHub() {
    if (!supabase || backendStatus !== "ready") return;
    setPlayerHubLoading(true);
    const [{ data: hubData }, { data: dailyResult }] = await Promise.all([
      supabase.rpc("get_player_hub"),
      supabase.rpc("get_daily_challenge"),
    ]);
    if (hubData) setPlayerHub(hubData as PlayerHub);
    if (dailyResult) {
      const nextDaily = dailyResult as DailyChallengeData;
      setDailyData(nextDaily);
      setDailyBest((current) => Math.max(current, nextDaily.best));
    }
    setPlayerHubLoading(false);
  }

  function openOnlineLobby() {
    setOnlineDisplayName((current) => current || window.localStorage.getItem("skrabaj-display-name") || "");
    setOnlineNotice(backendStatus === "offline" ? "Онлајн сервис тренутно није доступан." : "");
    setOnlineModalOpen(true);
    void refreshPlayerHub();
  }

  function openDailyChallenge() {
    setOpenModal("daily");
    void refreshPlayerHub();
  }

  async function createOnlineMatch(displayName: string, gameMode: GameMode) {
    if (!supabase || backendStatus !== "ready") {
      setNotice("Потребна је веза са сервисом за онлајн партију.");
      return;
    }
    window.localStorage.setItem("skrabaj-display-name", displayName);
    setOnlineLoading(true);
    const { data, error } = await supabase.rpc("create_match", {
      p_display_name: displayName,
      p_game_mode: gameMode,
    });
    if (error || !data?.[0]) {
      setNotice(`Партија није направљена: ${error?.message ?? "непозната грешка"}`);
      setOnlineLoading(false);
      return;
    }
    setActiveMatchId(data[0].match_id);
    const { data: state, error: stateError } = await supabase.rpc("get_match_state", {
      p_match_id: data[0].match_id,
    });
    if (stateError) {
      setNotice(`Партија није учитана: ${stateError.message}`);
    } else {
      applyOnlineMatchState(state as OnlineMatchState);
    }
    setOnlineLoading(false);
  }

  async function findQuickMatch(displayName: string) {
    if (!supabase || backendStatus !== "ready") {
      setOnlineNotice("Потребна је веза са сервисом за брзу игру.");
      return;
    }
    window.localStorage.setItem("skrabaj-display-name", displayName);
    setOnlineLoading(true);
    setOnlineNotice("");
    const { data, error } = await supabase.rpc("find_quick_match", {
      p_display_name: displayName,
      p_game_mode: "quick",
    });
    if (error || !data) {
      setOnlineNotice(`Претрага није покренута: ${error?.message ?? "непозната грешка"}`);
    } else {
      const next = data as OnlineMatchState;
      setActiveMatchId(next.match.id);
      applyOnlineMatchState(next);
    }
    setOnlineLoading(false);
  }

  async function cancelQuickMatch() {
    if (!supabase || !onlineState || onlineState.match.match_source !== "quick") return;
    setOnlineLoading(true);
    const { error } = await supabase.rpc("cancel_quick_match", { p_match_id: onlineState.match.id });
    if (error) {
      setOnlineNotice(`Претрага није отказана: ${error.message}`);
    } else {
      window.localStorage.removeItem("skrabaj-active-match");
      setActiveMatchId(null);
      setOnlineState(null);
      setOnlineNotice("Претрага је отказана.");
    }
    setOnlineLoading(false);
  }

  function resumeOnlineMatch(matchId: string) {
    setActiveMatchId(matchId);
    setOnlineModalOpen(false);
  }

  async function authenticateWithGoogle() {
    if (!supabase) return;
    setOnlineLoading(true);
    setOnlineNotice("");
    const redirectTo = `${window.location.origin}${window.location.pathname}`;
    const result = account.isAnonymous
      ? await supabase.auth.linkIdentity({ provider: "google", options: { redirectTo } })
      : await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo } });
    if (result.error) setOnlineNotice(`Google пријава није успела: ${result.error.message}`);
    setOnlineLoading(false);
  }

  async function authenticateWithEmail(email: string, password: string, intent: "login" | "upgrade") {
    if (!supabase) return;
    setOnlineLoading(true);
    setOnlineNotice("");
    const result = intent === "upgrade"
      ? await supabase.auth.updateUser({ email, password })
      : await supabase.auth.signInWithPassword({ email, password });
    if (result.error) {
      setOnlineNotice(`Налог није повезан: ${result.error.message}`);
    } else {
      setOnlineNotice(intent === "upgrade" ? "Налог је направљен, а досадашњи напредак је сачуван." : "Успешно си пријављен.");
      await refreshPlayerHub();
    }
    setOnlineLoading(false);
  }

  async function signOutAccount() {
    if (!supabase) return;
    setOnlineLoading(true);
    await supabase.auth.signOut();
    const { data, error } = await supabase.auth.signInAnonymously({ options: { data: { display_name: "Локални играч" } } });
    if (error) setOnlineNotice(`Одјава није завршена: ${error.message}`);
    else {
      setUserId(data.user?.id ?? null);
      setAccount({ email: null, isAnonymous: true });
      setPlayerHub(null);
      setOnlineNotice("Одјављен си. Можеш да наставиш као гост.");
    }
    setOnlineLoading(false);
  }

  async function resignOnlineMatch() {
    if (!supabase || !onlineState || !window.confirm("Сигурно желиш да предаш ову партију?")) return;
    setSubmitting(true);
    const { data, error } = await supabase.rpc("resign_match", { p_match_id: onlineState.match.id });
    if (error) setNotice(`Предаја није успела: ${error.message}`);
    else applyOnlineMatchState(data as OnlineMatchState);
    setSubmitting(false);
  }

  async function rematchOnline() {
    if (!supabase || !onlineState || !isOnline) {
      startNewGame();
      return;
    }
    setSubmitting(true);
    const { data, error } = await supabase.rpc("create_rematch", { p_match_id: onlineState.match.id });
    if (error) setNotice(`Реванш није направљен: ${error.message}`);
    else {
      const next = data as OnlineMatchState;
      setActiveMatchId(next.match.id);
      setResultModalOpen(false);
      applyOnlineMatchState(next);
    }
    setSubmitting(false);
  }

  async function joinOnlineMatch(displayName: string, inviteCode: string) {
    if (!supabase || backendStatus !== "ready") {
      setNotice("Потребна је веза са сервисом за онлајн партију.");
      return;
    }
    window.localStorage.setItem("skrabaj-display-name", displayName);
    setOnlineLoading(true);
    const { data, error } = await supabase.rpc("join_match", {
      p_display_name: displayName,
      p_invite_code: inviteCode,
    });
    if (error || !data?.[0]) {
      setNotice(`Придруживање није успело: ${error?.message ?? "провери код"}`);
      setOnlineLoading(false);
      return;
    }
    setActiveMatchId(data[0].match_id);
    const { data: state, error: stateError } = await supabase.rpc("get_match_state", {
      p_match_id: data[0].match_id,
    });
    if (stateError) {
      setNotice(`Партија није учитана: ${stateError.message}`);
    } else {
      applyOnlineMatchState(state as OnlineMatchState);
      setOnlineModalOpen(false);
    }
    setOnlineLoading(false);
  }

  async function passOnlineTurn() {
    if (!supabase || !onlineState || !canPlayOnline || submitting) return;
    setSubmitting(true);
    const { data, error } = await supabase.rpc("pass_match_turn", {
      p_match_id: onlineState.match.id,
      p_expected_version: onlineState.match.version,
    });
    if (error) {
      setNotice(`Прескакање није успело: ${error.message}`);
    } else {
      applyOnlineMatchState(data as OnlineMatchState);
    }
    setSubmitting(false);
  }

  async function exchangeSelectedTiles() {
    if (submitting || exchangeTileIds.length === 0) return;
    setSubmitting(true);

    if (isOnline && onlineState) {
      const { data, error } = await supabase!.rpc("exchange_match_tiles", {
        p_match_id: onlineState.match.id,
        p_expected_version: onlineState.match.version,
        p_tile_ids: exchangeTileIds,
      });
      if (error) {
        setNotice(`Замена није успела: ${error.message}`);
      } else {
        applyOnlineMatchState(data as OnlineMatchState);
        setNotice("Слова су замењена. Настави потез са новим словима.");
      }
      setSubmitting(false);
      return;
    }

    const selected = new Set(exchangeTileIds);
    const returnedTiles = game.rack.filter((tile) => selected.has(tile.id));
    const remainingRack = game.rack.filter((tile) => !selected.has(tile.id));
    const replacement = drawTilesForRack(game.bag, returnedTiles.length, remainingRack);
    if (replacement.drawn.length !== returnedTiles.length) {
      setSubmitting(false);
      setNotice("У врећици нема довољно слова за замену.");
      return;
    }

    setGame((current) => ({
      ...current,
      bag: [...replacement.bag, ...returnedTiles],
      exchangeUsed: true,
      rack: [
        ...remainingRack,
        ...replacement.drawn,
      ],
    }));
    setExchangeMode(false);
    setExchangeTileIds([]);
    setNotice("Слова су замењена. Настави исти потез; замена за ову партију је искоришћена.");
    setSubmitting(false);
  }

  async function openLeaderboard() {
    setOpenModal("leaderboard");
    if (!supabase || backendStatus !== "ready") {
      setLeaderboardLoading(false);
      return;
    }

    setLeaderboardLoading(true);
    const { data, error } = await supabase.rpc("get_leaderboard", { p_limit: 50 });
    if (error) {
      setNotice(`Табела тренутно није доступна: ${error.message}`);
    } else {
      setLeaderboard((data ?? []) as LeaderboardEntry[]);
    }
    setLeaderboardLoading(false);
  }

  function selectRackTile(tile: RackTile) {
    setMoveFeedback(null);
    if (matchComplete) {
      setNotice("Партија је завршена после пет рунди.");
      return;
    }
    if (isOnline && !canPlayOnline) {
      setNotice("Сачекај ривалов потез.");
      return;
    }
    if (exchangeMode) {
      setExchangeTileIds((current) =>
        current.includes(tile.id)
          ? current.filter((tileId) => tileId !== tile.id)
          : [...current, tile.id],
      );
      setNotice("Изабери сва слова за замену, па потврди на дну екрана.");
      return;
    }
    setSelectedTileId((current) => (current === tile.id ? null : tile.id));
    setBlankLetter(null);
    setNotice(
      tile.letter
        ? `Изабрано слово ${tile.letter}. Додирни слободно поље.`
        : "Џокер је изабран. Прво му одреди слово.",
    );
  }

  function shuffleRack() {
    setGame((current) => ({ ...current, rack: shuffleTiles(current.rack) }));
    resetSelection();
    setNotice("Слова на сталку су промешана.");
  }

  function sortRack() {
    setGame((current) => ({
      ...current,
      rack: [...current.rack].sort((left, right) =>
        (left.letter ?? "ШШ").localeCompare(right.letter ?? "ШШ", "sr-Cyrl"),
      ),
    }));
    resetSelection();
    setNotice("Слова су сложена по азбучном реду.");
  }

  function startTileDrag(event: DragEvent<HTMLButtonElement>, tile: RackTile) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", tile.id);
    selectRackTile(tile);
  }

  function dropTile(event: DragEvent<HTMLButtonElement>, row: number, col: number) {
    event.preventDefault();
    handleBoardCell(row, col);
  }

  function reorderRack(event: DragEvent<HTMLButtonElement>, targetTileId: string) {
    event.preventDefault();
    const sourceTileId = event.dataTransfer.getData("text/plain");
    if (!sourceTileId || sourceTileId === targetTileId) return;
    setGame((current) => {
      const rack = [...current.rack];
      const sourceIndex = rack.findIndex((tile) => tile.id === sourceTileId);
      const targetIndex = rack.findIndex((tile) => tile.id === targetTileId);
      if (sourceIndex < 0 || targetIndex < 0) return current;
      const [tile] = rack.splice(sourceIndex, 1);
      rack.splice(targetIndex, 0, tile);
      return { ...current, rack };
    });
    resetSelection();
    setNotice("Редослед слова на сталку је промењен.");
  }

  function handleBoardCell(row: number, col: number) {
    setMoveFeedback(null);
    if (matchComplete) {
      setNotice("Партија је завршена после пет рунди.");
      return;
    }
    if (isOnline && !canPlayOnline) {
      setNotice("Сачекај ривалов потез.");
      return;
    }
    const existing = game.board[row][col];

    if (existing) {
      if (existing.committed) return;

      const nextBoard = cloneBoard(game.board);
      nextBoard[row][col] = null;
      const returnedTile: RackTile = {
        id: existing.id,
        letter: existing.isBlank ? null : existing.letter,
        value: existing.value,
      };

      setGame((current) => ({
        ...current,
        board: nextBoard,
        rack: [...current.rack, returnedTile],
      }));
      resetSelection();
      setNotice(`Слово ${existing.letter} је враћено на сталак.`);
      return;
    }

    if (!selectedTile) {
      setNotice("Прво изабери слово са сталка.");
      return;
    }

    if (!selectedTile.letter && !blankLetter) {
      setNotice("Изабери које слово представља џокер.");
      return;
    }

    const letter = selectedTile.letter ?? blankLetter;
    if (!letter) return;

    const nextBoard = cloneBoard(game.board);
    nextBoard[row][col] = {
      id: selectedTile.id,
      letter,
      value: selectedTile.value,
      isBlank: selectedTile.letter === null,
      committed: false,
    };

    setGame((current) => ({
      ...current,
      board: nextBoard,
      rack: current.rack.filter((tile) => tile.id !== selectedTile.id),
    }));
    if (soundEnabled) {
      navigator.vibrate?.(8);
      void playGameSound("placed", soundPalette);
    }
    if (!isOnline && game.turn >= MAX_ROUNDS) setResultModalOpen(true);
    resetSelection();
    setNotice(`Постављено: ${letter}.`);
  }

  function returnPendingTiles() {
    const returned: RackTile[] = [];
    const nextBoard = game.board.map((row) =>
      row.map((tile) => {
        if (!tile || tile.committed) return tile;
        returned.push({
          id: tile.id,
          letter: tile.isBlank ? null : tile.letter,
          value: tile.value,
        });
        return null;
      }),
    );

    if (returned.length === 0) {
      setNotice("Нема слова за враћање.");
      return;
    }

    setGame((current) => ({
      ...current,
      board: nextBoard,
      rack: [...current.rack, ...returned],
    }));
    setMoveFeedback(null);
    resetSelection();
    setNotice("Сва слова из текућег потеза су враћена.");
  }

  async function submitMove() {
    if (submitting || botThinking) return;
    if (matchComplete) {
      setNotice("Партија је завршена после пет рунди.");
      return;
    }
    const pendingTileIds = getPendingPositions(game.board)
      .map(({ row, col }) => game.board[row][col]?.id)
      .filter((tileId): tileId is string => Boolean(tileId));
    const result = evaluateMove(game.board);
    if (!result.valid) {
      triggerMoveFeedback("rejected", pendingTileIds);
      setNotice(result.error ?? "Потез није исправан.");
      return;
    }

    setSubmitting(true);
    if (isOnline && onlineState) {
      if (!canPlayOnline) {
        setSubmitting(false);
        setNotice("Сачекај ривалов потез.");
        return;
      }

      const placements = getPendingPositions(game.board).map(({ row, col }) => {
        const tile = game.board[row][col];
        return { row, col, tileId: tile?.id, letter: tile?.letter };
      });
      const { data, error } = await supabase!.rpc("submit_match_move", {
        p_match_id: onlineState.match.id,
        p_expected_version: onlineState.match.version,
        p_placements: placements,
      });
      if (error) {
        setSubmitting(false);
        triggerMoveFeedback("rejected", pendingTileIds);
        setLastRejectedWords(result.words.map(({ word }) => word));
        setNotice(`Потез није прихваћен: ${error.message}`);
        return;
      }
      applyOnlineMatchState(data as OnlineMatchState);
      triggerMoveFeedback("accepted", pendingTileIds);
      setSubmitting(false);
      return;
    }

    if (supabase && backendStatus === "ready") {
      const words = result.words.map(({ word }) => word.toLowerCase());
      const { data, error } = await supabase.rpc("check_dictionary_words", {
        p_words: words,
      });

      if (error) {
        try {
          const rejected = await checkLocalWords(words);
          if (rejected.length) {
            setSubmitting(false);
            triggerMoveFeedback("rejected", pendingTileIds);
            setNotice(`Речник не прихвата: ${rejected.join(", ")}.`);
            setLastRejectedWords(rejected);
            return;
          }
          setBackendStatus("offline");
        } catch {
          setSubmitting(false);
          triggerMoveFeedback("rejected", pendingTileIds);
          setNotice(`Провера речника није успела: ${error.message}`);
          return;
        }
      } else {
        const checkedWords = (data ?? []) as DictionaryCheckResult[];
        const accepted = new Set(
          checkedWords
            .filter((entry) => entry.accepted)
            .map((entry) => entry.word),
        );
        const rejected = words.filter((word) => !accepted.has(word));
        if (rejected.length) {
          setSubmitting(false);
          triggerMoveFeedback("rejected", pendingTileIds);
          setNotice(`Речник не прихвата: ${rejected.join(", ")}.`);
          setLastRejectedWords(rejected);
          return;
        }
      }
    } else {
      const rejected = await checkLocalWords(result.words.map(({ word }) => word));
      if (rejected.length) {
        setSubmitting(false);
        triggerMoveFeedback("rejected", pendingTileIds);
        setNotice(`Речник не прихвата: ${rejected.join(", ")}.`);
        setLastRejectedWords(rejected);
        return;
      }
    }

    const refill = drawTilesForRack(game.bag, RACK_SIZE - game.rack.length, game.rack);
    const nextGame: GameState = {
      ...game,
      board: commitMove(game.board),
      bag: refill.bag,
      rack: [...game.rack, ...refill.drawn],
      score: game.score + result.score,
      turn: game.turn + 1,
    };
    setGame(nextGame);
    triggerMoveFeedback("accepted", pendingTileIds);
    setMoveHistory((current) => [
      ...current,
      {
        id: `local-${game.turn}`,
        playerName: "Играч",
        score: result.score,
        tileIds: pendingTileIds,
        turn: game.turn,
        words: result.words.map(({ score, word }) => ({ score, word })),
      },
    ]);
    setLastRejectedWords([]);
    if (localMode === "daily" && game.turn >= MAX_ROUNDS) {
      const finalScore = game.score + result.score;
      window.localStorage.setItem(`skrabaj-daily-${dailySeed()}`, String(Math.max(dailyBest, finalScore)));
      setDailyBest((current) => Math.max(current, finalScore));
      if (supabase && backendStatus === "ready") {
        void supabase.rpc("submit_daily_challenge", { p_score: finalScore, p_move_count: MAX_ROUNDS }).then(({ data }) => {
          if (data) setDailyData(data as DailyChallengeData);
        });
      }
    }
    resetSelection();
    const localFinished = localMode !== "bot" && game.turn >= MAX_ROUNDS;
    setNotice(
      localFinished
        ? `Пет рунди је завршено. Освојено: ${game.score + result.score} поена.`
        : `${result.words.map(({ word }) => word).join(" + ")} · +${result.score} поена. ` +
          (supabase
            ? "Потез и све направљене речи су прихваћени."
            : "Потез је прихваћен без серверске провере речника."),
    );
    setSubmitting(false);
    if (localMode === "bot") void playBotTurn(nextGame);
  }

  return (
    <main className="game-shell">
      <header className="topbar">
        <Image className="brand-logo" alt="Шкрабај" height={961} priority src="/skrabaj.png" width={1693} />

        <div className="topbar-actions">
          <button
            aria-label={`Онлајн игра — ${backendStatus === "ready" ? "повезано" : backendStatus === "connecting" ? "повезивање" : "офлајн"}`}
            className={`nav-button nav-button--online nav-button--${backendStatus}`}
            onClick={openOnlineLobby}
            title="Онлајн игра"
            type="button"
          >
            <span className="status-dot" aria-hidden="true" />
            <span>Играј</span>
          </button>
          <button aria-label="Дневни изазов" className="nav-button nav-button--icon" onClick={openDailyChallenge} title="Дневни изазов" type="button">
            <GameIcon name="calendar" /><span className="desktop-label">Данас</span>
          </button>
          <button aria-label="Табела" className="nav-button nav-button--icon" onClick={openLeaderboard} title="Табела" type="button">
            <GameIcon name="trophy" />
            <span className="desktop-label">Табела</span>
          </button>
          <button aria-label="Правила" className="nav-button nav-button--icon" onClick={() => setOpenModal("rules")} title="Правила" type="button">
            <GameIcon name="book" />
            <span className="desktop-label">Правила</span>
          </button>
          <button aria-label="Подешавање звука" className={`nav-button nav-button--icon nav-button--sound ${soundEnabled ? "is-on" : "is-off"}`} onClick={() => setOpenModal("sound")} title="Подешавање звука" type="button">
            <GameIcon name={soundEnabled ? "sound" : "soundOff"} />
          </button>
        </div>
      </header>

      <section className={`intro ${game.turn > 1 || pendingCount > 0 || isOnline ? "intro--playing" : ""}`} id="top">
        <div>
          <p className="eyebrow">ТЕМЕЉ ИГРЕ · ВЕРЗИЈА 0.1</p>
          <h1>Освоји таблу.<br />Слово по слово.</h1>
          <p className="intro-copy">
            Брза партија на 9×9 табли, направљена за српски језик и игру у
            прегледачу. Ова верзија већ рачуна потезе, укрштања и бонус поља.
          </p>
        </div>
        <div className="legend" aria-label="Легенда бонус поља">
          <span><i className="legend-swatch letter2" /> слово ×2</span>
          <span><i className="legend-swatch letter3" /> слово ×3</span>
          <span><i className="legend-swatch word2" /> реч ×2</span>
          <span><i className="legend-swatch word3" /> реч ×3</span>
        </div>
      </section>

      {onlineState && (onlineState.match.status === "waiting" || onlineState.match.status === "active") && (
        <section className={`match-banner match-banner--${onlineState.match.status}`}>
          <span>
            <small>{onlineState.match.status === "waiting" ? "ЧЕКАМО РИВАЛА" : "ОНЛАЈН ПАРТИЈА"}</small>
            <strong>{onlineState.match.match_source === "quick" ? "Брза игра" : `Код ${onlineState.match.invite_code}`}</strong>
          </span>
          <p>
            {onlineState.match.status === "waiting"
              ? "Пошаљи код другом играчу."
              : canPlayOnline ? "Твој потез" : "Ривал је на потезу"}
          </p>
          <div className="match-banner__actions">
            {onlineState.match.status === "active" && <button onClick={resignOnlineMatch} type="button">Предај</button>}
            <button onClick={startNewGame} type="button">Изађи</button>
          </div>
        </section>
      )}

      <section className="match-strip" aria-label="Стање партије">
        <div className={`player-card ${playerIsActive ? "active-player" : ""}`}>
          <span className="avatar">ТИ</span>
          <span><small>{playerIsActive ? "НА ПОТЕЗУ" : "ИГРАЧ"}</small><strong>{viewer?.display_name ?? (localMode === "daily" ? "Дневни изазов" : "Играч")}</strong></span>
          <b>{game.score}</b>
        </div>
        <div className="round-indicator" aria-label={`Рунда ${currentRound} од ${MAX_ROUNDS}`}>
          <small>РУНДА <b>{currentRound}</b>/{MAX_ROUNDS}</small>
          <div className="round-dots" aria-hidden="true">
            {Array.from({ length: MAX_ROUNDS }, (_, index) => {
              const round = index + 1;
              const state = matchComplete || round < currentRound
                ? "complete"
                : round === currentRound
                  ? "active"
                  : "future";
              return <i className={state} key={round} />;
            })}
          </div>
          {remainingSeconds !== null && (
            <div className={`turn-clock ${remainingSeconds <= 10 ? "turn-clock--urgent" : ""}`} aria-label={`Преостало време ${remainingSeconds} секунди`}>
              <GameIcon name="clock" /><b>0:{String(remainingSeconds).padStart(2, "0")}</b>
            </div>
          )}
        </div>
        <div className={`player-card ${opponentIsActive ? "active-player" : ""} ${opponent ? "" : "future-player"}`}>
          <span className="avatar">{localMode === "bot" ? "Б" : opponent ? "РИ" : "?"}</span>
          <span><small>{opponentIsActive ? "НА ПОТЕЗУ" : "ПРОТИВНИК"}</small><strong>{localMode === "bot" ? "Букварко" : opponent?.display_name ?? "Противник"}</strong></span>
          <b>{localMode === "bot" ? botScore : opponent?.score ?? "—"}</b>
        </div>
      </section>

      <section className="play-area">
        <div className="board-column">
          <div className="board-frame">
            <div className="board" role="grid" aria-label="Табла 9 пута 9">
              {Array.from({ length: BOARD_SIZE }, (_, row) =>
                Array.from({ length: BOARD_SIZE }, (_, col) => {
                  const tile = game.board[row][col];
                  const premium = getPremium(row, col);
                  const isStart = row === START_CELL.row && col === START_CELL.col;
                  const isRivalDraft = isOnline && !tile && rivalDraftCells.has(`${row}-${col}`);
                  const feedbackIndex = tile ? (moveFeedback?.tileIds.indexOf(tile.id) ?? -1) : -1;
                  const feedbackClass = feedbackIndex >= 0 ? moveFeedback?.kind ?? "" : "";
                  const feedbackStyle = feedbackIndex >= 0
                    ? { "--feedback-order": feedbackIndex } as CSSProperties
                    : undefined;

                  return (
                    <button
                      aria-label={
                        tile
                          ? `${tile.letter}, ${tile.value} поена`
                          : isRivalDraft
                            ? "Ривал поставља плочицу на ово поље"
                          : isStart
                            ? "Почетна звезда, без бонуса"
                            : premium
                            ? PREMIUM_LABELS[premium].replace("\n", " ")
                            : `Поље ${row + 1}, ${col + 1}`
                      }
                      className={`board-cell ${premium ?? ""} ${isStart ? "start-cell" : ""} ${isRivalDraft ? "rival-draft" : ""} ${tile ? "occupied" : ""} ${tile && lastMoveTileIds.includes(tile.id) ? "last-move" : ""}`}
                      data-cell={`${row}-${col}`}
                      key={`${row}-${col}`}
                      disabled={matchComplete || botThinking || (isOnline && !canPlayOnline)}
                      onClick={() => handleBoardCell(row, col)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => dropTile(event, row, col)}
                      role="gridcell"
                      type="button"
                    >
                      {tile ? (
                        <span
                          className={`letter-tile board-tile ${tile.committed ? "committed" : pendingMoveAccepted ? "pending pending-valid" : "pending"} ${tile.isBlank ? "blank" : ""} ${feedbackClass}`}
                          key={`${tile.id}-${feedbackIndex >= 0 ? moveFeedback?.sequence : "idle"}`}
                          style={feedbackStyle}
                        >
                          <strong>{tile.letter}</strong>
                          <small>{tile.value}</small>
                        </span>
                      ) : isRivalDraft ? (
                        <span className="rival-draft-tile" aria-hidden="true">
                          <i /><i /><i />
                        </span>
                      ) : (
                        <span className="premium-label">
                          {isStart && <b aria-hidden="true">★</b>}
                          {premium &&
                            PREMIUM_LABELS[premium]
                              .split("\n")
                              .map((part) => <em key={part}>{part}</em>)}
                        </span>
                      )}
                    </button>
                  );
                }),
              )}
            </div>
          </div>

          <div className="rack-section">
            <div className="rack-heading">
              <span><small>ТВОЈА СЛОВА</small><strong>Слова</strong></span>
              <span className="rack-heading__tools">
                <button disabled={pendingCount > 0 || exchangeMode} onClick={shuffleRack} type="button">Промешај</button>
                <button disabled={pendingCount > 0 || exchangeMode} onClick={sortRack} type="button">Поређај</button>
                <button
                  className="rack-exchange-action"
                  disabled={!exchangeMode && !exchangeAvailable}
                  onClick={exchangeMode ? cancelExchange : beginExchange}
                  type="button"
                >
                  {exchangeMode ? "Одустани" : "Замени слова"}
                </button>
                <span className="bag-count">У врећици <b>{bagCount}</b></span>
              </span>
            </div>
            <div className="rack" aria-label="Сталак са словима">
              {game.rack.map((tile) => (
                <button
                  aria-pressed={exchangeMode ? exchangeTileIds.includes(tile.id) : selectedTileId === tile.id}
                  className={`letter-tile rack-tile ${exchangeMode && exchangeTileIds.includes(tile.id) ? "exchange-selected" : selectedTileId === tile.id ? "selected" : ""}`}
                  data-tile-id={tile.id}
                  disabled={matchComplete || botThinking || (isOnline && !canPlayOnline)}
                  draggable={!matchComplete && !botThinking && (!isOnline || canPlayOnline)}
                  key={tile.id}
                  onClick={() => selectRackTile(tile)}
                  onDragOver={(event) => event.preventDefault()}
                  onDragStart={(event) => startTileDrag(event, tile)}
                  onDrop={(event) => reorderRack(event, tile.id)}
                  type="button"
                >
                  <strong>{tile.letter ?? "★"}</strong>
                  <small>{tile.value}</small>
                </button>
              ))}
              {Array.from({ length: Math.max(0, RACK_SIZE - game.rack.length) }, (_, index) => (
                <span className="rack-placeholder" key={`empty-${index}`} />
              ))}
            </div>
          </div>
        </div>

        <aside className="turn-panel">
          <div className={`notice ${moveFeedback?.kind === "rejected" || pendingMoveRejected ? "notice-rejected" : moveFeedback?.kind === "accepted" || pendingMoveAccepted ? "notice-valid" : ""}`} aria-live="polite">
            <span aria-hidden="true">{moveFeedback?.kind === "rejected" || pendingMoveRejected ? "×" : moveFeedback?.kind === "accepted" || pendingMoveAccepted ? "✓" : "i"}</span>
            <p>{notice}</p>
          </div>
          {lastRejectedWords.length > 0 && (
            <button className="report-word" onClick={reportRejectedWords} type="button">Пријави реч за проверу</button>
          )}
          {localMode === "daily" && <p className="daily-best">Данашњи рекорд на овом уређају: <b>{dailyBest}</b></p>}

          <div className={`word-preview ${evaluation.words.length ? "" : "word-preview--empty"}`}>
            <small>ПОТЕЗ ПРАВИ</small>
            {evaluation.words.map((word) => (
              <div key={word.positions.map(({ row, col }) => `${row}-${col}`).join("|")}>
                <strong>{word.word}</strong><span>+{word.score}</span>
              </div>
            ))}
            {evaluation.words.length > 1 && <p>Сва укрштања се сабирају у укупан резултат.</p>}
            {evaluation.valid && (
              <p className={`word-check word-check--${pendingWordStatus}`}>
                {pendingWordStatus === "checking"
                  ? "Провера речника…"
                  : pendingWordStatus === "accepted"
                    ? "Речник прихвата потез."
                    : pendingWordStatus === "rejected"
                      ? "Речник не прихвата потез."
                      : "Провера речника није доступна."}
              </p>
            )}
          </div>

          {selectedTile?.letter === null && (
            <div className="blank-picker">
              <small>ЏОКЕР ПРЕДСТАВЉА</small>
              <div>
                {SERBIAN_ALPHABET.map((letter) => (
                  <button
                    className={blankLetter === letter ? "chosen" : ""}
                    key={letter}
                    onClick={() => setBlankLetter(letter)}
                    type="button"
                  >
                    {letter}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="turn-utilities">
            {!exchangeMode && pendingCount > 0 ? (
              <button className="secondary-action" onClick={returnPendingTiles} type="button">
                Поништи слова
              </button>
            ) : null}
            {!exchangeMode && isOnline && onlineState?.match.status === "active" && (
              <button
                className="secondary-action"
                disabled={!canPlayOnline || submitting || pendingCount > 0}
                onClick={passOnlineTurn}
                type="button"
              >
                Прескочи
              </button>
            )}
            {moveHistory.length > 0 && (
              <button className="secondary-action" onClick={() => setHistoryOpen((current) => !current)} type="button">
                {historyOpen ? "Сакриј потезе" : `Потези (${moveHistory.length})`}
              </button>
            )}
            {isOnline && !canPlayOnline && !notificationsEnabled && (
              <button className="secondary-action" onClick={enableTurnNotifications} type="button">Обавести ме</button>
            )}
          </div>

          {historyOpen && (
            <ol className="move-history">
              {[...moveHistory].reverse().map((move) => (
                <li key={move.id}>
                  <span>{move.turn}. {move.playerName}</span>
                  <strong>{move.words.map(({ word }) => word).join(" + ")}</strong>
                  <b>+{move.score}</b>
                </li>
              ))}
            </ol>
          )}

          <div className="turn-actions">
            <button
              className="primary-action"
              disabled={submitting || botThinking || matchComplete || (isOnline && !canPlayOnline) || (exchangeMode && exchangeTileIds.length === 0)}
              onClick={exchangeMode ? exchangeSelectedTiles : submitMove}
              type="button"
            >
              <span>
                {submitting
                  ? exchangeMode ? "МЕЊАМО СЛОВА…" : "ПРОВЕРА РЕЧНИКА…"
                  : exchangeMode ? `ЗАМЕНИ ИЗАБРАНА СЛОВА (${exchangeTileIds.length})` : "ПОТВРДИ ПОТЕЗ"}
              </span>
              {!exchangeMode && evaluation.valid && <b>{`+${evaluation.score}`}</b>}
            </button>
          </div>
        </aside>
      </section>
      {tutorialOpen && (
        <div className="tutorial-card" role="dialog" aria-label="Брзи водич">
          <button aria-label="Затвори водич" onClick={closeTutorial} type="button">×</button>
          <small>ПРВИ ПОТЕЗ</small>
          <strong>1. Изабери слово · 2. Додирни звезду · 3. Потврди реч</strong>
          <p>Наранџасти оквир показује слова текућег потеза, а резултат се рачуна пре потврде.</p>
          <button className="tutorial-done" onClick={closeTutorial} type="button">Разумем</button>
        </div>
      )}
      {openModal === "rules" && <RulesModal onClose={() => setOpenModal(null)} />}
      {openModal === "daily" && (
        <DailyChallengeModal
          currentUserId={userId}
          data={dailyData}
          loading={playerHubLoading}
          onClose={() => setOpenModal(null)}
          onPlay={() => {
            setOpenModal(null);
            startDailyChallenge();
          }}
          onShare={shareDailyResult}
        />
      )}
      {openModal === "leaderboard" && (
        <LeaderboardModal
          currentUserId={userId}
          entries={leaderboard}
          loading={leaderboardLoading}
          onClose={() => setOpenModal(null)}
        />
      )}
      {openModal === "sound" && (
        <SoundSettingsModal
          enabled={soundEnabled}
          onClose={() => setOpenModal(null)}
          onEnabledChange={setSound}
          onPaletteChange={chooseSoundPalette}
          palette={soundPalette}
        />
      )}
      {onlineModalOpen && (
        <OnlineGameModal
          account={account}
          activeMatch={onlineState && (onlineState.match.status === "waiting" || onlineState.match.status === "active") ? {
            code: onlineState.match.invite_code,
            mode: onlineState.match.game_mode,
            source: onlineState.match.match_source,
            status: onlineState.match.status,
          } : null}
          displayName={onlineDisplayName}
          hub={playerHub}
          hubLoading={playerHubLoading}
          loading={onlineLoading}
          notice={onlineNotice}
          onCancelQuickMatch={cancelQuickMatch}
          onClose={() => setOnlineModalOpen(false)}
          onCreate={createOnlineMatch}
          onDisplayNameChange={setOnlineDisplayName}
          onEmailAuth={authenticateWithEmail}
          onGoogleAuth={authenticateWithGoogle}
          onJoin={joinOnlineMatch}
          onQuickMatch={findQuickMatch}
          onResume={resumeOnlineMatch}
          onSignOut={signOutAccount}
          initialInviteCode={initialInviteCode}
        />
      )}
      {resultModalOpen && matchComplete && (
        <GameResultModal
          actionLabel={isOnline ? "РЕВАНШ" : "НОВА ПАРТИЈА"}
          kind={resultKind}
          onClose={closeResultModal}
          onNewGame={isOnline ? rematchOnline : localMode === "bot" ? startBotGame : localMode === "daily" ? startDailyChallenge : startNewGame}
          onOpenLeaderboard={() => {
            setResultModalOpen(false);
            if (localMode === "daily") openDailyChallenge();
            else void openLeaderboard();
          }}
          onShare={localMode === "daily" ? shareDailyResult : undefined}
          opponentName={localMode === "bot" ? "Букварко" : opponent?.display_name}
          opponentScore={localMode === "bot" ? botScore : opponent?.score}
          playerName={viewer?.display_name ?? "Играч"}
          playerScore={game.score}
        />
      )}
    </main>
  );
}
