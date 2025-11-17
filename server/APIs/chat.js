// server/APIs/chat.js
const express = require("express");
const router = express.Router();
const db = require("../db"); // your DB helper
const { requireAuth } = require("../middleware/auth");

// ------------------------------
// SEND MESSAGE
// ------------------------------
router.post("/chat/send", requireAuth, async (req, res) => {
    const userId = req.user.sub;
    const { table_id, message, is_private = false, recipient_id = null } = req.body;

    if (!table_id || !message)
        return res.status(400).json({ detail: "Missing table_id or message" });

    try {
        // check user in table
        const player = await db.query(
            `SELECT display_name FROM rummy_table_players WHERE table_id=$1 AND user_id=$2`,
            [table_id, userId]
        );

        if (!player.rows.length) {
            return res.status(403).json({ detail: "You are not part of this table" });
        }

        // private message recipient validation
        if (is_private && recipient_id) {
            const recipient = await db.query(
                `SELECT user_id FROM rummy_table_players WHERE table_id=$1 AND user_id=$2`,
                [table_id, recipient_id]
            );
            if (!recipient.rows.length)
                return res.status(400).json({ detail: "Recipient not in table" });
        }

        // save message
        const row = await db.query(
            `INSERT INTO chat_messages (table_id, user_id, message, is_private, recipient_id)
             VALUES ($1,$2,$3,$4,$5)
             RETURNING id, table_id, user_id, message, is_private, recipient_id, created_at`,
            [table_id, userId, message, is_private, recipient_id]
        );

        return res.json({
            ...row.rows[0],
            sender_name: player.rows[0].display_name || "Anonymous",
        });

    } catch (err) {
        console.error("chat/send error:", err);
        return res.status(500).json({ detail: "Server error" });
    }
});

// ------------------------------
// GET MESSAGES
// ------------------------------
router.get("/chat/messages", requireAuth, async (req, res) => {
    const userId = req.user.sub;
    const { table_id, limit = 100, before_id = null } = req.query;

    if (!table_id)
        return res.status(400).json({ detail: "Missing table_id" });

    try {
        // validate table membership
        const player = await db.query(
            `SELECT user_id FROM rummy_table_players WHERE table_id=$1 AND user_id=$2`,
            [table_id, userId]
        );

        if (!player.rows.length) {
            return res.status(403).json({ detail: "Not part of this table" });
        }

        let params = [table_id, userId];
        let query = `
            SELECT 
                cm.id, cm.table_id, cm.user_id, cm.message,
                cm.is_private, cm.recipient_id, cm.created_at,
                p.display_name AS sender_name
            FROM chat_messages cm
            JOIN rummy_table_players p 
                ON cm.table_id = p.table_id 
                AND cm.user_id = p.user_id
            WHERE cm.table_id = $1
            AND (
                cm.is_private = FALSE
                OR cm.user_id = $2
                OR cm.recipient_id = $2
            )
        `;

        // pagination
        if (before_id) {
            query += ` AND cm.id < $3`;
            params.push(before_id);
        }

        params.push(Number(limit) + 1);

        query += ` ORDER BY cm.created_at DESC, cm.id DESC LIMIT $${params.length}`;

        const rows = await db.query(query, params);

        const has_more = rows.rows.length > limit;
        const msgs = has_more ? rows.rows.slice(0, limit) : rows.rows;

        // chronological order
        msgs.reverse();

        return res.json({
            messages: msgs,
            has_more,
        });

    } catch (err) {
        console.error("chat/messages error:", err);
        return res.status(500).json({ detail: "Server error" });
    }
});

module.exports = router;
// server/APIs/chat.js
const express = require("express");
const router = express.Router();
const { fetch, fetchrow, execute } = require("../../server/db"); // adjust path if needed
const { requireAuth } = require("../../server/auth");

// Simple send message
router.post("/chat/send", requireAuth, async (req, res) => {
  try {
    const { table_id, message, is_private = false, recipient_id = null } = req.body;
    const userId = req.user.id;
    // NOTE: Add table membership checks similar to your python code
    const q = `INSERT INTO chat_messages (table_id, user_id, message, is_private, recipient_id, created_at)
               VALUES ($1, $2, $3, $4, $5, now()) RETURNING id, table_id, user_id, message, is_private, recipient_id, created_at`;
    const row = await fetchrow(q, table_id, userId, message, is_private, recipient_id);
    return res.json({
      id: row.id,
      table_id: row.table_id,
      user_id: row.user_id,
      sender_name: req.user.name,
      message: row.message,
      is_private: row.is_private,
      recipient_id: row.recipient_id,
      created_at: row.created_at,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal error" });
  }
});

module.exports = router;


