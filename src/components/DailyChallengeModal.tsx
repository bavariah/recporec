"use client";

import { AppModal } from "@/components/AppModal";
import { GameIcon } from "@/components/GameIcon";
import { PlayerAvatar, type PlayerProfileAppearance } from "@/components/PlayerAvatar";

interface DailyChallengeData {
  best: number;
  date: string;
  entries: Array<{ display_name: string; rank: number; score: number; user_id: string } & PlayerProfileAppearance>;
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
        <section className="daily-leaderboard">
          <div><small>ДАНАШЊА ТАБЕЛА</small><b>{data?.entries.length ?? 0} играча</b></div>
          {loading ? <p>Учитавање резултата…</p> : data?.entries.length ? (
            <ol>{data.entries.slice(0, 20).map((entry) => <li className={entry.user_id === currentUserId ? "is-you" : ""} key={entry.user_id}><b>{entry.rank}</b><PlayerAvatar avatar_key={entry.avatar_key} avatar_path={entry.avatar_path} displayName={entry.display_name} /><span>{entry.display_name}{entry.user_id === currentUserId && <em>ТИ</em>}</span><strong>{entry.score}</strong></li>)}</ol>
          ) : <p>Још нема завршених изазова данас. Буди први!</p>}
        </section>
      </div>
    </AppModal>
  );
}
