"use client";

import type { CSSProperties } from "react";
import { supabase } from "@/lib/supabase/client";

export const AVATAR_KEYS = ["lagoon", "sunset", "violet", "ocean", "rose", "forest"] as const;
export type AvatarKey = (typeof AVATAR_KEYS)[number];

export interface PlayerProfileAppearance {
  avatar_key?: AvatarKey | string | null;
  avatar_path?: string | null;
}

interface PlayerAvatarProps extends PlayerProfileAppearance {
  className?: string;
  displayName?: string | null;
  imageUrl?: string | null;
  label?: string;
}

export function avatarPublicUrl(path?: string | null) {
  if (!path || !supabase) return null;
  return supabase.storage.from("profile-avatars").getPublicUrl(path).data.publicUrl;
}

function initialFor(displayName?: string | null) {
  return displayName?.trim().charAt(0).toLocaleUpperCase("sr-Cyrl-RS") || "И";
}

export function PlayerAvatar({
  avatar_key,
  avatar_path,
  className = "",
  displayName,
  imageUrl,
  label,
}: PlayerAvatarProps) {
  const key = AVATAR_KEYS.includes(avatar_key as AvatarKey) ? avatar_key : "lagoon";
  const resolvedImage = imageUrl || avatarPublicUrl(avatar_path);
  const style = resolvedImage
    ? ({ "--avatar-image": `url("${resolvedImage.replaceAll('"', "%22")}")` } as CSSProperties)
    : undefined;

  return (
    <span
      aria-label={label || `Аватар играча ${displayName || "Играч"}`}
      className={`player-avatar player-avatar--${key} ${resolvedImage ? "player-avatar--photo" : ""} ${className}`.trim()}
      role="img"
      style={style}
    >
      <i aria-hidden="true" />
      <b aria-hidden="true">{resolvedImage ? "" : initialFor(displayName)}</b>
    </span>
  );
}
