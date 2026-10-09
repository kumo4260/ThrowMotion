"""
요새전 WebSocket 서버 (Django Channels).

브라우저 → 서버 메시지
  {"type": "shot", "vx": .., "vy": ..}        내 차례에 발사
  {"type": "settle", "blocks": [...]}          내가 쏜 새와 블록이 멈춘 뒤의 블록 상태

서버 → 브라우저 메시지
  {"type": "hello", "slot": 1|2}               내 자리(1P/2P)
  {"type": "state", ...}                        방 상태(Room.public_state)
  {"type": "shot", "slot", "vx", "vy"}         누군가 발사함 → 두 화면 모두 같은 속도로 날림
  {"type": "sync", "from", "blocks"}           쏜 사람 화면 기준 블록 상태 → 상대 화면이 맞춘다
  {"type": "error", "message"}                  입장 실패 등
"""

import asyncio

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from channels.layers import get_channel_layer

from matches.models import Match

from . import rooms
from .maps import BATTLE_MAP

# 게임 중 연결이 끊기면 이 시간(초) 안에 다시 들어와야 한다. 아니면 기권패.
RECONNECT_GRACE_SECONDS = 20
# 쏜 사람이 이 시간(초) 안에 결과를 못 보내면(탭을 숨겨 물리가 멈춘 경우 등) 차례를 넘긴다.
SETTLE_TIMEOUT_SECONDS = 25
# 모두 나간 방을 지우기까지 기다리는 시간(초)
EMPTY_ROOM_SECONDS = 30


def _group(code):
    return f"battle_{code}"


async def _broadcast(code, payload):
    await get_channel_layer().group_send(_group(code), {"type": "room.message", "payload": payload})


def _cancel_timer(room, key):
    task = room.timers.pop(key, None)
    # 타이머 안에서 게임이 끝나 자기 자신을 지우는 경우에는 취소하지 않는다.
    if task and not task.done() and task is not asyncio.current_task():
        task.cancel()


def _start_timer(room, key, coro):
    _cancel_timer(room, key)
    room.timers[key] = asyncio.ensure_future(coro)


@database_sync_to_async
def _record(room):
    """게임이 끝나면 두 사람의 전적에 승/패를 저장한다. 무승부는 저장하지 않는다."""
    if room.recorded or room.winner is None:
        return
    room.recorded = True
    for slot, player in room.players.items():
        other = room.players[2 if slot == 1 else 1]
        Match.objects.create(
            user_id=player.user_id,
            result=Match.RESULT_WIN if slot == room.winner else Match.RESULT_LOSE,
            map_name=f"요새전 vs {other.name if other else '?'}"[:100],
            shots_used=BATTLE_MAP["birdCount"] - room.shots[slot],
        )


async def _finish_if_over(room):
    if room.phase == rooms.PHASE_OVER:
        for key in list(room.timers):
            if key != "cleanup":
                _cancel_timer(room, key)
        await _record(room)


async def _forfeit_later(room, slot):
    await asyncio.sleep(RECONNECT_GRACE_SECONDS)
    player = room.players[slot]
    if player and not player.connected and room.forfeit(slot, "left"):
        await _finish_if_over(room)
        await _broadcast(room.code, room.public_state())


async def _settle_timeout(room, shot_id):
    await asyncio.sleep(SETTLE_TIMEOUT_SECONDS)
    if room.shooting and room.shot_id == shot_id and room.cancel_shot():
        await _finish_if_over(room)
        await _broadcast(room.code, room.public_state())


async def _cleanup_later(room):
    await asyncio.sleep(EMPTY_ROOM_SECONDS)
    if room.connected_count() == 0:
        rooms.remove_room(room.code)


class BattleConsumer(AsyncJsonWebsocketConsumer):
    room = None
    slot = None

    async def connect(self):
        user = self.scope.get("user")
        await self.accept()
        if not user or not user.is_authenticated:
            await self._reject("로그인이 필요합니다.")
            return

        room = rooms.get_room(self.scope["url_route"]["kwargs"]["code"])
        if room is None:
            await self._reject("없는 방이거나 이미 끝난 방입니다.")
            return
        slot = room.join(user.id, user.username)
        if slot is None:
            await self._reject("방이 가득 찼습니다.")
            return

        player = room.players[slot]
        # 같은 사람이 새 탭으로 다시 들어오면 예전 연결은 내보낸다.
        if player.channel and player.channel != self.channel_name:
            await self.channel_layer.send(player.channel, {"type": "room.kick"})
        player.channel = self.channel_name
        player.connected = True
        self.room, self.slot = room, slot
        _cancel_timer(room, f"forfeit{slot}")
        _cancel_timer(room, "cleanup")

        await self.channel_layer.group_add(_group(room.code), self.channel_name)
        await self.send_json({"type": "hello", "slot": slot})
        if room.phase != rooms.PHASE_WAITING:
            # 다시 접속한 경우: 지금 블록 상태부터 맞춘다.
            await self.send_json({"type": "sync", "from": 0, "blocks": room.blocks})
        room.start_if_ready()
        await _broadcast(room.code, room.public_state())

    async def disconnect(self, code):
        room, slot = self.room, self.slot
        if room is None:
            return
        await self.channel_layer.group_discard(_group(room.code), self.channel_name)
        player = room.players[slot]
        if player.channel != self.channel_name:
            return  # 새 탭으로 바뀐 예전 연결
        player.connected = False
        player.channel = None

        if room.phase == rooms.PHASE_PLAYING:
            if room.shooting and room.turn == slot:
                room.cancel_shot()
                await _finish_if_over(room)
            if room.phase == rooms.PHASE_PLAYING:
                _start_timer(room, f"forfeit{slot}", _forfeit_later(room, slot))
        elif room.phase == rooms.PHASE_WAITING and slot == 2:
            room.players[2] = None  # 대기 중에 나간 2P는 자리를 비워 준다.

        if room.connected_count() == 0:
            _start_timer(room, "cleanup", _cleanup_later(room))
        await _broadcast(room.code, room.public_state())

    async def receive_json(self, content, **kwargs):
        room, slot = self.room, self.slot
        if room is None or not isinstance(content, dict):
            return
        kind = content.get("type")
        if kind == "shot":
            velocity = room.shoot(slot, content.get("vx"), content.get("vy"))
            if velocity is None:
                return
            _start_timer(room, "settle", _settle_timeout(room, room.shot_id))
            await _broadcast(room.code, {"type": "shot", "slot": slot, "vx": velocity[0], "vy": velocity[1]})
            await _broadcast(room.code, room.public_state())
        elif kind == "settle":
            if not room.settle(slot, content.get("blocks")):
                return
            _cancel_timer(room, "settle")
            await _finish_if_over(room)
            await _broadcast(room.code, {"type": "sync", "from": slot, "blocks": room.blocks})
            await _broadcast(room.code, room.public_state())

    async def room_message(self, event):
        await self.send_json(event["payload"])

    async def room_kick(self, event):
        await self.send_json({"type": "error", "message": "다른 탭에서 이 방에 다시 들어왔습니다."})
        await self.close()

    async def _reject(self, message):
        await self.send_json({"type": "error", "message": message})
        await self.close()
