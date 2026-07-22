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
  onEmailAuth: (email: string, password: string, intent: "login" | "upgrade") => Promise<void>;
  onGoogleAuth: () => Promise<void>;
  onSignOut: () => Promise<void>;
}

export function AccountModal({
  account,
  hub,
  loading,
  notice,
  onClose,
  onEmailAuth,
  onGoogleAuth,
  onSignOut,
}: AccountModalProps) {
  const [existingAccount, setExistingAccount] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

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
              <button className="google-action" disabled={loading} onClick={onGoogleAuth} type="button"><b>G</b> Настави преко Google-а</button>
              <div className="online-divider"><span>или имејлом</span></div>
              <label><span>ИМЕЈЛ</span><input autoComplete="email" onChange={(event) => setEmail(event.target.value)} placeholder="ime@primer.rs" type="email" value={email} /></label>
              <label><span>ЛОЗИНКА</span><input autoComplete={existingAccount ? "current-password" : "new-password"} minLength={8} onChange={(event) => setPassword(event.target.value)} placeholder="Најмање 8 знакова" type="password" value={password} /></label>
              <button className="primary-action modal-action" disabled={loading || !email.includes("@") || password.length < 8} onClick={() => onEmailAuth(email, password, existingAccount ? "login" : "upgrade")} type="button">
                {loading ? "САЧЕКАЈ…" : existingAccount ? "ПРИЈАВИ СЕ" : "НАПРАВИ НАЛОГ"}
              </button>
              <button className="account-switch" onClick={() => setExistingAccount((current) => !current)} type="button">
                {existingAccount ? "Немаш налог? Направи га" : "Већ имаш налог? Пријави се"}
              </button>
            </div>

            <p className="account-modal__guest-note"><GameIcon name="check" /> Тренутни гостујући напредак остаје сачуван када направиш налог.</p>
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
