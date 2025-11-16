// NEW PlayingCard.jsx (uses your PNG deck exactly)
import React from "react";

export default function PlayingCard({
  card,
  onClick,
  selected,
  draggable = true,
  faceDown = false
}) {
  if (!card) return null;

  /** -------------------------------
   *  FACE-DOWN (stock/discard back)
   * --------------------------------
   */
  if (card.faceDown || faceDown) {
    return (
      <img
        src={`/cards/BACK.png`}
        alt="card-back"
        draggable={false}
        className={`w-[72px] sm:w-[88px] aspect-[2/3] rounded-lg shadow-md`}
      />
    );
  }

  /** -------------------------------
   *  JOKERS
   * --------------------------------
   */
  if (card.joker || card.rank === "JOKER") {
    const file = card.color === "black"
      ? "/cards/JOKER_BLACK.png"
      : "/cards/JOKER_RED.png";

    return (
      <img
        src={file}
        alt="joker"
        draggable={draggable}
        onClick={onClick}
        onDragStart={(e) => {
          if (!draggable) return;
          e.dataTransfer.setData("card", JSON.stringify(card));
        }}
        className={`w-[72px] sm:w-[88px] aspect-[2/3] rounded-lg shadow-xl border ${selected ? "ring-2 ring-amber-400" : ""}`}
      />
    );
  }

  /** -------------------------------
   *  NORMAL CARDS (AH, 10D, QS etc.)
   * --------------------------------
   */
  const filename = `${card.rank}${card.suit}.png`;  
  const src = `/cards/${filename}`;

  const fallback = (e) => {
    e.currentTarget.src = "";
    e.currentTarget.style.display = "none";
  };

  return (
    <img
      src={src}
      alt={filename}
      draggable={draggable}
      onClick={onClick}
      onDragStart={(e) => {
        if (!draggable) return;
        e.dataTransfer.setData("card", JSON.stringify(card));
      }}
      onError={fallback}
      className={`
        w-[72px] sm:w-[88px] 
        aspect-[2/3] 
        rounded-lg 
        shadow-xl 
        border border-gray-300 
        select-none 
        ${selected ? "ring-2 ring-amber-400 scale-105" : ""}
      `}
    />
  );
}
