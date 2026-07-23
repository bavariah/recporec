"use client";

import { useState } from "react";
import { AppModal } from "@/components/AppModal";
import { GameIcon } from "@/components/GameIcon";
import { PlayerAvatar, type PlayerProfileAppearance } from "@/components/PlayerAvatar";

interface DailyOverallEntry extends PlayerProfileAppearance {
  average_score: number;
  best_score: number;
  challenges_played: number;
  display_name: string;
  rank: number;
  total_score: number;
  user_id: string;
}

interface DailyChallengeData {
  best: number;
  date: string;
  entries: Array<{ display_name: string; rank: number; score: number; user_id: string } & PlayerProfileAppearance>;
  overall_count: number;
  overall_entries: DailyOverallEntry[];
  overall_rank: number | null;
  rank: number | null;
  streak: number;
}

interface DailyChallengeModalProps {
  currentUserId: string | null;
  data: DailyChallengeData | null;
  loading: boolean;
  onClose: () => void;
  onPlay: () => void;
  onShare: () => void;
}

export function DailyChallengeModal({ currentUserId, data, loading, onClose, onPlay, onShare }: DailyChallengeModalProps) {
  const [ranking, setRanking] = useState<"overall" | "today">("today");
  const entries = ranking === "today" ? data?.entries ?? [] : data?.overall_entries ?? [];

  return (
    <AppModal eyebrow="ИСТА СЛОВА ЗА СВЕ" icon={<GameIcon name="calendar" />} onClose={onClose} position="upper" title="Дневни изазов" variant="default">
      <div className="daily-modal">
        <div className="daily-hero">
          <span><GameIcon name="flame" /></span>
          <div><small>ТВОЈ НИЗ</small><strong>{data?.streak ?? 0}</strong><em>дана</em></div>
          <div><small>НАЈБОЉЕ ДАНАС</small><strong>{data?.best ?? 0}</strong><em>{data?.rank ? `#${data.rank}` : "без пласмана"}</em></div>
        </div>
        <p>Пет потеза са истим почетним словима као и сви остали играчи данас.</p>
        <button className="primary-action modal-action" onClick={onPlay} type="button">ИГРАЈ ДАНАШЊИ ИЗАЗОВ <span>→</span></button>
        {(data?.best ?? 0) > 0 && <button className="secondary-action modal-action daily-share" onClick={onShare} type="button"><GameIcon name="share" /> Подели резултат</button>}
        <div className="daily-ranking-tabs" role="tablist" aria-label="Табела Дневног изазова">
          <button aria-selected={ranking === "today"} className={ranking === "today" ? "selected" : ""} onClick={() => setRanking("today")} role="tab" type="button">ДАНАС</button>
          <button aria-selected={ranking === "overall"} className={ranking === "overall" ? "selected" : ""} onClick={() => setRanking("overall")} role="tab" type="button">УКУПНО</button>
        </div>
        <section className={`daily-leaderboard ${ranking === "overall" ? "daily-leaderboard--overall" : ""}`}>
          <div>
            <small>{ranking === "today" ? "ДАНАШЊА ТАБЕЛА" : "УКУПНИ ДНЕВНИ ПЛАСМАН"}</small>
            <b>{ranking === "today" ? data?.entries.length ?? 0 : data?.overall_count ?? 0} играча</b>
          </div>
          {loading ? <p>Учитавање резултата…</p> : entries.length ? (
            ranking === "today" ? (
              <ol>{data!.entries.slice(0, 20).map((entry) => <li className={entry.user_id === currentUserId ? "is-you" : ""} key={entry.user_id}><b>{entry.rank}</b><PlayerAvatar avatar_key={entry.avatar_key} avatar_path={entry.avatar_path} displayName={entry.display_name} /><span>{entry.display_name}{entry.user_id === currentUserId && <em>ТИ</em>}</span><strong>{entry.score}</strong></li>)}</ol>
            ) : (
              <ol>{data!.overall_entries.slice(0, 20).map((entry) => (
                <li className={entry.user_id === currentUserId ? "is-you" : ""} key={entry.user_id}>
                  <b>{entry.rank}</b>
                  <PlayerAvatar avatar_key={entry.avatar_key} avatar_path={entry.avatar_path} displayName={entry.display_name} />
                  <span>
                    <strong>{entry.display_name}{entry.user_id === currentUserId && <em>ТИ</em>}</strong>
                    <small>{entry.challenges_played} изазова · најбоље {entry.best_score} · просек {Number(entry.average_score).toFixed(1)}</small>
                  </span>
                  <strong>{entry.total_score}<small> укупно</small></strong>
                </li>
              ))}</ol>
            )
          ) : <p>{ranking === "today" ? "Још нема завршених изазова данас. Буди први!" : "Укупна табела чека први завршени Дневни изазов."}</p>}
        </section>
      </div>
    </AppModal>
  );
}
