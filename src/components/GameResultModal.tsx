"use client";

import { AppModal } from "@/components/AppModal";

export type GameResultKind = "win" | "lose" | "draw" | "summary";

interface GameResultModalProps {
  kind: GameResultKind;
  onClose: () => void;
  onNewGame: () => void;
  onOpenLeaderboard: () => void;
  opponentName?: string;
  opponentScore?: number;
  playerName: string;
  playerScore: number;
}

const RESULT_COPY: Record<GameResultKind, { eyebrow: string; icon: string; title: string; message: string }> = {
  win: {
    eyebrow: "ПАРТИЈА ЈЕ ЗАВРШЕНА",
    icon: "★",
    title: "Победа!",
    message: "Одлична партија — табла је твоја.",
  },
  lose: {
    eyebrow: "ПАРТИЈА ЈЕ ЗАВРШЕНА",
    icon: "X",
    title: "Овог пута — ривал.",
    message: "Добра борба. Нова партија је само један додир далеко.",
  },
  draw: {
    eyebrow: "ПАРТИЈА ЈЕ ЗАВРШЕНА",
    icon: "=",
    title: "Нерешено!",
    message: "Потпуно изједначена партија. Време је за реванш.",
  },
  summary: {
    eyebrow: "ПЕТ РУНДИ ЈЕ ГОТОВО",
    icon: "✓",
    title: "Сјајно шкрабање!",
    message: "Резултат је сачуван на табли — пробај да га надмашиш.",
  },
};

export function GameResultModal({
  kind,
  onClose,
  onNewGame,
  onOpenLeaderboard,
  opponentName,
  opponentScore,
  playerName,
  playerScore,
}: GameResultModalProps) {
  const copy = RESULT_COPY[kind];

  return (
    <AppModal eyebrow={copy.eyebrow} onClose={onClose} title={copy.title}>
      <div className={`result-card result-card--${kind}`}>
        <div className="result-badge" aria-hidden="true">{copy.icon}</div>
        <p className="result-message">{copy.message}</p>

        <div className="result-scoreboard">
          <div className="result-score result-score--player">
            <span>ТИ</span>
            <strong>{playerName}</strong>
            <b>{playerScore}</b>
          </div>
          {opponentName && typeof opponentScore === "number" && (
            <>
              <i aria-hidden="true">:</i>
              <div className="result-score">
                <span>РИВАЛ</span>
                <strong>{opponentName}</strong>
                <b>{opponentScore}</b>
              </div>
            </>
          )}
        </div>

        <button className="primary-action modal-action result-rematch" onClick={onNewGame} type="button">
          <span>НОВА ПАРТИЈА</span><b>→</b>
        </button>
        <button className="result-table-link" onClick={onOpenLeaderboard} type="button">
          Погледај табелу
        </button>
      </div>
    </AppModal>
  );
}
