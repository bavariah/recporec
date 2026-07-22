"use client";

import { useState } from "react";
import { AppModal } from "@/components/AppModal";
import { GameIcon } from "@/components/GameIcon";
import type { PlayerHub } from "@/components/OnlineGameModal";

interface AccountModalProps {
  account: { email: string | null; isAnonymous: boolean };
  hub: PlayerHub | null;
  loading: boolean;
  notice?: string;
  onClose: () => void;
  onEmailAuth: (email: string, intent: "login" | "upgrade") => Promise<boolean>;
  onSignOut: () => Promise<void>;
}

export function AccountModal({
  account,
  hub,
  loading,
  notice,
  onClose,
  onEmailAuth,
  onSignOut,
}: AccountModalProps) {
  const [existingAccount, setExistingAccount] = useState(false);
  const [email, setEmail] = useState("");
  const intent = existingAccount ? "login" : "upgrade";

  function switchEmailMode() {
    setExistingAccount((current) => !current);
  }

  async function sendEmail() {
    await onEmailAuth(email.trim(), intent);
  }

  return (
    <AppModal icon={<GameIcon name="user" />} onClose={onClose} position="upper" title={account.isAnonymous ? "Пријава" : "Мој налог"} variant="account">
      <div className="account-modal">
        {notice && <p className="play-hub__notice">{notice}</p>}

        {account.isAnonymous ? (
          <>
            <div className="account-modal__hero">
              <span><GameIcon name="user" /><b>+</b></span>
              <div>
                <small>ИГРАШ КАО ГОСТ</small>
                <strong>Сачувај напредак</strong>
                <p>Повежи налог да сачуваш партије, резултате и противнике на свим уређајима.</p>
              </div>
            </div>

            <div className="account-form account-form--standalone">
              <label><span>ИМЕЈЛ</span><input autoComplete="email" onChange={(event) => setEmail(event.target.value)} placeholder="ime@primer.rs" type="email" value={email} /></label>
              <button className="primary-action modal-action" disabled={loading || !email.includes("@")} onClick={sendEmail} type="button">
                {loading ? "ШАЉЕМО…" : existingAccount ? "ПОШАЉИ ЛИНК ЗА ПРИЈАВУ" : "САЧУВАЈ ПРЕКО ИМЕЈЛА"}
              </button>
              <button className="account-switch" onClick={switchEmailMode} type="button">
                {existingAccount ? "Немаш налог? Сачувај овај напредак" : "Већ имаш налог? Пошаљи ми линк"}
              </button>
            </div>

            <p className="account-modal__guest-note"><GameIcon name="check" /> Нови налог чува овај гостујући напредак. Пријава на постојећи налог отвара напредак тог налога.</p>
          </>
        ) : (
          <>
            <div className="account-modal__hero account-modal__hero--signed-in">
              <span><GameIcon name="user" /><b><GameIcon name="check" /></b></span>
              <div>
                <small>ПРИЈАВЉЕН НАЛОГ</small>
                <strong>{hub?.profile?.display_name || account.email || "Играч"}</strong>
                <p>{account.email}</p>
              </div>
            </div>
            <div className="account-summary account-summary--standalone">
              <div>
                <span>ПАРТИЈЕ<strong>{hub?.stats.games ?? 0}</strong></span>
                <span>ПОБЕДЕ<strong>{hub?.stats.wins ?? 0}</strong></span>
                <span>ПОЕНИ<strong>{hub?.stats.points ?? 0}</strong></span>
              </div>
              <button className="secondary-action" disabled={loading} onClick={onSignOut} type="button">Одјави се</button>
            </div>
          </>
        )}
      </div>
    </AppModal>
  );
}
