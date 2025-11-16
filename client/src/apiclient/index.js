// client/src/apiclient/index.js
import axios from "axios";

const BASE_URL = "http://localhost:3001"; // backend server

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 6000,
});

// -----------------------------------------
// TABLE / ROOM APIs
// -----------------------------------------

export const createTable = async (payload) => {
  return api.post("/table/create", payload);
};

export const joinTable = async (payload) => {
  return api.post("/table/join", payload);
};

export const getTableState = async (tableId, userId) => {
  return api.get(`/table/state/${tableId}/${userId}`);
};

export const startNextRound = async (tableId, userId) => {
  return api.post("/table/nextround", { tableId, userId });
};

// -----------------------------------------
// GAME ACTIONS APIs
// -----------------------------------------

export const drawFromDeck = async (tableId, userId) => {
  return api.post("/game/draw/deck", { tableId, userId });
};

export const drawFromDiscard = async (tableId, userId) => {
  return api.post("/game/draw/discard", { tableId, userId });
};

export const discardCard = async (tableId, userId, card) => {
  return api.post("/game/discard", { tableId, userId, card });
};

export const declareShow = async (tableId, userId, melds) => {
  return api.post("/game/declare", { tableId, userId, melds });
};

export const dropBeforePick = async (tableId, userId) => {
  return api.post("/game/drop", { tableId, userId });
};

// -----------------------------------------
// SCOREBOARD HISTORY
// -----------------------------------------

export const getScoreHistory = async (tableId) => {
  return api.get(`/table/history/${tableId}`);
};

// -----------------------------------------
// CHAT
// -----------------------------------------

export const sendChat = async (tableId, userId, message) => {
  return api.post("/chat/send", { tableId, userId, message });
};

// -----------------------------------------
// VOICE CALL / JOIN-LEAVE INDICATOR
// -----------------------------------------

export const userJoinedCall = async (tableId, userId) => {
  return api.post("/call/join", { tableId, userId });
};

export const userLeftCall = async (tableId, userId) => {
  return api.post("/call/leave", { tableId, userId });
};

export default {
  createTable,
  joinTable,
  getTableState,
  startNextRound,
  drawFromDeck,
  drawFromDiscard,
  discardCard,
  declareShow,
  dropBeforePick,
  getScoreHistory,
  sendChat,
  userJoinedCall,
  userLeftCall,
};
