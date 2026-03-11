// frontend/gameBabylon.js
// Babylon loaded via <script> tags, available as globals:
const BABYLON = window.BABYLON;
const GUI = window.BABYLON.GUI;

/**
 * Minimal Babylon FPS horror prototype for OCR coursework.
 * - Low-poly scene
 * - 3-minute escape timer
 * - TV starts broadcast
 * - Door unlocks after broadcast
 * - Ramp acts as stairs
 * - Roof trigger = escape
 * - Tsunami wall approaches = death
 *
 * Integrates with backend:
 * POST /api/game/run  (Bearer token optional)
 */

// ---------- API INTEGRATION ----------
const API_BASE = `${location.protocol}//${location.hostname}:3001/api`;
let authToken = localStorage.getItem("tsunami_token") || "";

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  } catch {
    throw new Error(`Failed to reach backend at ${API_BASE}. Is it running?`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function recordRun(outcome, completionTimeMs = null) {
  // Allow anonymous runs; only submit if logged in.
  if (!authToken) return;
  try {
    await api("/game/run", {
      method: "POST",
      body: JSON.stringify({ outcome, completionTimeMs })
    });
    // If your site has a leaderboard refresh function elsewhere, you can call it here.
  } catch (e) {
    console.warn("Failed to record run:", e.message);
  }
}

// ---------- HUD HELPERS ----------
function formatTimer(msRemaining) {
  const totalSec = Math.max(0, Math.ceil(msRemaining / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// ---------- GAME TEMPLATE ----------
export function startBabylonGame(canvasId = "gameCanvas") {
  const canvas = document.getElementById(canvasId);
  if (!canvas) throw new Error(`Canvas #${canvasId} not found`);

  // Engine: low requirements (disable antialias, cap hardware scaling)
  const engine = new BABYLON.Engine(canvas, false, {
    preserveDrawingBuffer: false,
    stencil: false,
    disableWebGL2Support: false
  });

  // Reduce resolution for PS1/PS2 vibe + performance
  engine.setHardwareScalingLevel(1.35);

  const scene = new BABYLON.Scene(engine);
  scene.clearColor = new BABYLON.Color4(0.04, 0.06, 0.10, 1.0);
  scene.fogMode = BABYLON.Scene.FOGMODE_EXP2;
  scene.fogDensity = 0.02;
  scene.fogColor = new BABYLON.Color3(0.04, 0.06, 0.10);
  // Press I to toggle the Babylon Inspector (editor/debug UI)
window.addEventListener("keydown", (e) => {
  if (e.code === "KeyI") {
    if (scene.debugLayer.isVisible()) {
      scene.debugLayer.hide();
      debugFreeze = false; // resume updates
    } else {
      scene.debugLayer.show({ overlay: true });
      debugFreeze = true;  // freeze updates so inspector edits persist
    }
  }
});
  // Basic lighting (retro)
  const hemi = new BABYLON.HemisphericLight("hemi", new BABYLON.Vector3(0, 1, 0), scene);
  hemi.intensity = 0.6;

  const dir = new BABYLON.DirectionalLight("dir", new BABYLON.Vector3(-0.4, -1, 0.2), scene);
  dir.position = new BABYLON.Vector3(20, 30, -10);
  dir.intensity = 0.6;

  // Enable collisions + gravity (simple FPS feel)
  scene.collisionsEnabled = true;
  scene.gravity = new BABYLON.Vector3(0, -0.5, 0);

  // Camera: UniversalCamera gives FPS-like controls quickly
  const camera = new BABYLON.UniversalCamera("cam", new BABYLON.Vector3(0, 1.7, 0), scene);
  camera.attachControl(canvas, true);
  camera.keysUp = [87];    // W
  camera.keysDown = [83];  // S
  camera.keysLeft = [65];  // A
  camera.keysRight = [68]; // D
  camera.speed = 0.18;
  camera.angularSensibility = 2500;
  camera.applyGravity = true;
  camera.checkCollisions = true;
  camera.ellipsoid = new BABYLON.Vector3(0.28, 0.85, 0.28);
  camera.ellipsoidOffset = new BABYLON.Vector3(0, 0.85, 0);

  // Lock pointer on click (mouse look)
  canvas.addEventListener("click", () => {
    if (!scene.getEngine().isPointerLock) {
      canvas.requestPointerLock?.();
    }
  });

  // Materials (flat shaded look)
  function flatMat(name, hex) {
    const m = new BABYLON.StandardMaterial(name, scene);
    m.diffuseColor = BABYLON.Color3.FromHexString(hex);
    m.specularColor = BABYLON.Color3.Black(); // no shiny highlights
    m.emissiveColor = BABYLON.Color3.Black();
    return m;
  }

  const matWall = flatMat("wall", "#4f5968");
  const matFloor = flatMat("floor", "#1a1f2c");
  const matDoor = flatMat("door", "#7c5e4d");
  const matTV = flatMat("tv", "#101318");
  const matRoof = flatMat("roof", "#2c3442");
  const matWave = new BABYLON.StandardMaterial("wave", scene);
  matWave.diffuseColor = BABYLON.Color3.FromHexString("#2b5f99");
  matWave.alpha = 0.65;
  matWave.specularColor = BABYLON.Color3.Black();

  // ---------- LEVEL GEOMETRY ----------
  // Ground
  const ground = BABYLON.MeshBuilder.CreateGround("ground", { width: 80, height: 80 }, scene);
  ground.position.y = 0;
  ground.checkCollisions = true;
  ground.material = matFloor;

  // Apartment room (box walls)
  function wall(name, pos, size) {
    const m = BABYLON.MeshBuilder.CreateBox(name, size, scene);
    m.position = pos.clone();
    m.checkCollisions = true;
    m.material = matWall;
    return m;
  }

  // Room centered near origin
  wall("wall_n", new BABYLON.Vector3(0, 1.5, -4), { width: 8, height: 3, depth: 0.4 });
  wall("wall_s", new BABYLON.Vector3(0, 1.5, 4), { width: 8, height: 3, depth: 0.4 });
  wall("wall_w", new BABYLON.Vector3(-4, 1.5, 0), { width: 0.4, height: 3, depth: 8 });
  // Split east wall for door gap: two segments
  wall("wall_e1", new BABYLON.Vector3(4, 1.5, 2.2), { width: 0.4, height: 3, depth: 3.6 });
  wall("wall_e2", new BABYLON.Vector3(4, 1.5, -2.2), { width: 0.4, height: 3, depth: 3.6 });

  // Corridor (simple)
  const corridor = BABYLON.MeshBuilder.CreateBox("corridor", { width: 24, height: 1, depth: 10 }, scene);
  corridor.position = new BABYLON.Vector3(12, 0.5, 0);
  corridor.checkCollisions = true;
  corridor.material = matFloor;

  // Corridor walls
  wall("corr_n", new BABYLON.Vector3(12, 1.5, -5), { width: 24, height: 3, depth: 0.4 });
  wall("corr_s", new BABYLON.Vector3(12, 1.5, 5), { width: 24, height: 3, depth: 0.4 });

  // Roof platform (higher)
  const roof = BABYLON.MeshBuilder.CreateBox("roof", { width: 18, height: 1, depth: 18 }, scene);
  roof.position = new BABYLON.Vector3(28, 6, 0);
  roof.checkCollisions = true;
  roof.material = matRoof;

  // “Stairs” as a ramp (easy to climb)
  const ramp = BABYLON.MeshBuilder.CreateBox("ramp", { width: 12, height: 0.6, depth: 6 }, scene);
ramp.position = new BABYLON.Vector3(20, 2.6, 0);

// ✅ Flip direction so it slopes upward toward the roof (positive X direction)
ramp.rotation.z = 0.35;

ramp.checkCollisions = true;
ramp.material = flatMat("ramp", "#3b4250");

  // Roof rails (visual + collisions)
  const railN = BABYLON.MeshBuilder.CreateBox("railN", { width: 18, height: 2, depth: 0.3 }, scene);
  railN.position = new BABYLON.Vector3(28, 7, -9);
  railN.checkCollisions = true;
  railN.material = flatMat("rail", "#697387");

  const railS = railN.clone("railS");
  railS.position.z = 9;

  const railW = BABYLON.MeshBuilder.CreateBox("railW", { width: 0.3, height: 2, depth: 18 }, scene);
  railW.position = new BABYLON.Vector3(19, 7, 0);
  railW.checkCollisions = true;
  railW.material = flatMat("rail2", "#697387");

  const railE = railW.clone("railE");
  railE.position.x = 37;

  // Interactable TV
  const tv = BABYLON.MeshBuilder.CreateBox("tv", { width: 1.2, height: 0.8, depth: 0.2 }, scene);
  tv.position = new BABYLON.Vector3(-1.5, 1.0, -2.5);
  tv.material = matTV;
  tv.metadata = { type: "tv" };

  // Door (starts locked)
  const door = BABYLON.MeshBuilder.CreateBox("door", { width: 0.35, height: 2.4, depth: 1.4 }, scene);
  door.position = new BABYLON.Vector3(4, 1.2, -1.7);
  door.material = matDoor;
  door.checkCollisions = true;
  door.metadata = { type: "door", locked: true };

  // Tsunami wall (approaches from far x-)
  const wave = BABYLON.MeshBuilder.CreateBox("wave", { width: 4, height: 20, depth: 80 }, scene);
  wave.position = new BABYLON.Vector3(-150, 9, 0);
  wave.material = matWave;

  // Roof trigger (invisible area)
  const roofTrigger = {
    min: new BABYLON.Vector3(22, 5.4, -6),
    max: new BABYLON.Vector3(34, 10, 6)
  };

  // ---------- GUI / HUD ----------
  const ui = GUI.AdvancedDynamicTexture.CreateFullscreenUI("ui");

  const timerText = new GUI.TextBlock();
  timerText.text = "03:00";
  timerText.color = "#ff7d8a";
  timerText.fontSize = 22;
  timerText.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
  timerText.textVerticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
  timerText.paddingTop = 12;
  timerText.paddingLeft = 16;
  ui.addControl(timerText);

  const objectiveText = new GUI.TextBlock();
  objectiveText.text = "Objective: Click to lock mouse. Press E at the TV.";
  objectiveText.color = "#9aa5b5";
  objectiveText.fontSize = 18;
  objectiveText.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
  objectiveText.textVerticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
  objectiveText.paddingTop = 12;
  ui.addControl(objectiveText);

  const promptText = new GUI.TextBlock();
  promptText.text = "";
  promptText.color = "#e8ecf3";
  promptText.fontSize = 18;
  promptText.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
  promptText.textVerticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_BOTTOM;
  promptText.paddingLeft = 16;
  promptText.paddingBottom = 14;
  ui.addControl(promptText);

  const endingText = new GUI.TextBlock();
  endingText.text = "";
  endingText.color = "#73d38d";
  endingText.fontSize = 22;
  endingText.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
  endingText.textVerticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
  endingText.paddingTop = 12;
  endingText.paddingRight = 16;
  ui.addControl(endingText);

  // Crosshair
  const crosshair = new GUI.TextBlock();
  crosshair.text = "+";
  crosshair.color = "rgba(232,236,243,0.75)";
  crosshair.fontSize = 20;
  crosshair.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
  crosshair.textVerticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_CENTER;
  ui.addControl(crosshair);

  function setPrompt(msg = "") { promptText.text = msg; }
  function setEnding(msg, success) {
    endingText.text = msg;
    endingText.color = success ? "#73d38d" : "#ff7d8a";
  }

  // ---------- GAME STATE ----------
  const gameState = {
    started: false,
    broadcastDone: false,
    roomDoorUnlocked: false,
    runStartMs: 0,
    maxTimeMs: 180000,
    ended: false
  };let debugFreeze = false;

// Press F to toggle freeze manually
window.addEventListener("keydown", (e) => {
  if (e.code === "KeyF") debugFreeze = !debugFreeze;
});

  // Input: “E” interact
  const inputMap = {};
  scene.actionManager = new BABYLON.ActionManager(scene);
  scene.actionManager.registerAction(new BABYLON.ExecuteCodeAction(BABYLON.ActionManager.OnKeyDownTrigger, (evt) => {
    inputMap[evt.sourceEvent.code] = true;
  }));
  scene.actionManager.registerAction(new BABYLON.ExecuteCodeAction(BABYLON.ActionManager.OnKeyUpTrigger, (evt) => {
    inputMap[evt.sourceEvent.code] = false;
  }));

  function msElapsed() {
    return performance.now() - gameState.runStartMs;
  }

  function endGame(outcome) {
    if (gameState.ended) return;
    gameState.ended = true;

    if (outcome === "escaped") {
      const time = Math.floor(msElapsed());
      objectiveText.text = "Ending: You reached the roof as the city floods below.";
      setEnding(`ESCAPED ${formatTimer(gameState.maxTimeMs - time)} left`, true);
      recordRun("escaped", time);
    } else {
      objectiveText.text = "Ending: The tsunami overtook the building.";
      setEnding("DROWNED", false);
      recordRun("died", null);
    }
  }

  function inBox(p, min, max) {
    return (p.x >= min.x && p.x <= max.x &&
      p.y >= min.y && p.y <= max.y &&
      p.z >= min.z && p.z <= max.z);
  }

  function updatePromptAndInteract() {
    if (gameState.ended) return setPrompt("");

    const p = camera.position;

    const dTV = BABYLON.Vector3.Distance(p, tv.position);
    const dDoor = BABYLON.Vector3.Distance(p, door.position);

    // Prompt priority
    if (!gameState.started && dTV < 2.2) {
      setPrompt("Press E to watch the news broadcast.");
      if (inputMap["KeyE"]) {
        inputMap["KeyE"] = false;
        gameState.started = true;
        gameState.runStartMs = performance.now();
        objectiveText.text = "News Alert: Tsunami inbound. Escape your room and reach the roof in 3 minutes.";
        setEnding("Broadcast started...", true);

        // after 4 seconds, unlock door
        setTimeout(() => {
          gameState.broadcastDone = true;
          gameState.roomDoorUnlocked = true;
          door.metadata.locked = false;
          objectiveText.text = "Objective: Open the door (E), climb to the roof.";
          setEnding("", true);
        }, 4000);
      }
      return;
    }

    if (dDoor < 2.2) {
      if (!gameState.roomDoorUnlocked) {
        setPrompt("Door locked. Watch the TV first.");
        if (inputMap["KeyE"]) inputMap["KeyE"] = false;
        return;
      }
      setPrompt("Press E to open the door.");
      if (inputMap["KeyE"]) {
        inputMap["KeyE"] = false;
        // remove door collision by disposing it
        door.dispose();
        objectiveText.text = "Objective: Reach the roof before the wave arrives.";
        setEnding("Door opened.", true);
      }
      return;
    }

    setPrompt("");
  }

  // ---------- MAIN LOOP ----------
  scene.onBeforeRenderObservable.add(() => {
    // Update HUD timer
    if (!gameState.started || gameState.ended) {
      timerText.text = "03:00";
    } else {
      const elapsed = msElapsed();
      const remaining = gameState.maxTimeMs - elapsed;
      timerText.text = formatTimer(remaining);

      // wave movement: fair pace (slow start, mild increase)
      const dt = engine.getDeltaTime() / 1000; // ✅ seconds
const t = Math.min(1, elapsed / gameState.maxTimeMs);

//  Tune these speeds to taste (units per second)
const speed = 1.2 + t * 1.4; // starts 1.2, ends 2.6
wave.position.x += speed * dt;

      // death if time up
      if (remaining <= 0) endGame("died");

      // death if wave reaches player
      if (wave.position.x > camera.position.x - 0.6) endGame("died");

      // escape if roof trigger reached
      if (inBox(camera.position, roofTrigger.min, roofTrigger.max)) endGame("escaped");
    }

    updatePromptAndInteract();

    // Light camera jitter for retro tension near the end
    if (gameState.started && !gameState.ended) {
      const remaining = gameState.maxTimeMs - msElapsed();
      const danger = 1 - Math.max(0, Math.min(1, remaining / gameState.maxTimeMs));
      camera.position.x += (Math.random() - 0.5) * 0.0015 * danger;
      camera.position.z += (Math.random() - 0.5) * 0.0015 * danger;
    }
  });

  engine.runRenderLoop(() => {
    scene.render();
  });

  window.addEventListener("resize", () => engine.resize());

  // Return controls to let your website call reset later if you want
  return {
    engine,
    scene,
    camera,
    reset: () => {
      // Simple “reset”: reload page or rebuild scene in a future iteration
      location.reload();
    }
  };
}