"""
1대1 요새전 맵 데이터.

맵 양 끝에 각자의 새총과 요새가 있고, 번갈아 쏴서 상대 요새의 돼지를
먼저 모두 쓰러뜨리면 이긴다. 왼쪽이 1P, 오른쪽이 2P이고 2P 쪽은 1P 쪽을
좌우 반전해서 만든다(완전히 공평한 대칭 맵).

블록마다 "side"가 붙는다: 1 = 1P 요새, 2 = 2P 요새, 0 = 가운데 지형.
블록의 "id"는 동기화할 때 같은 블록을 가리키는 번호다.
"""

from game.maps import BIG_H, BIG_LAUNCH_SPEED, BIG_W, _B, _hut, _rock, _stone_tower


def _left_fortress():
    return (
        _stone_tower(300, _B)
        + _hut(570, _B)
        + [
            # 두 건물 사이 바닥에 숨은 돼지
            {"x": 435, "y": _B - 26, "w": 52, "h": 52, "type": "pig"},
            # 새총 쪽(상대가 쏘아 오는 쪽)을 막는 앞 벽
            {"x": 720, "y": _B - 70, "w": 40, "h": 140, "type": "stone"},
            {"x": 720, "y": _B - 175, "w": 30, "h": 70, "type": "wood"},
        ]
    )


def _mirror(block):
    return {**block, "x": BIG_W - block["x"]}


def _build_blocks():
    left = [{**b, "side": 1} for b in _left_fortress()]
    right = [{**_mirror(b), "side": 2} for b in _left_fortress()]
    middle = [{**_rock(BIG_W / 2, _B - 260, 200, _B), "side": 0}]
    blocks = left + middle + right
    return [{**b, "id": i} for i, b in enumerate(blocks)]


BATTLE_MAP = {
    "id": "duel",
    "name": "요새 맞대결",
    "width": BIG_W,
    "height": BIG_H,
    "maxLaunchSpeed": BIG_LAUNCH_SPEED,
    "birdCount": 6,
    "slings": {
        "1": {"x": 900, "y": _B - 110},
        "2": {"x": BIG_W - 900, "y": _B - 110},
    },
    "blocks": _build_blocks(),
}


def pigs_by_side(blocks):
    counts = {1: 0, 2: 0}
    for b in blocks:
        if b["type"] == "pig" and b.get("side") in counts:
            counts[b["side"]] += 1
    return counts
