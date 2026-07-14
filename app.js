const DURATION_SECONDS = 24;
const TIMER_NAME = "FoldRotateTime";
const INTERPOLATOR_NAMES = Array.from({ length: 8 }, (_, index) => `DesignMove${index + 1}n1`);

const elements = {
  canvas: document.querySelector("#model-viewer"),
  viewerCard: document.querySelector(".viewer-card"),
  stage: document.querySelector("#viewer-stage"),
  loadingPanel: document.querySelector("#loading-panel"),
  loadingMessage: document.querySelector("#loading-message"),
  viewerHint: document.querySelector("#viewer-hint"),
  timeline: document.querySelector("#timeline"),
  timeDisplay: document.querySelector("#time-display"),
  playPause: document.querySelector("#play-pause"),
  restart: document.querySelector("#restart"),
  resetView: document.querySelector("#reset-view"),
  fullscreen: document.querySelector("#fullscreen"),
};

let browser;
let timer;
let interpolators = [];
let isScrubbing = false;
let resumeAfterScrub = false;
let initialized = false;

function now() {
  return Date.now() / 1000;
}

function formatTime(seconds) {
  const safeSeconds = Math.max(0, Math.min(DURATION_SECONDS, seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = Math.floor(safeSeconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function setProgress(fraction) {
  const clamped = Math.max(0, Math.min(1, Number(fraction) || 0));
  if (!isScrubbing) {
    elements.timeline.value = String(Math.round(clamped * 1000));
  }
  elements.timeDisplay.value = `${formatTime(clamped * DURATION_SECONDS)} / 0:24`;
  elements.timeDisplay.textContent = elements.timeDisplay.value;
}

function setPlayingState(isPlaying) {
  const icon = elements.playPause.querySelector(".button-icon");
  const label = elements.playPause.querySelector(".button-label");
  icon.textContent = isPlaying ? "Ⅱ" : "▶";
  label.textContent = isPlaying ? "一時停止" : "再生";
  elements.playPause.setAttribute("aria-label", isPlaying ? "アニメーションを一時停止" : "アニメーションを再生");
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

  if (timer.isPaused) {
    timer.resumeTime = now();
  } else if (!timer.isActive) {
    startFromFraction(Number(elements.timeline.value) / 1000);
  }
  setPlayingState(true);
}

function startFromFraction(fraction = 0) {
  if (!timer) return;

  const clamped = Math.max(0, Math.min(1, fraction));
  timer.enabled = false;
  setInterpolatorFraction(clamped);
  timer.stopTime = 0;
  timer.startTime = now() - clamped * DURATION_SECONDS;
  timer.enabled = true;
  setPlayingState(true);
}

function resetViewpoint() {
  if (!browser) return;

  try {
    const viewpoint = browser.currentScene.getNamedNode("VIEWPOINT");
    viewpoint.set_bind = true;
  } catch (error) {
    console.warn("初期視点を取得できませんでした。", error);
  }
}

function initializeViewer() {
  try {
    timer = browser.currentScene.getNamedNode(TIMER_NAME);
    interpolators = INTERPOLATOR_NAMES.map((name) => browser.currentScene.getNamedNode(name));

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
    setPlayingState(true);
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
  const fraction = Number(event.currentTarget.value) / 1000;
  setInterpolatorFraction(fraction);
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

elements.fullscreen.addEventListener("click", async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await elements.viewerCard?.requestFullscreen?.();
  } catch (error) {
    console.warn("全画面表示を開始できませんでした。", error);
  }
});

document.addEventListener("fullscreenchange", () => {
  elements.fullscreen.setAttribute(
    "aria-label",
    document.fullscreenElement ? "全画面表示を終了" : "全画面表示",
  );
});

elements.stage.addEventListener("pointerdown", () => elements.viewerHint.classList.add("is-hidden"), {
  once: true,
});

window.addEventListener("error", (event) => {
  if (!initialized && String(event.filename).includes("x_ite")) {
    showLoadError("3D表示ライブラリを読み込めませんでした。通信環境を確認してください。");
  }
});

try {
  await customElements.whenDefined("x3d-canvas");
  browser = elements.canvas.browser;
  browser.addBrowserCallback(
    "web-viewer-init",
    X3D.X3DConstants.INITIALIZED_EVENT,
    initializeViewer,
  );
} catch (error) {
  console.error(error);
  showLoadError("3Dビューアを初期化できませんでした。ページを再読み込みしてください。");
}

window.setTimeout(() => {
  if (!initialized) {
    showLoadError(
      location.protocol === "file:"
        ? "このページはWebサーバー経由で開いてください。GitHub Pagesではそのまま動作します。"
        : "3Dモデルの読み込みに時間がかかっています。通信環境を確認して再読み込みしてください。",
    );
  }
}, 15000);
