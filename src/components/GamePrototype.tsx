"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import { createTileBag, drawTiles, shuffleTiles } from "@/game/tiles";
import type { Board, RackTile, SerbianLetter } from "@/game/types";
import { supabase } from "@/lib/supabase/client";
import { LeaderboardModal, type LeaderboardEntry } from "@/components/LeaderboardModal";
import { GameResultModal, type GameResultKind } from "@/components/GameResultModal";
import { OnlineGameModal } from "@/components/OnlineGameModal";
import { RulesModal } from "@/components/RulesModal";

type BackendStatus = "connecting" | "ready" | "offline";

interface DictionaryCheckResult {
  word: string;
  accepted: boolean;
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
}

interface OnlineMatchState {
  match: OnlineMatchRecord;
  rack: RackTile[];
  players: OnlinePlayer[];
  bag_count: number;
  viewer_id: string;
}

const MAX_ROUNDS = 5;
const TURNS_PER_ROUND = 2;
const MAX_TURNS = MAX_ROUNDS * TURNS_PER_ROUND;

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function buildNewGame(random: () => number = Math.random): GameState {
  const shuffledBag = shuffleTiles(createTileBag(), random);
  const firstDraw = drawTiles(shuffledBag, RACK_SIZE);

  return {
    board: createEmptyBoard(),
    bag: firstDraw.bag,
    exchangeUsed: false,
    rack: firstDraw.drawn,
    score: 0,
    turn: 1,
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
  const [openModal, setOpenModal] = useState<"rules" | "leaderboard" | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [onlineModalOpen, setOnlineModalOpen] = useState(false);
  const [onlineDisplayName, setOnlineDisplayName] = useState("");
  const [onlineLoading, setOnlineLoading] = useState(false);
  const [activeMatchId, setActiveMatchId] = useState<string | null>(null);
  const [onlineState, setOnlineState] = useState<OnlineMatchState | null>(null);
  const [resultModalOpen, setResultModalOpen] = useState(false);

  const applyOnlineMatchState = useCallback((nextState: OnlineMatchState) => {
    setOnlineState(nextState);
    const board = nextState.match.board.length === BOARD_SIZE
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
    if (nextState.match.status !== "waiting") setOnlineModalOpen(false);

    if (nextState.match.status === "waiting") {
      setNotice("Партија је направљена. Пошаљи позивни код другом играчу.");
    } else if (nextState.match.status === "completed") {
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
            setNotice(`Сервис за игру тренутно није доступан: ${error.message}`);
          }
          return;
        }
        session = signedIn.session;
      }

      if (session?.access_token) await supabase.realtime.setAuth(session.access_token);
      if (active) {
        setUserId(session?.user.id ?? null);
        setBackendStatus("ready");
      }
    }

    void connectLocalBackend();
    return () => {
      active = false;
    };
  }, []);

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
      .channel(`match-ui-${activeMatchId}`)
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
      .subscribe();

    return () => {
      active = false;
      void client.removeChannel(channel);
    };
  }, [activeMatchId, applyOnlineMatchState]);

  const selectedTile = game.rack.find((tile) => tile.id === selectedTileId) ?? null;
  const evaluation = useMemo(() => evaluateMove(game.board), [game.board]);
  const pendingCount = useMemo(
    () => getPendingPositions(game.board).length,
    [game.board],
  );
  const viewer = onlineState?.players.find((player) => player.user_id === userId) ?? null;
  const opponent = onlineState?.players.find((player) => player.user_id !== userId) ?? null;
  const isOnline = Boolean(activeMatchId && onlineState);
  const canPlayOnline = Boolean(
    isOnline && onlineState?.match.status === "active" && onlineState.match.current_player_id === userId,
  );
  const matchComplete = isOnline
    ? onlineState?.match.status === "completed"
    : game.turn > MAX_TURNS;
  const currentRound = Math.min(
    MAX_ROUNDS,
    Math.ceil(Math.min(game.turn, MAX_TURNS) / TURNS_PER_ROUND),
  );
  const playerIsActive = !matchComplete && (!isOnline || canPlayOnline);
  const opponentIsActive = Boolean(
    !matchComplete && isOnline && onlineState?.match.status === "active" && !canPlayOnline,
  );
  const exchangeUsed = isOnline ? (viewer?.exchange_used ?? true) : game.exchangeUsed;
  const bagCount = onlineState?.bag_count ?? game.bag.length;
  const exchangeAvailable = Boolean(
    !matchComplete && playerIsActive && !exchangeUsed && bagCount > 0 && pendingCount === 0,
  );
  const resultKind: GameResultKind = isOnline
    ? onlineState?.match.winner_id === null
      ? "draw"
      : onlineState?.match.winner_id === onlineState?.viewer_id
        ? "win"
        : "lose"
    : "summary";

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
    setActiveMatchId(null);
    setOnlineState(null);
    setResultModalOpen(false);
    setGame(buildNewGame());
    resetSelection();
    setNotice("Нова партија је спремна. Прва реч иде преко звезде.");
  }

  function openOnlineLobby() {
    setOnlineDisplayName((current) => current || window.localStorage.getItem("skrabaj-display-name") || "");
    setOnlineModalOpen(true);
  }

  function openNewOnlineGame() {
    startNewGame();
    openOnlineLobby();
  }

  async function createOnlineMatch(displayName: string) {
    if (!supabase || backendStatus !== "ready") {
      setNotice("Потребна је веза са сервисом за онлајн партију.");
      return;
    }
    window.localStorage.setItem("skrabaj-display-name", displayName);
    setOnlineLoading(true);
    const { data, error } = await supabase.rpc("create_match", {
      p_display_name: displayName,
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
    const replacement = drawTiles(game.bag, returnedTiles.length);
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
        ...current.rack.filter((tile) => !selected.has(tile.id)),
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
    if (!supabase) return;

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

  function handleBoardCell(row: number, col: number) {
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
    if (game.turn >= MAX_TURNS) setResultModalOpen(true);
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
    resetSelection();
    setNotice("Сва слова из текућег потеза су враћена.");
  }

  async function submitMove() {
    if (submitting) return;
    if (matchComplete) {
      setNotice("Партија је завршена после пет рунди.");
      return;
    }
    const result = evaluateMove(game.board);
    if (!result.valid) {
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
        setNotice(`Потез није прихваћен: ${error.message}`);
        return;
      }
      applyOnlineMatchState(data as OnlineMatchState);
      setSubmitting(false);
      return;
    }

    if (supabase) {
      const words = result.words.map(({ word }) => word.toLowerCase());
      const { data, error } = await supabase.rpc("check_dictionary_words", {
        p_words: words,
      });

      if (error) {
        setSubmitting(false);
        setNotice(`Провера речника није успела: ${error.message}`);
        return;
      }

      const checkedWords = (data ?? []) as DictionaryCheckResult[];
      const accepted = new Set(
        checkedWords
          .filter((entry) => entry.accepted)
          .map((entry) => entry.word),
      );
      const rejected = words.filter((word) => !accepted.has(word));
      if (rejected.length) {
        setSubmitting(false);
        setNotice(`Речник не прихвата: ${rejected.join(", ")}.`);
        return;
      }
    }

    const refill = drawTiles(game.bag, RACK_SIZE - game.rack.length);
    setGame((current) => ({
      ...current,
      board: commitMove(current.board),
      bag: refill.bag,
      rack: [...current.rack, ...refill.drawn],
      score: current.score + result.score,
      turn: current.turn + 1,
    }));
    resetSelection();
    setNotice(
      game.turn >= MAX_TURNS
        ? `Пет рунди је завршено. Освојено: ${game.score + result.score} поена.`
        : `${result.words.map(({ word }) => word).join(" + ")} · +${result.score} поена. ` +
          (supabase
            ? "Потез и све направљене речи су прихваћени."
            : "Потез је прихваћен без серверске провере речника."),
    );
    setSubmitting(false);
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
          <button aria-label="Правила" className="nav-button nav-button--icon" onClick={() => setOpenModal("rules")} title="Правила" type="button">
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 17.2v.1M9.8 9.2a2.3 2.3 0 1 1 3.6 1.9c-.9.6-1.4 1.1-1.4 2.2"/><circle cx="12" cy="12" r="9"/></svg>
            <span className="desktop-label">Правила</span>
          </button>
          <button aria-label="Табела" className="nav-button nav-button--icon" onClick={openLeaderboard} title="Табела" type="button">
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M8 4h8v3.5a4 4 0 0 1-8 0V4Z"/><path d="M8 6H5v1.5A3.5 3.5 0 0 0 8.5 11M16 6h3v1.5a3.5 3.5 0 0 1-3.5 3.5M12 12v4M9 20h6M10 16h4v4"/></svg>
            <span className="desktop-label">Табела</span>
          </button>
        </div>
      </header>

      <section className="intro" id="top">
        <div>
          <p className="eyebrow">ТЕМЕЉ ИГРЕ · ВЕРЗИЈА 0.1</p>
          <h1>Освоји таблу.<br />Слово по слово.</h1>
          <p className="intro-copy">
            Брза партија на 8×8 табли, направљена за српски језик и игру у
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

      {onlineState && (
        <section className={`match-banner match-banner--${onlineState.match.status}`}>
          <span>
            <small>{onlineState.match.status === "waiting" ? "ЧЕКАМО РИВАЛА" : "ОНЛАЈН ПАРТИЈА"}</small>
            <strong>Код {onlineState.match.invite_code}</strong>
          </span>
          <p>
            {onlineState.match.status === "waiting"
              ? "Пошаљи код другом играчу."
              : onlineState.match.status === "completed"
                ? "Партија је завршена."
                : canPlayOnline ? "Твој потез" : "Ривал је на потезу"}
          </p>
          <button onClick={startNewGame} type="button">Изађи</button>
        </section>
      )}

      <section className="match-strip" aria-label="Стање партије">
        <div className={`player-card ${playerIsActive ? "active-player" : ""}`}>
          <span className="avatar">ТИ</span>
          <span><small>{playerIsActive ? "НА ПОТЕЗУ" : "ИГРАЧ"}</small><strong>{viewer?.display_name ?? "Играч"}</strong></span>
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
        </div>
        <div className={`player-card ${opponentIsActive ? "active-player" : ""} ${opponent ? "" : "future-player"}`}>
          <span className="avatar">{opponent ? "РИ" : "?"}</span>
          <span><small>{opponentIsActive ? "НА ПОТЕЗУ" : "ПРОТИВНИК"}</small><strong>{opponent?.display_name ?? "Противник"}</strong></span>
          <b>{opponent?.score ?? "—"}</b>
        </div>
      </section>

      <section className="play-area">
        <div className="board-column">
          <div className="board-frame">
            <div className="board" role="grid" aria-label="Табла 8 пута 8">
              {Array.from({ length: BOARD_SIZE }, (_, row) =>
                Array.from({ length: BOARD_SIZE }, (_, col) => {
                  const tile = game.board[row][col];
                  const premium = getPremium(row, col);
                  const isStart = row === START_CELL.row && col === START_CELL.col;

                  return (
                    <button
                      aria-label={
                        tile
                          ? `${tile.letter}, ${tile.value} поена`
                          : premium
                            ? PREMIUM_LABELS[premium].replace("\n", " ")
                            : `Поље ${row + 1}, ${col + 1}`
                      }
                      className={`board-cell ${premium ?? ""} ${tile ? "occupied" : ""}`}
                      data-cell={`${row}-${col}`}
                      key={`${row}-${col}`}
                      disabled={matchComplete || (isOnline && !canPlayOnline)}
                      onClick={() => handleBoardCell(row, col)}
                      role="gridcell"
                      type="button"
                    >
                      {tile ? (
                        <span
                          className={`letter-tile board-tile ${tile.committed ? "committed" : "pending"} ${tile.isBlank ? "blank" : ""}`}
                        >
                          <strong>{tile.letter}</strong>
                          <small>{tile.value}</small>
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
              <span className="bag-count">У врећици <b>{bagCount}</b></span>
            </div>
            <div className="rack" aria-label="Сталак са словима">
              {game.rack.map((tile) => (
                <button
                  aria-pressed={exchangeMode ? exchangeTileIds.includes(tile.id) : selectedTileId === tile.id}
                  className={`letter-tile rack-tile ${exchangeMode && exchangeTileIds.includes(tile.id) ? "exchange-selected" : selectedTileId === tile.id ? "selected" : ""}`}
                  data-tile-id={tile.id}
                  disabled={matchComplete || (isOnline && !canPlayOnline)}
                  key={tile.id}
                  onClick={() => selectRackTile(tile)}
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
          <div className={`notice ${evaluation.valid ? "notice-valid" : ""}`} aria-live="polite">
            <span aria-hidden="true">{evaluation.valid ? "✓" : "i"}</span>
            <p>{notice}</p>
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
            {exchangeMode ? (
              <button className="secondary-action" onClick={cancelExchange} type="button">
                Одустани од замене
              </button>
            ) : pendingCount > 0 ? (
              <button className="secondary-action" onClick={returnPendingTiles} type="button">
                Поништи слова
              </button>
            ) : exchangeAvailable ? (
              <button className="secondary-action exchange-action" onClick={beginExchange} type="button">
                Замени слова
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
          </div>

          <div className="turn-actions">
            <button
              className="primary-action"
              disabled={submitting || matchComplete || (isOnline && !canPlayOnline) || (exchangeMode && exchangeTileIds.length === 0)}
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
      {openModal === "rules" && <RulesModal onClose={() => setOpenModal(null)} />}
      {openModal === "leaderboard" && (
        <LeaderboardModal
          entries={leaderboard}
          loading={leaderboardLoading}
          onClose={() => setOpenModal(null)}
        />
      )}
      {onlineModalOpen && (
        <OnlineGameModal
          activeCode={onlineState?.match.status === "waiting" ? onlineState.match.invite_code : null}
          displayName={onlineDisplayName}
          loading={onlineLoading}
          onClose={() => setOnlineModalOpen(false)}
          onCreate={createOnlineMatch}
          onDisplayNameChange={setOnlineDisplayName}
          onJoin={joinOnlineMatch}
        />
      )}
      {resultModalOpen && matchComplete && (
        <GameResultModal
          kind={resultKind}
          onClose={() => setResultModalOpen(false)}
          onNewGame={openNewOnlineGame}
          onOpenLeaderboard={() => {
            setResultModalOpen(false);
            void openLeaderboard();
          }}
          opponentName={opponent?.display_name}
          opponentScore={opponent?.score}
          playerName={viewer?.display_name ?? "Играч"}
          playerScore={game.score}
        />
      )}
    </main>
  );
}
