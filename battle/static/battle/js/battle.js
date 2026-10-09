// ------------------------------------------------------------------
// 1대1 요새전 화면.
//
// 맵 왼쪽 끝이 1P, 오른쪽 끝이 2P의 새총+요새다. 서버(battle/consumers.py)와
// WebSocket으로 연결해서 차례를 주고받는다.
//   - 내 차례에 새총을 당겼다 놓으면 발사 속도만 서버로 보낸다(shot).
//   - 서버가 두 사람에게 같은 속도를 돌려주면 두 화면 모두 새를 날린다.
//   - 쏜 사람 화면에서 새와 블록이 멈추면 블록 상태를 서버로 보낸다(settle).
//   - 상대 화면은 그 상태(sync)로 블록을 다시 맞춘다. 물리 결과가 브라우저마다
//     조금씩 달라도 "쏜 사람 화면"이 정답이 된다.
//
// 당기기/발사 로직은 game.js와 같은 beginPull/movePull/finishPull 구조라서
// 캠 모드(hand_control.js)도 그대로 쓸 수 있다.
// ------------------------------------------------------------------

const VIEW_W = 1200;
const VIEW_H = 700;
const GROUND_HEIGHT = 40;

const MAX_PULL = 160;
const DAMAGE_SPEED_THRESHOLD = 90;
const SCROLL_SPEED = 900;
const BLOCK_REST_SPEED = 20; // 블록이 이 속도보다 느리면 멈춘 것으로 본다

const MAP = JSON.parse(document.getElementById("map-data").textContent);
const WORLD_W = MAP.width;
const WORLD_H = MAP.height;
const GROUND_Y = WORLD_H - GROUND_HEIGHT;
const MAX_LAUNCH_SPEED = MAP.maxLaunchSpeed;
const BLOCK_META = {};
MAP.blocks.forEach((b) => { BLOCK_META[b.id] = b; });

const SIDE_COLOR = { 1: 0x4a8fe2, 2: 0xe24b4a };

let gameInstance = null;
let controlMode = "mouse";

// ---- 서버와 주고받는 상태 ----
let ws = null;
let mySlot = null;
let roomState = null;
let fatalError = null; // 다시 연결하면 안 되는 오류(방 없음, 가득 참 등)
let reconnectTries = 0;
let latestBlocks = null; // 장면이 만들어지기 전에 받은 블록 상태(다시 접속한 경우)

function getScene() {
  const scene = gameInstance ? gameInstance.scene.getScene("BattleScene") : null;
  return scene && scene.ready ? scene : null;
}

function otherSlot(slot) {
  return slot === 1 ? 2 : 1;
}

function playerName(slot) {
  const p = roomState && roomState.players[String(slot)];
  return p ? p.name : "?";
}

class BattleScene extends Phaser.Scene {
  constructor() {
    super("BattleScene");
  }

  preload() {
    const g = this.add.graphics();
    g.fillStyle(0xe24b4a, 1);
    g.fillCircle(18, 18, 18);
    g.lineStyle(2, 0x791f1f, 1);
    g.strokeCircle(18, 18, 18);
    g.generateTexture("bird", 36, 36);
    g.destroy();
  }

  create() {
    this.isDragging = false;
    this.isFlying = false;
    this.shooterSlot = null; // 지금 날아가는 새를 쏜 사람
    this.waitingForShot = false; // 발사를 보내고 서버 응답을 기다리는 중
    this.settleTimer = 0;
    this.blockRestTimer = 0;
    this.blockWaitTime = 0;
    this.sendingSettle = false;

    this.physics.world.setBounds(0, 0, WORLD_W, WORLD_H);
    this.physics.world.gravity.y = 950;

    const cam = this.cameras.main;
    cam.setBounds(0, 0, WORLD_W, WORLD_H);
    cam.setBackgroundColor("#87b8d6");

    this.drawBackground();

    const ground = this.add.rectangle(WORLD_W / 2, WORLD_H - GROUND_HEIGHT / 2, WORLD_W, GROUND_HEIGHT, 0x4a3a2c);
    this.physics.add.existing(ground, true);

    // ---- 새총 두 개(1P 왼쪽, 2P 오른쪽) ----
    this.slings = { 1: MAP.slings["1"], 2: MAP.slings["2"] };
    [1, 2].forEach((slot) => {
      const a = this.slings[slot];
      this.add.rectangle(a.x, (GROUND_Y + a.y + 10) / 2, 10, GROUND_Y - a.y + 10, 0x5b3a20);
      const fork = this.add.graphics();
      fork.lineStyle(6, SIDE_COLOR[slot], 1);
      fork.lineBetween(a.x - 14, a.y + 30, a.x, a.y);
      fork.lineBetween(a.x + 14, a.y + 30, a.x, a.y);
    });
    this.anchor = this.slings[1];

    // ---- 요새 위 이름표 ----
    this.nameTags = {};
    [1, 2].forEach((slot) => {
      const x = slot === 1 ? 470 : WORLD_W - 470;
      this.nameTags[slot] = this.add.text(x, GROUND_Y - 330, "", {
        fontSize: "20px",
        fontFamily: "Malgun Gothic, sans-serif",
        color: "#ffffff",
        backgroundColor: slot === 1 ? "#2b5c99cc" : "#99302fcc",
        padding: { x: 10, y: 4 },
      }).setOrigin(0.5).setDepth(2);
    });

    // ---- 지형(바위)과 블록 ----
    this.rocksGroup = this.physics.add.staticGroup();
    MAP.blocks.filter((b) => b.type === "rock").forEach((b) => {
      const rock = this.add.rectangle(b.x, b.y, b.w, b.h, 0x5b5148).setStrokeStyle(2, 0x3a332c);
      this.rocksGroup.add(rock);
    });
    this.blocksGroup = this.physics.add.group();
    this.physics.add.collider(this.blocksGroup, ground);
    this.physics.add.collider(this.blocksGroup, this.rocksGroup);
    this.physics.add.collider(this.blocksGroup, this.blocksGroup);
    this.rebuildBlocks(
      latestBlocks ||
      MAP.blocks.filter((b) => b.type !== "rock").map((b) => ({ id: b.id, x: b.x, y: b.y, hp: b.type === "stone" ? 2 : 1 }))
    );

    // ---- 새 ----
    this.bird = this.physics.add.sprite(this.anchor.x, this.anchor.y, "bird");
    this.bird.body.setCircle(18);
    this.bird.body.setAllowGravity(false);
    this.bird.body.setBounce(0.35);
    this.bird.body.moves = false;
    this.physics.add.collider(this.bird, ground);
    this.physics.add.collider(this.bird, this.rocksGroup);
    this.physics.add.collider(this.bird, this.blocksGroup, this.onBirdHitBlock, null, this);

    this.aimLine = this.add.graphics();
    this.trajectoryDots = this.add.graphics();

    // ---- 마우스 드래그 ----
    this.bird.setInteractive({ cursor: "grab" });
    this.input.setDraggable(this.bird);
    this.input.on("dragstart", (pointer, obj) => {
      if (controlMode !== "mouse" || obj !== this.bird) return;
      this.beginPull();
    });
    this.input.on("drag", (pointer, obj, dragX, dragY) => {
      if (controlMode !== "mouse" || obj !== this.bird) return;
      this.movePull(dragX, dragY);
    });
    this.input.on("dragend", (pointer, obj) => {
      if (controlMode !== "mouse" || obj !== this.bird) return;
      this.finishPull();
    });

    this.cursors = this.input.keyboard.createCursorKeys();
    this.input.keyboard.on("keydown-SPACE", () => this.panToSling(mySlot || 1));
    this.input.on("wheel", (pointer, objs, dx, dy) => this.scrollCameraBy(dx + dy));

    // ---- 화면 고정 UI ----
    const uiStyle = {
      fontSize: "16px",
      fontFamily: "Malgun Gothic, sans-serif",
      color: "#ffffff",
      backgroundColor: "#00000055",
      padding: { x: 8, y: 4 },
    };
    this.infoText = this.add.text(16, 16, "", uiStyle).setScrollFactor(0).setDepth(10);
    this.add.text(VIEW_W - 16, 16, "← → / 휠: 둘러보기   스페이스: 내 새총으로", { ...uiStyle, fontSize: "13px" })
      .setOrigin(1, 0).setScrollFactor(0).setDepth(10);
    this.turnText = this.add.text(VIEW_W / 2, 64, "", {
      fontSize: "24px",
      fontFamily: "Malgun Gothic, sans-serif",
      color: "#ffd76a",
      backgroundColor: "#00000088",
      padding: { x: 16, y: 6 },
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(10);
    this.messageText = this.add.text(VIEW_W / 2, VIEW_H / 2, "", {
      fontSize: "34px",
      fontFamily: "Malgun Gothic, sans-serif",
      color: "#ffd76a",
      backgroundColor: "#00000099",
      padding: { x: 20, y: 12 },
      align: "center",
    }).setOrigin(0.5).setScrollFactor(0).setDepth(10).setVisible(false);

    this.cameras.main.centerOn(this.slingCameraCenter(1).x, this.slingCameraCenter(1).y);
    this.ready = true;
    this.applyState();
  }

  drawBackground() {
    const far = this.add.graphics().setScrollFactor(0.3, 1);
    far.fillStyle(0x9cc7a0, 1);
    for (let x = -200; x < WORLD_W; x += 520) far.fillEllipse(x + 260, GROUND_Y + 20, 700, 260);
    const clouds = this.add.graphics().setScrollFactor(0.15, 0.6);
    clouds.fillStyle(0xffffff, 0.75);
    for (let i = 0, x = 120; x < WORLD_W; i++, x += 430) {
      const y = 70 + ((i * 97) % 160);
      clouds.fillEllipse(x, y, 140, 44);
      clouds.fillEllipse(x + 50, y - 14, 90, 40);
    }
  }

  // ---------------- 블록 ----------------
  // 서버가 준 블록 목록(id, x, y, hp)대로 블록을 전부 다시 만든다.
  rebuildBlocks(list) {
    this.blocksGroup.clear(true, true);
    list.forEach((s) => {
      const b = BLOCK_META[s.id];
      if (!b || b.type === "rock") return;
      let obj;
      if (b.type === "pig") {
        obj = this.add.circle(s.x, s.y, b.w / 2, 0x63b04a).setStrokeStyle(3, SIDE_COLOR[b.side]);
      } else if (b.type === "stone") {
        obj = this.add.rectangle(s.x, s.y, b.w, b.h, 0x8a8f98).setStrokeStyle(2, 0x4a4e55);
      } else {
        obj = this.add.rectangle(s.x, s.y, b.w, b.h, 0xc98a4b).setStrokeStyle(2, 0x7a5326);
      }
      this.physics.add.existing(obj);
      if (b.type === "pig") obj.body.setCircle(b.w / 2);
      else obj.body.setSize(b.w, b.h);
      obj.body.setBounce(0.05);
      obj.body.setDrag(40, 0);
      obj.body.setFriction(1, 0);
      obj.setData("id", s.id);
      obj.setData("type", b.type);
      obj.setData("hp", s.hp);
      if (b.type === "stone" && s.hp < 2) obj.setAlpha(0.75); // 금 간 돌
      this.blocksGroup.add(obj);
    });
  }

  snapshotBlocks() {
    return this.blocksGroup.getChildren().map((obj) => ({
      id: obj.getData("id"),
      x: Math.round(obj.x * 10) / 10,
      y: Math.round(obj.y * 10) / 10,
      hp: obj.getData("hp"),
    }));
  }

  blocksAtRest() {
    return this.blocksGroup.getChildren().every((obj) => obj.body.speed < BLOCK_REST_SPEED);
  }

  onBirdHitBlock(bird, block) {
    if (bird.body.speed < DAMAGE_SPEED_THRESHOLD) return;
    const hp = block.getData("hp") - 1;
    block.setData("hp", hp);
    if (hp > 0) {
      block.setAlpha(0.75);
      return;
    }
    this.blocksGroup.remove(block, false, false);
    block.body.enable = false;
    this.tweens.add({
      targets: block,
      alpha: 0,
      scale: 0.2,
      duration: 150,
      onComplete: () => block.destroy(),
    });
  }

  // ---------------- 카메라 ----------------
  // 내 새총 차례에는 맵 끝(내 요새 쪽)을 화면 가장자리에 맞춰서 내 요새와 새총이 함께 보이게 한다.
  slingCameraCenter(slot) {
    const x = slot === 1 ? VIEW_W / 2 : WORLD_W - VIEW_W / 2;
    return { x, y: WORLD_H - VIEW_H / 2 };
  }

  panToSling(slot, duration = 600) {
    const cam = this.cameras.main;
    cam.stopFollow();
    const c = this.slingCameraCenter(slot);
    if (duration <= 0) {
      cam.panEffect.reset();
      cam.centerOn(c.x, c.y);
    } else {
      cam.pan(c.x, c.y, duration, "Sine.easeInOut", true);
    }
  }

  scrollCameraBy(dx) {
    if (this.isFlying || this.isDragging) return;
    const cam = this.cameras.main;
    cam.panEffect.reset();
    cam.scrollX += dx;
  }

  // ---------------- 당기기 / 발사 ----------------
  canShoot() {
    return (
      roomState && roomState.phase === "playing" && roomState.turn === mySlot && !roomState.shooting &&
      !this.isFlying && !this.waitingForShot
    );
  }

  beginPull() {
    if (this.isDragging || !this.canShoot()) return;
    this.isDragging = true;
    this.panToSling(mySlot, 0);
  }

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

  finishPull() {
    if (!this.isDragging) return;
    this.isDragging = false;
    this.aimLine.clear();
    this.trajectoryDots.clear();

    const dx = this.anchor.x - this.bird.x;
    const dy = this.anchor.y - this.bird.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 12 || !this.canShoot()) {
      this.bird.setPosition(this.anchor.x, this.anchor.y);
      return;
    }
    const power = Math.min((dist / MAX_PULL) * MAX_LAUNCH_SPEED, MAX_LAUNCH_SPEED);
    const angle = Math.atan2(dy, dx);
    // 바로 날리지 않고 서버로 보낸다. 서버가 두 사람에게 같은 "shot"을 돌려주면 그때 날린다.
    this.waitingForShot = true;
    sendMessage({ type: "shot", vx: Math.cos(angle) * power, vy: Math.sin(angle) * power });
    // 서버가 발사를 받아주지 않으면(연결 끊김 등) 잠시 뒤 새를 제자리로 돌려 다시 쏠 수 있게 한다.
    this.time.delayedCall(3000, () => {
      if (this.waitingForShot && !this.isFlying) {
        this.waitingForShot = false;
        this.bird.setPosition(this.anchor.x, this.anchor.y);
      }
    });
  }

  drawAim(px, py) {
    this.aimLine.clear();
    this.aimLine.lineStyle(3, 0xffffff, 0.85);
    this.aimLine.beginPath();
    this.aimLine.moveTo(this.anchor.x, this.anchor.y);
    this.aimLine.lineTo(px, py);
    this.aimLine.strokePath();

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

  // 서버가 보낸 발사(두 화면 공통)
  flyBird(slot, vx, vy) {
    this.waitingForShot = false;
    this.isDragging = false;
    this.aimLine.clear();
    this.trajectoryDots.clear();
    this.anchor = this.slings[slot];
    this.shooterSlot = slot;
    this.bird.setPosition(this.anchor.x, this.anchor.y);
    this.bird.body.moves = true;
    this.bird.body.setAllowGravity(true);
    this.bird.setVelocity(vx, vy);
    this.isFlying = true;
    this.flightTime = 0;
    this.settleTimer = 0;
    this.blockRestTimer = 0;
    this.blockWaitTime = 0;
    this.sendingSettle = false;
    this.cameras.main.panEffect.reset();
    this.cameras.main.startFollow(this.bird, true, 0.12, 0.12);
  }

  // 상대가 쏜 결과(또는 다시 접속했을 때의 현재 상태)로 블록을 맞춘다.
  applySync(blocks) {
    if (this.isFlying) this.stopFlight();
    this.rebuildBlocks(blocks);
  }

  stopFlight() {
    this.isFlying = false;
    this.sendingSettle = false;
    this.shooterSlot = null;
    this.bird.body.setVelocity(0, 0);
    this.bird.body.setAllowGravity(false);
    this.bird.body.moves = false;
    this.cameras.main.stopFollow();
  }

  update(time, delta) {
    if (!this.isFlying && !this.isDragging) {
      if (this.cursors.left.isDown) this.scrollCameraBy((-SCROLL_SPEED * delta) / 1000);
      if (this.cursors.right.isDown) this.scrollCameraBy((SCROLL_SPEED * delta) / 1000);
    }
    if (!this.isFlying) return;

    const b = this.bird.body;
    this.flightTime += delta;
    if (b.blocked.down || b.touching.down) b.velocity.x *= Math.pow(0.05, delta / 1000);
    const offScreen = this.bird.x > WORLD_W + 40 || this.bird.x < -40 || this.bird.y > WORLD_H + 100;
    const nearlyStopped = Math.abs(b.velocity.x) < 8 && Math.abs(b.velocity.y) < 8 && b.y > 0;
    this.settleTimer = offScreen || nearlyStopped ? this.settleTimer + delta : 0;
    const birdDone = offScreen || this.settleTimer > 550 || this.flightTime > 12000;
    if (!birdDone) return;

    if (this.shooterSlot !== mySlot) {
      // 상대가 쏜 새: 내 화면은 구경만 하고, 상대가 보낸 결과(sync)를 기다린다.
      this.cameras.main.stopFollow();
      return;
    }

    // 내가 쏜 새: 블록까지 멈출 때까지(최대 4초) 기다렸다가 결과를 보낸다.
    this.blockWaitTime += delta;
    this.blockRestTimer = this.blocksAtRest() ? this.blockRestTimer + delta : 0;
    if (!this.sendingSettle && (this.blockRestTimer > 400 || this.blockWaitTime > 4000)) {
      this.sendingSettle = true;
      sendMessage({ type: "settle", blocks: this.snapshotBlocks() });
      this.stopFlight();
    }
  }

  // ---------------- 서버 상태 → 화면 ----------------
  applyState() {
    if (!this.infoText) return;
    const s = roomState;
    if (!s) {
      this.turnText.setText("서버에 연결하는 중...");
      return;
    }
    [1, 2].forEach((slot) => {
      const p = s.players[String(slot)];
      const label = `${slot}P ${p ? p.name : "(빈 자리)"}${slot === mySlot ? " (나)" : ""}`;
      this.nameTags[slot].setText(label);
    });

    const me = mySlot ? `${mySlot}P` : "";
    this.infoText.setText(
      `나: ${me}   남은 새 ${s.shots[String(mySlot)] ?? "-"}   내 돼지 ${s.pigs[String(mySlot)] ?? "-"}\n` +
      `상대: 남은 새 ${s.shots[String(otherSlot(mySlot))] ?? "-"}   상대 돼지 ${s.pigs[String(otherSlot(mySlot))] ?? "-"}`
    );

    if (s.phase === "waiting") {
      this.turnText.setText(`상대를 기다리는 중... 방 코드 ${s.code}`);
    } else if (s.phase === "playing") {
      const other = s.players[String(otherSlot(mySlot))];
      if (other && !other.connected) {
        this.turnText.setText("상대 연결이 끊겼습니다. 20초 안에 돌아오지 않으면 승리!");
      } else if (s.turn === mySlot) {
        this.turnText.setText(s.shooting ? "날아가는 중..." : "내 차례! 새총을 당겨 쏘세요");
      } else {
        this.turnText.setText(s.shooting ? `${playerName(s.turn)}님의 새가 날아가는 중...` : `${playerName(s.turn)}님의 차례`);
      }
    } else {
      this.turnText.setText("게임 종료");
      this.showResult(s);
    }

    // 쏜 사람이 결과를 못 보내고 차례가 넘어간 경우(연결 끊김 등) 날던 새를 멈춘다.
    if (!s.shooting && this.isFlying) this.stopFlight();

    // 차례가 바뀌었으면 새를 그 사람 새총에 올려 두고 카메라를 옮긴다.
    if (s.phase === "playing" && !s.shooting && !this.isFlying && !this.isDragging && !this.waitingForShot) {
      const firstTurn = this.lastTurn === undefined;
      const turnChanged = this.lastTurn !== s.turn;
      this.anchor = this.slings[s.turn];
      this.bird.setPosition(this.anchor.x, this.anchor.y);
      if (turnChanged) {
        this.lastTurn = s.turn;
        this.time.delayedCall(firstTurn ? 0 : 400, () => {
          if (!this.isFlying && !this.isDragging) this.panToSling(s.turn, 900);
        });
      }
    }
    if (s.phase !== "playing") this.waitingForShot = false;
  }

  showResult(s) {
    let text;
    if (s.winner === null) text = "무승부!";
    else if (s.winner === mySlot) text = "승리!";
    else text = "패배...";
    const why = {
      all_pigs: "돼지를 모두 쓰러뜨렸습니다",
      out_of_birds: "새를 모두 써서 남은 돼지 수로 판정",
      left: s.winner === mySlot ? "상대가 나갔습니다" : "연결이 끊겨 기권 처리되었습니다",
    }[s.reason] || "";
    this.messageText.setText(`${text}\n${why}\n(로비로 돌아가 새 방을 만들어 주세요)`);
    this.messageText.setVisible(true);
  }
}

// ------------------------------------------------------------------
// WebSocket
// ------------------------------------------------------------------
function sendMessage(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}${window.BATTLE.wsPath}`);
  ws.onopen = () => { reconnectTries = 0; };
  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch (e) { return; }
    handleMessage(msg);
  };
  ws.onclose = () => {
    ws = null;
    const scene = getScene();
    if (fatalError || (roomState && roomState.phase === "over")) return;
    reconnectTries += 1;
    if (reconnectTries > 8) {
      setNote("서버와 연결이 끊겼습니다. 로비로 돌아가 주세요.");
      return;
    }
    setNote("연결이 끊겼습니다. 다시 연결하는 중...");
    if (scene) scene.waitingForShot = false;
    setTimeout(connect, 1500);
  };
}

function handleMessage(msg) {
  const scene = getScene();
  if (msg.type === "hello") {
    mySlot = msg.slot;
  } else if (msg.type === "state") {
    roomState = msg;
    renderPlayers();
    if (scene) scene.applyState();
  } else if (msg.type === "shot") {
    if (scene) scene.flyBird(msg.slot, msg.vx, msg.vy);
  } else if (msg.type === "sync") {
    if (msg.from !== mySlot) {
      latestBlocks = msg.blocks;
      if (scene) scene.applySync(msg.blocks);
    }
  } else if (msg.type === "error") {
    fatalError = msg.message;
    setNote(msg.message);
    if (scene) {
      scene.messageText.setText(`${msg.message}\n(로비로 돌아가 주세요)`).setVisible(true);
    }
  }
}

function setNote(text) {
  document.getElementById("note").textContent = text;
}

function renderPlayers() {
  const box = document.getElementById("players");
  box.innerHTML = "";
  [1, 2].forEach((slot) => {
    const p = roomState.players[String(slot)];
    const el = document.createElement("span");
    el.className = `p p${slot}`;
    if (roomState.phase === "playing" && roomState.turn === slot) el.classList.add("turn");
    if (!p || !p.connected) el.classList.add("off");
    el.textContent = `${slot}P ${p ? p.name : "대기 중"}${slot === mySlot ? " (나)" : ""}`;
    box.appendChild(el);
  });
  if (roomState.phase === "waiting") setNote("상대를 기다리는 중... 방 코드를 친구에게 알려 주세요");
  else if (roomState.phase === "playing") {
    setNote(roomState.turn === mySlot ? "내 차례입니다" : "상대 차례입니다");
  } else setNote("게임이 끝났습니다");
}

// ------------------------------------------------------------------
// 게임 / 조작 모드
// ------------------------------------------------------------------
function createGame() {
  gameInstance = new Phaser.Game({
    type: Phaser.AUTO,
    width: VIEW_W,
    height: VIEW_H,
    parent: "game-container",
    backgroundColor: "#87b8d6",
    physics: {
      default: "arcade",
      arcade: { gravity: { y: 950 }, debug: false, fps: 120 },
    },
    scene: [BattleScene],
  });
}

window.campullBegin = () => {
  if (controlMode !== "cam") return;
  const scene = getScene();
  if (scene) scene.beginPull();
};
window.campullMove = (x, y) => {
  if (controlMode !== "cam") return;
  const scene = getScene();
  if (scene) scene.movePull(x, y);
};
window.campullEnd = () => {
  if (controlMode !== "cam") return;
  const scene = getScene();
  if (scene) scene.finishPull();
};
window.getSlingAnchor = () => {
  const scene = getScene();
  if (!scene || !mySlot) return null;
  const a = scene.slings[mySlot];
  return { x: a.x, y: a.y };
};

function setMouseMode() {
  controlMode = "mouse";
  document.getElementById("mouse-mode-btn").classList.add("active");
  document.getElementById("cam-mode-btn").classList.remove("active");
  document.getElementById("cam-box").style.display = "none";
  if (window.stopCamControl) window.stopCamControl();
}

async function setCamMode() {
  document.getElementById("cam-mode-btn").classList.add("active");
  document.getElementById("mouse-mode-btn").classList.remove("active");
  document.getElementById("cam-box").style.display = "flex";
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
  connect();
  document.getElementById("mouse-mode-btn").addEventListener("click", () => {
    if (controlMode !== "mouse") setMouseMode();
  });
  document.getElementById("cam-mode-btn").addEventListener("click", () => {
    if (controlMode !== "cam") setCamMode();
  });
});
