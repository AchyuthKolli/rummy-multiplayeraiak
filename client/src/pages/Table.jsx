// client/src/Table.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { socket, joinRoom, onGameUpdate, onChatMessage, onVoiceStatus, onDeclareUpdate, onSpectateUpdate } from "../socket";
import { Copy, Check, Crown, User2, Play, Trophy, X, ChevronDown, ChevronUp, LogOut, Mic, MicOff, UserX } from "lucide-react";
import { toast } from "sonner";

// Rummy components (keep your existing imports)
import { HandStrip } from "../games/rummy/components/HandStrip";
import { TableDiagram } from "../games/rummy/components/TableDiagram";
import { CasinoTable3D } from "../games/rummy/components/CasinoTable3D";
import { PlayerProfile } from "../games/rummy/components/PlayerProfile";
import { PlayingCard } from "../games/rummy/components/PlayingCard";
import { GameRules } from "../games/rummy/components/GameRules";
import { ScoreboardModal } from "../games/rummy/components/ScoreboardModal";
import { WildJokerRevealModal } from "../games/rummy/components/WildJokerRevealModal";
import { PointsTable } from "../games/rummy/components/PointsTable";
import SpectateControls from "../games/rummy/components/SpectateControls";
import HistoryTable from "../games/rummy/components/HistoryTable";
import ChatSidebar from "../games/rummy/components/ChatSidebar";
import VoicePanel from "../games/rummy/components/VoicePanel";
import SpectateControlsLocal from "../games/rummy/components/SpectateControls"; // fallback if needed
import initCursorSpark from "../utils/cursor-spark";

useEffect(() => {
  const stop = initCursorSpark({ color: "rgba(120,220,255,0.9)" });
  return () => stop();
}, []);



// small helper to promisify socket ack calls
function requestSocket(event, payload = {}, timeout = 8000) {
  return new Promise((resolve, reject) => {
    let called = false;
    const timer = setTimeout(() => {
      if (!called) {
        called = true;
        reject(new Error("Socket ack timeout for " + event));
      }
    }, timeout);

    try {
      socket.emit(event, payload, (res) => {
        if (called) return;
        called = true;
        clearTimeout(timer);
        resolve(res);
      });
    } catch (e) {
      clearTimeout(timer);
      reject(e);
    }
  });
}

// CardBack (kept identical)
const CardBack = ({ className = "" }) => (
  <div className={`relative bg-white rounded-lg border-2 border-gray-300 shadow-lg ${className}`}>
    <div className="absolute inset-0 rounded-lg overflow-hidden">
      <div
        className="w-full h-full"
        style={{
          background:
            "repeating-linear-gradient(45deg, #dc2626 0px, #dc2626 10px, white 10px, white 20px)",
        }}
      />
    </div>
  </div>
);

// MeldSlotBox and LeftoverSlotBox: keep same UI logic as your current file
// For brevity, I assume you will keep the same components (provided earlier).
// Below we only provide main Table component which uses socket-based requests.

export default function Table() {
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const tableId = sp.get("tableId");

  // load user from your auth stack — keep same hook
  // I'm using a small fallback if useUser not present
  let user = null;
  try { // eslint-disable-next-line
    // Try to import/use your real auth hook if available
    const { useUser } = require("@stackframe/react");
    user = useUser();
  } catch (e) {
    // fallback: try window.__AK_USER if set by app
    user = (typeof window !== "undefined" && window.__AK_USER) ? window.__AK_USER : null;
  }

  // state (kept same)
  const [loading, setLoading] = useState(true);
  const [info, setInfo] = useState(null);
  const [myRound, setMyRound] = useState(null);
  const [copied, setCopied] = useState(false);
  const [acting, setActing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [scoreboard, setScoreboard] = useState(null);
  const [showScoreboard, setShowScoreboard] = useState(false);
  const [showWildJokerReveal, setShowWildJokerReveal] = useState(false);
  const [revealedWildJoker, setRevealedWildJoker] = useState(null);
  const [roundHistory, setRoundHistory] = useState([]);
  const [tableColor, setTableColor] = useState('green');
  const [voiceMuted, setVoiceMuted] = useState(false);
  const [droppingGame, setDroppingGame] = useState(false);
  const [spectateRequested, setSpectateRequested] = useState(false);
  const [spectateRequests, setSpectateRequests] = useState([]);
  const [showScoreboardModal, setShowScoreboardModal] = useState(false);
  const [showScoreboardPanel, setShowScoreboardPanel] = useState(false);
  const [revealedHands, setRevealedHands] = useState(null);

  const [selectedCard, setSelectedCard] = useState(null);
  const [lastDrawnCard, setLastDrawnCard] = useState(null);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [meld1, setMeld1] = useState([null, null, null]);
  const [meld2, setMeld2] = useState([null, null, null]);
  const [meld3, setMeld3] = useState([null, null, null]);
  const [leftover, setLeftover] = useState([null, null, null, null]);
  const prevPlayersRef = useRef(null);

  // local saved melds load/save (preserve previous behavior)
  useEffect(() => {
    if (!tableId) return;
    const storageKey = `rummy_melds_${tableId}`;
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      try {
        const { meld1: m1, meld2: m2, meld3: m3, leftover: lo, locks } = JSON.parse(saved);
        if (m1) setMeld1(m1);
        if (m2) setMeld2(m2);
        if (m3) setMeld3(m3);
        if (lo) setLeftover(lo);
      } catch (e) { /* ignore */ }
    }
  }, [tableId]);

  useEffect(() => {
    if (!tableId) return;
    const storageKey = `rummy_melds_${tableId}`;
    const data = { meld1, meld2, meld3, leftover };
    try { localStorage.setItem(storageKey, JSON.stringify(data)); } catch(e) {}
  }, [tableId, meld1, meld2, meld3, leftover]);

  // socket: join room, attach listeners
  useEffect(() => {
    if (!tableId || !socket || !user) return;

    joinRoom(tableId, user.id);
    console.log("Joined room", tableId);

    const onGame = () => { console.log("socket: game_update"); refresh(); };
    const onDeclare = () => { console.log("socket: declare_made"); fetchRevealedHands(); };
    const onVoice = (d) => { if (d.user_id === user.id) setVoiceMuted(d.muted); };
    const onSpect = () => { console.log("socket: spectate_update"); refresh(); };
    const onChat = (m) => { /* optional: integrate w/ ChatSidebar */ };

    onGameUpdate(onGame);
    onDeclareUpdate(onDeclare);
    onVoiceStatus(onVoice);
    onSpectateUpdate(onSpect);
    onChatMessage(onChat);

    // cleanup
    return () => {
      try {
        socket.off("game_update", onGame);
        socket.off("declare_made", onDeclare);
        socket.off("voice_status", onVoice);
        socket.off("spectate_update", onSpect);
        socket.off("chat_message", onChat);
      } catch (e) {}
    };
  }, [tableId, user]);

  // refresh table info via socket get_table_state & get_round_me
  const refresh = async () => {
    if (!tableId) return;
    setLoading(true);
    try {
      // ask server for public table snapshot
      const tResp = await requestSocket("get_table_state", { table_id: tableId }).catch(() => null);
      if (!tResp || !tResp.ok) {
        // attempt fallback: if server returns the object directly, accept it
        if (tResp && tResp.table) setInfo(tResp.table);
        else {
          toast.error("Failed to refresh table info (socket)");
          setLoading(false);
          return;
        }
      } else {
        setInfo(tResp.table || tResp);
      }

      if (tResp && tResp.table && tResp.table.status === "playing") {
        const rr = await requestSocket("get_round_me", { table_id: tableId }).catch(() => null);
        if (rr && rr.ok) {
          setMyRound(rr);
          setHasDrawn((rr.hand || []).length === 14);
        } else if (rr && rr.hand) {
          setMyRound(rr);
          setHasDrawn((rr.hand || []).length === 14);
        }
      }

      // keep wildcard persistent if returned
      if (tResp && tResp.table && tResp.table.wild_joker_rank) {
        setRevealedWildJoker(tResp.table.wild_joker_rank);
      }

      setLoading(false);
    } catch (e) {
      console.error("refresh error", e);
      toast.error("Connection error");
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!tableId) return;
    refresh();
    const interval = setInterval(refresh, 15000);
    return () => clearInterval(interval);
  }, [tableId]);

  // small helper to fetch revealed hands
  const fetchRevealedHands = async () => {
    if (!tableId) return null;
    try {
      const res = await requestSocket("get_revealed_hands", { table_id: tableId }).catch(() => null);
      if (!res) {
        toast.error("Failed to fetch revealed hands (socket)");
        return null;
      }
      setRevealedHands(res);
      setShowScoreboardModal(true);
      setShowScoreboardPanel(true);
      return res;
    } catch (e) {
      console.error("revealed hands error", e);
      toast.error("Failed to fetch scoreboard");
      return null;
    }
  };

  // Actions (socket-based)
  const onStart = async () => {
    if (!tableId) return;
    setStarting(true);
    try {
      const body = { table_id: tableId, seed: Date.now() };
      const res = await requestSocket("start_round", body);
      if (!res || !res.ok) {
        toast.error(res?.message || "Start round failed");
      } else {
        toast.success(`Round #${res.round_number} started`);
        await refresh();
      }
    } catch (e) {
      console.error("start error", e);
      toast.error("Failed to start");
    } finally { setStarting(false); }
  };

  const onDrawStock = async () => {
    if (!tableId || !user || hasDrawn) return;
    setActing(true);
    try {
      const res = await requestSocket("draw_stock", { table_id: tableId });
      if (!res || !res.ok) {
        toast.error(res?.message || "Failed to draw from stock");
        setActing(false);
        return;
      }
      // server returns personal hand
      if (res.hand) setMyRound(res);
      setHasDrawn(true);
      toast.success("Drew from stock");
      socket.emit("game_update", { tableId });
      setTimeout(refresh, 160);
    } catch (e) {
      console.error("draw stock error", e);
      toast.error("Failed to draw from stock");
    } finally { setActing(false); }
  };

  const onDrawDiscard = async () => {
    if (!tableId || !user || hasDrawn) return;
    setActing(true);
    try {
      const res = await requestSocket("draw_discard", { table_id: tableId });
      if (!res || !res.ok) {
        toast.error(res?.message || "Failed to draw from discard");
        setActing(false);
        return;
      }
      if (res.hand) setMyRound(res);
      setHasDrawn(true);
      toast.success("Drew from discard");
      socket.emit("game_update", { tableId });
      setTimeout(refresh, 160);
    } catch (e) {
      console.error("draw discard error", e);
      toast.error("Failed to draw from discard");
    } finally { setActing(false); }
  };

  const onDiscard = async () => {
    if (!tableId || !selectedCard || !hasDrawn) return;
    setActing(true);
    try {
      const res = await requestSocket("discard_card", { table_id: tableId, card: selectedCard });
      if (!res || !res.ok) {
        toast.error(res?.message || "Discard failed");
        setActing(false);
        return;
      }
      // update local hand if returned
      if (res.hand) setMyRound(res);
      toast.success("Card discarded");
      socket.emit("game_update", { tableId });
      setTimeout(refresh, 160);
      setSelectedCard(null);
      setHasDrawn(false);
    } catch (e) {
      console.error("discard error", e);
      toast.error("Failed to discard");
    } finally { setActing(false); }
  };

  const onDeclare = async () => {
    if (!myRound) return;
    const totalPlaced = (meld1.filter(Boolean).length + meld2.filter(Boolean).length + meld3.filter(Boolean).length + leftover.filter(Boolean).length);
    if (totalPlaced !== 13) {
      toast.error(`Place all 13 cards to declare. Currently ${totalPlaced}/13`);
      return;
    }
    if ((myRound.hand || []).length !== 14) {
      toast.error("You must draw before declaring.");
      return;
    }
    setActing(true);
    try {
      const groups = [
        meld1.filter(Boolean),
        meld2.filter(Boolean),
        meld3.filter(Boolean),
        leftover.filter(Boolean)
      ].filter(g => g.length > 0).map(g => g.map(c => ({ rank: c.rank, suit: c.suit, joker: c.joker })));

      const res = await requestSocket("declare", { table_id: tableId, groups });
      if (!res) {
        toast.error("Declare failed");
        return;
      }
      socket.emit("declare_made", { tableId });
      if (res.valid) {
        toast.success("Valid declaration — you win the round!");
      } else {
        toast.warning("Invalid declaration — penalties applied");
      }
      await fetchRevealedHands();
    } catch (e) {
      console.error("declare error", e);
      toast.error("Failed to declare");
    } finally { setActing(false); }
  };

  const onNextRound = async () => {
    if (!tableId) return;
    setStarting(true);
    try {
      const res = await requestSocket("prepare_next_round", { table_id: tableId });
      if (!res || !res.ok) {
        toast.error(res?.message || "Failed to start next round");
      } else {
        toast.success("Next round started");
        refresh();
      }
    } catch (e) {
      console.error("next round error", e);
      toast.error("Failed to start next round");
    } finally { setStarting(false); }
  };

  const onDropGame = async () => {
    if (!tableId) return;
    if (hasDrawn) {
      toast.error("You can only drop before drawing a card.");
      return;
    }
    setDroppingGame(true);
    try {
      const res = await requestSocket("drop_player", { table_id: tableId });
      if (!res || !res.ok) {
        toast.error(res?.message || "Drop failed");
      } else {
        toast.success("Dropped from game (penalty applied)");
        await refresh();
      }
    } catch (e) {
      console.error("drop error", e);
      toast.error("Failed to drop");
    } finally { setDroppingGame(false); }
  };

  const requestSpectate = async (playerId) => {
    if (!tableId) return;
    try {
      const res = await requestSocket("request_spectate", { table_id: tableId });
      if (res && res.ok) toast.success("Spectate requested");
      else toast.error("Spectate request failed");
    } catch (e) {
      toast.error("Failed to request spectate");
    }
  };

  const grantSpectate = async (spectatorId) => {
    if (!tableId) return;
    try {
      const res = await requestSocket("grant_spectate", { table_id: tableId, user_id: spectatorId, granted: true });
      if (res && res.ok) {
        setSpectateRequests(prev => prev.filter(id => id !== spectatorId));
        toast.success("Spectate granted");
      } else toast.error("Grant failed");
    } catch (e) {
      toast.error("Failed to grant spectate");
    }
  };

  const toggleVoiceMute = async () => {
    if (!tableId || !user) return;
    try {
      const res = await requestSocket("voice.mute", { table_id: tableId, user_id: user.id });
      setVoiceMuted(true);
      toast.success("Muted");
    } catch (e) {
      toast.error("Failed to toggle voice");
    }
  };

  const onCopy = () => {
    if (!info?.code) return;
    navigator.clipboard.writeText(info.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  useEffect(() => {
    // reset drawing state on turn change
    if (!info || !user) return;
    if (info.active_user_id !== user.id) {
      setHasDrawn(false);
      setSelectedCard(null);
      setLastDrawnCard(null);
    }
  }, [info?.active_user_id, user?.id]);

  // minimal debug render for missing tableId
  if (!tableId) {
    return (
      <div className="container mx-auto px-4 py-12">
        <div className="bg-card border border-border rounded-lg p-6">
          <p className="text-foreground mb-4">Missing tableId.</p>
          <button onClick={() => navigate("/")} className="px-4 py-2 bg-secondary text-secondary-foreground rounded-lg">
            Go Home
          </button>
        </div>
      </div>
    );
  }

  /* ------------------------------- Render ------------------------------- */
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950">
      <div className="relative">
        <GameRules defaultOpen={false} />
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-semibold text-foreground">Table</h2>
            <div className="flex items-center gap-2">
              {info?.status === 'playing' && (
                <button
                  onClick={toggleVoiceMute}
                  className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg font-medium shadow-lg transition-colors ${voiceMuted ? 'bg-red-700 hover:bg-red-600 text-white' : 'bg-green-700 hover:bg-green-600 text-white'}`}
                  title={voiceMuted ? 'Unmute' : 'Mute'}
                >
                  {voiceMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                </button>
              )}

              {info?.status === 'playing' && !hasDrawn && (
                <button
                  onClick={onDropGame}
                  disabled={droppingGame}
                  className="inline-flex items-center gap-2 px-3 py-2 bg-orange-700 hover:bg-orange-600 text-white rounded-lg font-medium shadow-lg transition-colors disabled:opacity-50"
                  title="Drop game (20pt penalty)"
                >
                  <UserX className="w-5 h-5" />
                  {droppingGame ? 'Dropping...' : 'Drop'}
                </button>
              )}

              <button onClick={() => navigate("/")} className="inline-flex items-center gap-2 px-4 py-2 bg-red-700 hover:bg-red-600 text-white rounded-lg font-medium shadow-lg transition-colors">
                <LogOut className="w-5 h-5" />
                Leave Table
              </button>
            </div>
          </div>

          {/* layout - left main, right sidebar */}
          <div className="grid gap-4 grid-cols-1 lg:grid-cols-[1fr,300px]">
            <div className="bg-card border border-border rounded-lg p-4 order-2 lg:order-1">
              {loading && <p className="text-muted-foreground">Loading…</p>}
              {!loading && info && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Room Code</p>
                      <p className="text-2xl font-bold tracking-wider text-green-400">{info.code}</p>
                    </div>

                    {revealedWildJoker && (
                      <div className="mt-2 px-3 py-1 bg-yellow-900/30 border border-yellow-500/40 rounded-lg text-yellow-300 font-bold text-lg">
                        Wild Joker: {revealedWildJoker}
                      </div>
                    )}

                    <button onClick={onCopy} className="inline-flex items-center gap-2 px-3 py-2 bg-green-800 text-green-100 rounded-lg hover:bg-green-700">
                      {copied ? (<><Check className="w-4 h-4"/> Copied</>) : (<><Copy className="w-4 h-4"/> Copy</>)}
                    </button>
                  </div>

                  <div className="border-t border-border pt-4">
                    <p className="text-sm text-muted-foreground mb-2">Players</p>
                    <div className="grid grid-cols-2 gap-3">
                      {info.players.map((p) => (
                        <div key={p.user_id} className={`flex items-center gap-2 bg-background px-2 py-1 rounded border border-border`}>
                          <div className="w-8 h-8 rounded-full bg-green-800/50 flex items-center justify-center">
                            <User2 className="w-4 h-4 text-green-200"/>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-foreground text-sm truncate">Seat {p.seat}</p>
                            <p className="text-muted-foreground text-xs truncate">{p.display_name || p.user_id.slice(0,6)}</p>
                          </div>
                          {p.user_id === info.host_user_id && (
                            <span className="inline-flex items-center gap-1 text-[10px] text-amber-400 bg-amber-900/20 px-1.5 py-0.5 rounded">
                              <Crown className="w-3 h-3"/> Host
                            </span>
                          )}
                          {info.status === "playing" && p.user_id === info.active_user_id && (
                            <span className="text-xs text-amber-400 font-medium">Active</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* ... rest of your UI unchanged (melds, handstrip, scoreboard modal etc) ... */}

                  <ScoreboardModal
                    isOpen={showScoreboardModal && !!revealedHands}
                    onClose={() => setShowScoreboardModal(false)}
                    data={revealedHands}
                    players={info?.players || []}
                    currentUserId={user?.id || ''}
                    tableId={tableId || ''}
                    hostUserId={info?.host_user_id || ''}
                    onNextRound={() => {
                      setShowScoreboardModal(false);
                      onNextRound();
                    }}
                  />

                  {showScoreboardPanel && revealedHands && (
                    <div className="fixed right-0 top-0 h-full w-96 bg-gray-900/95 border-l-2 border-yellow-500 shadow-2xl z-50 overflow-y-auto animate-slide-in-right">
                      {/* side scoreboard content preserved from earlier -> unchanged UI */}
                      <div className="p-6">
                        <div className="flex justify-between items-center mb-6">
                          <h2 className="text-2xl font-bold text-yellow-400">Round Results</h2>
                          <button onClick={() => setShowScoreboardPanel(false)} className="text-gray-400 hover:text-white transition-colors">
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>

                        {/* round results rendering unchanged */}
                        <div className="mb-6 p-4 bg-gray-800 rounded-lg border border-yellow-600">
                          <h3 className="text-lg font-semibold text-yellow-400 mb-3">Scores</h3>
                          {Object.entries(revealedHands.scores || {}).map(([uid, score]) => {
                            const playerName = revealedHands.player_names?.[uid] || "Unknown";
                            return (
                              <div key={uid} className="flex justify-between py-2 border-b border-gray-700 last:border-0">
                                <span className={uid === user?.id ? "text-yellow-400 font-semibold" : "text-gray-300"}>
                                  {playerName}
                                </span>
                                <span className={`font-bold ${score === 0 ? "text-green-400" : "text-red-400"}`}>
                                  {score} pts
                                </span>
                              </div>
                            );
                          })}
                        </div>

                        {/* rest unchanged */}
                      </div>
                    </div>
                  )}

                </div>
              )}
            </div>

            {/* Sidebar - Table Info (unchanged look) */}
            {true && (
              <div className="bg-card border border-border rounded-lg shadow-lg">
                <div className="flex items-center justify-between p-3 bg-muted/30 border-b border-border rounded-t-lg">
                  <h3 className="text-sm font-semibold text-foreground">Table Info</h3>
                  <div className="flex items-center gap-1">
                    <button onClick={() => {}} className="p-1 hover:bg-muted rounded" title="Minimize">
                      <ChevronUp className="w-4 h-4" />
                    </button>
                    <button onClick={() => {}} className="p-1 hover:bg-muted rounded" title="Close">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="p-4 space-y-4 max-h-[80vh] overflow-y-auto">
                  <div>
                    <p className="text-sm text-muted-foreground">Room Code</p>
                    <div className="flex items-center gap-2 mt-1">
                      <code className="text-lg font-mono text-foreground bg-background px-3 py-1 rounded border border-border">{info?.code}</code>
                      <button onClick={() => { navigator.clipboard.writeText(info?.code || ""); toast.success("Code copied!"); }} className="p-1.5 hover:bg-muted rounded">
                        <Copy className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div>
                    <p className="text-sm text-muted-foreground mb-2">Players ({info?.players?.length || 0})</p>
                    <div className="space-y-1.5">
                      {info?.players?.map((p) => (
                        <div key={p.user_id} className="flex items-center gap-2 text-sm bg-background px-2 py-1 rounded border border-border">
                          <div className="w-8 h-8 rounded-full bg-green-800/50 flex items-center justify-center">
                            <User2 className="w-4 h-4 text-green-200"/>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-foreground text-sm truncate">Seat {p.seat}</p>
                            <p className="text-muted-foreground text-xs truncate">{p.display_name || p.user_id.slice(0,6)}</p>
                          </div>
                          {p.user_id === info.host_user_id && <span className="inline-flex items-center gap-1 text-[10px] text-amber-400 bg-amber-900/20 px-1.5 py-0.5 rounded"><Crown className="w-3 h-3"/> Host</span>}
                          {info.status === "playing" && p.user_id === info.active_user_id && <span className="text-xs text-amber-400 font-medium">Active</span>}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="border-t border-border pt-3">
                    <p className="text-sm text-muted-foreground">Status: <span className="text-foreground font-medium">{info?.status ?? "-"}</span></p>
                    {info && info.status === "waiting" && user && user.id === info.host_user_id && (
                      <button onClick={onStart} disabled={starting} className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg disabled:opacity-50 mt-2">
                        <Play className="w-5 h-5" />
                        {starting ? "Starting…" : "Start Game"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Chat & Voice panels */}
            {user && info && tableId && (
              <ChatSidebar
                tableId={tableId}
                currentUserId={user.id}
                players={info.players.map(p => ({ userId: p.user_id, displayName: p.display_name || p.user_id.slice(0,6) }))}
              />
            )}

            {user && info && tableId && (
              <VoicePanel
                tableId={tableId}
                currentUserId={user.id}
                isHost={info.host_user_id === user.id}
                players={info.players}
              />
            )}

          </div>
        </div>
      </div>
    </div>
  );
}
