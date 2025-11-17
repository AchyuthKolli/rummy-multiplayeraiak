import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { useTableSocket } from "../../../../../apiclient/socket"; // adjust if different
import PlayingCard from "./PlayingCard";
import "./meldboard.css"; // you can style or skip

/**
 * Rummy MeldBoard – 3/3/3/4 Layout
 *
 * props:
 * - tableId
 * - userId
 * - hand        ← array of player cards
 * - onMeldChange(groups) ← parent updates UI state
 */
export default function MeldBoard({ tableId, userId, hand, onMeldChange }) {
  const socket = useTableSocket();

  const [melds, setMelds] = useState([[], [], [], []]); // 3/3/3/4
  const [locked, setLocked] = useState([false, false, false, false]); // lock per meld
  const [sequenceLocked, setSequenceLocked] = useState(false); // green lock

  /* -----------------------------------------
      Load saved melds from localStorage
  -----------------------------------------*/
  useEffect(() => {
    try {
      const saved = localStorage.getItem(`melds_${tableId}_${userId}`);
      const savedLock = localStorage.getItem(`locks_${tableId}_${userId}`);
      const seq = localStorage.getItem(`seqLock_${tableId}_${userId}`);

      if (saved) setMelds(JSON.parse(saved));
      if (savedLock) setLocked(JSON.parse(savedLock));
      if (seq === "true") setSequenceLocked(true);
    } catch {}
  }, [tableId, userId]);

  /* -----------------------------------------
        Save to LocalStorage
  -----------------------------------------*/
  const saveState = (m, l, s) => {
    try {
      localStorage.setItem(`melds_${tableId}_${userId}`, JSON.stringify(m));
      localStorage.setItem(`locks_${tableId}_${userId}`, JSON.stringify(l));
      localStorage.setItem(`seqLock_${tableId}_${userId}`, s ? "true" : "false");
    } catch {}
  };

  /* -----------------------------------------
      Drag + Drop
  -----------------------------------------*/
  function onDropCard(card, meldIndex) {
    if (locked[meldIndex]) {
      toast.error("This meld is locked.");
      return;
    }

    const newMelds = [...melds];
    const limit = meldIndex === 3 ? 4 : 3;

    if (newMelds[meldIndex].length >= limit) {
      toast.error(`Meld ${meldIndex + 1} can only hold ${limit} cards`);
      return;
    }

    // Remove from other melds
    for (let i = 0; i < 4; i++) {
      newMelds[i] = newMelds[i].filter(
        (c) => !(c.rank === card.rank && c.suit === card.suit && c.joker === card.joker)
      );
    }

    newMelds[meldIndex].push(card);
    setMelds(newMelds);
    saveState(newMelds, locked, sequenceLocked);
    onMeldChange(newMelds);
  }

  /* -----------------------------------------
       Lock a Meld (orange lock)
  -----------------------------------------*/
  function lockSingle(meldIndex) {
    const limit = meldIndex === 3 ? 4 : 3;
    if (melds[meldIndex].length !== limit) {
      toast.error(`Meld ${meldIndex + 1} must have ${limit} cards.`);
      return;
    }

    const newLocked = [...locked];
    newLocked[meldIndex] = true;
    setLocked(newLocked);

    saveState(melds, newLocked, sequenceLocked);
    toast.success(`Meld ${meldIndex + 1} locked`);
  }

  /* -----------------------------------------
      Lock Pure Sequence (GREEN LOCK)
      → triggers wild joker reveal in closed joker mode
  -----------------------------------------*/
  function lockPureSeq() {
    if (sequenceLocked) return;

    // Must check if any meld is a pure sequence of 3 or 4
    const found = melds.some((g) => g.length >= 3);

    if (!found) {
      toast.error("Place a pure sequence first.");
      return;
    }

    setSequenceLocked(true);
    saveState(melds, locked, true);

    socket.emit("rummy.lockSequence", {
      tableId,
      userId,
      meld: melds[0], // Typically first meld
    });

    toast.success("Pure sequence locked. Wild Joker revealed!");
  }

  /* -----------------------------------------
        UI – Render each Meld Box
  -----------------------------------------*/
  const renderMeld = (meld, index) => {
    const size = index === 3 ? 4 : 3;

    return (
      <div className="meld-box" key={index}>
        <div className="meld-header">
          <span>Meld {index + 1} ({size} cards)</span>
          <button
            className="lock-btn"
            disabled={locked[index]}
            onClick={() => lockSingle(index)}
          >
            {locked[index] ? "🔒" : "🔓"}
          </button>
        </div>

        <div className="meld-cards">
          {Array(size)
            .fill(null)
            .map((_, i) => (
              <div
                key={i}
                className="meld-slot"
                onDrop={(e) => {
                  e.preventDefault();
                  const card = JSON.parse(e.dataTransfer.getData("card"));
                  onDropCard(card, index);
                }}
                onDragOver={(e) => e.preventDefault()}
              >
                {meld[i] ? (
                  <PlayingCard card={meld[i]} small />
                ) : (
                  <div className="empty-slot">{i + 1}</div>
                )}
              </div>
            ))}
        </div>
      </div>
    );
  };

  /* -----------------------------------------
         Leftover Cards (not in melds)
  -----------------------------------------*/
  const placedIds = new Set(
    melds.flat().map((c) => `${c.rank}${c.suit}${c.joker}`)
  );

  const leftover = hand.filter(
    (c) => !placedIds.has(`${c.rank}${c.suit}${c.joker}`)
  );

  /* -----------------------------------------
          FINAL RENDER
  -----------------------------------------*/
  return (
    <div className="meld-board-container">
      <div className="meld-row">
        {renderMeld(melds[0], 0)}
        {renderMeld(melds[1], 1)}
        {renderMeld(melds[2], 2)}
      </div>

      <div className="meld-row">{renderMeld(melds[3], 3)}</div>

      <div className="leftover-box">
        <div className="left-head">
          Leftover / 4-card sequence
          <button
            className="seq-lock-btn"
            disabled={sequenceLocked}
            onClick={lockPureSeq}
          >
            {sequenceLocked ? "🟢 Pure Locked" : "🟩 Lock Pure Seq"}
          </button>
        </div>

        <div className="leftover-cards">
          {leftover.map((c, i) => (
            <PlayingCard
              key={i}
              card={c}
              small
              draggable
              onDragStart={(e) =>
                e.dataTransfer.setData("card", JSON.stringify(c))
              }
            />
          ))}
        </div>
      </div>
    </div>
  );
}
