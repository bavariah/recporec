"use client";

import { AppModal } from "@/components/AppModal";
import { GameIcon } from "@/components/GameIcon";

interface RulesModalProps {
  onClose: () => void;
}

const rules = [
  ["01", "Направи реч", "Поређај слова водоравно или усправно. Прва реч мора преко звезде."],
  ["02", "Повежи потез", "Нови потез додирује слова на табли. Бодује се свака нова реч."],
  ["03", "Искористи бонус", "×2 и ×3 важе само када први пут прекријеш бонус поље."],
  ["04", "Провери реч", "Реч мора бити у српском речнику. Џокер мења слово и вреди 0."],
  ["05", "Одиграј пет рунди", "Свако игра једном по рунди. После 5 рунди побеђује већи резултат."],
];

export function RulesModal({ onClose }: RulesModalProps) {
  return (
    <AppModal eyebrow="КАКО СЕ ИГРА" icon={<GameIcon name="book" />} onClose={onClose} title="Правила" variant="rules">
      <div className="rules-intro">
        <span className="rules-star" aria-hidden="true">★</span>
        <p><strong>Освоји таблу 9×9.</strong><br />Прави речи, спајај потезе и користи бонусе паметно.</p>
      </div>
      <ol className="rules-list">
        {rules.map(([number, title, copy]) => (
          <li key={number}>
            <span>{number}</span>
            <div><strong>{title}</strong><p>{copy}</p></div>
          </li>
        ))}
      </ol>
      <p className="rules-footnote">
        <GameIcon name="sparkles" /> Једном у партији можеш заменити изабрана слова и наставити исти потез. Четири прескакања заредом завршавају партију.
      </p>
      <a className="sibling-game-link" href="https://bavariah.github.io/cik-pogodi/" rel="noreferrer" target="_blank">
        Играј и ЧИК ПОГОДИ <span aria-hidden="true">↗</span>
      </a>
    </AppModal>
  );
}
