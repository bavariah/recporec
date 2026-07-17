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
  ["05", "Одиграј пет рунди", "У свакој рунди оба играча имају по један потез. После десетог потеза завршава се партија и побеђује већи број поена."],
];

export function RulesModal({ onClose }: RulesModalProps) {
  return (
    <AppModal eyebrow="КАКО СЕ ИГРА" onClose={onClose} title="Правила Шкрабаја">
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
        Једнак резултат после пет рунди је нерешен. Четири узастопна прескакања такође завршавају партију.
      </p>
    </AppModal>
  );
}
