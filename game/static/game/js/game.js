// ------------------------------------------------------------------
// 새총 조작: "마우스 드래그" 모드와 MediaPipe Hands 기반 "캠(주먹 쥐기)" 모드를
// 모두 지원한다. 실제 당기기/발사 로직은 beginPull/movePull/finishPull에만
// 있고, 마우스 이벤트와 hand_control.js(window.campullBegin/Move/End)가
// 둘 다 이 메서드들을 호출한다.
// ------------------------------------------------------------------

const GAME_W = 1200;
const GAME_H = 700;
const GROUND_HEIGHT = 40;

const MAX_PULL = 160;       // 새총 최대 당김 거리(px) - 더 크게 당길 수 있음
const MAX_LAUNCH_SPEED = 1450; // 발사 속도 상한 (기존 620 -> 대폭 강화)
const DAMAGE_SPEED_THRESHOLD = 90; // 이 속도 이상으로 충돌해야 블록에 데미지

let currentMapIndex = 0;
let gameInstance = null;
let controlMode = "mouse"; // "mouse" | "cam"

function getActiveScene() {
  return gameInstance ? gameInstance.scene.getScene("GameScene") : null;
}

class GameScene extends Phaser.Scene {
  constructor() {
    super("GameScene");
  }

  init(data) {
    this.mapIndex = data.mapIndex || 0;
  }

  preload() {
    // 이미지 에셋 없이 Graphics로 즉석 텍스처 생성 (임시 테스트용)
    const g = this.add.graphics();

    // 새(투사체) - 빨간 원
    g.clear();
    g.fillStyle(0xe24b4a, 1);
    g.fillCircle(18, 18, 18);
    g.lineStyle(2, 0x791f1f, 1);
    g.strokeCircle(18, 18, 18);
    g.generateTexture("bird", 36, 36);

    // 블록(나무/돌)과 돼지는 맵마다 크기가 달라서 고정 텍스처 대신
    // Phaser Shape(Rectangle/Circle) + 물리 바디로 만든다.
    // (텍스처를 setDisplaySize로 늘리면 물리 바디 크기가 스케일과
    //  곱해져 이중으로 커지는 문제가 있어 이 방식으로 피한다.)

    // 바닥
    g.clear();
    g.fillStyle(0x4a3a2c, 1);
    g.fillRect(0, 0, GAME_W, GROUND_HEIGHT);
    g.generateTexture("ground", GAME_W, GROUND_HEIGHT);

    g.destroy();
  }

  create() {
    const mapData = MAPS[this.mapIndex];
    this.mapData = mapData;
    this.isGameOver = false;
    this.isDragging = false;
    this.isFlying = false;
    this.shotsLeft = mapData.birdCount;
    this.settleTimer = 0;

    this.physics.world.setBounds(0, 0, GAME_W, GAME_H);
    this.physics.world.gravity.y = 950;

    // ---- 배경 ----
    this.cameras.main.setBackgroundColor("#87b8d6");
    this.add.rectangle(GAME_W / 2, GAME_H - GROUND_HEIGHT / 2, GAME_W, GROUND_HEIGHT, 0x4a3a2c);

    const ground = this.physics.add.staticImage(GAME_W / 2, GAME_H - GROUND_HEIGHT / 2, "ground");

    // ---- 새총 기둥(비주얼) ----
    this.anchor = mapData.slingAnchor;
    this.add.rectangle(this.anchor.x, GAME_H - GROUND_HEIGHT, 10, GAME_H - GROUND_HEIGHT - this.anchor.y + 10, 0x5b3a20);
    this.forkGfx = this.add.graphics();

    // ---- 블록 / 돼지 그룹 ----
    // Shape 게임오브젝트(Rectangle/Circle)를 맵 데이터의 실제 크기로 바로 만들어서
    // 물리 바디 크기가 스케일과 곱해지는 문제 없이 정확히 맞도록 한다.
    this.blocksGroup = this.physics.add.group();
    mapData.blocks.forEach((b) => {
      let obj;
      if (b.type === "pig") {
        obj = this.add.circle(b.x, b.y, b.w / 2, 0x63b04a).setStrokeStyle(2, 0x2f5e20);
      } else if (b.type === "stone") {
        obj = this.add.rectangle(b.x, b.y, b.w, b.h, 0x8a8f98).setStrokeStyle(2, 0x4a4e55);
      } else {
        obj = this.add.rectangle(b.x, b.y, b.w, b.h, 0xc98a4b).setStrokeStyle(2, 0x7a5326);
      }

      this.physics.add.existing(obj);
      if (b.type === "pig") {
        obj.body.setCircle(b.w / 2);
      } else {
        obj.body.setSize(b.w, b.h);
      }
      obj.body.setBounce(0.05);
      obj.body.setDrag(40, 0);
      obj.body.setFriction(1, 0);
      obj.setData("type", b.type);
      obj.setData("hp", b.type === "stone" ? 2 : 1);
      this.blocksGroup.add(obj);
    });

    this.pigsLeft = mapData.blocks.filter((b) => b.type === "pig").length;

    this.physics.add.collider(this.blocksGroup, ground);
    this.physics.add.collider(this.blocksGroup, this.blocksGroup);

    // ---- 새(투사체) ----
    this.bird = this.physics.add.sprite(this.anchor.x, this.anchor.y, "bird");
    this.bird.body.setCircle(18);
    this.bird.body.setAllowGravity(false);
    this.bird.body.setBounce(0.35);
    this.bird.body.moves = false;

    this.physics.add.collider(this.bird, ground);
    this.physics.add.collider(this.bird, this.blocksGroup, this.onBirdHitBlock, null, this);

    // ---- 조준선(가이드) ----
    this.aimLine = this.add.graphics();
    this.trajectoryDots = this.add.graphics();

    // ---- 입력: 마우스 드래그로 새총 당기기/발사 ----
    this.bird.setInteractive({ cursor: "grab" });
    this.input.setDraggable(this.bird);

    this.input.on("dragstart", (pointer, obj) => {
      if (controlMode !== "mouse") return;
      if (obj !== this.bird || this.isFlying || this.isGameOver) return;
      this.isDragging = true;
    });

    this.input.on("drag", (pointer, obj, dragX, dragY) => {
      if (controlMode !== "mouse") return;
      if (obj !== this.bird || !this.isDragging) return;
      this.movePull(dragX, dragY);
    });

    this.input.on("dragend", (pointer, obj) => {
      if (controlMode !== "mouse") return;
      if (obj !== this.bird || !this.isDragging) return;
      this.finishPull();
    });

    // ---- UI 텍스트 ----
    this.infoText = this.add.text(16, 16, "", {
      fontSize: "16px",
      fontFamily: "Malgun Gothic, sans-serif",
      color: "#ffffff",
      backgroundColor: "#00000055",
      padding: { x: 8, y: 4 },
    });
    this.updateInfoText();

    this.messageText = this.add.text(GAME_W / 2, GAME_H / 2, "", {
      fontSize: "40px",
      fontFamily: "Malgun Gothic, sans-serif",
      color: "#ffd76a",
      backgroundColor: "#00000099",
      padding: { x: 20, y: 12 },
    }).setOrigin(0.5).setVisible(false);

    this.drawFork();
  }

  // 캠(주먹 쥐기) 모드에서 window.campullBegin()으로 호출된다.
  // 마우스 dragstart와 동일하게, 시작 시점에는 새를 움직이지 않고
  // 앵커 위치 그대로 둔다(그 다음 movePull이 상대 이동을 반영).
  beginPull() {
    if (this.isFlying || this.isGameOver || this.isDragging) return;
    this.isDragging = true;
  }

  // 마우스 drag 이벤트와 캠 모드 양쪽에서 공용으로 쓰는 당기기 갱신 로직.
  movePull(dragX, dragY) {
    if (!this.isDragging) return;
    const dx = dragX - this.anchor.x;
    const dy = dragY - this.anchor.y;
    const dist = Math.min(Math.sqrt(dx * dx + dy * dy), MAX_PULL);
    const angle = Math.atan2(dy, dx);
    const px = this.anchor.x + Math.cos(angle) * dist;
    const py = this.anchor.y + Math.sin(angle) * dist;
    this.bird.setPosition(px, py);
    this.drawAim(px, py);
  }

  // 캠(손 펴기) 모드에서 window.campullEnd()로 호출된다.
  finishPull() {
    if (!this.isDragging) return;
    this.isDragging = false;
    this.launchBird();
  }

  drawFork() {
    this.forkGfx.clear();
    this.forkGfx.lineStyle(6, 0x5b3a20, 1);
    this.forkGfx.lineBetween(this.anchor.x - 14, this.anchor.y + 30, this.anchor.x, this.anchor.y);
    this.forkGfx.lineBetween(this.anchor.x + 14, this.anchor.y + 30, this.anchor.x, this.anchor.y);
  }

  drawAim(px, py) {
    this.aimLine.clear();
    this.aimLine.lineStyle(3, 0xffffff, 0.85);
    this.aimLine.beginPath();
    this.aimLine.moveTo(this.anchor.x, this.anchor.y);
    this.aimLine.lineTo(px, py);
    this.aimLine.strokePath();

    // 발사 궤적 미리보기(점선 점들)
    this.trajectoryDots.clear();
    const dx = this.anchor.x - px;
    const dy = this.anchor.y - py;
    const dist = Math.min(Math.sqrt(dx * dx + dy * dy), MAX_PULL);
    const power = (dist / MAX_PULL) * MAX_LAUNCH_SPEED;
    const angle = Math.atan2(dy, dx);
    const vx = Math.cos(angle) * power;
    const vy = Math.sin(angle) * power;
    const gravity = this.physics.world.gravity.y;

    this.trajectoryDots.fillStyle(0xffffff, 0.7);
    for (let i = 1; i <= 8; i++) {
      const t = i * 0.09;
      const x = this.anchor.x + vx * t;
      const y = this.anchor.y + vy * t + 0.5 * gravity * t * t;
      if (y > GAME_H - GROUND_HEIGHT) break;
      this.trajectoryDots.fillCircle(x, y, 3);
    }
  }

  launchBird() {
    const dx = this.anchor.x - this.bird.x;
    const dy = this.anchor.y - this.bird.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    this.aimLine.clear();
    this.trajectoryDots.clear();

    if (dist < 12) {
      // 거의 안 당겼으면 발사 취소, 제자리로 복귀
      this.bird.setPosition(this.anchor.x, this.anchor.y);
      return;
    }

    const power = Math.min((dist / MAX_PULL) * MAX_LAUNCH_SPEED, MAX_LAUNCH_SPEED);
    const angle = Math.atan2(dy, dx);

    this.bird.body.moves = true;
    this.bird.body.setAllowGravity(true);
    this.bird.setVelocity(Math.cos(angle) * power, Math.sin(angle) * power);

    this.isFlying = true;
    this.shotsLeft -= 1;
    this.settleTimer = 0;
    this.updateInfoText();
  }

  onBirdHitBlock(bird, block) {
    const speed = bird.body.speed;
    if (speed < DAMAGE_SPEED_THRESHOLD) return;

    const hp = block.getData("hp") - 1;
    block.setData("hp", hp);

    if (hp <= 0) {
      const wasPig = block.getData("type") === "pig";
      // 그룹/물리 시뮬레이션에서는 즉시 제외하되, 사라지는 연출(tween)이
      // 끝난 뒤에 실제로 destroy 한다 (destroy 후에는 tween 대상이 될 수 없음).
      this.blocksGroup.remove(block, false, false);
      block.body.enable = false;

      this.tweens.add({
        targets: block,
        alpha: 0,
        scale: 0.2,
        duration: 150,
        onComplete: () => block.destroy(),
      });

      if (wasPig) {
        this.pigsLeft -= 1;
      }
      this.updateInfoText();
      this.checkWinLose();
    }
  }

  updateInfoText() {
    this.infoText.setText(
      `${this.mapData.name}\n남은 새: ${Math.max(this.shotsLeft, 0)}   남은 돼지: ${Math.max(this.pigsLeft, 0)}`
    );
  }

  checkWinLose() {
    if (this.isGameOver) return;

    if (this.pigsLeft <= 0) {
      this.isGameOver = true;
      this.showMessage("승리! 모든 돼지를 제거했습니다.");
    }
  }

  showMessage(text) {
    this.messageText.setText(text + "\n(다시하기 버튼을 눌러주세요)");
    this.messageText.setVisible(true);
  }

  update(time, delta) {
    if (this.isFlying) {
      const b = this.bird.body;
      const offScreen = this.bird.x > GAME_W + 40 || this.bird.x < -40;
      const nearlyStopped = Math.abs(b.velocity.x) < 8 && Math.abs(b.velocity.y) < 8 && b.y > 0;

      if (offScreen || nearlyStopped) {
        this.settleTimer += delta;
      } else {
        this.settleTimer = 0;
      }

      if (offScreen || this.settleTimer > 550) {
        this.isFlying = false;
        this.resetBirdToSling();
      }
    }

    if (!this.isGameOver && !this.isFlying && !this.isDragging && this.pigsLeft > 0 && this.shotsLeft <= 0) {
      this.isGameOver = true;
      this.showMessage("패배... 새가 모두 소진되었습니다.");
    }
  }

  resetBirdToSling() {
    if (this.isGameOver) return;
    this.bird.body.setVelocity(0, 0);
    this.bird.body.setAllowGravity(false);
    this.bird.body.moves = false;
    this.bird.setPosition(this.anchor.x, this.anchor.y);
    this.bird.setInteractive({ cursor: "grab" });
  }
}

function createGame(mapIndex) {
  currentMapIndex = mapIndex;
  if (gameInstance) {
    gameInstance.destroy(true);
    gameInstance = null;
  }

  const config = {
    type: Phaser.AUTO,
    width: GAME_W,
    height: GAME_H,
    parent: "game-container",
    backgroundColor: "#87b8d6",
    physics: {
      default: "arcade",
      arcade: { gravity: { y: 950 }, debug: false },
    },
    scene: [GameScene],
  };

  gameInstance = new Phaser.Game(config);
  gameInstance.scene.start("GameScene", { mapIndex });
}

function setActiveMapButton(mapIndex) {
  document.getElementById("map1-btn").classList.toggle("active", mapIndex === 0);
  document.getElementById("map2-btn").classList.toggle("active", mapIndex === 1);
}

// hand_control.js가 손 위치/제스처를 이 함수들로 알려준다.
window.campullBegin = () => {
  if (controlMode !== "cam") return;
  const scene = getActiveScene();
  if (scene) scene.beginPull();
};
window.campullMove = (x, y) => {
  if (controlMode !== "cam") return;
  const scene = getActiveScene();
  if (scene) scene.movePull(x, y);
};
window.campullEnd = () => {
  if (controlMode !== "cam") return;
  const scene = getActiveScene();
  if (scene) scene.finishPull();
};
// hand_control.js가 "주먹 쥔 순간부터의 상대 이동"을 계산할 수 있도록
// 현재 새총 앵커의 캔버스 좌표를 알려준다.
window.getSlingAnchor = () => {
  const scene = getActiveScene();
  return scene ? { x: scene.anchor.x, y: scene.anchor.y } : null;
};

function setMouseMode() {
  controlMode = "mouse";
  document.getElementById("mouse-mode-btn").classList.add("active");
  document.getElementById("cam-mode-btn").classList.remove("active");
  document.getElementById("cam-box").style.display = "none";
  document.getElementById("note").textContent = "새(공)을 마우스로 당겨서 발사하세요";
  if (window.stopCamControl) window.stopCamControl();
}

async function setCamMode() {
  document.getElementById("cam-mode-btn").classList.add("active");
  document.getElementById("mouse-mode-btn").classList.remove("active");
  document.getElementById("cam-box").style.display = "flex";
  document.getElementById("note").textContent = "카메라 앞에서 주먹을 쥐어 당기고, 펴서 발사하세요";

  try {
    if (window.startCamControl) await window.startCamControl();
    controlMode = "cam";
  } catch (err) {
    alert("웹캠/손 인식을 시작할 수 없습니다: " + err.message);
    setMouseMode();
  }
}

window.addEventListener("DOMContentLoaded", () => {
  createGame(0);
  setActiveMapButton(0);

  document.getElementById("map1-btn").addEventListener("click", () => {
    createGame(0);
    setActiveMapButton(0);
  });
  document.getElementById("map2-btn").addEventListener("click", () => {
    createGame(1);
    setActiveMapButton(1);
  });
  document.getElementById("reset-btn").addEventListener("click", () => {
    createGame(currentMapIndex);
  });
  document.getElementById("mouse-mode-btn").addEventListener("click", () => {
    if (controlMode === "mouse") return;
    setMouseMode();
  });
  document.getElementById("cam-mode-btn").addEventListener("click", () => {
    if (controlMode === "cam") return;
    setCamMode();
  });
});