// ------------------------------------------------------------------
// 새총 조작: "마우스 드래그" 모드와 MediaPipe Hands 기반 "캠(주먹 쥐기)" 모드를
// 모두 지원한다. 실제 당기기/발사 로직은 beginPull/movePull/finishPull에만
// 있고, 마우스 이벤트와 hand_control.js(window.campullBegin/Move/End)가
// 둘 다 이 메서드들을 호출한다.
//
// 맵 데이터는 Django(game/maps.py)가 템플릿에 json_script("map-data")로
// 넣어준다. 맵(월드)이 화면(VIEW_W x VIEW_H)보다 크면 카메라가 날아가는
// 새를 따라가고, 방향키/마우스 휠로 맵을 둘러볼 수 있다.
// ------------------------------------------------------------------

const VIEW_W = 1200; // 화면(캔버스) 크기. hand_control.js도 이 크기를 기준으로 한다.
const VIEW_H = 700;
const GROUND_HEIGHT = 40;

const MAX_PULL = 160;       // 새총 최대 당김 거리(px) - 더 크게 당길 수 있음
const DAMAGE_SPEED_THRESHOLD = 90; // 이 속도 이상으로 충돌해야 블록에 데미지
const SLING_SCREEN_X = 220; // 카메라가 새총으로 돌아왔을 때 새총이 놓이는 화면 x
const SCROLL_SPEED = 900;   // 방향키로 맵을 둘러보는 속도(px/s)

const MAP = JSON.parse(document.getElementById("map-data").textContent);
const WORLD_W = MAP.width;
const WORLD_H = MAP.height;
const GROUND_Y = WORLD_H - GROUND_HEIGHT;
const MAX_LAUNCH_SPEED = MAP.maxLaunchSpeed; // 큰 맵일수록 멀리 날아가도록 맵마다 지정

let gameInstance = null;
let controlMode = "mouse"; // "mouse" | "cam"

// ---- 선명한 화면 ----
// 캔버스를 화면에 보이는 크기 x 기기 픽셀 비율만큼 큰 해상도(RES배)로 만들고,
// 카메라를 RES배 확대해서 게임 좌표는 그대로 VIEW_W x VIEW_H로 쓴다.
// (작은 캔버스를 늘려서 흐릿하게 보이던 것을 해결. 너무 무거워지지 않게 최대 3배)
let RES = 1;

function pickResolution() {
  const box = document.getElementById("game-container").getBoundingClientRect();
  const fit = Math.min(box.width / VIEW_W, box.height / VIEW_H) || 1;
  const want = fit * (window.devicePixelRatio || 1);
  return Math.min(3, Math.max(1, Math.ceil(want * 4) / 4)); // 0.25 단위라 캔버스 크기가 정수로 떨어진다
}

// create()의 마지막에 부른다. 화면 고정 UI(scrollFactor 0)는 카메라 확대의 영향을
// 받으므로 컨테이너에 모아 확대 중심만큼 옮겨 두고(그래서 UI 좌표도 VIEW_W x VIEW_H 기준),
// 글자는 RES배 해상도로 그려서 흐려지지 않게 한다.
function sharpenScene(scene) {
  const hud = scene.add.container((VIEW_W / 2) * (RES - 1), (VIEW_H / 2) * (RES - 1))
    .setScrollFactor(0).setDepth(10);
  scene.children.list.slice().forEach((obj) => {
    if (obj.type === "Text") obj.setResolution(RES);
    if (obj !== hud && obj.scrollFactorX === 0 && obj.scrollFactorY === 0) hud.add(obj);
  });
}

function getActiveScene() {
  return gameInstance ? gameInstance.scene.getScene("GameScene") : null;
}

class GameScene extends Phaser.Scene {
  constructor() {
    super("GameScene");
  }

  // 이미지 에셋 없이 새/블록/돼지/바닥을 모두 Phaser Shape(Rectangle/Circle) + 물리 바디로 만든다.
  // (텍스처를 setDisplaySize로 늘리면 물리 바디 크기가 스케일과 곱해져 이중으로 커지고,
  //  고해상도 화면에서 흐려지는 문제가 있어 이 방식으로 피한다.)

  create() {
    const mapData = MAP;
    this.mapData = mapData;
    this.isGameOver = false;
    this.isDragging = false;
    this.isFlying = false;
    this.shotsLeft = mapData.birdCount;
    this.settleTimer = 0;

    // 물리 경계 = 양 끝 벽의 안쪽 면. 벽(정적 바디)만 있으면 블록 여러 개가 한꺼번에
    // 밀려올 때 서로 밀어내다 벽을 뚫고 나갈 수 있어서, 경계로 한 번 더 막는다.
    // 위/아래는 막지 않는다(높이 쏜 새는 화면 위로 나갔다가 돌아오고, 바닥은 따로 있다).
    const walls = [...(MAP.walls || [])].sort((a, b) => a.x - b.x);
    const innerL = walls.length ? walls[0].x + walls[0].w / 2 : 0;
    const innerR = walls.length ? walls[walls.length - 1].x - walls[walls.length - 1].w / 2 : WORLD_W;
    this.physics.world.setBounds(innerL, 0, innerR - innerL, WORLD_H, true, true, false, false);
    this.innerL = innerL;
    this.innerR = innerR;
    this.physics.world.gravity.y = 950;

    // ---- 카메라: 화면보다 큰 맵은 스크롤 ----
    const cam = this.cameras.main;
    cam.setBounds(0, 0, WORLD_W, WORLD_H);
    cam.setZoom(RES); // 캔버스가 RES배 크므로 확대해서 보이는 범위는 VIEW_W x VIEW_H로 유지
    cam.setBackgroundColor("#87b8d6");

    // ---- 배경 ----
    this.drawBackground();

    // 바닥: 맵 너비 전체를 덮는 정적 물리 바디
    const ground = this.add.rectangle(WORLD_W / 2, WORLD_H - GROUND_HEIGHT / 2, WORLD_W, GROUND_HEIGHT, 0x4a3a2c);
    this.physics.add.existing(ground, true);

    // ---- 새총 기둥(비주얼) ----
    this.anchor = mapData.slingAnchor;
    this.add.rectangle(this.anchor.x, (GROUND_Y + this.anchor.y + 10) / 2, 10, GROUND_Y - this.anchor.y + 10, 0x5b3a20);
    this.forkGfx = this.add.graphics();

    // ---- 블록 / 돼지 그룹 ----
    // Shape 게임오브젝트(Rectangle/Circle)를 맵 데이터의 실제 크기로 바로 만들어서
    // 물리 바디 크기가 스케일과 곱해지는 문제 없이 정확히 맞도록 한다.
    // 블록도 물리 경계(벽 안쪽)를 넘지 못하게 한다. 그룹에 넣을 때 그룹 기본값이 바디에
    // 덮어써지므로 개별 바디가 아니라 그룹 설정으로 켠다.
    this.blocksGroup = this.physics.add.group({ collideWorldBounds: true });
    // 'rock'은 움직이지도 부서지지도 않는 지형(고원, 벽)
    this.rocksGroup = this.physics.add.staticGroup();
    // 맵 양 끝의 보이지 않는 벽: 새와 블록이 맵 밖으로 나가지 못하게 막는다(바위와 같이 충돌).
    (MAP.walls || []).forEach((w) => {
      const wall = this.add.rectangle(w.x, w.y, w.w, w.h).setVisible(false); // 충돌만 하고 화면에는 안 보임
      this.rocksGroup.add(wall);
    });
    mapData.blocks.forEach((b) => {
      if (b.type === "rock") {
        const rock = this.add.rectangle(b.x, b.y, b.w, b.h, 0x5b5148).setStrokeStyle(2, 0x3a332c);
        this.rocksGroup.add(rock);
        return;
      }
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
    this.physics.add.collider(this.blocksGroup, this.rocksGroup);
    this.physics.add.collider(this.blocksGroup, this.blocksGroup);

    // ---- 새(투사체) ----
    // 텍스처를 늘리면 흐려지므로 도형(원)으로 그려서 어떤 해상도에서도 선명하게 한다.
    this.bird = this.add.circle(this.anchor.x, this.anchor.y, 18, 0xe24b4a).setStrokeStyle(2, 0x791f1f);
    this.physics.add.existing(this.bird);
    this.bird.body.setCircle(18);
    this.bird.body.setAllowGravity(false);
    this.bird.body.setBounce(0.35);
    this.bird.body.setCollideWorldBounds(true);
    this.bird.body.moves = false;

    this.physics.add.collider(this.bird, ground);
    this.physics.add.collider(this.bird, this.rocksGroup);
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

    // ---- 맵 둘러보기: 방향키 / 마우스 휠 ----
    this.cursors = this.input.keyboard.createCursorKeys();
    this.input.keyboard.on("keydown-SPACE", () => this.returnCameraToSling());
    this.input.on("wheel", (pointer, objs, dx, dy) => {
      this.scrollCameraBy(dx + dy);
    });

    // ---- UI 텍스트 (카메라가 움직여도 화면에 고정) ----
    this.infoText = this.add.text(16, 16, "", {
      fontSize: "16px",
      fontFamily: "Malgun Gothic, sans-serif",
      color: "#ffffff",
      backgroundColor: "#00000055",
      padding: { x: 8, y: 4 },
    }).setScrollFactor(0).setDepth(10);
    this.updateInfoText();

    if (WORLD_W > VIEW_W || WORLD_H > VIEW_H) {
      this.add.text(VIEW_W - 16, 16, "← → 방향키 / 휠: 맵 둘러보기   스페이스: 새총으로", {
        fontSize: "13px",
        fontFamily: "Malgun Gothic, sans-serif",
        color: "#ffffff",
        backgroundColor: "#00000055",
        padding: { x: 8, y: 4 },
      }).setOrigin(1, 0).setScrollFactor(0).setDepth(10);
    }

    this.messageText = this.add.text(VIEW_W / 2, VIEW_H / 2, "", {
      fontSize: "40px",
      fontFamily: "Malgun Gothic, sans-serif",
      color: "#ffd76a",
      backgroundColor: "#00000099",
      padding: { x: 20, y: 12 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(10).setVisible(false);

    this.drawFork();
    sharpenScene(this);
    this.playIntroPan();
  }

  // 하늘 위 구름/언덕(시차 스크롤)과 바닥의 거리 눈금. 넓은 맵에서
  // 카메라가 움직이고 있다는 느낌과 거리 감각을 준다.
  drawBackground() {
    const far = this.add.graphics().setScrollFactor(0.3, 1);
    far.fillStyle(0x9cc7a0, 1);
    for (let x = -200; x < WORLD_W; x += 520) {
      far.fillEllipse(x + 260, GROUND_Y + 20, 700, 260);
    }

    const clouds = this.add.graphics().setScrollFactor(0.15, 0.6);
    clouds.fillStyle(0xffffff, 0.75);
    for (let i = 0, x = 120; x < WORLD_W; i++, x += 430) {
      const y = 70 + ((i * 97) % 160);
      clouds.fillEllipse(x, y, 140, 44);
      clouds.fillEllipse(x + 50, y - 14, 90, 40);
    }

    if (WORLD_W > VIEW_W) {
      for (let x = 500; x < WORLD_W; x += 500) {
        this.add.text(x, GROUND_Y + 12, `${x}`, {
          fontSize: "12px",
          fontFamily: "sans-serif",
          color: "#d9c3a5",
        }).setOrigin(0.5, 0).setDepth(1);
      }
    }
  }

  // 새총이 화면 왼쪽(SLING_SCREEN_X)에 오도록 카메라가 맞춰야 할 중심 좌표
  slingCameraCenter() {
    return {
      x: this.anchor.x - SLING_SCREEN_X + VIEW_W / 2,
      y: WORLD_H - VIEW_H / 2, // 바닥이 화면 맨 아래에 오도록
    };
  }

  // 시작할 때 목표물 쪽을 먼저 보여주고 새총으로 돌아온다.
  playIntroPan() {
    const cam = this.cameras.main;
    const home = this.slingCameraCenter();
    if (WORLD_W <= VIEW_W) {
      cam.centerOn(home.x, home.y);
      return;
    }
    cam.centerOn(WORLD_W, home.y);
    this.time.delayedCall(700, () => {
      if (!this.isDragging && !this.isFlying) cam.pan(home.x, home.y, 1600, "Sine.easeInOut");
    });
  }

  returnCameraToSling(duration = 500) {
    const cam = this.cameras.main;
    cam.stopFollow();
    const home = this.slingCameraCenter();
    if (duration <= 0) {
      cam.panEffect.reset();
      cam.centerOn(home.x, home.y);
    } else {
      cam.pan(home.x, home.y, duration, "Sine.easeInOut", true);
    }
  }

  scrollCameraBy(dx) {
    if (this.isFlying || this.isDragging) return;
    const cam = this.cameras.main;
    cam.panEffect.reset();
    cam.scrollX += dx;
  }

  // 캠(주먹 쥐기) 모드에서 window.campullBegin()으로 호출된다.
  // 마우스 dragstart와 동일하게, 시작 시점에는 새를 움직이지 않고
  // 앵커 위치 그대로 둔다(그 다음 movePull이 상대 이동을 반영).
  beginPull() {
    if (this.isFlying || this.isGameOver || this.isDragging) return;
    this.isDragging = true;
    // 맵을 둘러보던 중이어도 새총이 보이도록 바로 돌아온다.
    this.returnCameraToSling(0);
  }

  // 마우스 drag 이벤트와 캠 모드 양쪽에서 공용으로 쓰는 당기기 갱신 로직.
  movePull(dragX, dragY) {
    if (!this.isDragging) return;
    const dx = dragX - this.anchor.x;
    const dy = dragY - this.anchor.y;
    const dist = Math.min(Math.sqrt(dx * dx + dy * dy), MAX_PULL);
    const angle = Math.atan2(dy, dx);
    // 새총이 벽 가까이 있어도(연습 맵) 당긴 새가 벽 속으로 들어가지 않게 한다.
    const px = Phaser.Math.Clamp(this.anchor.x + Math.cos(angle) * dist, this.innerL + 18, this.innerR - 18);
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
      if (y > GROUND_Y) break;
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
    this.bird.body.setVelocity(Math.cos(angle) * power, Math.sin(angle) * power);

    this.isFlying = true;
    this.flightTime = 0;
    this.cameras.main.panEffect.reset();
    this.cameras.main.startFollow(this.bird, true, 0.12, 0.12);
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
      this.reportResult("win");
    }
  }

  // 로그인 상태면 승/패 결과를 서버에 저장한다. 실패해도 게임 진행에는 영향 없음.
  reportResult(result) {
    const rec = window.MATCH_RECORD;
    if (!rec) return;
    fetch(rec.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRFToken": rec.csrfToken,
      },
      body: JSON.stringify({
        result,
        map_name: this.mapData.name,
        shots_used: this.mapData.birdCount - Math.max(this.shotsLeft, 0),
      }),
    }).catch(() => {});
  }

  showMessage(text) {
    this.messageText.setText(text + "\n(다시하기 또는 맵 선택을 눌러주세요)");
    this.messageText.setVisible(true);
  }

  update(time, delta) {
    if (!this.isFlying && !this.isDragging) {
      if (this.cursors.left.isDown) this.scrollCameraBy((-SCROLL_SPEED * delta) / 1000);
      if (this.cursors.right.isDown) this.scrollCameraBy((SCROLL_SPEED * delta) / 1000);
    }

    if (this.isFlying) {
      const b = this.bird.body;
      this.flightTime += delta;
      // 바닥/블록 위를 구르는 새는 마찰로 멈추게 한다. (넓은 맵에서는
      // 마찰이 없으면 화면 끝까지 한참 굴러가서 다음 새를 쏠 수 없다)
      if (b.blocked.down || b.touching.down) {
        b.velocity.x *= Math.pow(0.05, delta / 1000);
      }
      const offScreen = this.bird.x > WORLD_W + 40 || this.bird.x < -40 || this.bird.y > WORLD_H + 100;
      const nearlyStopped = Math.abs(b.velocity.x) < 8 && Math.abs(b.velocity.y) < 8 && b.y > 0;

      if (offScreen || nearlyStopped) {
        this.settleTimer += delta;
      } else {
        this.settleTimer = 0;
      }

      // 블록 위에서 계속 흔들리는 경우 등을 대비해 한 발은 최대 12초로 제한
      if (offScreen || this.settleTimer > 550 || this.flightTime > 12000) {
        this.isFlying = false;
        this.resetBirdToSling();
        // 결과를 잠깐 보여준 뒤 새총으로 카메라를 돌린다.
        this.time.delayedCall(500, () => {
          if (!this.isFlying && !this.isDragging) this.returnCameraToSling(700);
        });
      }
    }

    if (!this.isGameOver && !this.isFlying && !this.isDragging && this.pigsLeft > 0 && this.shotsLeft <= 0) {
      this.isGameOver = true;
      this.showMessage("패배... 새가 모두 소진되었습니다.");
      this.reportResult("lose");
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

function createGame() {
  if (gameInstance) {
    gameInstance.destroy(true);
    gameInstance = null;
  }

  RES = pickResolution();
  const config = {
    type: Phaser.AUTO,
    width: VIEW_W * RES,
    height: VIEW_H * RES,
    parent: "game-container",
    // 브라우저 창에 맞춰 비율을 유지한 채 최대한 크게 키운다(게임 좌표는 VIEW_W x VIEW_H 그대로).
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    backgroundColor: "#87b8d6",
    physics: {
      default: "arcade",
      // fps 120: 빠른 새가 얇은 블록을 뚫고 지나가지 않도록 물리를 더 촘촘히 계산
      arcade: { gravity: { y: 950 }, debug: false, fps: 120 },
    },
    scene: [GameScene],
  };

  gameInstance = new Phaser.Game(config);
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
  createGame();

  document.getElementById("reset-btn").addEventListener("click", () => {
    createGame();
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