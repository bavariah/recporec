"use client";

import { useState } from "react";
import { AppModal } from "@/components/AppModal";
import { GameIcon } from "@/components/GameIcon";

export type GameMode = "quick" | "relaxed";

const QUICK_MATCHMAKING_VISIBLE = false;

export interface PlayerHubMatch {
  game_mode: GameMode;
  invite_code?: string;
  match_id: string;
  match_source?: "invite" | "quick";
  my_score?: number;
  opponent_name?: string | null;
  opponent_score?: number | null;
  result?: "win" | "loss" | "draw";
  status?: "waiting" | "active";
  updated_at: string;
}

export interface PlayerHub {
  open_matches: PlayerHubMatch[];
  profile: { display_name: string; id: string } | null;
  recent_matches: PlayerHubMatch[];
  stats: { average: number; games: number; points: number; wins: number };
}

interface OnlineGameModalProps {
  activeMatch: {
    code: string;
    mode: GameMode;
    source: "invite" | "quick";
    status: "waiting" | "active";
  } | null;
  displayName: string;
  hub: PlayerHub | null;
  hubLoading: boolean;
  initialInviteCode?: string;
  loading: boolean;
  notice?: string;
  onCancelQuickMatch: () => Promise<void>;
  onClose: () => void;
  onCreate: (displayName: string, mode: GameMode) => Promise<void>;
  onDisplayNameChange: (displayName: string) => void;
  onJoin: (displayName: string, inviteCode: string) => Promise<void>;
  onQuickMatch: (displayName: string) => Promise<void>;
  onResume: (matchId: string) => void;
}

function modeLabel(mode: GameMode) {
  return mode === "quick" ? "Брза · 60 сек" : "Опуштена";
}

function relativeDate(value: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return "управо";
  if (minutes < 60) return `пре ${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `пре ${hours} ч`;
  return new Intl.DateTimeFormat("sr-Cyrl-RS", { day: "numeric", month: "short" }).format(new Date(value));
}

export function OnlineGameModal({
  activeMatch,
  displayName,
  hub,
  hubLoading,
  initialInviteCode = "",
  loading,
  notice,
  onCancelQuickMatch,
  onClose,
  onCreate,
  onDisplayNameChange,
  onJoin,
  onQuickMatch,
  onResume,
}: OnlineGameModalProps) {
  const [inviteCode, setInviteCode] = useState(initialInviteCode);
  const [inviteMode, setInviteMode] = useState<GameMode>("quick");
  const [copied, setCopied] = useState(false);
  const validName = displayName.trim().length >= 2;

  async function copyInviteCode() {
    if (!activeMatch?.code) return;
    await navigator.clipboard.writeText(activeMatch.code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  async function shareInvite() {
    if (!activeMatch?.code) return;
    const url = `${window.location.origin}${window.location.pathname}?match=${activeMatch.code}`;
    if (navigator.share) {
      await navigator.share({ title: "Шкрабај", text: "Придружи ми се у Шкрабају", url });
      return;
    }
    await navigator.clipboard.writeText(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  if (activeMatch?.status === "waiting") {
    const quickSearch = activeMatch.source === "quick";
    return (
      <AppModal icon={<GameIcon name={quickSearch ? "target" : "users"} />} onClose={onClose} position="upper" title={quickSearch ? "Тражимо противника" : "Позови противника"} variant="online">
        {quickSearch ? (
          <div className="matchmaking-wait">
            <span className="matchmaking-radar" aria-hidden="true"><i /><GameIcon name="target" /></span>
            <small>БРЗА ИГРА · 60 СЕКУНДИ</small>
            <strong>Проналазимо слободног играча…</strong>
            <p>Можеш да откажеш претрагу у било ком тренутку.</p>
            <button className="secondary-action modal-action" disabled={loading} onClick={onCancelQuickMatch} type="button">Откажи претрагу</button>
          </div>
        ) : (
          <div className="invite-ready">
            <span>ПОЗИВНИ КОД · {modeLabel(activeMatch.mode).toUpperCase()}</span>
            <strong>{activeMatch.code}</strong>
            <p>Пошаљи овај код другом играчу. Партија почиње чим се придружи.</p>
            <button className="secondary-action modal-action invite-copy" onClick={copyInviteCode} type="button">{copied ? "Код је копиран ✓" : "Копирај позивни код"}</button>
            <button className="secondary-action modal-action invite-copy" onClick={shareInvite} type="button"><GameIcon name="share" /> Подели линк</button>
            <button className="primary-action modal-action" onClick={onClose} type="button">Врати се на таблу <span>→</span></button>
          </div>
        )}
      </AppModal>
    );
  }

  return (
    <AppModal icon={<GameIcon name="gamepad" />} onClose={onClose} position="upper" title="Играј" variant="online" wide>
      <div className="play-hub">
        {notice && <p className="play-hub__notice">{notice}</p>}

        <div className="play-hub__lead">
          <small>ИЗАБЕРИ НАЧИН ИГРЕ</small>
          <strong>Како желиш да играш?</strong>
          <p>Покрени приватну партију или се придружи пријатељу преко позивног кода.</p>
        </div>

        <label className="online-identity player-identity">
          <span className="player-identity__avatar"><GameIcon name="user" /></span>
          <span className="player-identity__field">
            <small>ИМЕ У ИГРИ</small>
            <input autoComplete="nickname" maxLength={24} minLength={2} onChange={(event) => onDisplayNameChange(event.target.value)} placeholder="Како да те види противник?" value={displayName} />
            <em>Ово име виде твоји противници</em>
          </span>
          <span className="player-identity__status">ПРОФИЛ</span>
        </label>

        {QUICK_MATCHMAKING_VISIBLE && (
          <section className="quick-play-card">
            <span className="quick-play-card__icon"><GameIcon name="clock" /></span>
            <div><small>ОПЦИЈА 1 · БРЗА ИГРА</small><strong>Пронађи противника</strong><p>Насумичан играч · 60 секунди по потезу · аутоматски прескок</p></div>
            <button className="primary-action" disabled={loading || !validName} onClick={() => onQuickMatch(displayName.trim())} type="button">{loading ? "ТРАЖИМО…" : "ПРОНАЂИ ИГРАЧА"}<span>→</span></button>
          </section>
        )}

        <section className="invite-section">
          <div className="play-hub__section-title"><span><b>1</b><GameIcon name="users" /> ПОЗОВИ ПРИЈАТЕЉА</span></div>
          <p className="play-option-copy">Изабери темпо, направи приватни код и пошаљи га пријатељу.</p>
          <div className="mode-picker" role="radiogroup" aria-label="Режим партије">
            <button aria-checked={inviteMode === "quick"} className={inviteMode === "quick" ? "selected" : ""} onClick={() => setInviteMode("quick")} role="radio" type="button"><GameIcon name="clock" /><span><strong>Брза игра</strong><small>60 сек по потезу</small></span></button>
            <button aria-checked={inviteMode === "relaxed"} className={inviteMode === "relaxed" ? "selected" : ""} onClick={() => setInviteMode("relaxed")} role="radio" type="button"><GameIcon name="history" /><span><strong>Опуштена</strong><small>Без ограничења</small></span></button>
          </div>
          <button className="secondary-action modal-action create-invite" disabled={loading || !validName} onClick={() => onCreate(displayName.trim(), inviteMode)} type="button">Направи позивни код</button>
        </section>

        <section className="join-section">
          <div className="play-hub__section-title"><span><b>2</b><GameIcon name="target" /> ИМАШ ПОЗИВНИ КОД?</span></div>
          <p className="play-option-copy">Унеси код који ти је послао пријатељ и придружи се партији.</p>
          <div className="join-row">
            <input aria-label="Позивни код" autoCapitalize="characters" autoComplete="off" className="invite-input" inputMode="text" maxLength={6} onChange={(event) => setInviteCode(event.target.value.toUpperCase().replace(/[^A-F0-9]/g, ""))} placeholder="ПОЗИВНИ КОД" value={inviteCode} />
            <button className="secondary-action" disabled={loading || !validName || inviteCode.length !== 6} onClick={() => onJoin(displayName.trim(), inviteCode)} type="button">УЂИ</button>
          </div>
        </section>

        {(hubLoading || (hub?.open_matches.length ?? 0) > 0) && (
          <section className="session-section">
            <div className="play-hub__section-title"><span><GameIcon name="history" /> ТВОЈЕ ПАРТИЈЕ</span></div>
            {hubLoading ? <span className="session-loading">Учитавање…</span> : hub?.open_matches.map((match) => (
              <button className="session-row" key={match.match_id} onClick={() => onResume(match.match_id)} type="button">
                <span><strong>{match.opponent_name || (match.status === "waiting" ? "Чекамо противника" : "Онлајн партија")}</strong><small>{modeLabel(match.game_mode)} · {relativeDate(match.updated_at)}</small></span>
                <b>{match.status === "active" ? "НАСТАВИ" : "ОТВОРИ"} →</b>
              </button>
            ))}
          </section>
        )}

        {(hub?.recent_matches.length ?? 0) > 0 && (
          <section className="recent-section">
            <div className="play-hub__section-title"><span>ПОСЛЕДЊЕ ПАРТИЈЕ</span></div>
            {hub!.recent_matches.slice(0, 4).map((match) => <div className="recent-row" key={match.match_id}><span><strong>{match.opponent_name || "Противник"}</strong><small>{modeLabel(match.game_mode)} · {relativeDate(match.updated_at)}</small></span><b className={`result-${match.result}`}>{match.result === "win" ? "ПОБЕДА" : match.result === "loss" ? "ПОРАЗ" : "НЕРЕШЕНО"}</b><em>{match.my_score} : {match.opponent_score ?? 0}</em></div>)}
          </section>
        )}
      </div>
    </AppModal>
  );
}
