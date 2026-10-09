"""
게임 맵 데이터.

맵 선택 화면(map_select)과 게임 화면(play)이 모두 이 목록을 쓴다.
게임 화면에서는 선택된 맵 하나를 json_script로 넘겨서 game.js가 읽는다.

좌표 규칙
- 월드 크기는 맵마다 width x height (화면에 보이는 크기는 항상 1200x700,
  그보다 큰 맵은 카메라가 따라가며 스크롤된다).
- 바닥 윗면의 y = height - 40.
- 블록의 x, y는 "중심" 좌표, w/h는 크기.
- type: 'wood'(약함, hp1) / 'stone'(강함, hp2) / 'pig'(목표물, 전부 파괴하면 승리)
        / 'rock'(움직이지 않고 부서지지 않는 지형)
- walls: 맵 양 끝(왼쪽/오른쪽)의 벽. 새와 블록이 맵 밖으로 나가지 못하게
  막는다. 화면 위쪽으로도 높이 솟아 있어서 높이 쏜 새도 넘어가지 못한다.
"""

GROUND_HEIGHT = 40
WALL_THICKNESS = 40
# 벽 꼭대기 y. 최대 발사 속도(2000)로 바로 위로 쏴도 꼭짓점이 y=-1300 정도라서
# 그보다 충분히 높게 둔다(화면에는 y=0 아래만 보인다).
WALL_TOP = -3000


def _ground(height):
    return height - GROUND_HEIGHT


def walls(width, height):
    """맵 왼쪽/오른쪽 끝의 벽 2개 (블록과 같은 중심 좌표 규칙)."""
    h = _ground(height) - WALL_TOP
    cy = WALL_TOP + h / 2
    half = WALL_THICKNESS / 2
    return [
        {"x": half, "y": cy, "w": WALL_THICKNESS, "h": h},
        {"x": width - half, "y": cy, "w": WALL_THICKNESS, "h": h},
    ]


# ---------------------------------------------------------------------------
# 연습 맵 (기존 1200x700 테스트 맵)
# ---------------------------------------------------------------------------
_G = _ground(700)

PRACTICE_MAPS = [
    {
        "id": "practice-1",
        "name": "연습 1 - 대형 피라미드",
        "description": "처음 해보는 사람을 위한 작은 맵입니다.",
        "difficulty": "연습",
        "width": 1200,
        "height": 700,
        "slingAnchor": {"x": 180, "y": _G - 100},
        "birdCount": 4,
        "maxLaunchSpeed": 1450,
        "blocks": [
            {"x": 850, "y": _G - 40, "w": 44, "h": 80, "type": "wood"},
            {"x": 1050, "y": _G - 40, "w": 44, "h": 80, "type": "wood"},
            {"x": 950, "y": _G - 97, "w": 260, "h": 34, "type": "stone"},
            {"x": 950, "y": _G - 142, "w": 56, "h": 56, "type": "pig"},
        ],
    },
    {
        "id": "practice-2",
        "name": "연습 2 - 트윈 타워",
        "description": "다리를 무너뜨려 돼지 두 마리를 잡으세요.",
        "difficulty": "연습",
        "width": 1200,
        "height": 700,
        "slingAnchor": {"x": 180, "y": _G - 100},
        "birdCount": 6,
        "maxLaunchSpeed": 1450,
        "blocks": [
            {"x": 720, "y": _G - 40, "w": 46, "h": 80, "type": "stone"},
            {"x": 720, "y": _G - 115, "w": 42, "h": 70, "type": "wood"},
            {"x": 1080, "y": _G - 40, "w": 46, "h": 80, "type": "stone"},
            {"x": 1080, "y": _G - 115, "w": 42, "h": 70, "type": "wood"},
            # 두 탑 위에 걸친 다리, 그 위 양 끝에 돼지
            {"x": 900, "y": _G - 162, "w": 380, "h": 24, "type": "wood"},
            {"x": 720, "y": _G - 201, "w": 54, "h": 54, "type": "pig"},
            {"x": 1080, "y": _G - 201, "w": 54, "h": 54, "type": "pig"},
        ],
    },
]


# ---------------------------------------------------------------------------
# 대형 맵 (연습 맵의 가로 3배 = 3600px, 세로 1.5배 = 1050px)
# ---------------------------------------------------------------------------
BIG_W = 3600
BIG_H = 1050
_B = _ground(BIG_H)  # 1010
BIG_SLING = {"x": 220, "y": _B - 110}
BIG_LAUNCH_SPEED = 2000  # 넓어진 맵 끝까지 닿도록 발사 속도 상한을 올림


def _hut(cx, base_y, pigs=1):
    """나무 기둥 2개 + 지붕 + 지붕 위 돼지. base_y는 받치는 면의 y."""
    blocks = [
        {"x": cx - 60, "y": base_y - 45, "w": 30, "h": 90, "type": "wood"},
        {"x": cx + 60, "y": base_y - 45, "w": 30, "h": 90, "type": "wood"},
        {"x": cx, "y": base_y - 102, "w": 170, "h": 24, "type": "wood"},
    ]
    if pigs:
        blocks.append({"x": cx, "y": base_y - 140, "w": 52, "h": 52, "type": "pig"})
    return blocks


def _stone_tower(cx, base_y):
    """돌 기둥 2개 + 돌 지붕 + 돼지 (튼튼한 버전)."""
    return [
        {"x": cx - 55, "y": base_y - 50, "w": 40, "h": 100, "type": "stone"},
        {"x": cx + 55, "y": base_y - 50, "w": 40, "h": 100, "type": "stone"},
        {"x": cx, "y": base_y - 115, "w": 180, "h": 30, "type": "stone"},
        {"x": cx, "y": base_y - 157, "w": 54, "h": 54, "type": "pig"},
    ]


def _rock(cx, top_y, w, base_y):
    """바닥(base_y)부터 top_y까지 솟은 고정 지형."""
    h = base_y - top_y
    return {"x": cx, "y": top_y + h / 2, "w": w, "h": h, "type": "rock"}


BIG_MAPS = [
    # ---------------- 맵 1: 넓은 초원에 흩어진 오두막 3채 ----------------
    {
        "id": "meadow",
        "name": "초원 마을",
        "description": "멀리 흩어진 오두막 3채. 거리 감각을 익히기 좋은 맵입니다.",
        "difficulty": "쉬움",
        "blocks": _hut(1500, _B) + _hut(2350, _B) + _hut(3150, _B),
        "birdCount": 6,
    },
    # ---------------- 맵 2: 높이가 다른 바위 고원 위의 탑 ----------------
    {
        "id": "canyon",
        "name": "바위 협곡",
        "description": "높이가 다른 바위 고원 위에 돌탑이 서 있습니다. 포물선으로 넘겨 치세요.",
        "difficulty": "보통",
        "blocks": (
            [_rock(1700, _B - 160, 360, _B)]
            + _stone_tower(1700, _B - 160)
            + _hut(2400, _B)
            + [_rock(3100, _B - 300, 340, _B)]
            + _stone_tower(3100, _B - 300)
        ),
        "birdCount": 6,
    },
    # ---------------- 맵 3: 바위 벽 너머 절벽 위의 성 ----------------
    {
        "id": "cliff",
        "name": "절벽 위의 성",
        "description": "바위 벽이 앞을 막고 있고, 성은 높은 절벽 위에 있습니다.",
        "difficulty": "어려움",
        "blocks": (
            [_rock(1400, _B - 380, 90, _B)]
            + _hut(1900, _B)
            + [_rock(2850, _B - 420, 520, _B)]
            + [
                # 절벽 위 성: 돌 벽 두 개 사이에 나무 2층 + 돼지 2마리
                {"x": 2650, "y": _B - 420 - 85, "w": 40, "h": 170, "type": "stone"},
                {"x": 3050, "y": _B - 420 - 85, "w": 40, "h": 170, "type": "stone"},
                {"x": 2780, "y": _B - 420 - 40, "w": 30, "h": 80, "type": "wood"},
                {"x": 2920, "y": _B - 420 - 40, "w": 30, "h": 80, "type": "wood"},
                {"x": 2850, "y": _B - 420 - 92, "w": 200, "h": 24, "type": "wood"},
                {"x": 2850, "y": _B - 420 - 130, "w": 52, "h": 52, "type": "pig"},
                {"x": 2850, "y": _B - 420 - 26, "w": 52, "h": 52, "type": "pig"},
                {"x": 2850, "y": _B - 420 - 183, "w": 440, "h": 26, "type": "stone"},
            ]
        ),
        "birdCount": 7,
    },
    # ---------------- 맵 4: 돼지 4마리가 숨은 대형 요새 ----------------
    {
        "id": "fortress",
        "name": "최종 요새",
        "description": "돌벽으로 둘러싼 2층 요새에 돼지 4마리. 새를 아껴 쓰세요.",
        "difficulty": "매우 어려움",
        "blocks": (
            _stone_tower(1600, _B)
            + [
                # 바깥 돌벽
                {"x": 2300, "y": _B - 80, "w": 50, "h": 160, "type": "stone"},
                {"x": 3300, "y": _B - 80, "w": 50, "h": 160, "type": "stone"},
                # 1층 기둥과 바닥판
                {"x": 2550, "y": _B - 60, "w": 36, "h": 120, "type": "wood"},
                {"x": 2800, "y": _B - 60, "w": 36, "h": 120, "type": "stone"},
                {"x": 3050, "y": _B - 60, "w": 36, "h": 120, "type": "wood"},
                {"x": 2675, "y": _B - 26, "w": 52, "h": 52, "type": "pig"},
                {"x": 2925, "y": _B - 26, "w": 52, "h": 52, "type": "pig"},
                {"x": 2800, "y": _B - 135, "w": 560, "h": 30, "type": "stone"},
                # 2층
                {"x": 2600, "y": _B - 150 - 45, "w": 30, "h": 90, "type": "wood"},
                {"x": 3000, "y": _B - 150 - 45, "w": 30, "h": 90, "type": "wood"},
                {"x": 2800, "y": _B - 150 - 26, "w": 52, "h": 52, "type": "pig"},
                {"x": 2800, "y": _B - 150 - 102, "w": 460, "h": 24, "type": "wood"},
            ]
        ),
        "birdCount": 8,
    },
]

for _m in BIG_MAPS:
    _m.update(
        width=BIG_W,
        height=BIG_H,
        slingAnchor=BIG_SLING,
        maxLaunchSpeed=BIG_LAUNCH_SPEED,
    )

MAPS = BIG_MAPS + PRACTICE_MAPS
for _m in MAPS:
    _m["walls"] = walls(_m["width"], _m["height"])
MAPS_BY_ID = {m["id"]: m for m in MAPS}


def pig_count(map_data):
    return sum(1 for b in map_data["blocks"] if b["type"] == "pig")
