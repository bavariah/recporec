"use client";

import { AppModal } from "@/components/AppModal";
import { GameIcon } from "@/components/GameIcon";
import { SOUND_PALETTES, playGameSound, type SoundPalette } from "@/game/sound";

interface SoundSettingsModalProps {
  enabled: boolean;
  onClose: () => void;
  onEnabledChange: (enabled: boolean) => void;
  onPaletteChange: (palette: SoundPalette) => void;
  palette: SoundPalette;
}

export function SoundSettingsModal({ enabled, onClose, onEnabledChange, onPaletteChange, palette }: SoundSettingsModalProps) {
  async function preview(nextPalette: SoundPalette) {
    onPaletteChange(nextPalette);
    if (!enabled) onEnabledChange(true);
    await playGameSound("placed", nextPalette);
    window.setTimeout(() => void playGameSound("accepted", nextPalette), 180);
  }

  function toggleSound() {
    const next = !enabled;
    onEnabledChange(next);
    if (next) void playGameSound("placed", palette);
  }

  return (
    <AppModal
      compact
      eyebrow="ЗВУЧНИ ДОЖИВЉАЈ"
      icon={<GameIcon name="music" />}
      onClose={onClose}
      title="Изабери звук"
      variant="sound"
    >
      <div className="sound-settings">
        <div className="sound-master-row">
          <span>
            <strong>Звук у игри</strong>
            <small>Потези, успех и одбијене речи</small>
          </span>
          <button
            aria-pressed={enabled}
            className={`sound-switch ${enabled ? "is-on" : ""}`}
            onClick={toggleSound}
            type="button"
          >
            <span />
            <b>{enabled ? "УКЉ." : "ИСКЉ."}</b>
          </button>
        </div>

        <div className="sound-palette-grid">
          {SOUND_PALETTES.map((option) => (
            <button
              aria-pressed={palette === option.id}
              className={`sound-palette sound-palette--${option.id} ${palette === option.id ? "is-selected" : ""}`}
              key={option.id}
              onClick={() => void preview(option.id)}
              type="button"
            >
              <span className="sound-wave" aria-hidden="true"><i /><i /><i /><i /></span>
              <strong>{option.label}</strong>
              <small>{option.description}</small>
              <b>{palette === option.id ? "ИЗАБРАНО" : "ПУСТИ"}</b>
            </button>
          ))}
        </div>
        <p className="sound-tip"><GameIcon name="sparkles" /> Додирни стил да чујеш кратак пример.</p>
      </div>
    </AppModal>
  );
}
