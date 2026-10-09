// ------------------------------------------------------------------
// 솔로(game.js)와 1대1 요새전(battle.js)이 같이 쓰는 물리 설정.
//
// Phaser에 들어 있는 Matter.js를 쓴다. Arcade Physics는 상자가 회전하지 않아서
// 블록이 넘어지거나 굴러떨어지지 않았는데, Matter는 블록이 회전하고 무게(밀도),
// 마찰, 탄성이 있어서 기둥이 넘어지고 지붕이 미끄러지는 등 실제처럼 무너진다.
//
// 단위: 게임 코드는 계속 px, px/s를 쓰고, Matter로 넘길 때만 바꾼다.
//   - Matter 속도는 "1/60초당 px" → px/s ÷ 60
//   - Matter 중력은 gravity.y × 0.001 px/ms² → 950px/s²이면 0.95
// ------------------------------------------------------------------

const GRAVITY = 950;              // px/s² (조준 궤적 미리보기도 이 값으로 그린다)
const PHYSICS_STEP_MS = 1000 / 120; // 물리 1스텝 = 1/120초. 빠른 새가 얇은 블록을 뚫지 않게 촘촘히 계산
const MAX_STEPS_PER_FRAME = 8;    // 탭이 잠깐 멈췄다 돌아와도 한꺼번에 너무 많이 계산하지 않게
const MATTER_SPEED = 60;          // px/s ↔ Matter 속도 변환 비율

// 블록 재질. density는 면적당 무게(돌이 나무보다 2.5배 무겁다),
// friction/frictionStatic은 미끄러짐, restitution은 튕기는 정도.
const MATERIALS = {
  wood: { density: 0.0016, friction: 0.7, frictionStatic: 1.0, restitution: 0.08 },
  stone: { density: 0.004, friction: 0.8, frictionStatic: 1.2, restitution: 0.04 },
  pig: { density: 0.0012, friction: 0.6, frictionStatic: 0.8, restitution: 0.2, frictionAir: 0.004 },
  bird: { density: 0.006, friction: 0.5, frictionStatic: 0.6, restitution: 0.35, frictionAir: 0.0004 },
  ground: { friction: 0.9, frictionStatic: 1.2, restitution: 0.05 },
};

// 부딪힐 때(서로 가까워지는 속도, px/s) 이 이상이면 hp가 1 깎인다.
// 새는 약하게 스쳐도 데미지(이전과 같은 값), 블록끼리/바닥에 떨어진 경우는
// 꽤 세게 부딪혀야 한다. 돼지는 약해서 지붕에서 떨어지거나(약 110px 낙하 ≈ 460px/s)
// 기울어진 판자에서 미끄러져 떨어져도 죽는다.
const BIRD_DAMAGE_SPEED = 90;
const BIRD_HEAVY_DAMAGE_SPEED = 900; // 아주 세게 맞히면 돌도 한 번에 부서진다(hp 2 깎임)
const FALL_DAMAGE_SPEED = { pig: 180, wood: 450, stone: 650 };

function matterPhysicsConfig() {
  return {
    default: "matter",
    matter: {
      gravity: { x: 0, y: GRAVITY / 1000 },
      enableSleeping: true, // 멈춘 블록은 잠들어서 쌓인 탑이 떨리지 않는다(부딪히면 깨어난다)
      positionIterations: 10,
      velocityIterations: 8,
      autoUpdate: false, // stepPhysics()가 고정 간격으로 직접 계산한다
      debug: false,
    },
  };
}

// 장면 update()에서 매 프레임 부른다. 화면 프레임레이트와 상관없이 항상 같은
// 간격(1/120초)으로 계산해서 결과가 일정하고, 빠른 물체도 덜 뚫고 지나간다.
function stepPhysics(scene, delta) {
  scene.physicsAccum = Math.min((scene.physicsAccum || 0) + delta, PHYSICS_STEP_MS * MAX_STEPS_PER_FRAME);
  while (scene.physicsAccum >= PHYSICS_STEP_MS) {
    scene.matter.world.step(PHYSICS_STEP_MS);
    scene.physicsAccum -= PHYSICS_STEP_MS;
  }
}

// 바닥, 바위처럼 움직이지 않는 상자. visual이 있으면 그 도형에 물리 바디를 붙인다.
function addStaticBox(scene, x, y, w, h, visual) {
  const opts = { isStatic: true, ...MATERIALS.ground };
  if (visual) return scene.matter.add.gameObject(visual, { shape: { type: "rectangle", width: w, height: h }, ...opts });
  return scene.matter.add.rectangle(x, y, w, h, opts);
}

// 맵 양 끝의 보이지 않는 벽. 안쪽 면은 맵 데이터 그대로 두고, 물리 바디만 바깥쪽으로
// 두껍게 만들어서 블록이 한꺼번에 밀려와도 벽을 뚫고 나가지 못하게 한다.
// 돌려주는 값: 벽 안쪽 면의 x (innerL, innerR)
function addEndWalls(scene, walls, worldW) {
  const sorted = [...(walls || [])].sort((a, b) => a.x - b.x);
  const EXTRA = 400;
  sorted.forEach((w, i) => {
    const outward = i === 0 ? -1 : 1;
    addStaticBox(scene, w.x + (outward * EXTRA) / 2, w.y, w.w + EXTRA, w.h);
  });
  return {
    innerL: sorted.length ? sorted[0].x + sorted[0].w / 2 : 0,
    innerR: sorted.length ? sorted[sorted.length - 1].x - sorted[sorted.length - 1].w / 2 : worldW,
  };
}

// 블록/돼지 도형(obj)에 재질에 맞는 물리 바디를 붙인다. 돼지는 원, 나머지는 상자.
// 처음에는 잠든 상태로 둬서 맵이 만든 그대로 서 있다가, 무언가 부딪히면 깨어난다.
function attachBlockBody(scene, obj, b, angle) {
  const shape = b.type === "pig" ? { type: "circle", radius: b.w / 2 } : { type: "rectangle", width: b.w, height: b.h };
  scene.matter.add.gameObject(obj, { shape, ...MATERIALS[b.type] || MATERIALS.wood, sleepThreshold: 30 });
  if (angle) obj.setRotation(angle);
  obj.setToSleep();
  return obj;
}

function addBirdBody(scene, bird, radius) {
  scene.matter.add.gameObject(bird, { shape: { type: "circle", radius }, ...MATERIALS.bird });
  holdBird(bird);
  return bird;
}

// 새총에 걸려 있는 동안: 중력도 받지 않고 다른 물체와 부딪히지도 않는다.
function holdBird(bird) {
  bird.setStatic(true);
  bird.setSensor(true);
  bird.setRotation(0);
}

function releaseBird(bird, vx, vy) {
  bird.setSensor(false);
  bird.setStatic(false);
  bird.setAwake(); // 지난번에 멈춰서 잠든 채로 남아 있으면 날아가지 않는다
  bird.setVelocity(vx / MATTER_SPEED, vy / MATTER_SPEED);
  bird.setAngularVelocity(0);
}

function bodySpeed(body) {
  return Phaser.Physics.Matter.Matter.Body.getSpeed(body) * MATTER_SPEED; // px/s
}

function bodyAngularSpeed(body) {
  return Math.abs(Phaser.Physics.Matter.Matter.Body.getAngularVelocity(body)) * MATTER_SPEED; // rad/s
}

// 굴러가는 물체의 가로 속도와 회전을 k배로 줄인다.
function dampRolling(obj, k) {
  const Body = Phaser.Physics.Matter.Matter.Body;
  const v = Body.getVelocity(obj.body);
  Body.setVelocity(obj.body, { x: v.x * k, y: v.y });
  Body.setAngularVelocity(obj.body, Body.getAngularVelocity(obj.body) * k);
}

// 두 바디가 부딪힌 순간 서로 가까워지던 속도(px/s, 충돌면에 수직인 성분)
function impactSpeed(pair) {
  const Body = Phaser.Physics.Matter.Matter.Body;
  const a = Body.getVelocity(pair.bodyA);
  const b = Body.getVelocity(pair.bodyB);
  const n = pair.collision.normal;
  return Math.abs((a.x - b.x) * n.x + (a.y - b.y) * n.y) * MATTER_SPEED;
}

// 블록 하나가 이번 충돌로 잃는 hp. byBird: 부딪힌 상대가 새인지
function impactDamage(type, speed, byBird) {
  if (byBird) {
    if (speed >= BIRD_HEAVY_DAMAGE_SPEED) return 2;
    return speed >= BIRD_DAMAGE_SPEED ? 1 : 0;
  }
  return speed >= (FALL_DAMAGE_SPEED[type] || Infinity) ? 1 : 0;
}

// Phaser 게임오브젝트를 찾을 때: 원/상자 바디는 parent가 자기 자신이다.
function pairObjects(pair) {
  const a = pair.bodyA.gameObject || (pair.bodyA.parent && pair.bodyA.parent.gameObject);
  const b = pair.bodyB.gameObject || (pair.bodyB.parent && pair.bodyB.parent.gameObject);
  return [a || null, b || null];
}

// 블록이 부서지면 그 위에서 잠들어 있던 블록이 공중에 떠 있지 않도록 모두 깨운다.
function wakeAll(objs) {
  objs.forEach((o) => { if (o.body) o.setAwake(); });
}

// 부서진 블록: 물리에서는 바로 빼고, 사라지는 연출(tween)이 끝나면 지운다.
function removeBlockWithFade(scene, block) {
  block.setData("dead", true);
  scene.matter.world.remove(block.body);
  scene.tweens.add({
    targets: block,
    alpha: 0,
    duration: 150,
    onComplete: () => block.destroy(),
  });
}
