// ------------------------------------------------------------------
// MediaPipe Hands(Tasks Vision) 기반 캠 조작 모드.
// 주먹을 쥐면 새총을 잡아 당기고(campullBegin/Move), 손을 펴면 발사한다
// (campullEnd). 실제 게임 로직은 game.js의 GameScene.beginPull/movePull/
// finishPull에 있으며, 이 파일은 좌표/제스처만 계산해서 넘겨준다.
// ------------------------------------------------------------------

import {
  HandLandmarker,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const GAME_CANVAS_W = 1200;
const GAME_CANVAS_H = 700;

// 손가락 끝/두 번째 관절 랜드마크 인덱스 (엄지 제외: 검지, 중지, 약지, 소지)
const FINGER_TIPS = [8, 12, 16, 20];
const FINGER_PIPS = [6, 10, 14, 18];
const PALM_POINTS = [0, 5, 9, 13, 17];

let handLandmarker = null;
let video = null;
let overlayCanvas = null;
let overlayCtx = null;
let statusEl = null;
let running = false;
let isPulling = false;
let lastVideoTime = -1;
let rafId = null;

// 주먹을 쥔 "순간"의 손 좌표와 그 시점의 새총 앵커 좌표.
// 그 이후로는 이 기준점 대비 손이 얼마나 움직였는지(상대 이동량)만큼만
// 새총을 당긴다 - 카메라 프레임 안에서 손의 절대 위치가 어디든 상관없다.
let pullOriginHand = null;
let pullAnchor = null;

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// 손목 대비 각 손가락 끝의 거리가 두 번째 관절보다 가까우면 "접힌" 것으로 본다.
// 4개 중 3개 이상 접혀 있으면 주먹으로 판정.
function isFist(landmarks) {
  const wrist = landmarks[0];
  let curled = 0;
  for (let i = 0; i < FINGER_TIPS.length; i++) {
    const tip = landmarks[FINGER_TIPS[i]];
    const pip = landmarks[FINGER_PIPS[i]];
    if (dist(tip, wrist) < dist(pip, wrist) * 1.05) curled++;
  }
  return curled >= 3;
}

function palmCenter(landmarks) {
  let x = 0;
  let y = 0;
  PALM_POINTS.forEach((i) => {
    x += landmarks[i].x;
    y += landmarks[i].y;
  });
  return { x: x / PALM_POINTS.length, y: y / PALM_POINTS.length };
}

function drawLandmarks(landmarks, fist) {
  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  overlayCtx.fillStyle = fist ? "#ff6a6a" : "#5be86c";
  landmarks.forEach((lm) => {
    const x = lm.x * overlayCanvas.width;
    const y = lm.y * overlayCanvas.height;
    overlayCtx.beginPath();
    overlayCtx.arc(x, y, 3.5, 0, Math.PI * 2);
    overlayCtx.fill();
  });
}

function clearOverlay() {
  if (overlayCtx) overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
}

async function setupCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 480, height: 360 },
    audio: false,
  });
  video.srcObject = stream;
  await new Promise((resolve) => {
    video.onloadedmetadata = () => resolve();
  });
  await video.play();
  overlayCanvas.width = video.videoWidth;
  overlayCanvas.height = video.videoHeight;
}

async function initHandLandmarker() {
  const vision = await FilesetResolver.forVisionTasks(WASM_URL);
  const baseOptions = { modelAssetPath: MODEL_URL };
  const options = { baseOptions, runningMode: "VIDEO", numHands: 1 };
  try {
    handLandmarker = await HandLandmarker.createFromOptions(vision, {
      ...options,
      baseOptions: { ...baseOptions, delegate: "GPU" },
    });
  } catch (err) {
    handLandmarker = await HandLandmarker.createFromOptions(vision, {
      ...options,
      baseOptions: { ...baseOptions, delegate: "CPU" },
    });
  }
}

function predictLoop() {
  if (!running) return;

  if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    const result = handLandmarker.detectForVideo(video, performance.now());

    if (result.landmarks && result.landmarks.length > 0) {
      const landmarks = result.landmarks[0];
      const fist = isFist(landmarks);
      drawLandmarks(landmarks, fist);

      const center = palmCenter(landmarks);
      // 비디오는 화면에서 좌우 반전(거울 모드)되어 보이므로, 손 좌표도
      // x를 뒤집어야 "내가 오른쪽으로 움직이면 화면에서도 오른쪽"이 된다.
      // (카메라 프레임 내 절대 위치가 아니라, 아래에서 grab 시점 대비
      //  "얼마나 움직였는지"만 쓰기 때문에 스케일만 맞으면 된다.)
      const handX = (1 - center.x) * GAME_CANVAS_W;
      const handY = center.y * GAME_CANVAS_H;

      if (fist && !isPulling) {
        isPulling = true;
        pullOriginHand = { x: handX, y: handY };
        pullAnchor = window.getSlingAnchor();
        window.campullBegin();
        statusEl.textContent = "주먹 감지 - 당기는 중";
      } else if (fist && isPulling) {
        if (pullAnchor) {
          const targetX = pullAnchor.x + (handX - pullOriginHand.x);
          const targetY = pullAnchor.y + (handY - pullOriginHand.y);
          window.campullMove(targetX, targetY);
        }
        statusEl.textContent = "주먹 감지 - 당기는 중";
      } else if (!fist && isPulling) {
        isPulling = false;
        pullOriginHand = null;
        pullAnchor = null;
        window.campullEnd();
        statusEl.textContent = "손 폄 감지 - 발사!";
      } else {
        statusEl.textContent = "손 인식됨 - 주먹을 쥐면 당깁니다";
      }
    } else {
      clearOverlay();
      if (isPulling) {
        isPulling = false;
        pullOriginHand = null;
        pullAnchor = null;
        window.campullEnd();
      }
      statusEl.textContent = "손이 보이지 않습니다";
    }
  }

  rafId = requestAnimationFrame(predictLoop);
}

window.startCamControl = async function startCamControl() {
  video = document.getElementById("cam-video");
  overlayCanvas = document.getElementById("cam-overlay");
  overlayCtx = overlayCanvas.getContext("2d");
  statusEl = document.getElementById("cam-status");

  statusEl.textContent = "카메라/모델 로딩 중...";
  if (!handLandmarker) {
    await initHandLandmarker();
  }
  await setupCamera();

  running = true;
  isPulling = false;
  pullOriginHand = null;
  pullAnchor = null;
  lastVideoTime = -1;
  statusEl.textContent = "손 인식 대기 중...";
  rafId = requestAnimationFrame(predictLoop);
};

window.stopCamControl = function stopCamControl() {
  running = false;
  if (rafId) cancelAnimationFrame(rafId);
  if (isPulling) {
    isPulling = false;
    pullOriginHand = null;
    pullAnchor = null;
    if (window.campullEnd) window.campullEnd();
  }
  if (video && video.srcObject) {
    video.srcObject.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  }
  clearOverlay();
};
