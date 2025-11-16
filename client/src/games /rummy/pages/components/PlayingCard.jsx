import React from "react";
import type { CardView } from "../apiclient/data-contracts";

export interface Props {
  card: CardView;
  onClick?: () => void;
  selected?: boolean;
  draggable?: boolean;
}

// Convert RUMMY card format → PNG filename
const normalizeRank = (r: string) => {
  if (!r) return "";
  const s = r.toUpperCase();
  if (s === "JOKER") return "JOKER";
  return s; // A,2,3,...10,J,Q,K
};

const suitToLetter = (s: string | null) => {
  if (!s) return "";
  const up = s.toUpperCase();
  if (["H", "D", "S", "C"].includes(up)) return up;
  return "";
};

export const PlayingCard: React.FC<Props> = ({
  card,
  onClick,
  selected,
  draggable = true,
}) => {
  const isJoker = card.joker || card.rank === "JOKER";

  const handleDragStart = (e: React.DragEvent) => {
    if (!draggable) return;

    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("card", JSON.stringify(card));

    const img = new Image();
    img.src = "";
    e.dataTransfer.setDragImage(img, 0, 0);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (!draggable) return;
  };

  // Build PNG filename
  let imgSrc = "";

  if (isJoker) {
    imgSrc = "/cards/JOKER_RED.png";
  } else {
    const r = normalizeRank(card.rank);
    const s = suitToLetter(card.suit || "");
    imgSrc = `/cards/${r}${s}.png`;
  }

  return (
    <div
      draggable={draggable}
      onDragStart={handleDragStart}
      onTouchStart={handleTouchStart}
      onClick={onClick}
      className={`
        relative w-full aspect-[2/3] min-w-[60px] max-w-[100px]
        rounded-lg bg-white 
        border-2 shadow-md transition-all touch-manipulation
        ${selected ? "border-amber-500 ring-2 ring-amber-400 scale-105" : "border-gray-300"}
        ${onClick ? "cursor-pointer hover:scale-105 active:scale-95" : "cursor-default"}
      `}
      title={card.code}
    >
      {/* PNG CARD IMAGE */}
      <img
        src={imgSrc}
        className="absolute inset-0 w-full h-full object-contain rounded-lg pointer-events-none"
        alt={card.code}
      />

      {/* If PNG missing, fallback */}
      <div className="absolute inset-0 p-1 hidden">
        <div className="text-xs font-bold">{card.rank}</div>
      </div>
    </div>
  );
};
