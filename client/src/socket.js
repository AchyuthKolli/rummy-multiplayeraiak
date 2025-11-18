import { io } from "socket.io-client";

// ✅ Vite environment variable
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:3001";

export const socket = io(SOCKET_URL, {
  transports: ["websocket"],
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 500,
});

socket.on("connect", () => {
  console.log("🟢 Socket connected:", socket.id);
});

socket.on("disconnect", () => {
  console.log("🔴 Socket disconnected");
});

// ====== SUBSCRIBE TO ROOM ======
export const joinRoom = (tableId, userId) => {
  socket.emit("join_room", { tableId, userId });
};

// ====== LISTENERS ======
export const onGameUpdate = (callback) => {
  socket.on("game_update", callback);
};

export const onChatMessage = (callback) => {
  socket.on("chat_message", callback);
};

export const onVoiceStatus = (callback) => {
  socket.on("voice_status", callback);
};

export const onDeclareUpdate = (callback) => {
  socket.on("declare_made", callback);
};

export const onSpectateUpdate = (callback) => {
  socket.on("spectate_update", callback);
};

// ====== SENDERS ======
export const sendChatMsg = (tableId, userId, message) => {
  socket.emit("chat_message", { tableId, userId, message });
};

export const broadcastVoice = (tableId, userId, muted) => {
  socket.emit("voice_status", { tableId, userId, muted });
};

export const notifySpectate = (tableId, requesterId, targetId) => {
  socket.emit("spectate_request", { tableId, requesterId, targetId });
};
