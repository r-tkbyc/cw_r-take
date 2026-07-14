const MODEL_CONFIGS = {
  spinosaurus: {
    name: "スピノサウルス",
    file: "./S＆D‗スチレン恐竜組立キット_スピノサウルス_001_05.WRL",
    duration: 34,
    partCount: 17,
    viewpoint: {
      position: [-23.7441, -37.7704, -12.2813],
      orientation: [-0.968, -0.198, 0.151, -1.334],
      center: [-28.522, 5.482, -19.3635],
      fieldOfView: 0.7107,
    },
    accent: "#d76449",
  },
  pteranodon: {
    name: "プテラノドン",
    file: "./S＆D‗スチレン恐竜組立キット_プテラノドン_001_05.WRL",
    duration: 24,
    partCount: 8,
    viewpoint: {
      position: [61.6748, 40.9351, -32.2954],
      orientation: [0.008, -0.79, -0.613, -3.12],
      center: [61.352, -3.6005, -21.79],
      fieldOfView: 0.5867,
    },
    accent: "#237252",
  },
  velociraptor: {
    name: "ヴェロキラプトル",
    file: "./S＆D‗スチレン恐竜組立キット_ヴェロキラプトル_001_05.WRL",
    duration: 26,
    partCount: 7,
    viewpoint: {
      position: [150.8253, -35.6393, -10.2521],
      orientation: [-1, 0.021, -0.018, -1.382],
      center: [147.104, -0.011, -20.0835],
      fieldOfView: 0.6077,
    },
    accent: "#c58a13",
  },
};

const TIMER_NAME = "FoldRotateTime";
const modelKey = new URLSearchParams(window.location.search).get("model");
const config = MODEL_CONFIGS[modelKey] ?? MODEL_CONFIGS.pteranodon;
const interpolatorNames = Array.from(
  { length: config.partCount },
  (_, index) => `DesignMove${index + 1}n1`,
);

const elements = {
  canvas: document.querySelector("#model-viewer"),
  stage: document.querySelector("#viewer-stage"),
  loadingPanel: document.querySelector("#loading-panel"),
  loadingMessage: document.querySelector("#loading-message"),
  viewerHint: document.querySelector("#viewer-hint"),
  timeline: document.querySelector("#timeline"),
  timeDisplay: document.querySelector("#time-display"),
  playPause: document.querySelector("#play-pause"),
  restart: document.querySelector("#restart"),
  resetView: document.querySelector("#reset-view"),
};

let browser;
let timer;
let interpolators = [];
let isScrubbing = false;
let resumeAfterScrub = false;
let initialized = false;
let resetViewpoints = [];
let resetViewpointIndex = 0;

document.documentElement.style.setProperty("--model-accent", config.accent);
document.title = `${config.name}｜立体恐竜パズル 3D組立ガイド`;
for (const element of document.querySelectorAll("[data-model-name]")) {
  element.textContent = config.name;
}

function now() {
  return Date.now() / 1000;
}

function formatTime(seconds) {
  const safeSeconds = Math.max(0, Math.min(config.duration, seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = Math.floor(safeSeconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function setProgress(fraction) {
  const clamped = Math.max(0, Math.min(1, Number(fraction) || 0));
  if (!isScrubbing) {
    elements.timeline.value = String(Math.round(clamped * 1000));
  }
  const display = `${formatTime(clamped * config.duration)} / ${formatTime(config.duration)}`;
  elements.timeDisplay.value = display;
  elements.timeDisplay.textContent = display;
}

function setPlayingState(isPlaying) {
  const icon = elements.playPause.querySelector(".button-icon");
  const label = elements.playPause.querySelector(".button-label");
  icon.textContent = isPlaying ? "Ⅱ" : "▶";
  label.textContent = isPlaying ? "一時停止" : "再生";
  elements.playPause.setAttribute(
    "aria-label",
    isPlaying ? "アニメーションを一時停止" : "アニメーションを再生",
  );
}

function setControlsEnabled(enabled) {
  elements.timeline.disabled = !enabled;
  elements.playPause.disabled = !enabled;
  elements.restart.disabled = !enabled;
  elements.resetView.disabled = !enabled;
}

function showLoadError(message) {
  elements.loadingPanel.classList.add("is-error");
  elements.loadingMessage.textContent = message;
  setControlsEnabled(false);
}

function setInterpolatorFraction(fraction) {
  for (const interpolator of interpolators) {
    interpolator.set_fraction = fraction;
  }
  setProgress(fraction);
}

function pauseAnimation() {
  if (!timer || timer.isPaused) return;
  timer.pauseTime = now();
  setPlayingState(false);
}

function resumeAnimation() {
  if (!timer) return;

  if (!timer.isActive) {
    startFromFraction(Number(elements.timeline.value) / 1000);
  } else if (timer.isPaused) {
    timer.resumeTime = now();
  }
  setPlayingState(true);
}

function startFromFraction(fraction = 0) {
  if (!timer) return;

  const clamped = Math.max(0, Math.min(1, fraction));
  timer.enabled = false;
  setInterpolatorFraction(clamped);
  timer.stopTime = 0;
  timer.startTime = now() - clamped * config.duration;
  timer.enabled = true;
  setPlayingState(true);
}

function resetViewpoint() {
  if (!browser || resetViewpoints.length === 0) return;

  try {
    const viewpoint = resetViewpoints[resetViewpointIndex];
    resetViewpointIndex = (resetViewpointIndex + 1) % resetViewpoints.length;
    viewpoint.retainUserOffsets = false;
    viewpoint.jump = true;
    viewpoint.set_bind = true;
  } catch (error) {
    console.warn("初期視点を取得できませんでした。", error);
  }
}

function createResetViewpoints() {
  resetViewpoints = Array.from({ length: 2 }, () => {
    const viewpoint = browser.currentScene.createNode("Viewpoint");
    viewpoint.position = new X3D.SFVec3f(...config.viewpoint.position);
    viewpoint.orientation = new X3D.SFRotation(...config.viewpoint.orientation);
    viewpoint.centerOfRotation = new X3D.SFVec3f(...config.viewpoint.center);
    viewpoint.fieldOfView = config.viewpoint.fieldOfView;
    viewpoint.retainUserOffsets = false;
    viewpoint.jump = true;
    browser.currentScene.rootNodes.push(viewpoint);
    return viewpoint;
  });
}

function disableInertiaRotation() {
  const viewer = browser.getViewer?.();
  if (!viewer || typeof viewer.addSpinning !== "function") return;
  viewer.addSpinning = () => viewer.removeSpinning?.();
}

function initializeViewer() {
  try {
    timer = browser.currentScene.getNamedNode(TIMER_NAME);
    interpolators = interpolatorNames.map((name) => browser.currentScene.getNamedNode(name));

    // ArtiosCAD exports the timer with an old startTime and loop enabled,
    // which makes playback appear partway through on load. Stop it before
    // revealing the model and explicitly restore every part to frame zero.
    timer.enabled = false;
    setInterpolatorFraction(0);

    createResetViewpoints();
    disableInertiaRotation();

    timer.addFieldCallback("web-viewer-progress", "fraction_changed", (value) => {
      setProgress(Number(value));
    });
    timer.addFieldCallback("web-viewer-paused", "isPaused", (value) => {
      setPlayingState(!Boolean(value));
    });
    timer.addFieldCallback("web-viewer-active", "isActive", (value) => {
      if (!Boolean(value)) setPlayingState(false);
    });

    initialized = true;
    setControlsEnabled(true);
    setPlayingState(false);
    setProgress(0);
    elements.loadingPanel.classList.add("is-hidden");
    window.setTimeout(() => elements.viewerHint.classList.add("is-hidden"), 4200);
  } catch (error) {
    console.error(error);
    showLoadError("モデルは読み込めましたが、アニメーション情報を取得できませんでした。");
  }
}

elements.playPause.addEventListener("click", () => {
  if (!timer) return;
  if (timer.isPaused || !timer.isActive) resumeAnimation();
  else pauseAnimation();
});

elements.restart.addEventListener("click", () => startFromFraction(0));
elements.resetView.addEventListener("click", resetViewpoint);

elements.timeline.addEventListener("pointerdown", () => {
  isScrubbing = true;
  resumeAfterScrub = Boolean(timer?.isActive && !timer?.isPaused);
  pauseAnimation();
});

elements.timeline.addEventListener("input", (event) => {
  if (!isScrubbing) {
    isScrubbing = true;
    resumeAfterScrub = Boolean(timer?.isActive && !timer?.isPaused);
    pauseAnimation();
  }
  setInterpolatorFraction(Number(event.currentTarget.value) / 1000);
});

function finishScrubbing() {
  if (!isScrubbing) return;
  const fraction = Number(elements.timeline.value) / 1000;
  isScrubbing = false;

  if (resumeAfterScrub) {
    startFromFraction(fraction);
  } else {
    timer.enabled = false;
    setInterpolatorFraction(fraction);
    setPlayingState(false);
  }
}

elements.timeline.addEventListener("change", finishScrubbing);
elements.timeline.addEventListener("pointerup", finishScrubbing);
elements.timeline.addEventListener("pointercancel", finishScrubbing);
elements.timeline.addEventListener("keyup", finishScrubbing);

elements.stage.addEventListener("pointerdown", () => elements.viewerHint.classList.add("is-hidden"), {
  once: true,
});

window.addEventListener("error", (event) => {
  if (!initialized && String(event.filename).includes("x_ite")) {
    showLoadError("3D表示ライブラリを読み込めませんでした。通信環境を確認してください。");
  }
});

async function bootViewer() {
  try {
    await customElements.whenDefined("x3d-canvas");
    browser = elements.canvas.browser;
    browser.addBrowserCallback(
      "web-viewer-init",
      X3D.X3DConstants.INITIALIZED_EVENT,
      initializeViewer,
    );
    browser.addBrowserCallback(
      "web-viewer-load-error",
      X3D.X3DConstants.CONNECTION_ERROR,
      () => showLoadError("WRLファイルを読み込めませんでした。ファイル名と公開場所を確認してください。"),
    );
    elements.canvas.setAttribute("src", config.file);
  } catch (error) {
    console.error(error);
    showLoadError("3Dビューアを初期化できませんでした。ページを再読み込みしてください。");
  }
}

bootViewer();

window.setTimeout(() => {
  if (!initialized) {
    showLoadError(
      location.protocol === "file:"
        ? "このページはWebサーバー経由で開いてください。GitHub Pagesではそのまま動作します。"
        : "3Dモデルの読み込みに時間がかかっています。通信環境を確認して再読み込みしてください。",
    );
  }
}, 15000);
