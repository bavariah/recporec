"use client";

import { useState } from "react";
import { AppModal } from "@/components/AppModal";
import { GameIcon } from "@/components/GameIcon";
import type { PlayerHub } from "@/components/OnlineGameModal";
import { AVATAR_KEYS, PlayerAvatar, type AvatarKey } from "@/components/PlayerAvatar";

export interface ProfileUpdateInput {
  avatarFile: File | null;
  avatarKey: AvatarKey;
  avatarPath: string | null;
  displayName: string;
}

interface AccountModalProps {
  account: { email: string | null; isAnonymous: boolean };
  hub: PlayerHub | null;
  loading: boolean;
  notice?: string;
  onClose: () => void;
  onEmailAuth: (email: string, intent: "login" | "upgrade") => Promise<boolean>;
  onSaveProfile: (profile: ProfileUpdateInput) => Promise<{ avatarPath: string | null } | null>;
  onSignOut: () => Promise<void>;
}

export function AccountModal({
  account,
  hub,
  loading,
  notice,
  onClose,
  onEmailAuth,
  onSaveProfile,
  onSignOut,
}: AccountModalProps) {
  const [existingAccount, setExistingAccount] = useState(false);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState(hub?.profile?.display_name || "");
  const [avatarKey, setAvatarKey] = useState<AvatarKey>((hub?.profile?.avatar_key as AvatarKey) || "lagoon");
  const [avatarPath, setAvatarPath] = useState<string | null>(hub?.profile?.avatar_path || null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [profileError, setProfileError] = useState("");
  const intent = existingAccount ? "login" : "upgrade";

  function switchEmailMode() {
    setExistingAccount((current) => !current);
  }

  async function sendEmail() {
    await onEmailAuth(email.trim(), intent);
  }

  function chooseBuiltInAvatar(key: AvatarKey) {
    setAvatarKey(key);
    setAvatarPath(null);
    setAvatarFile(null);
    setAvatarPreview(null);
    setProfileError("");
  }

  function chooseUpload(file: File | null) {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setProfileError("Изабери JPG, PNG или WebP слику.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setProfileError("Слика може имати највише 2 MB.");
      return;
    }
    setAvatarFile(file);
    setAvatarPath(null);
    setProfileError("");
    const reader = new FileReader();
    reader.addEventListener("load", () => setAvatarPreview(typeof reader.result === "string" ? reader.result : null), { once: true });
    reader.readAsDataURL(file);
  }

  async function saveProfile() {
    const cleanName = displayName.trim();
    if (cleanName.length < 2 || cleanName.length > 24) {
      setProfileError("Име мора имати од 2 до 24 знака.");
      return;
    }
    setProfileError("");
    const saved = await onSaveProfile({ avatarFile, avatarKey, avatarPath, displayName: cleanName });
    if (saved) {
      setAvatarPath(saved.avatarPath);
      setAvatarFile(null);
      setAvatarPreview(null);
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
              <PlayerAvatar
                avatar_key={avatarKey}
                avatar_path={avatarPath}
                className="account-profile-avatar"
                displayName={displayName}
                imageUrl={avatarPreview}
              />
              <div>
                <small>ПРИЈАВЉЕН НАЛОГ</small>
                <strong>{displayName || account.email || "Играч"}</strong>
                <p>{account.email}</p>
              </div>
            </div>
            <section className="profile-editor">
              <label className="profile-name-field">
                <span>ИМЕ У ИГРИ</span>
                <input
                  autoComplete="nickname"
                  maxLength={24}
                  minLength={2}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="Твоје име у игри"
                  value={displayName}
                />
                <small>Ово име виде противници и играчи на табели.</small>
              </label>
              <div className="avatar-picker">
                <div><span>ИЗАБЕРИ АВАТАР</span><small>или додај своју слику</small></div>
                <div className="avatar-picker__choices">
                  {AVATAR_KEYS.map((key) => (
                    <button
                      aria-label={`Изабери аватар ${key}`}
                      aria-pressed={!avatarFile && !avatarPath && avatarKey === key}
                      className={!avatarFile && !avatarPath && avatarKey === key ? "selected" : ""}
                      key={key}
                      onClick={() => chooseBuiltInAvatar(key)}
                      type="button"
                    >
                      <PlayerAvatar avatar_key={key} displayName={displayName} />
                    </button>
                  ))}
                  <label className={`avatar-upload ${avatarFile || avatarPath ? "selected" : ""}`}>
                    <input accept="image/jpeg,image/png,image/webp" onChange={(event) => chooseUpload(event.target.files?.[0] || null)} type="file" />
                    {avatarFile || avatarPath ? (
                      <PlayerAvatar avatar_key={avatarKey} avatar_path={avatarPath} displayName={displayName} imageUrl={avatarPreview} />
                    ) : (
                      <><GameIcon name="plus" /><small>СЛИКА</small></>
                    )}
                  </label>
                </div>
              </div>
              {profileError && <p className="profile-editor__error">{profileError}</p>}
              <button className="primary-action modal-action profile-save" disabled={loading} onClick={saveProfile} type="button">
                {loading ? "ЧУВАМО…" : "САЧУВАЈ ПРОФИЛ"}
              </button>
            </section>
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
