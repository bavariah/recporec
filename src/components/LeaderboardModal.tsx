"use client";

import { AppModal } from "@/components/AppModal";
import { GameIcon } from "@/components/GameIcon";

export interface LeaderboardEntry {
  user_id: string;
  display_name: string;
  total_games: number;
  wins: number;
  losses: number;
  total_points: number;
  average_points: number;
}

interface LeaderboardModalProps {
  currentUserId?: string | null;
  entries: LeaderboardEntry[];
  loading: boolean;
  onClose: () => void;
}

export function LeaderboardModal({ currentUserId, entries, loading, onClose }: LeaderboardModalProps) {
  const podium = entries.slice(0, 3);
  const rest = entries.slice(3);

  return (
    <AppModal
      eyebrow="УКУПНИ ПЛАСМАН"
      icon={<GameIcon name="trophy" />}
      onClose={onClose}
      title="Табела играча"
      variant="leaderboard"
      wide
    >
      <p className="leaderboard-note"><GameIcon name="sparkles" /> Поени одлучују пласман, затим победе и просек.</p>
      {loading ? (
        <div className="leaderboard-empty leaderboard-empty--loading"><span className="modal-loader" />Учитавање табеле…</div>
      ) : entries.length === 0 ? (
        <div className="leaderboard-empty">
          <GameIcon name="trophy" />
          <strong>Табела чека прву завршену партију.</strong>
          <p>Резултати ће се овде појавити аутоматски.</p>
        </div>
      ) : (
        <>
          <div className="leaderboard-podium">
            {podium.map((entry, index) => (
              <article
                className={`podium-card podium-card--${index + 1} ${entry.user_id === currentUserId ? "is-you" : ""}`}
                key={entry.user_id}
              >
                <div className="podium-card__header">
                  <div className="podium-card__identity">
                    <small>{index === 0 ? "ШАМПИОН" : `${index + 1}. МЕСТО`}</small>
                    <strong>{entry.display_name}{entry.user_id === currentUserId && <em>ТИ</em>}</strong>
                  </div>
                  <span className={`rank rank-${index + 1}`}>{index === 0 ? <GameIcon name="crown" /> : index + 1}</span>
                </div>
                <b>{entry.total_points}<small> поена</small></b>
                <dl>
                  <div><dt>Победе</dt><dd>{entry.wins}</dd></div>
                  <div><dt>Просек</dt><dd>{Number(entry.average_points).toFixed(1)}</dd></div>
                  <div><dt>Партије</dt><dd>{entry.total_games}</dd></div>
                </dl>
              </article>
            ))}
          </div>
          {rest.length > 0 && (
            <div className="leaderboard-rest">
              <small>ОСТАЛИ ИГРАЧИ</small>
              {rest.map((entry, index) => (
                <article className={entry.user_id === currentUserId ? "is-you" : ""} key={entry.user_id}>
                  <span>{index + 4}</span>
                  <strong>{entry.display_name}{entry.user_id === currentUserId && <em>ТИ</em>}</strong>
                  <small>{entry.wins} победа · просек {Number(entry.average_points).toFixed(1)}</small>
                  <b>{entry.total_points}</b>
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </AppModal>
  );
}
