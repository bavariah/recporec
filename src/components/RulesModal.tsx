"use client";

import { AppModal } from "@/components/AppModal";

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
    <AppModal eyebrow="КАКО СЕ ИГРА" onClose={onClose} title="Правила">
      <div className="rules-intro">
        <span className="rules-star" aria-hidden="true">★</span>
        <p>Освоји више поена од ривала на табли 8×8.</p>
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
        Једном у партији можеш заменити изабрана слова и затим наставити исти потез. Исти резултат је нерешен, а четири прескакања заредом завршавају партију.
      </p>
      <a className="sibling-game-link" href="https://bavariah.github.io/cik-pogodi/" rel="noreferrer" target="_blank">
        Играј и Цик Погоди <span aria-hidden="true">↗</span>
      </a>
    </AppModal>
  );
}
