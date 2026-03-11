// frontend/app.js
// Auth + profile + leaderboard only (NO Three.js game code)

const API_BASE = `${location.protocol}//${location.hostname}:3001/api`;

const authStatus = document.getElementById("authStatus");
const authMessage = document.getElementById("authMessage");
const profileBox = document.getElementById("profileBox");
const leaderboardBox = document.getElementById("leaderboardBox");

let authToken = localStorage.getItem("tsunami_token") || "";

function setMessage(msg, type = "info") {
  authMessage.textContent = msg;
  authMessage.style.color =
    type === "error" ? "#ff7d8a" :
    type === "success" ? "#73d38d" :
    "#9aa5b5";
}

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  } catch (e) {
    throw new Error(`Failed to reach backend at ${API_BASE}. Is it running?`);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function formatMs(ms) {
  if (ms == null) return "—";
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  const centi = Math.floor((ms % 1000) / 10);
  return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(centi).padStart(2, "0")}`;
}

// Tabs
document.getElementById("showLoginBtn").addEventListener("click", () => {
  document.getElementById("loginForm").classList.remove("hidden");
  document.getElementById("registerForm").classList.add("hidden");
  document.getElementById("showLoginBtn").classList.add("active");
  document.getElementById("showRegisterBtn").classList.remove("active");
});

document.getElementById("showRegisterBtn").addEventListener("click", () => {
  document.getElementById("registerForm").classList.remove("hidden");
  document.getElementById("loginForm").classList.add("hidden");
  document.getElementById("showRegisterBtn").classList.add("active");
  document.getElementById("showLoginBtn").classList.remove("active");
});

// Login
document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  setMessage("Logging in...");
  try {
    const username = document.getElementById("loginUsername").value.trim();
    const password = document.getElementById("loginPassword").value;

    const data = await api("/login", {
      method: "POST",
      body: JSON.stringify({ username, password })
    });

    authToken = data.token;
    localStorage.setItem("tsunami_token", authToken);
    setMessage("Login successful", "success");
    await loadProfile();
    await loadLeaderboard();
  } catch (err) {
    setMessage(err.message, "error");
  }
});

// Register
document.getElementById("registerForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  setMessage("Creating account...");
  try {
    const username = document.getElementById("registerUsername").value.trim();
    const email = document.getElementById("registerEmail").value.trim();
    const password = document.getElementById("registerPassword").value;

    const data = await api("/register", {
      method: "POST",
      body: JSON.stringify({ username, email, password })
    });

    authToken = data.token;
    localStorage.setItem("tsunami_token", authToken);
    setMessage("Account created and logged in", "success");
    await loadProfile();
    await loadLeaderboard();
  } catch (err) {
    setMessage(err.message, "error");
  }
});

// Profile
async function loadProfile() {
  if (!authToken) {
    authStatus.textContent = "Not logged in";
    profileBox.innerHTML = "<p>Log in to load your stats.</p>";
    return;
  }

  try {
    const data = await api("/me");
    authStatus.textContent = `Logged in: ${data.user.username}`;
    profileBox.innerHTML = `
      <p><strong>User:</strong> ${data.user.username}</p>
      <p><strong>Email:</strong> ${data.user.email ?? "Not set"}</p>
      <p><strong>Completed Runs:</strong> ${data.stats.runsCompleted}</p>
      <p><strong>Failed Runs:</strong> ${data.stats.runsFailed}</p>
      <p><strong>Total Runs:</strong> ${data.stats.totalRuns}</p>
      <p><strong>Best Time:</strong> ${formatMs(data.stats.bestTimeMs)}</p>
    `;
  } catch (err) {
    setMessage(err.message, "error");
    authToken = "";
    localStorage.removeItem("tsunami_token");
    authStatus.textContent = "Not logged in";
    profileBox.innerHTML = "<p>Log in to load your stats.</p>";
  }
}

// Leaderboard
async function loadLeaderboard() {
  leaderboardBox.innerHTML = "<p>Loading...</p>";
  try {
    const data = await api("/leaderboard", { method: "GET" });
    if (!data.leaderboard.length) {
      leaderboardBox.innerHTML = "<p>No escape times recorded yet.</p>";
      return;
    }
    leaderboardBox.innerHTML = data.leaderboard.map((row, i) => `
      <div class="leaderboard-item">
        <span>${i + 1}. ${row.username}</span>
        <span>${formatMs(row.best_time_ms)}</span>
      </div>
    `).join("");
  } catch (err) {
    leaderboardBox.innerHTML = `<p style="color:#ff7d8a">${err.message}</p>`;
  }
}

document.getElementById("refreshLeaderboardBtn").addEventListener("click", loadLeaderboard);

// Initial load
loadProfile();
loadLeaderboard();