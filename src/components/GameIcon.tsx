import type { ReactNode, SVGProps } from "react";

export type GameIconName =
  | "book"
  | "check"
  | "close"
  | "crown"
  | "gamepad"
  | "medal"
  | "music"
  | "sparkles"
  | "sound"
  | "soundOff"
  | "target"
  | "trophy"
  | "users";

interface GameIconProps extends SVGProps<SVGSVGElement> {
  name: GameIconName;
}

export function GameIcon({ name, ...props }: GameIconProps) {
  const paths: Record<GameIconName, ReactNode> = {
    book: <><path d="M4.5 5.5A2.5 2.5 0 0 1 7 3h4v16H7a2.5 2.5 0 0 0-2.5 2V5.5Z"/><path d="M19.5 5.5A2.5 2.5 0 0 0 17 3h-4v16h4a2.5 2.5 0 0 1 2.5 2V5.5Z"/></>,
    check: <path d="m5 12.5 4.2 4.2L19 7" />,
    close: <><path d="m7 7 10 10"/><path d="M17 7 7 17"/></>,
    crown: <><path d="m4 8 4 3 4-6 4 6 4-3-1.5 10h-13L4 8Z"/><path d="M6.5 21h11"/></>,
    gamepad: <><path d="M7.5 8h9a5 5 0 0 1 4.7 6.7l-1 2.8a2.3 2.3 0 0 1-3.8.8L14.2 16H9.8l-2.2 2.3a2.3 2.3 0 0 1-3.8-.8l-1-2.8A5 5 0 0 1 7.5 8Z"/><path d="M7 11v4M5 13h4M16.5 12h.1M18.5 14h.1"/></>,
    medal: <><circle cx="12" cy="15" r="5"/><path d="m9 10-3-7h4l2 4 2-4h4l-3 7"/><path d="m12 12 1 2 2 .3-1.5 1.5.4 2.2-1.9-1-1.9 1 .4-2.2L9 14.3l2-.3 1-2Z"/></>,
    music: <><path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/></>,
    sparkles: <><path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2L12 3Z"/><path d="m18.5 14 .7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7.7-2.3ZM5 13l.8 2.2L8 16l-2.2.8L5 19l-.8-2.2L2 16l2.2-.8L5 13Z"/></>,
    sound: <><path d="M5 10v4h3l4 3V7l-4 3H5Z"/><path d="M15 9.5a4 4 0 0 1 0 5"/><path d="M17.5 7a7 7 0 0 1 0 10"/></>,
    soundOff: <><path d="M5 10v4h3l4 3V7l-4 3H5Z"/><path d="m15 10 5 5M20 10l-5 5"/></>,
    target: <><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M22 12h-3M12 22v-3M2 12h3"/></>,
    trophy: <><path d="M8 4h8v3.5a4 4 0 0 1-8 0V4Z"/><path d="M8 6H5v1.5A3.5 3.5 0 0 0 8.5 11M16 6h3v1.5a3.5 3.5 0 0 1-3.5 3.5M12 12v4M9 20h6M10 16h4v4"/></>,
    users: <><circle cx="9" cy="8" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><circle cx="17" cy="9" r="2.3"/><path d="M15.5 14.5a4.5 4.5 0 0 1 5 4.5"/></>,
  };

  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24" {...props}>
      {paths[name]}
    </svg>
  );
}
