// ------------------------------------------------------------------
// 솔로(game.js)와 1대1 요새전(battle.js)이 같이 쓰는 그래픽 꾸미기.
//
// 물리 바디는 지금처럼 Shape(Rectangle/Circle)에 붙어 있고, 여기서는 그 위에
// "스킨"(Graphics로 그린 나뭇결, 돼지 얼굴, 새 눈 등)을 덧씌워서 매 프레임
// 도형의 위치/회전/투명도를 따라가게 한다. 이미지 파일 없이 벡터로 그리기 때문에
// 화면 해상도(RES)가 커져도 흐려지지 않고, 물리 바디 크기에도 영향이 없다.
//
// 그 밖에 맵마다 다른 배경 테마(하늘 그라데이션, 해/달, 산, 구름),
// 새총 고무줄, 비행 궤적, 블록이 부서질 때 파편/연기 파티클, 화면 흔들림,
// 점수 팝업, 승리 폭죽 같은 연출을 담당한다.
// ------------------------------------------------------------------

const THEMES = {
  meadow: {
    sky: ["#3f8fd8", "#bfe6ff"], sun: 0xfff3b0, glow: 0xfff7d6,
    far: 0x9bbfdc, farTop: 0xe8f1f8, mid: 0x7cc36d, near: 0x5aa84c,
    grass: 0x5cbf47, grassDark: 0x3e8f32, dirt: 0x7a5232, dirtDark: 0x5a3b22,
    rock: 0x7f756b, rockDark: 0x5c544c, cloud: 0xffffff, trees: 0x3f8a3a,
  },
  canyon: {
    sky: ["#e9773f", "#ffe0a6"], sun: 0xfff0c0, glow: 0xffd28a,
    far: 0xd59a6e, farTop: 0xe9bb8e, mid: 0xbc6d43, near: 0xa25532,
    grass: 0xd0a65a, grassDark: 0xa47c3a, dirt: 0x9a5a34, dirtDark: 0x6e3d22,
    rock: 0xa0694b, rockDark: 0x7a4b33, cloud: 0xfff2e2, mesa: true,
  },
  cliff: {
    sky: ["#5b4ab8", "#ffb39c"], sun: 0xffe3a0, glow: 0xffb3a0,
    far: 0x8a74b5, farTop: 0xc9b6e0, mid: 0x5d7d72, near: 0x4b7348,
    grass: 0x63a84c, grassDark: 0x3f7a33, dirt: 0x6e4a32, dirtDark: 0x4e3322,
    rock: 0x766a78, rockDark: 0x544a56, cloud: 0xffd9e0, trees: 0x355f3a,
  },
  fortress: {
    sky: ["#0d1330", "#4b3c72"], sun: 0xf3f0dc, glow: 0x9aa6ff, moon: true, stars: true,
    far: 0x2f3160, farTop: 0x4a4c82, mid: 0x323a58, near: 0x283445,
    grass: 0x3f7048, grassDark: 0x2a4e31, dirt: 0x4a3a33, dirtDark: 0x302520,
    rock: 0x5c586b, rockDark: 0x403d4c, cloud: 0x8f93c4, torches: true,
  },
};
const MAP_THEME = { meadow: "meadow", canyon: "canyon", cliff: "cliff", fortress: "fortress", duel: "cliff" };

function themeFor(mapId) {
  return THEMES[MAP_THEME[mapId] || "meadow"];
}

// 매번 같은 모양이 나오는 의사 난수(맵을 다시 시작해도 배경이 똑같다)
function vrand(i) {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

// ------------------------------------------------------------------
// 배경
// ------------------------------------------------------------------
function drawScenery(scene, theme, worldW, worldH, groundY) {
  // 하늘: 세로 그라데이션 캔버스 텍스처를 맵 전체 크기로 늘린다(그라데이션이라 늘려도 티가 안 난다).
  const skyKey = "sky-" + theme.sky.join("");
  if (!scene.textures.exists(skyKey)) {
    const tex = scene.textures.createCanvas(skyKey, 4, 256);
    const grad = tex.context.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, theme.sky[0]);
    grad.addColorStop(1, theme.sky[1]);
    tex.context.fillStyle = grad;
    tex.context.fillRect(0, 0, 4, 256);
    tex.refresh();
  }
  scene.add.image(0, 0, skyKey).setOrigin(0).setDisplaySize(worldW, worldH).setDepth(-100);

  if (theme.stars) {
    const stars = scene.add.graphics().setScrollFactor(0.05, 0.3).setDepth(-99);
    for (let i = 0; i < 160; i++) {
      stars.fillStyle(0xffffff, 0.3 + vrand(i * 3) * 0.7);
      stars.fillCircle(vrand(i) * (worldW * 0.05 + 1400), vrand(i + 500) * (groundY - 250), 0.6 + vrand(i * 7) * 1.4);
    }
    scene.tweens.add({ targets: stars, alpha: 0.6, duration: 1800, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
  }

  // 해(또는 달)와 은은하게 깜빡이는 빛무리
  // 세로로 큰 맵은 카메라가 아래쪽에 있으므로(시차 0.3) 그만큼 내려서 화면 위쪽에 보이게 한다.
  const sunX = 930, sunY = (theme.moon ? 120 : 130) + Math.max(0, worldH - VIEW_H) * 0.3;
  const glow = scene.add.graphics().setScrollFactor(0.05, 0.3).setDepth(-98);
  for (let i = 6; i >= 1; i--) {
    glow.fillStyle(theme.glow, 0.06);
    glow.fillCircle(sunX, sunY, 46 + i * 22);
  }
  scene.tweens.add({ targets: glow, alpha: 0.55, duration: 2200, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
  const sun = scene.add.graphics().setScrollFactor(0.05, 0.3).setDepth(-97);
  sun.fillStyle(theme.sun, 1);
  sun.fillCircle(sunX, sunY, 48);
  if (theme.moon) {
    sun.fillStyle(0xd9d5bd, 1);
    sun.fillCircle(sunX - 14, sunY - 10, 9);
    sun.fillCircle(sunX + 16, sunY + 12, 6);
    sun.fillCircle(sunX + 6, sunY - 22, 4);
  } else {
    sun.fillStyle(0xffffff, 0.5);
    sun.fillCircle(sunX - 14, sunY - 14, 16);
  }

  // 먼 산맥(시차 스크롤이 가장 느림)
  const far = scene.add.graphics().setScrollFactor(0.2, 1).setDepth(-96);
  const farW = worldW * 0.2 + 1400;
  const peaks = [];
  for (let x = -100, i = 0; x < farW; i++, x += 140 + vrand(i) * 160) {
    peaks.push({ x, y: groundY - 170 - vrand(i + 40) * 190 });
  }
  far.fillStyle(theme.far, 1);
  far.fillPoints([{ x: -200, y: groundY + 40 }, ...peaks.flatMap((p, i) => {
    const next = peaks[i + 1];
    return next ? [p, { x: (p.x + next.x) / 2, y: groundY - 110 - vrand(i + 90) * 60 }] : [p];
  }), { x: farW + 200, y: groundY + 40 }], true);
  far.fillStyle(theme.farTop, 0.9);
  peaks.forEach((p) => {
    if (p.y > groundY - 260) return; // 높은 봉우리에만 눈/햇빛
    far.fillTriangle(p.x, p.y, p.x - 26, p.y + 34, p.x + 26, p.y + 34);
  });

  // 구름: 각자 천천히 좌우로 떠다닌다.
  for (let i = 0, x = 120; x < worldW * 0.15 + 1400; i++, x += 300 + vrand(i + 7) * 260) {
    const y = 60 + vrand(i * 5) * 170;
    const s = 0.7 + vrand(i * 11) * 0.7;
    const c = scene.add.graphics().setScrollFactor(0.15, 0.6).setDepth(-95);
    c.setPosition(x, y).setScale(s);
    c.fillStyle(theme.cloud, 0.35);
    c.fillEllipse(6, 22, 190, 34);
    c.fillStyle(theme.cloud, 0.92);
    c.fillCircle(-50, 6, 26);
    c.fillCircle(-14, -10, 36);
    c.fillCircle(28, -2, 30);
    c.fillCircle(60, 10, 20);
    c.fillRoundedRect(-76, 4, 150, 26, 13);
    scene.tweens.add({
      targets: c, x: x + 40 + vrand(i) * 60, duration: 7000 + vrand(i + 3) * 6000,
      yoyo: true, repeat: -1, ease: "Sine.easeInOut",
    });
  }

  // 중간 언덕(협곡은 평평한 메사 바위) + 나무
  const mid = scene.add.graphics().setScrollFactor(0.45, 1).setDepth(-94);
  const midW = worldW * 0.45 + 1400;
  for (let i = 0, x = -100; x < midW; i++, x += 380 + vrand(i + 20) * 240) {
    const w = 420 + vrand(i + 60) * 320;
    const h = 110 + vrand(i + 80) * 120;
    if (theme.mesa) {
      mid.fillStyle(theme.mid, 1);
      mid.fillPoints([
        { x: x - w / 2, y: groundY + 10 }, { x: x - w / 3, y: groundY - h },
        { x: x + w / 3, y: groundY - h }, { x: x + w / 2, y: groundY + 10 },
      ], true);
      mid.fillStyle(0xffffff, 0.12);
      for (let k = 1; k < 4; k++) {
        const y = groundY - h + k * 26;
        const half = w / 3 + (w / 6) * ((y - (groundY - h)) / (h + 10)) - 4;
        mid.fillRect(x - half, y, half * 2, 5);
      }
    } else {
      mid.fillStyle(theme.mid, 1);
      mid.fillEllipse(x, groundY + 30, w, h * 2);
      if (theme.trees) {
        for (let t = 0; t < 3; t++) {
          const tx = x - w * 0.25 + t * w * 0.22 + vrand(i * 9 + t) * 30;
          const ty = groundY + 30 - Math.sqrt(Math.max(0, 1 - ((tx - x) / (w / 2)) ** 2)) * h + 6;
          mid.fillStyle(0x5b3a22, 1);
          mid.fillRect(tx - 3, ty - 18, 6, 20);
          mid.fillStyle(theme.trees, 1);
          mid.fillCircle(tx, ty - 30, 18);
          mid.fillCircle(tx - 10, ty - 20, 13);
          mid.fillCircle(tx + 11, ty - 21, 13);
        }
      }
    }
  }

  // 가까운 언덕(맵과 거의 같이 움직임)
  const near = scene.add.graphics().setScrollFactor(0.7, 1).setDepth(-93);
  near.fillStyle(theme.near, 1);
  for (let i = 0, x = -150; x < worldW * 0.7 + 1400; i++, x += 300 + vrand(i + 33) * 200) {
    near.fillEllipse(x, groundY + 24, 360 + vrand(i + 44) * 240, 120 + vrand(i + 55) * 70);
  }
}

// 바닥 스킨: 흙 + 자갈 + 맨 위 잔디. 바닥 도형(물리 바디)은 그대로 두고 위에 그린다.
function drawGround(scene, theme, worldW, groundY, groundH) {
  const g = scene.add.graphics();
  g.fillStyle(theme.dirt, 1);
  g.fillRect(0, groundY, worldW, groundH);
  g.fillStyle(theme.dirtDark, 1);
  g.fillRect(0, groundY + groundH * 0.55, worldW, groundH * 0.45);
  for (let i = 0; i < worldW / 18; i++) {
    g.fillStyle(i % 3 ? theme.dirtDark : 0xffffff, i % 3 ? 0.8 : 0.12);
    g.fillEllipse(vrand(i) * worldW, groundY + 12 + vrand(i + 9) * (groundH - 14), 4 + vrand(i + 3) * 7, 3 + vrand(i + 5) * 4);
  }
  g.fillStyle(theme.grassDark, 1);
  g.fillRect(0, groundY - 2, worldW, 10);
  g.fillStyle(theme.grass, 1);
  g.fillRect(0, groundY - 2, worldW, 6);
  for (let x = 0, i = 0; x < worldW; i++, x += 5 + vrand(i) * 5) {
    const h = 5 + vrand(i + 17) * 9;
    g.fillStyle(i % 2 ? theme.grass : theme.grassDark, 1);
    g.fillTriangle(x, groundY + 2, x + 5, groundY + 2, x + 2 + vrand(i + 1) * 3, groundY - h);
  }
  return g;
}

// ------------------------------------------------------------------
// 도형 스킨 (블록/돼지/새)
// ------------------------------------------------------------------
// obj(물리 바디가 붙은 도형) 위에 스킨을 붙이고, 장면마다 한 번 sync를 걸어 둔다.
function addSkin(scene, obj, draw) {
  if (!scene.skinned) {
    scene.skinned = [];
    scene.events.on("postupdate", () => syncSkins(scene));
  }
  const g = scene.add.graphics().setDepth(obj.depth);
  obj.skin = g;
  obj.drawSkin = draw;
  draw(g, obj);
  g.setPosition(obj.x, obj.y).setRotation(obj.rotation);
  scene.skinned.push(obj);
  return g;
}

function redrawSkin(obj) {
  if (!obj.skin) return;
  obj.skin.clear();
  obj.drawSkin(obj.skin, obj);
}

function syncSkins(scene) {
  scene.skinned = scene.skinned.filter((o) => {
    if (!o.scene || !o.active) {
      o.skin.destroy();
      return false;
    }
    o.skin.setPosition(o.x, o.y).setRotation(o.rotation).setAlpha(o.alpha).setScale(o.scaleX, o.scaleY)
      .setVisible(o.visible);
    return true;
  });
  if (scene.bird && scene.anchor) updateSlingBands(scene);
}

function drawWoodSkin(g, w, h) {
  const hw = w / 2, hh = h / 2;
  g.fillStyle(0xc98a4b, 1);
  g.fillRect(-hw + 1, -hh + 1, w - 2, h - 2);
  g.fillStyle(0xe2aa6c, 1);
  g.fillRect(-hw + 2, -hh + 2, w - 4, Math.min(5, h * 0.18));
  g.fillStyle(0x9b622f, 1);
  g.fillRect(-hw + 2, hh - 2 - Math.min(5, h * 0.18), w - 4, Math.min(5, h * 0.18));
  // 나뭇결: 긴 방향으로 물결 선
  g.lineStyle(1.5, 0x8e5a2b, 0.7);
  const horizontal = w >= h;
  const len = horizontal ? w : h;
  const span = horizontal ? h : w;
  const lines = Math.max(2, Math.floor(span / 9));
  for (let k = 1; k < lines; k++) {
    const off = -span / 2 + (span * k) / lines;
    g.beginPath();
    for (let t = 0; t <= 8; t++) {
      const a = -len / 2 + 4 + ((len - 8) * t) / 8;
      const b = off + Math.sin(t * 1.3 + k * 2) * 1.6;
      if (t === 0) g.moveTo(horizontal ? a : b, horizontal ? b : a);
      else g.lineTo(horizontal ? a : b, horizontal ? b : a);
    }
    g.strokePath();
  }
  // 옹이와 못
  g.fillStyle(0x7a4a22, 0.8);
  g.fillEllipse(horizontal ? len * 0.18 : 0, horizontal ? 0 : len * 0.18, 7, 5);
  g.fillStyle(0x4a3a30, 1);
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sy]) => g.fillCircle(sx * (hw - 5), sy * (hh - 5), 1.6));
  g.lineStyle(2, 0x6e4520, 1);
  g.strokeRect(-hw + 1, -hh + 1, w - 2, h - 2);
}

function drawStoneSkin(g, w, h, cracked) {
  const hw = w / 2, hh = h / 2;
  g.fillStyle(0x8c929b, 1);
  g.fillRect(-hw + 1, -hh + 1, w - 2, h - 2);
  g.fillStyle(0xb9bec6, 1);
  g.fillRect(-hw + 2, -hh + 2, w - 4, 4);
  g.fillRect(-hw + 2, -hh + 2, 4, h - 4);
  g.fillStyle(0x5f646c, 1);
  g.fillRect(-hw + 2, hh - 6, w - 4, 4);
  g.fillRect(hw - 6, -hh + 2, 4, h - 4);
  for (let i = 0; i < (w * h) / 220; i++) {
    g.fillStyle(i % 2 ? 0x6d727a : 0xa4a9b1, 0.8);
    g.fillCircle(-hw + 7 + vrand(i + w) * (w - 14), -hh + 7 + vrand(i + h * 3) * (h - 14), 1 + vrand(i) * 1.5);
  }
  if (cracked) {
    g.lineStyle(2, 0x2d3036, 1);
    g.beginPath();
    g.moveTo(-hw * 0.7, -hh + 2);
    g.lineTo(-hw * 0.2, -hh * 0.1);
    g.lineTo(-hw * 0.35, hh * 0.35);
    g.lineTo(hw * 0.15, hh - 3);
    g.moveTo(-hw * 0.2, -hh * 0.1);
    g.lineTo(hw * 0.45, -hh * 0.3);
    g.lineTo(hw - 3, -hh * 0.05);
    g.strokePath();
  }
  g.lineStyle(2, 0x41454c, 1);
  g.strokeRect(-hw + 1, -hh + 1, w - 2, h - 2);
}

function drawRockSkin(g, w, h, theme) {
  const hw = w / 2, hh = h / 2;
  g.fillStyle(theme.rock, 1);
  g.fillRect(-hw, -hh, w, h);
  g.fillStyle(theme.rockDark, 1);
  for (let y = -hh + 26, k = 0; y < hh - 8; k++, y += 22 + vrand(k + w) * 16) {
    g.fillRect(-hw, y, w, 3);
  }
  for (let i = 0; i < (w * h) / 900; i++) {
    g.fillStyle(i % 2 ? theme.rockDark : 0xffffff, i % 2 ? 0.7 : 0.1);
    g.fillEllipse(-hw + vrand(i + h) * w, -hh + 12 + vrand(i + w) * (h - 16), 10 + vrand(i) * 14, 5 + vrand(i + 1) * 6);
  }
  g.fillStyle(0xffffff, 0.14);
  g.fillRect(-hw, -hh, 5, h);
  // 맨 위 잔디
  g.fillStyle(theme.grassDark, 1);
  g.fillRect(-hw - 2, -hh - 2, w + 4, 9);
  g.fillStyle(theme.grass, 1);
  g.fillRect(-hw - 2, -hh - 2, w + 4, 5);
  for (let x = -hw; x < hw; x += 7) {
    g.fillTriangle(x, -hh + 2, x + 5, -hh + 2, x + 2, -hh - 6 - vrand(x) * 4);
  }
}

function drawPigSkin(g, r, strokeColor, strokeW) {
  // 귀
  g.fillStyle(0x4f9a3a, 1);
  g.fillCircle(-r * 0.55, -r * 0.78, r * 0.26);
  g.fillCircle(r * 0.55, -r * 0.78, r * 0.26);
  g.fillStyle(0x8fd36e, 1);
  g.fillCircle(-r * 0.55, -r * 0.78, r * 0.13);
  g.fillCircle(r * 0.55, -r * 0.78, r * 0.13);
  // 얼굴
  g.fillStyle(strokeColor, 1);
  g.fillCircle(0, 0, r);
  g.fillStyle(0x67b84c, 1);
  g.fillCircle(0, 0, r - strokeW);
  g.fillStyle(0x86cf66, 1);
  g.fillEllipse(-r * 0.2, -r * 0.35, r * 1.1, r * 0.7);
  g.fillStyle(0xffffff, 0.35);
  g.fillEllipse(-r * 0.4, -r * 0.55, r * 0.35, r * 0.2);
  // 눈
  [-1, 1].forEach((s) => {
    g.fillStyle(0xffffff, 1);
    g.fillCircle(s * r * 0.38, -r * 0.12, r * 0.2);
    g.fillStyle(0x1d2b18, 1);
    g.fillCircle(s * r * 0.34, -r * 0.1, r * 0.09);
  });
  // 코
  g.fillStyle(0x9be07a, 1);
  g.fillEllipse(0, r * 0.3, r * 0.75, r * 0.5);
  g.lineStyle(1.5, 0x3f7f2c, 1);
  g.strokeEllipse(0, r * 0.3, r * 0.75, r * 0.5);
  g.fillStyle(0x2e5a20, 1);
  g.fillEllipse(-r * 0.14, r * 0.3, r * 0.12, r * 0.2);
  g.fillEllipse(r * 0.14, r * 0.3, r * 0.12, r * 0.2);
}

function drawBirdSkin(g, r) {
  // 꼬리 깃털
  g.fillStyle(0x2a1a1a, 1);
  g.fillTriangle(-r * 0.8, -r * 0.1, -r * 1.55, -r * 0.45, -r * 1.3, r * 0.05);
  g.fillTriangle(-r * 0.8, r * 0.1, -r * 1.5, r * 0.2, -r * 1.25, r * 0.45);
  // 머리 깃털
  g.fillStyle(0xc73a39, 1);
  g.fillEllipse(-r * 0.05, -r * 1.0, r * 0.28, r * 0.6);
  g.fillEllipse(r * 0.2, -r * 0.95, r * 0.24, r * 0.5);
  // 몸
  g.fillStyle(0x791f1f, 1);
  g.fillCircle(0, 0, r);
  g.fillStyle(0xe24b4a, 1);
  g.fillCircle(0, 0, r - 2);
  g.fillStyle(0xff7a6e, 1);
  g.fillEllipse(-r * 0.25, -r * 0.4, r * 1.0, r * 0.6);
  g.fillStyle(0xf3dcc0, 1);
  g.fillEllipse(r * 0.05, r * 0.5, r * 1.3, r * 0.75);
  // 눈 + 화난 눈썹
  [[0.18, 0.2], [0.55, 0.18]].forEach(([ex, er]) => {
    g.fillStyle(0xffffff, 1);
    g.fillCircle(r * ex, -r * 0.18, r * er);
    g.fillStyle(0x111111, 1);
    g.fillCircle(r * (ex + 0.06), -r * 0.15, r * 0.08);
  });
  g.lineStyle(r * 0.16, 0x1a1010, 1);
  g.lineBetween(-r * 0.05, -r * 0.48, r * 0.38, -r * 0.3);
  g.lineBetween(r * 0.36, -r * 0.3, r * 0.82, -r * 0.46);
  // 부리
  g.fillStyle(0xf2b630, 1);
  g.fillTriangle(r * 0.55, r * 0.02, r * 1.2, r * 0.18, r * 0.55, r * 0.32);
  g.fillStyle(0xc98a1c, 1);
  g.fillTriangle(r * 0.55, r * 0.2, r * 1.1, r * 0.22, r * 0.55, r * 0.34);
}

// 블록 종류에 맞는 스킨을 붙인다. b는 맵 데이터(크기, 종류), side는 요새전 돼지 테두리 색.
function skinBlock(scene, obj, b, theme, sideColor) {
  if (b.type === "rock") return addSkin(scene, obj, (g) => drawRockSkin(g, b.w, b.h, theme));
  if (b.type === "pig") return addSkin(scene, obj, (g) => drawPigSkin(g, b.w / 2, sideColor || 0x2f5e20, sideColor ? 3 : 2));
  if (b.type === "stone") {
    return addSkin(scene, obj, (g, o) => drawStoneSkin(g, b.w, b.h, o.getData && o.getData("hp") < 2));
  }
  return addSkin(scene, obj, (g) => drawWoodSkin(g, b.w, b.h));
}

function skinBird(scene, bird, r) {
  return addSkin(scene, bird, (g) => drawBirdSkin(g, r));
}

// ------------------------------------------------------------------
// 새총
// ------------------------------------------------------------------
const PRONG = 17; // 새총 가지 끝이 앵커에서 좌우로 떨어진 거리

// 새 뒤에 그려지는 부분(기둥 + 뒤쪽 가지). accent는 요새전에서 1P/2P 구분 색.
function drawSlingBack(scene, a, groundY, accent) {
  const g = scene.add.graphics().setDepth(2);
  g.fillStyle(0x000000, 0.25);
  g.fillEllipse(a.x, groundY + 2, 40, 8);
  g.fillStyle(0x6b4423, 1);
  g.fillRoundedRect(a.x - 7, a.y + 22, 14, groundY - a.y - 20, 4);
  g.fillStyle(0x8f5d32, 1);
  g.fillRect(a.x - 4, a.y + 24, 4, groundY - a.y - 24);
  g.lineStyle(10, 0x5e3a1d, 1);
  g.lineBetween(a.x, a.y + 28, a.x + PRONG, a.y - 6);
  g.fillStyle(0x5e3a1d, 1);
  g.fillCircle(a.x + PRONG, a.y - 6, 5);
  if (accent !== undefined) {
    g.fillStyle(accent, 1);
    g.fillRect(a.x - 7, a.y + 40, 14, 8);
  }
  return g;
}

// 새 앞에 그려지는 앞쪽 가지
function drawSlingFront(scene, a) {
  const g = scene.add.graphics().setDepth(4);
  g.lineStyle(10, 0x7a4b25, 1);
  g.lineBetween(a.x, a.y + 28, a.x - PRONG, a.y - 6);
  g.fillStyle(0x7a4b25, 1);
  g.fillCircle(a.x - PRONG, a.y - 6, 5);
  g.fillCircle(a.x, a.y + 28, 6);
  g.lineStyle(3, 0xa06a38, 1);
  g.lineBetween(a.x - 2, a.y + 24, a.x - PRONG + 1, a.y - 4);
  return g;
}

// 장면에 고무줄용 Graphics 두 개를 만든다(뒤 줄은 새보다 먼저, 앞 줄은 새보다 나중에 만들 것).
function createBands(scene) {
  scene.bandBack = scene.add.graphics().setDepth(2.5);
}
function createFrontBand(scene) {
  scene.bandFront = scene.add.graphics().setDepth(3.5);
}

// 매 프레임: 새가 새총에 걸려 있으면 두 가지 끝에서 새까지 고무줄을 당기고,
// 날아간 뒤에는 느슨하게 늘어진 줄만 그린다.
function updateSlingBands(scene) {
  if (!scene.bandBack || !scene.bandFront) return;
  const a = scene.anchor;
  const bird = scene.bird;
  const back = scene.bandBack.clear();
  const front = scene.bandFront.clear();
  const L = { x: a.x - PRONG, y: a.y - 6 };
  const R = { x: a.x + PRONG, y: a.y - 6 };
  const held = !scene.isFlying && Phaser.Math.Distance.Between(bird.x, bird.y, a.x, a.y) < MAX_PULL + 30;
  if (!held) {
    back.lineStyle(4, 0x3a2312, 1);
    back.beginPath();
    back.moveTo(R.x, R.y);
    back.lineTo(a.x, a.y + 4);
    back.lineTo(L.x, L.y);
    back.strokePath();
    return;
  }
  const dx = bird.x - a.x, dy = bird.y - a.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  const ux = d > 1 ? dx / d : -1, uy = d > 1 ? dy / d : 0;
  const width = Phaser.Math.Clamp(7 - (d / MAX_PULL) * 3, 4, 7);
  const pouch = { x: bird.x + ux * 14, y: bird.y + uy * 14 };
  back.lineStyle(width, 0x3a2312, 1);
  back.lineBetween(R.x, R.y, pouch.x, pouch.y);
  back.fillStyle(0x2a1a0e, 1);
  back.fillCircle(pouch.x, pouch.y, 8);
  front.lineStyle(width, 0x4a2c16, 1);
  front.lineBetween(L.x, L.y, pouch.x, pouch.y);
}

// ------------------------------------------------------------------
// 연출: 궤적, 파티클, 흔들림, 팝업
// ------------------------------------------------------------------
function createFx(scene) {
  const mk = (key, draw, w, h) => {
    if (scene.textures.exists(key)) return;
    const g = scene.make.graphics({ x: 0, y: 0, add: false });
    draw(g);
    g.generateTexture(key, w, h);
    g.destroy();
  };
  mk("fx-dot", (g) => { g.fillStyle(0xffffff, 1); g.fillCircle(16, 16, 16); }, 32, 32);
  mk("fx-chip", (g) => { g.fillStyle(0xffffff, 1); g.fillRect(0, 0, 24, 12); }, 24, 12);
  mk("fx-star", (g) => {
    g.fillStyle(0xffffff, 1);
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const rr = i % 2 ? 7 : 16;
      const ang = -Math.PI / 2 + (i * Math.PI) / 5;
      pts.push({ x: 16 + Math.cos(ang) * rr, y: 16 + Math.sin(ang) * rr });
    }
    g.fillPoints(pts, true);
  }, 32, 32);

  const emitter = (key, cfg) => scene.add.particles(0, 0, key, { emitting: false, ...cfg }).setDepth(6);
  scene.fx = {
    chips: emitter("fx-chip", {
      speed: { min: 140, max: 420 }, angle: { min: 200, max: 340 }, gravityY: 1100,
      lifespan: { min: 700, max: 1200 }, rotate: { start: 0, end: 540 }, scale: { start: 0.7, end: 0.3 },
      alpha: { start: 1, end: 0 },
    }),
    dust: emitter("fx-dot", {
      speed: { min: 30, max: 140 }, lifespan: { min: 500, max: 900 }, scale: { start: 0.35, end: 1.3 },
      alpha: { start: 0.55, end: 0 }, gravityY: -40,
    }),
    stars: emitter("fx-star", {
      speed: { min: 120, max: 300 }, lifespan: 650, scale: { start: 0.8, end: 0 }, rotate: { start: 0, end: 360 },
      tint: [0xfff27a, 0xffffff, 0xffc94a], blendMode: "ADD",
    }),
    confetti: emitter("fx-chip", {
      speed: { min: 200, max: 520 }, angle: { min: 230, max: 310 }, gravityY: 500, lifespan: 2600,
      rotate: { start: 0, end: 720 }, scale: { start: 0.6, end: 0.5 },
      tint: [0xff5a5f, 0xffd23f, 0x3ec7ff, 0x7bea6a, 0xc77dff, 0xffffff],
    }),
  };
  scene.trailGfx = scene.add.graphics().setDepth(2.4);
  scene.trailNext = 0;
}

const CHIP_TINT = {
  wood: [0xc98a4b, 0xa06a35, 0xe2aa6c],
  stone: [0x8c929b, 0x6d727a, 0xb9bec6],
  pig: [0x67b84c, 0x86cf66, 0x9be07a],
};

// 블록이 부서질 때
function breakFx(scene, obj, type) {
  if (!scene.fx) return;
  const n = type === "pig" ? 10 : Math.min(18, 6 + Math.round((obj.width * obj.height) / 600));
  scene.fx.chips.setParticleTint(0xffffff);
  CHIP_TINT[type].forEach((t, i) => {
    scene.fx.chips.setParticleTint(t);
    scene.fx.chips.explode(Math.ceil(n / 3), obj.x + (i - 1) * 6, obj.y);
  });
  scene.fx.dust.setParticleTint(type === "pig" ? 0xc6f5b0 : 0xf2eadf);
  scene.fx.dust.explode(type === "pig" ? 14 : 8, obj.x, obj.y);
  if (type === "pig") {
    scene.fx.stars.explode(10, obj.x, obj.y);
    ringFx(scene, obj.x, obj.y, 0xfff6a8);
    scene.cameras.main.shake(160, 0.004);
  }
}

function ringFx(scene, x, y, color) {
  const ring = scene.add.circle(x, y, 12).setStrokeStyle(5, color, 1).setDepth(6);
  scene.tweens.add({ targets: ring, scale: 5, alpha: 0, duration: 420, ease: "Cubic.easeOut", onComplete: () => ring.destroy() });
}

// 새가 세게 부딪혔을 때(연속으로 너무 자주 흔들리지 않게 간격을 둔다)
function hitFx(scene, x, y, speed) {
  if (!scene.fx || speed < 380 || scene.time.now - (scene.lastHitFx || 0) < 120) return;
  scene.lastHitFx = scene.time.now;
  scene.fx.dust.setParticleTint(0xffffff);
  scene.fx.dust.explode(6, x, y);
  if (speed > 700) {
    scene.fx.stars.explode(5, x, y);
    scene.cameras.main.shake(110, Math.min(0.008, speed / 200000));
  }
}

function launchFx(scene, x, y) {
  if (!scene.fx) return;
  scene.trailGfx.clear();
  scene.trailNext = 0;
  scene.fx.dust.setParticleTint(0xffffff);
  scene.fx.dust.explode(10, x, y);
}

// 날아가는 동안 새 뒤에 흰 점을 남긴다(다음 발사 전까지 남아 있어서 조준에 참고가 된다).
function trailFx(scene, bird, flightTime) {
  if (!scene.trailGfx || flightTime < scene.trailNext) return;
  const big = Math.floor(scene.trailNext / 45) % 3 === 0;
  scene.trailNext = flightTime + 45;
  scene.trailGfx.fillStyle(0xffffff, 0.85);
  scene.trailGfx.fillCircle(bird.x, bird.y, big ? 5 : 3);
}

function floatText(scene, x, y, text, color) {
  const t = scene.add.text(x, y, text, {
    fontSize: "26px", fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold",
    color, stroke: "#2a1a08", strokeThickness: 6,
  }).setOrigin(0.5).setDepth(7).setResolution(RES).setScale(0.4);
  scene.tweens.add({ targets: t, scale: 1, duration: 220, ease: "Back.easeOut" });
  scene.tweens.add({ targets: t, y: y - 70, alpha: 0, delay: 350, duration: 800, ease: "Cubic.easeIn", onComplete: () => t.destroy() });
}

function confettiFx(scene) {
  if (!scene.fx) return;
  const v = scene.cameras.main.worldView;
  for (let i = 0; i < 5; i++) {
    scene.time.delayedCall(i * 180, () => scene.fx.confetti.explode(28, v.x + v.width * (0.1 + i * 0.2), v.bottom - 20));
  }
}

// 결과 메시지가 튀어나오듯 등장
function popIn(scene, obj) {
  obj.setScale(0.3).setAlpha(0);
  scene.tweens.add({ targets: obj, scale: 1, alpha: 1, duration: 420, ease: "Back.easeOut" });
}

// 화면 고정 UI 글자 스타일
function hudStyle(size, extra) {
  return {
    fontSize: size + "px",
    fontFamily: "Malgun Gothic, sans-serif",
    fontStyle: "bold",
    color: "#ffffff",
    backgroundColor: "#0d1526b3",
    padding: { x: 10, y: 6 },
    shadow: { offsetX: 1, offsetY: 2, color: "#000000", blur: 3, fill: true },
    ...extra,
  };
}
