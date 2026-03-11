const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const Database = require("better-sqlite3");
const dotenv = require("dotenv");

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3001);
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";
const EMAIL_ENC_KEY_HEX = process.env.EMAIL_ENC_KEY || "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const EMAIL_ENC_KEY = Buffer.from(EMAIL_ENC_KEY_HEX, "hex");

if (EMAIL_ENC_KEY.length !== 32) {
  console.error("EMAIL_ENC_KEY must be 32 bytes (64 hex chars).");
  process.exit(1);
}

// Game Database Setup //
const db = new Database("game.db");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  email_ciphertext TEXT,
  email_iv TEXT,
  email_auth_tag TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_stats (
  user_id INTEGER PRIMARY KEY,
  runs_completed INTEGER NOT NULL DEFAULT 0,
  runs_failed INTEGER NOT NULL DEFAULT 0,
  best_time_ms INTEGER,
  total_runs INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS run_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  outcome TEXT NOT NULL CHECK(outcome IN ('escaped','died')),
  completion_time_ms INTEGER,
  recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
`);

// --- SECURITY / MIDDLEWARE ---
app.use(helmet());
app.use(express.json({ limit: "200kb" }));
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // allow tools
    if (origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:")) {
      return cb(null, true);
    }
    return cb(new Error("CORS blocked: " + origin), false);
  }
}));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 25,
  standardHeaders: true,
  legacyHeaders: false
});

app.use("/api/login", authLimiter);
app.use("/api/register", authLimiter);

// --- HELPERS ---
function encryptText(plainText) {
  if (!plainText) return { ciphertext: null, iv: null, authTag: null };

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", EMAIL_ENC_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: encrypted.toString("hex"),
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex")
  };
}

function decryptText(ciphertextHex, ivHex, authTagHex) {
  if (!ciphertextHex || !ivHex || !authTagHex) return null;
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    EMAIL_ENC_KEY,
    Buffer.from(ivHex, "hex")
  );
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(ciphertextHex, "hex")),
    decipher.final()
  ]);
  return decrypted.toString("utf8");
}

function signToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function authRequired(req, res, next) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: "Missing or invalid token" });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { id: payload.sub, username: payload.username };
    next();
  } catch (err) {
    return res.status(401).json({ error: "Token expired or invalid" });
  }
}

function validateUsername(username) {
  return typeof username === "string" &&
    username.length >= 3 &&
    username.length <= 20 &&
    /^[a-zA-Z0-9_]+$/.test(username);
}

function validatePassword(password) {
  // Coursework-friendly: demonstrates complexity requirements
  return typeof password === "string" &&
    password.length >= 8 &&
    password.length <= 72 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /[0-9]/.test(password) &&
    /[^A-Za-z0-9]/.test(password);
}

// --- ROUTES ---
app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "tsunami-horror-api" });
});

app.post("/api/register", async (req, res) => {
  try {
    const { username, password, email } = req.body || {};

    if (!validateUsername(username)) {
      return res.status(400).json({
        error: "Username must be 3-20 chars and contain only letters, numbers, underscores"
      });
    }

    if (!validatePassword(password)) {
      return res.status(400).json({
        error: "Password must be 8+ chars and include upper, lower, number, and symbol"
      });
    }

    if (email && (typeof email !== "string" || email.length > 100 || !email.includes("@"))) {
      return res.status(400).json({ error: "Invalid email format" });
    }

    const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
    if (existing) {
      return res.status(409).json({ error: "Username already exists" });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const enc = encryptText(email || null);

    const insertUser = db.prepare(`
      INSERT INTO users (username, password_hash, email_ciphertext, email_iv, email_auth_tag)
      VALUES (?, ?, ?, ?, ?)
    `);

    const result = insertUser.run(
      username,
      passwordHash,
      enc.ciphertext,
      enc.iv,
      enc.authTag
    );

    db.prepare("INSERT INTO user_stats (user_id) VALUES (?)").run(result.lastInsertRowid);

    const user = { id: result.lastInsertRowid, username };
    const token = signToken(user);

    return res.status(201).json({
      message: "Account created",
      token,
      user: { id: user.id, username: user.username }
    });
  } catch (err) {
    console.error("Register error:", err);
    return res.status(500).json({ error: "Server error during registration" });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body || {};

    if (typeof username !== "string" || typeof password !== "string") {
      return res.status(400).json({ error: "Username and password required" });
    }

    const user = db.prepare(`
      SELECT id, username, password_hash
      FROM users
      WHERE username = ?
    `).get(username);

    if (!user) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    const token = signToken(user);
    return res.json({
      message: "Login successful",
      token,
      user: { id: user.id, username: user.username }
    });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ error: "Server error during login" });
  }
});

app.get("/api/me", authRequired, (req, res) => {
  const row = db.prepare(`
    SELECT u.id, u.username, u.email_ciphertext, u.email_iv, u.email_auth_tag,
           s.runs_completed, s.runs_failed, s.best_time_ms, s.total_runs
    FROM users u
    JOIN user_stats s ON s.user_id = u.id
    WHERE u.id = ?
  `).get(req.user.id);

  if (!row) return res.status(404).json({ error: "User not found" });

  let email = null;
  try {
    email = decryptText(row.email_ciphertext, row.email_iv, row.email_auth_tag);
  } catch {
    email = null;
  }

  res.json({
    user: {
      id: row.id,
      username: row.username,
      email
    },
    stats: {
      runsCompleted: row.runs_completed,
      runsFailed: row.runs_failed,
      bestTimeMs: row.best_time_ms,
      totalRuns: row.total_runs
    }
  });
});

app.post("/api/game/run", authRequired, (req, res) => {
  try {
    const { outcome, completionTimeMs } = req.body || {};

    if (!["escaped", "died"].includes(outcome)) {
      return res.status(400).json({ error: "Outcome must be 'escaped' or 'died'" });
    }

    let time = null;
    if (outcome === "escaped") {
      if (!Number.isInteger(completionTimeMs) || completionTimeMs < 1000 || completionTimeMs > 180000) {
        return res.status(400).json({ error: "Invalid completion time" });
      }
      time = completionTimeMs;
    }

    const insertRun = db.prepare(`
      INSERT INTO run_records (user_id, outcome, completion_time_ms)
      VALUES (?, ?, ?)
    `);

    const updateStatsEscaped = db.prepare(`
      UPDATE user_stats
      SET runs_completed = runs_completed + 1,
          total_runs = total_runs + 1,
          best_time_ms = CASE
            WHEN best_time_ms IS NULL THEN ?
            WHEN ? < best_time_ms THEN ?
            ELSE best_time_ms
          END
      WHERE user_id = ?
    `);

    const updateStatsDied = db.prepare(`
      UPDATE user_stats
      SET runs_failed = runs_failed + 1,
          total_runs = total_runs + 1
      WHERE user_id = ?
    `);

    const tx = db.transaction(() => {
      insertRun.run(req.user.id, outcome, time);
      if (outcome === "escaped") {
        updateStatsEscaped.run(time, time, time, req.user.id);
      } else {
        updateStatsDied.run(req.user.id);
      }
    });

    tx();

    res.json({ message: "Run recorded" });
  } catch (err) {
    console.error("Run record error:", err);
    res.status(500).json({ error: "Server error recording run" });
  }
});

app.get("/api/leaderboard", (req, res) => {
  const rows = db.prepare(`
    SELECT u.username, s.best_time_ms, s.runs_completed, s.runs_failed
    FROM user_stats s
    JOIN users u ON u.id = s.user_id
    WHERE s.best_time_ms IS NOT NULL
    ORDER BY s.best_time_ms ASC
    LIMIT 20
  `).all();

  res.json({ leaderboard: rows });
});

app.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`);
});