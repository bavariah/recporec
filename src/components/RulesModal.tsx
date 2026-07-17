"use client";

import { AppModal } from "@/components/AppModal";

interface RulesModalProps {
  onClose: () => void;
}

const rules = [
  ["01", "Направи реч", "Постави слова у један непрекидан водораван или усправан низ. Прва реч мора да пређе преко звезде."],
  ["02", "Повежи потез", "Сваки следећи потез мора да додирне већ одиграна слова. Бодују се главна реч и сва нова укрштања."],
  ["03", "Искористи бонус", "×2 и ×3 множе вредност новог слова или целе речи. Бонус поље важи само када се први пут покрије."],
  ["04", "Провери реч", "Прихватају се речи из нашег српског речника. Џокер може бити било које слово, али вреди 0 поена."],
];

export function RulesModal({ onClose }: RulesModalProps) {
  return (
    <AppModal eyebrow="КАКО СЕ ИГРА" onClose={onClose} title="Правила Речограда">
      <div className="rules-intro">
        <span className="rules-star" aria-hidden="true">★</span>
        <p>Освоји више поена од ривала на компактној табли 8×8.</p>
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
        Тренутно четири узастопна прескакања завршавају партију; побеђује већи број поена, а једнак резултат је нерешен. Замена слова и финални баланс врећице биће закључани са коначним правилима.
      </p>
    </AppModal>
  );
}
