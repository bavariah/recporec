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
  onEmailOtpVerify: (email: string, token: string, intent: "login" | "upgrade") => Promise<boolean>;
  onGoogleAuth: (intent: "login" | "upgrade") => Promise<void>;
  onSignOut: () => Promise<void>;
}

export function AccountModal({
  account,
  hub,
  loading,
  notice,
  onClose,
  onEmailAuth,
  onEmailOtpVerify,
  onGoogleAuth,
  onSignOut,
}: AccountModalProps) {
  const [existingAccount, setExistingAccount] = useState(false);
  const [email, setEmail] = useState("");
  const [emailSent, setEmailSent] = useState(false);
  const [otp, setOtp] = useState("");
  const intent = existingAccount ? "login" : "upgrade";

  function switchEmailMode() {
    setExistingAccount((current) => !current);
    setEmailSent(false);
    setOtp("");
  }

  async function sendEmail() {
    if (await onEmailAuth(email.trim(), intent)) {
      setEmailSent(true);
      setOtp("");
    }
  }

  async function verifyCode() {
    if (await onEmailOtpVerify(email.trim(), otp, intent)) {
      setOtp("");
    }
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
              <button className="google-action" disabled={loading} onClick={() => onGoogleAuth(intent)} type="button">
                <b>G</b> {existingAccount ? "Пријави се преко Google-а" : "Сачувај преко Google-а"}
              </button>
              <div className="online-divider"><span>или имејлом</span></div>
              <label><span>ИМЕЈЛ</span><input autoComplete="email" onChange={(event) => setEmail(event.target.value)} placeholder="ime@primer.rs" type="email" value={email} /></label>
              {emailSent ? (
                <div className="email-code-step">
                  <p><GameIcon name="check" /> Послали смо ти имејл. Отвори линк или унеси шест цифара ако је код приказан.</p>
                  <label><span>КОД ИЗ ИМЕЈЛА</span><input autoComplete="one-time-code" inputMode="numeric" maxLength={6} onChange={(event) => setOtp(event.target.value.replace(/\D/g, ""))} placeholder="000000" value={otp} /></label>
                  <button className="primary-action modal-action" disabled={loading || otp.length !== 6} onClick={verifyCode} type="button">{loading ? "ПРОВЕРА…" : "ПОТВРДИ КОД"}</button>
                  <button className="account-switch" disabled={loading} onClick={sendEmail} type="button">Пошаљи поново</button>
                </div>
              ) : (
                <button className="primary-action modal-action" disabled={loading || !email.includes("@")} onClick={sendEmail} type="button">
                  {loading ? "ШАЉЕМО…" : existingAccount ? "ПОШАЉИ ЛИНК / КОД" : "САЧУВАЈ ПРЕКО ИМЕЈЛА"}
                </button>
              )}
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
