// 임시 테스트용 맵 데이터 2개.
// 좌표는 게임 캔버스(1200x700) 기준. y는 블록의 "중심" 좌표.
// type: 'wood'(약함, hp1) / 'stone'(강함, hp2) / 'pig'(목표물, 전부 파괴하면 승리)

const GROUND_Y = 660;

const MAPS = [
  // ---------------- 맵 1: 대형 피라미드 구조 ----------------
  {
    name: "맵 1 - 대형 피라미드",
    slingAnchor: { x: 180, y: GROUND_Y - 100 },
    birdCount: 4,
    blocks: [
      // 바닥 두 기둥 (더 두껍고 넓게 배치)
      { x: 850, y: GROUND_Y - 40, w: 44, h: 80, type: "wood" },
      { x: 1050, y: GROUND_Y - 40, w: 44, h: 80, type: "wood" },
      // 기둥 위 가로 지지대
      { x: 950, y: GROUND_Y - 97, w: 260, h: 34, type: "stone" },
      // 지지대 위 목표물(돼지)
      { x: 950, y: GROUND_Y - 142, w: 56, h: 56, type: "pig" },
    ],
  },

  // ---------------- 맵 2: 3단 트윈 타워 + 연결 다리 + 돼지 2개 ----------------
  {
    name: "맵 2 - 트윈 타워",
    slingAnchor: { x: 180, y: GROUND_Y - 100 },
    birdCount: 6,
    blocks: [
      // 왼쪽 타워 (돌 -> 나무 -> 돼지)
      { x: 720, y: GROUND_Y - 40, w: 46, h: 80, type: "stone" },
      { x: 720, y: GROUND_Y - 115, w: 42, h: 70, type: "wood" },
      { x: 720, y: GROUND_Y - 176, w: 54, h: 54, type: "pig" },

      // 오른쪽 타워 (돌 -> 나무 -> 돼지)
      { x: 1080, y: GROUND_Y - 40, w: 46, h: 80, type: "stone" },
      { x: 1080, y: GROUND_Y - 115, w: 42, h: 70, type: "wood" },
      { x: 1080, y: GROUND_Y - 176, w: 54, h: 54, type: "pig" },

      // 두 타워를 잇는 다리(파괴 시 돼지들이 무너지도록)
      { x: 900, y: GROUND_Y - 155, w: 380, h: 24, type: "wood" },
    ],
  },
];