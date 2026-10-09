"""
1대1 요새전 방(room) 상태와 규칙.

방 상태는 서버 프로세스 메모리에만 있다(재시작하면 사라짐). Channels의
InMemoryChannelLayer와 마찬가지로 서버 프로세스가 하나일 때만 맞게 동작한다.

물리 계산은 브라우저(Phaser Arcade)가 한다. Arcade 물리는 두 브라우저에서
결과가 똑같이 나온다는 보장이 없어서, "쏜 사람" 브라우저의 결과를 기준으로 삼는다.
  1. 차례인 사람이 쏘면(shot) 서버가 발사 속도를 두 사람에게 똑같이 전달한다.
  2. 쏜 사람 화면에서 새와 블록이 멈추면 남은 블록 상태(settle)를 서버로 보낸다.
  3. 서버는 그 상태로 남은 돼지를 세고, 상대에게 그대로 전달(sync)한 뒤
     승패를 판정하거나 차례를 넘긴다.
"""

import math
import secrets
import threading
import time

from .maps import BATTLE_MAP, pigs_by_side

PHASE_WAITING = "waiting"
PHASE_PLAYING = "playing"
PHASE_OVER = "over"

CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # 헷갈리는 0/O, 1/I 제외
CODE_LENGTH = 5
STALE_ROOM_SECONDS = 10 * 60  # 아무도 접속하지 않은 방은 10분 뒤 정리

_BLOCKS_BY_ID = {b["id"]: b for b in BATTLE_MAP["blocks"]}
_MAX_COORD = 10000


class Player:
    def __init__(self, user_id, name):
        self.user_id = user_id
        self.name = name
        self.connected = False
        self.channel = None


class Room:
    def __init__(self, code, owner_id, owner_name):
        self.code = code
        self.created_at = time.time()
        self.phase = PHASE_WAITING
        self.players = {1: Player(owner_id, owner_name), 2: None}
        self.turn = 1
        self.shooting = False
        self.shot_id = 0
        self.shots = {1: BATTLE_MAP["birdCount"], 2: BATTLE_MAP["birdCount"]}
        self.blocks = [_public_block(b) for b in BATTLE_MAP["blocks"] if b["type"] != "rock"]
        self.pigs = pigs_by_side(BATTLE_MAP["blocks"])
        self.winner = None  # 1 | 2 | None(무승부 또는 진행 중)
        self.reason = ""
        self.recorded = False
        self.timers = {}  # 서버(consumer)가 쓰는 asyncio 작업 보관용

    # ---------------- 입장 ----------------
    def slot_of(self, user_id):
        for slot, p in self.players.items():
            if p and p.user_id == user_id:
                return slot
        return None

    def join(self, user_id, name):
        """이미 들어온 사람은 원래 자리, 새로 온 사람은 빈 2P 자리. 자리가 없으면 None."""
        slot = self.slot_of(user_id)
        if slot:
            return slot
        if self.phase == PHASE_WAITING and self.players[2] is None:
            self.players[2] = Player(user_id, name)
            return 2
        return None

    def connected_count(self):
        return sum(1 for p in self.players.values() if p and p.connected)

    def start_if_ready(self):
        if self.phase == PHASE_WAITING and self.connected_count() == 2:
            self.phase = PHASE_PLAYING
            self.turn = 1
            return True
        return False

    # ---------------- 발사 / 결과 ----------------
    def shoot(self, slot, vx, vy):
        """차례인 사람의 발사를 받는다. 받아들인 경우 (vx, vy)를, 아니면 None을 돌려준다."""
        if self.phase != PHASE_PLAYING or self.shooting or slot != self.turn:
            return None
        if self.shots[slot] <= 0:
            return None
        try:
            vx, vy = float(vx), float(vy)
        except (TypeError, ValueError):
            return None
        if not (math.isfinite(vx) and math.isfinite(vy)):
            return None
        # 최대 발사 속도를 넘으면 같은 방향으로 줄인다.
        speed = math.hypot(vx, vy)
        limit = BATTLE_MAP["maxLaunchSpeed"]
        if speed > limit:
            vx, vy = vx * limit / speed, vy * limit / speed
        self.shots[slot] -= 1
        self.shooting = True
        self.shot_id += 1
        return round(vx, 2), round(vy, 2)

    def settle(self, slot, blocks):
        """쏜 사람이 보낸, 멈춘 뒤의 블록 상태를 받는다. 받아들이면 True."""
        if self.phase != PHASE_PLAYING or not self.shooting or slot != self.turn:
            return False
        cleaned = _clean_blocks(blocks)
        if cleaned is None:
            return False
        self.blocks = cleaned
        self.pigs = pigs_by_side([_BLOCKS_BY_ID[b["id"]] for b in cleaned])
        self.shooting = False
        self._after_shot()
        return True

    def cancel_shot(self):
        """쏜 사람이 결과를 보내지 못했을 때(연결 끊김, 시간 초과): 블록은 그대로 두고 차례만 넘긴다."""
        if self.phase != PHASE_PLAYING or not self.shooting:
            return False
        self.shooting = False
        self._after_shot()
        return True

    def _after_shot(self):
        p1, p2 = self.pigs[1], self.pigs[2]
        if p1 == 0 or p2 == 0:
            self._finish(None if p1 == p2 else (1 if p1 > 0 else 2), "all_pigs")
        elif self.shots[1] <= 0 and self.shots[2] <= 0:
            self._finish(None if p1 == p2 else (1 if p1 > p2 else 2), "out_of_birds")
        else:
            other = 2 if self.turn == 1 else 1
            # 상대가 새를 다 썼으면 남은 사람이 계속 쏜다.
            if self.shots[other] > 0:
                self.turn = other

    def forfeit(self, slot, reason="left"):
        if self.phase != PHASE_PLAYING:
            return False
        self.shooting = False
        self._finish(2 if slot == 1 else 1, reason)
        return True

    def _finish(self, winner, reason):
        self.phase = PHASE_OVER
        self.winner = winner
        self.reason = reason

    # ---------------- 화면에 보낼 상태 ----------------
    def public_state(self):
        return {
            "type": "state",
            "code": self.code,
            "phase": self.phase,
            "players": {
                str(slot): (
                    {"name": p.name, "connected": p.connected} if p else None
                )
                for slot, p in self.players.items()
            },
            "turn": self.turn,
            "shooting": self.shooting,
            "shots": {"1": self.shots[1], "2": self.shots[2]},
            "pigs": {"1": self.pigs[1], "2": self.pigs[2]},
            "winner": self.winner,
            "reason": self.reason,
        }


def _public_block(b):
    return {"id": b["id"], "x": b["x"], "y": b["y"], "hp": 2 if b["type"] == "stone" else 1}


def _clean_blocks(blocks):
    """브라우저가 보낸 블록 목록을 검사해서 정리한다. 이상하면 None."""
    if not isinstance(blocks, list) or len(blocks) > len(_BLOCKS_BY_ID):
        return None
    cleaned = []
    seen = set()
    for item in blocks:
        if not isinstance(item, dict):
            return None
        try:
            bid = int(item["id"])
            x = float(item["x"])
            y = float(item["y"])
            hp = int(item["hp"])
        except (KeyError, TypeError, ValueError):
            return None
        src = _BLOCKS_BY_ID.get(bid)
        if src is None or src["type"] == "rock" or bid in seen:
            return None
        if not (math.isfinite(x) and math.isfinite(y)) or abs(x) > _MAX_COORD or abs(y) > _MAX_COORD:
            return None
        if hp <= 0:
            continue
        seen.add(bid)
        max_hp = 2 if src["type"] == "stone" else 1
        cleaned.append({"id": bid, "x": round(x, 1), "y": round(y, 1), "hp": min(hp, max_hp)})
    return cleaned


# ---------------------------------------------------------------------------
# 방 목록 (서버 메모리)
# ---------------------------------------------------------------------------
ROOMS = {}
_lock = threading.Lock()


def create_room(user_id, name):
    with _lock:
        _prune_locked()
        while True:
            code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))
            if code not in ROOMS:
                break
        room = Room(code, user_id, name)
        ROOMS[code] = room
        return room


def get_room(code):
    return ROOMS.get((code or "").upper())


def remove_room(code):
    with _lock:
        ROOMS.pop(code, None)


def open_rooms():
    """로비에 보여줄, 상대를 기다리는 방 목록."""
    with _lock:
        _prune_locked()
        return [
            r
            for r in ROOMS.values()
            if r.phase == PHASE_WAITING and r.players[2] is None and r.connected_count() > 0
        ]


def _prune_locked():
    now = time.time()
    for code in [
        c for c, r in ROOMS.items()
        if r.connected_count() == 0 and now - r.created_at > STALE_ROOM_SECONDS
    ]:
        del ROOMS[code]
