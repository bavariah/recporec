"use client";

import { useState } from "react";
import { AppModal } from "@/components/AppModal";

interface OnlineGameModalProps {
  activeCode: string | null;
  loading: boolean;
  onClose: () => void;
  onCreate: (displayName: string) => Promise<void>;
  onJoin: (displayName: string, inviteCode: string) => Promise<void>;
}

export function OnlineGameModal({
  activeCode,
  loading,
  onClose,
  onCreate,
  onJoin,
}: OnlineGameModalProps) {
  const [displayName, setDisplayName] = useState("Играч");
  const [inviteCode, setInviteCode] = useState("");

  return (
    <AppModal eyebrow="ИГРА УДВОЈЕ" onClose={onClose} title="Онлајн партија">
      {activeCode ? (
        <div className="invite-ready">
          <span>ПОЗИВНИ КОД</span>
          <strong>{activeCode}</strong>
          <p>Пошаљи овај код другом играчу. Партија почиње чим се придружи.</p>
          <button className="primary-action modal-action" onClick={onClose} type="button">
            Врати се на таблу <span>→</span>
          </button>
        </div>
      ) : (
        <div className="online-form">
          <label>
            <span>ИМЕ НА ТАБЛИ</span>
            <input
              autoComplete="nickname"
              maxLength={24}
              minLength={2}
              onChange={(event) => setDisplayName(event.target.value)}
              value={displayName}
            />
          </label>

          <button
            className="primary-action modal-action"
            disabled={loading || displayName.trim().length < 2}
            onClick={() => onCreate(displayName.trim())}
            type="button"
          >
            {loading ? "Припрема…" : "Направи нову партију"} <span>→</span>
          </button>

          <div className="online-divider"><span>или се придружи</span></div>

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
            onClick={() => onJoin(displayName.trim(), inviteCode)}
            type="button"
          >
            Придружи се партији
          </button>
        </div>
      )}
    </AppModal>
  );
}
