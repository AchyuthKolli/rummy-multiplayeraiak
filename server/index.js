// server/index.js
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
dotenv.config();

const { requireAuth } = require("./auth");

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: "1mb" }));
app.use(bodyParser.urlencoded({ extended: true }));

// Health
app.get("/health", (req, res) => res.json({ status: "ok", ts: Date.now() }));

// Auto-load routers from server/APIs/*.js
const apisDir = path.join(__dirname, "APIs");
if (fs.existsSync(apisDir)) {
  const files = fs.readdirSync(apisDir).filter((f) => f.endsWith(".js"));
  for (const file of files) {
    try {
      const routerPath = path.join(apisDir, file);
      const mod = require(routerPath);
      // The old python files are not valid JS — make sure server/APIs contains JS routers.
      // Expect each file to export an Express Router as `module.exports = router;`
      if (mod && mod.router) {
        // if module exports { router }, mount it
        app.use("/api", mod.router);
        console.log("Mounted router (router exported prop):", file);
      } else if (mod && mod instanceof express.Router) {
        app.use("/api", mod);
        console.log("Mounted router (router default):", file);
      } else if (mod && mod.default && mod.default instanceof express.Router) {
        app.use("/api", mod.default);
        console.log("Mounted router (router default export):", file);
      } else {
        // Try to mount it as a function that accepts (app, requireAuth)
        if (typeof mod === "function") {
          mod(app, requireAuth);
          console.log("Mounted API function:", file);
        } else {
          console.warn(`Skipped ${file}: not an express router or initializer`);
        }
      }
    } catch (e) {
      console.error("Failed to mount API file", file, e.message || e);
    }
  }
} else {
  console.warn("No server/APIs directory found to load routers from");
}

// Example protected route (you can remove later)
app.get("/api/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT} (env ${process.env.NODE_ENV || "dev"})`);
});
