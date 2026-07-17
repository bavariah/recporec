"use client";

import { AppModal } from "@/components/AppModal";

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
  entries: LeaderboardEntry[];
  loading: boolean;
  onClose: () => void;
}

export function LeaderboardModal({ entries, loading, onClose }: LeaderboardModalProps) {
  return (
    <AppModal eyebrow="УКУПНИ ПЛАСМАН" onClose={onClose} title="Табела играча" wide>
      <p className="leaderboard-note">Пласман је по укупним поенима, затим по победама и просеку.</p>
      {loading ? (
        <div className="leaderboard-empty">Учитавање табеле…</div>
      ) : entries.length === 0 ? (
        <div className="leaderboard-empty">
          <span aria-hidden="true">♜</span>
          <strong>Табела чека прву завршену партију.</strong>
          <p>Резултати ће се овде појавити аутоматски.</p>
        </div>
      ) : (
        <div className="leaderboard-table-wrap">
          <table className="leaderboard-table">
            <thead><tr><th>#</th><th>Играч</th><th>Партије</th><th>П / И</th><th>Поени</th><th>Просек</th></tr></thead>
            <tbody>
              {entries.map((entry, index) => (
                <tr key={entry.user_id}>
                  <td><span className={`rank rank-${index + 1}`}>{index + 1}</span></td>
                  <th scope="row">{entry.display_name}</th>
                  <td>{entry.total_games}</td>
                  <td>{entry.wins} / {entry.losses}</td>
                  <td><strong>{entry.total_points}</strong></td>
                  <td>{Number(entry.average_points).toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppModal>
  );
}
