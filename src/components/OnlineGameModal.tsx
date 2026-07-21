"use client";

import { useState } from "react";
import { AppModal } from "@/components/AppModal";
import { GameIcon } from "@/components/GameIcon";

interface OnlineGameModalProps {
  activeCode: string | null;
  displayName: string;
  loading: boolean;
  onClose: () => void;
  onCreate: (displayName: string) => Promise<void>;
  onDisplayNameChange: (displayName: string) => void;
  onJoin: (displayName: string, inviteCode: string) => Promise<void>;
  initialInviteCode?: string;
}

export function OnlineGameModal({
  activeCode,
  displayName,
  loading,
  onClose,
  onCreate,
  onDisplayNameChange,
  onJoin,
  initialInviteCode = "",
}: OnlineGameModalProps) {
  const [inviteCode, setInviteCode] = useState(initialInviteCode);
  const [copied, setCopied] = useState(false);

  function rememberName() {
    return displayName.trim();
  }

  async function copyInviteCode() {
    if (!activeCode) return;
    await navigator.clipboard.writeText(activeCode);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  async function shareInvite() {
    if (!activeCode) return;
    const url = `${window.location.origin}${window.location.pathname}?match=${activeCode}`;
    if (navigator.share) {
      await navigator.share({ title: "Шкрабај", text: "Придружи ми се у Шкрабају", url });
      return;
    }
    await navigator.clipboard.writeText(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <AppModal icon={<GameIcon name="users" />} onClose={onClose} position="upper" title="Онлајн партија" variant="online">
      {activeCode ? (
        <div className="invite-ready">
          <span>ПОЗИВНИ КОД</span>
          <strong>{activeCode}</strong>
          <p>Пошаљи овај код другом играчу. Партија почиње чим се придружи.</p>
          <button className="secondary-action modal-action invite-copy" onClick={copyInviteCode} type="button">
            {copied ? "Код је копиран ✓" : "Копирај позивни код"}
          </button>
          <button className="secondary-action modal-action invite-copy" onClick={shareInvite} type="button">
            Подели линк за партију
          </button>
          <button className="primary-action modal-action" onClick={onClose} type="button">
            Врати се на таблу <span>→</span>
          </button>
        </div>
      ) : (
        <div className="online-form">
          <label className="online-identity">
            <span>КАКО ДА ТЕ ВИДИ РИВАЛ?</span>
            <input
              autoComplete="nickname"
              maxLength={24}
              minLength={2}
              onChange={(event) => onDisplayNameChange(event.target.value)}
              placeholder="Унеси име"
              value={displayName}
            />
          </label>
          <p className="online-name-note">Питаћемо те само први пут на овом уређају.</p>

          <section className="online-choice online-choice--create">
            <span className="online-choice__icon"><GameIcon name="gamepad" /></span>
            <div><small>ПОКРЕНИ ИГРУ</small><strong>Нова партија</strong><p>Добиј позивни код и пошаљи га ривалу.</p></div>
            <button
              className="primary-action modal-action"
              disabled={loading || displayName.trim().length < 2}
              onClick={() => onCreate(rememberName())}
              type="button"
            >
              {loading ? "Припрема…" : "Направи партију"} <span>→</span>
            </button>
          </section>

          <div className="online-divider"><span>или се придружи</span></div>

          <section className="online-choice online-choice--join">
            <span className="online-choice__icon"><GameIcon name="target" /></span>
            <div><small>ИМАШ КОД?</small><strong>Придружи се</strong></div>
            <label>
              <span>ПОЗИВНИ КОД</span>
              <input
                autoCapitalize="characters"
                autoComplete="off"
                className="invite-input"
                inputMode="text"
                maxLength={6}
                onChange={(event) => setInviteCode(event.target.value.toUpperCase().replace(/[^A-F0-9]/g, ""))}
                placeholder="НПР. A4C9F2"
                value={inviteCode}
              />
            </label>
            <button
              className="secondary-action modal-action"
              disabled={loading || displayName.trim().length < 2 || inviteCode.length !== 6}
              onClick={() => onJoin(rememberName(), inviteCode)}
              type="button"
            >
              Уђи у партију
            </button>
          </section>
        </div>
      )}
    </AppModal>
  );
}
