import React, { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

// UI Components
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";

// Icons
import {
  ArrowLeft,
  Users,
  Trophy,
  Crown,
  Copy,
  Check,
} from "lucide-react";

// Notifications
import { toast } from "sonner";

// API Client
import apiclient from "../apiclient";

// Auth
import { useUser } from "@stackframe/react";

// -----------------------------
// Variant Config
// -----------------------------
const variantConfigs = {
  no_wildcard: {
    id: "no_wildcard",
    title: "No Wild Card",
    wildJokerMode: "no_joker",
    description: "Pure classic rummy with printed jokers only",
    color: "from-blue-500 to-cyan-500",
  },
  open_wildcard: {
    id: "open_wildcard",
    title: "Open Wild Card",
    wildJokerMode: "open_joker",
    description: "Traditional rummy with wild card revealed at start",
    color: "from-green-500 to-emerald-500",
  },
  close_wildcard: {
    id: "close_wildcard",
    title: "Close Wild Card",
    wildJokerMode: "close_joker",
    description:
      "Advanced variant - wild card reveals after first sequence",
    color: "from-purple-500 to-pink-500",
  },
};

export default function CreateTable() {
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const user = useUser();

  const variantId = sp.get("variant") || "open_wildcard";
  const variant = variantConfigs[variantId];

  const [playerName, setPlayerName] = useState("Player");
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [disqualifyScore, setDisqualifyScore] = useState(200);
  const [aceValue, setAceValue] = useState(10);
  const [creating, setCreating] = useState(false);
  const [generatedCode, setGeneratedCode] = useState("");
  const [tableId, setTableId] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (user?.displayName) {
      setPlayerName(user.displayName);
    }
  }, [user]);

  // -----------------------------
  // Create Room
  // -----------------------------
  const handleCreateRoom = async () => {
    if (!playerName.trim()) {
      toast.error("Enter your name");
      return;
    }

    if (aceValue !== 1 && aceValue !== 10) {
      toast.error("Invalid Ace Value");
      return;
    }

    if (!variant.wildJokerMode) {
      toast.error("Invalid Joker Mode");
      return;
    }

    setCreating(true);
    try {
      const body = {
        max_players: maxPlayers,
        disqualify_score: disqualifyScore,
        wild_joker_mode: variant.wildJokerMode,
        ace_value: aceValue,
      };

      const res = await apiclient.create_table(body);
      const data = await res.json();

      setGeneratedCode(data.code);
      setTableId(data.table_id);

      toast.success("Room Created!");
    } catch (e) {
      toast.error("Failed to create room");
    } finally {
      setCreating(false);
    }
  };

  // -----------------------------
  // Start Game
  // -----------------------------
  const handleStartGame = () => {
    navigate(`/Table?tableId=${tableId}`);
  };

  // -----------------------------
  // Copy Code
  // -----------------------------
  const copyToClipboard = () => {
    navigator.clipboard.writeText(generatedCode);
    setCopied(true);
    toast.success("Code Copied!");
    setTimeout(() => setCopied(false), 2000);
  };

  // -----------------------------
  // Render: Room Created Screen
  // -----------------------------
  if (generatedCode && tableId) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">

        <div className="border-b border-slate-700/50 bg-slate-900/50 backdrop-blur">
          <div className="max-w-3xl mx-auto px-6 py-6">
            <h1 className="text-3xl font-bold text-white">{variant.title}</h1>
            <p className="text-slate-400">{variant.description}</p>
          </div>
        </div>

        <div className="max-w-3xl mx-auto px-6 py-12">
          <Card className="bg-slate-800/50 border-slate-700 p-8">

            {/* Success */}
            <div className="text-center mb-8">
              <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-green-500/20 mb-4">
                <Crown className="w-10 h-10 text-green-400" />
              </div>
              <h2 className="text-2xl font-bold text-white">Room Created!</h2>
              <p className="text-slate-400">Share the code below</p>
            </div>

            {/* Code Box */}
            <div className="bg-slate-900/70 border border-slate-600 rounded-xl p-8 mb-8">
              <p className="text-sm text-slate-400 text-center mb-3">Room Code</p>
              <p className="text-5xl text-center text-white font-mono font-bold tracking-wider mb-6">
                {generatedCode}
              </p>
              <Button onClick={copyToClipboard} className="w-full bg-slate-700 hover:bg-slate-600">
                {copied ? <><Check className="w-5 h-5 mr-2" />Copied</> :
                  <><Copy className="w-5 h-5 mr-2" />Copy Code</>}
              </Button>
            </div>

            {/* Details */}
            <div className="space-y-3 bg-slate-900/50 rounded-lg p-6 mb-8">
              <Detail label="Host" value={playerName} />
              <Detail label="Game Mode" value={variant.title} />
              <Detail label="Max Players" value={maxPlayers} />
              <Detail label="Disqualify Score" value={`${disqualifyScore} pts`} />
              <Detail label="Ace Value" value={`${aceValue} pts`} />
            </div>

            {/* Buttons */}
            <div className="flex gap-3">
              <Button
                onClick={() => {
                  setGeneratedCode("");
                  setTableId(null);
                  navigate("/");
                }}
                className="flex-1 bg-slate-700 hover:bg-slate-600"
              >
                Cancel
              </Button>

              <Button
                onClick={handleStartGame}
                className={`flex-1 bg-gradient-to-r ${variant.color} text-white font-semibold`}
              >
                Go to Table
              </Button>
            </div>

          </Card>
        </div>
      </div>
    );
  }

  // -----------------------------
  // Render: Create Room Form
  // -----------------------------
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">

      <div className="border-b border-slate-700/50 bg-slate-900/50 backdrop-blur">
        <div className="max-w-3xl mx-auto px-6 py-6">

          <Button
            onClick={() => navigate("/")}
            className="text-slate-400 hover:text-white mb-4"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>

          <h1 className="text-3xl font-bold text-white">{variant.title}</h1>
          <p className="text-slate-400">{variant.description}</p>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-12">
        <Card className="bg-slate-800/50 border-slate-700 p-8">

          <h2 className="text-2xl text-white font-bold mb-6">Create Private Room</h2>

          <div className="space-y-6">

            {/* Name */}
            <div>
              <label className="block text-sm text-slate-300 mb-2">Your Name</label>
              <Input
                type="text"
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                className="bg-slate-900/50 border-slate-600 text-white"
              />
            </div>

            {/* Max Players */}
            <SelectBox
              label="Maximum Players"
              icon={<Users className="inline w-4 h-4 mr-2" />}
              value={maxPlayers}
              setValue={setMaxPlayers}
              options={[2, 3, 4, 5, 6]}
            />

            {/* Disqualification Score */}
            <SelectBox
              label="Disqualification Score"
              icon={<Trophy className="inline w-4 h-4 mr-2" />}
              value={disqualifyScore}
              setValue={setDisqualifyScore}
              options={[200, 300, 400, 500, 600]}
            />

            {/* Ace Value */}
            <AceSelect aceValue={aceValue} setAceValue={setAceValue} variant={variant} />

            <Button
              onClick={handleCreateRoom}
              disabled={!playerName.trim() || creating}
              className={`w-full bg-gradient-to-r ${variant.color} py-6 text-white font-semibold text-lg`}
            >
              {creating ? "Creating..." : "Create Room"}
            </Button>

          </div>
        </Card>
      </div>
    </div>
  );
}

// -----------------------------
// Small Components
// -----------------------------
function Detail({ label, value }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-slate-400">{label}:</span>
      <span className="text-white">{value}</span>
    </div>
  );
}

function SelectBox({ label, icon, value, setValue, options }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-300 mb-2">
        {icon}
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => setValue(Number(e.target.value))}
        className="w-full px-4 py-2 bg-slate-900/50 border border-slate-600 text-white rounded-lg"
      >
        {options.map((op) => (
          <option key={op} value={op}>
            {op}
            {label.includes("Players") ? " Players" : " Points"}
          </option>
        ))}
      </select>
    </div>
  );
}

function AceSelect({ aceValue, setAceValue, variant }) {
  return (
    <div>
      <label className="block text-sm text-slate-300 mb-3">Ace Point Value</label>
      <div className="grid grid-cols-2 gap-3">
        {[1, 10].map((v) => (
          <button
            key={v}
            onClick={() => setAceValue(v)}
            className={`p-4 rounded-lg border-2 transition-all ${
              aceValue === v
                ? `border-transparent bg-gradient-to-r ${variant.color} text-white`
                : "border-slate-600 bg-slate-900/50 text-slate-300 hover:border-slate-500"
            }`}
          >
            <div className="text-2xl font-bold">{v}</div>
            <div className="text-xs opacity-80 mt-1">
              {v === 1 ? "Point" : "Points"}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
