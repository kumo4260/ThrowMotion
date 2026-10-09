from asgiref.sync import sync_to_async
from channels.testing import WebsocketCommunicator
from django.conf import settings
from django.contrib.auth import get_user_model
from django.test import Client, TestCase, TransactionTestCase
from django.urls import reverse

from matches.models import Match
from slingshot_game.asgi import application

from . import consumers, rooms
from .maps import BATTLE_MAP, pigs_by_side

User = get_user_model()
PASSWORD = "slingshot-Pass-1234"


def _initial_blocks():
    return [rooms._public_block(b) for b in BATTLE_MAP["blocks"] if b["type"] != "rock"]


def _without_pigs(side):
    """settle로 보낼 블록 목록: 지정한 쪽 돼지를 모두 없앤 상태."""
    return [
        b for b in _initial_blocks()
        if not (rooms._BLOCKS_BY_ID[b["id"]]["type"] == "pig" and rooms._BLOCKS_BY_ID[b["id"]]["side"] == side)
    ]


class BattleMapTests(TestCase):
    def test_map_is_mirrored_and_fair(self):
        blocks = BATTLE_MAP["blocks"]
        left = sorted((b["x"], b["y"], b["type"]) for b in blocks if b["side"] == 1)
        right = sorted((BATTLE_MAP["width"] - b["x"], b["y"], b["type"]) for b in blocks if b["side"] == 2)
        self.assertEqual(left, right)
        self.assertEqual(pigs_by_side(blocks), {1: 3, 2: 3})
        s1, s2 = BATTLE_MAP["slings"]["1"], BATTLE_MAP["slings"]["2"]
        self.assertEqual(s1["x"] + s2["x"], BATTLE_MAP["width"])

    def test_end_walls_are_mirrored_and_clear_of_blocks(self):
        left, right = sorted(BATTLE_MAP["walls"], key=lambda w: w["x"])
        self.assertEqual(left["x"] + right["x"], BATTLE_MAP["width"])
        self.assertEqual((left["y"], left["w"], left["h"]), (right["y"], right["w"], right["h"]))
        self.assertEqual(left["x"] - left["w"] / 2, 0)
        for b in BATTLE_MAP["blocks"]:
            self.assertGreaterEqual(b["x"] - b["w"] / 2, left["w"], b)
            self.assertLessEqual(b["x"] + b["w"] / 2, BATTLE_MAP["width"] - right["w"], b)

    def test_block_ids_unique_and_inside_world(self):
        ids = [b["id"] for b in BATTLE_MAP["blocks"]]
        self.assertEqual(len(ids), len(set(ids)))
        ground_y = BATTLE_MAP["height"] - 40
        for b in BATTLE_MAP["blocks"]:
            self.assertGreaterEqual(b["x"] - b["w"] / 2, 0, b)
            self.assertLessEqual(b["x"] + b["w"] / 2, BATTLE_MAP["width"], b)
            self.assertLessEqual(b["y"] + b["h"] / 2, ground_y + 0.5, b)


class RoomRuleTests(TestCase):
    def setUp(self):
        self.room = rooms.Room("TEST1", 1, "alice")
        self.assertEqual(self.room.join(2, "bob"), 2)
        self.room.players[1].connected = self.room.players[2].connected = True
        self.assertTrue(self.room.start_if_ready())

    def test_third_person_cannot_join_and_members_keep_their_slot(self):
        self.assertIsNone(self.room.join(3, "carol"))
        self.assertEqual(self.room.join(1, "alice"), 1)
        self.assertEqual(self.room.join(2, "bob"), 2)

    def test_only_current_player_can_shoot_and_turns_alternate(self):
        self.assertIsNone(self.room.shoot(2, 100, -100))
        self.assertEqual(self.room.shoot(1, 100, -100), (100.0, -100.0))
        self.assertIsNone(self.room.shoot(1, 100, -100))  # 이미 날아가는 중
        self.assertFalse(self.room.settle(2, _initial_blocks()))
        self.assertTrue(self.room.settle(1, _initial_blocks()))
        self.assertEqual(self.room.turn, 2)
        self.assertEqual(self.room.shots, {1: 5, 2: 6})

    def test_shot_speed_is_capped(self):
        vx, vy = self.room.shoot(1, 99999, 0)
        self.assertAlmostEqual(vx, BATTLE_MAP["maxLaunchSpeed"])
        self.assertEqual(vy, 0)

    def test_bad_input_is_rejected(self):
        self.assertIsNone(self.room.shoot(1, "nan", 0))
        self.room.shoot(1, 10, 10)
        self.assertFalse(self.room.settle(1, "nope"))
        self.assertFalse(self.room.settle(1, [{"id": 9999, "x": 1, "y": 1, "hp": 1}]))
        rock_id = next(b["id"] for b in BATTLE_MAP["blocks"] if b["type"] == "rock")
        self.assertFalse(self.room.settle(1, [{"id": rock_id, "x": 1, "y": 1, "hp": 1}]))

    def test_destroying_all_enemy_pigs_wins(self):
        self.room.shoot(1, 10, 10)
        self.room.settle(1, _without_pigs(2))
        self.assertEqual(self.room.phase, rooms.PHASE_OVER)
        self.assertEqual(self.room.winner, 1)
        self.assertEqual(self.room.reason, "all_pigs")

    def test_hitting_own_pigs_counts_against_you(self):
        self.room.shoot(1, 10, 10)
        self.room.settle(1, _without_pigs(1))
        self.assertEqual(self.room.winner, 2)

    def test_out_of_birds_compares_pigs_left(self):
        one_enemy_pig_gone = _initial_blocks()
        pig2 = next(b for b in one_enemy_pig_gone if rooms._BLOCKS_BY_ID[b["id"]]["type"] == "pig"
                    and rooms._BLOCKS_BY_ID[b["id"]]["side"] == 2)
        one_enemy_pig_gone.remove(pig2)
        for _ in range(BATTLE_MAP["birdCount"] * 2):
            slot = self.room.turn
            self.room.shoot(slot, 10, 10)
            self.room.settle(slot, one_enemy_pig_gone)
        self.assertEqual(self.room.phase, rooms.PHASE_OVER)
        self.assertEqual(self.room.reason, "out_of_birds")
        self.assertEqual(self.room.winner, 1)

    def test_draw_when_both_run_out_with_same_pigs(self):
        for _ in range(BATTLE_MAP["birdCount"] * 2):
            slot = self.room.turn
            self.room.shoot(slot, 10, 10)
            self.room.cancel_shot()
        self.assertEqual(self.room.phase, rooms.PHASE_OVER)
        self.assertIsNone(self.room.winner)

    def test_forfeit(self):
        self.assertTrue(self.room.forfeit(2))
        self.assertEqual(self.room.winner, 1)
        self.assertEqual(self.room.reason, "left")


class LobbyViewTests(TestCase):
    def setUp(self):
        rooms.ROOMS.clear()
        User.objects.create_user("alice", password=PASSWORD)
        User.objects.create_user("bob", password=PASSWORD)
        User.objects.create_user("carol", password=PASSWORD)

    def test_lobby_requires_login(self):
        res = self.client.get(reverse("battle:lobby"))
        self.assertRedirects(res, f"{reverse('login')}?next={reverse('battle:lobby')}")

    def test_create_room_then_open_room_page(self):
        self.client.login(username="alice", password=PASSWORD)
        res = self.client.post(reverse("battle:create"))
        code = res.url.rstrip("/").split("/")[-1]
        self.assertIn(code, rooms.ROOMS)
        res = self.client.get(res.url)
        self.assertContains(res, code)
        self.assertContains(res, f"/ws/battle/{code}/")
        self.assertContains(res, 'id="map-data"')

    def test_join_by_code_and_unknown_room(self):
        self.client.login(username="bob", password=PASSWORD)
        res = self.client.get(reverse("battle:join"), {"code": "zzzzz"})
        self.assertRedirects(res, reverse("battle:room", args=["ZZZZZ"]), fetch_redirect_response=False)
        res = self.client.get(reverse("battle:room", args=["ZZZZZ"]))
        self.assertRedirects(res, f"{reverse('battle:lobby')}?error=missing")

    def test_full_room_sends_outsider_back_to_lobby(self):
        room = rooms.create_room(User.objects.get(username="alice").id, "alice")
        room.join(User.objects.get(username="bob").id, "bob")
        self.client.login(username="carol", password=PASSWORD)
        res = self.client.get(reverse("battle:room", args=[room.code]))
        self.assertRedirects(res, f"{reverse('battle:lobby')}?error=full")

    def test_lobby_lists_waiting_rooms(self):
        room = rooms.create_room(User.objects.get(username="alice").id, "alice")
        room.players[1].connected = True
        self.client.login(username="bob", password=PASSWORD)
        res = self.client.get(reverse("battle:lobby"))
        self.assertContains(res, room.code)
        self.assertContains(res, "alice님의 방")


class BattleSocketTests(TransactionTestCase):
    """두 사람이 WebSocket으로 접속해서 한 판을 끝까지 하는 흐름."""

    def setUp(self):
        rooms.ROOMS.clear()
        self.alice = User.objects.create_user("alice", password=PASSWORD)
        self.bob = User.objects.create_user("bob", password=PASSWORD)
        self.carol = User.objects.create_user("carol", password=PASSWORD)

    def _headers(self, user):
        client = Client()
        client.force_login(user)
        cookie = f"{settings.SESSION_COOKIE_NAME}={client.cookies[settings.SESSION_COOKIE_NAME].value}"
        return [(b"cookie", cookie.encode()), (b"origin", b"http://localhost")]

    async def _connect(self, user, code):
        headers = await sync_to_async(self._headers)(user)
        comm = WebsocketCommunicator(application, f"/ws/battle/{code}/", headers=headers)
        connected, _ = await comm.connect()
        self.assertTrue(connected)
        return comm

    async def _receive_until(self, comm, kind):
        while True:
            msg = await comm.receive_json_from(timeout=2)
            if msg["type"] == kind:
                return msg

    async def test_full_game_records_results(self):
        room = rooms.create_room(self.alice.id, "alice")
        a = await self._connect(self.alice, room.code)
        self.assertEqual((await self._receive_until(a, "hello"))["slot"], 1)
        state = await self._receive_until(a, "state")
        self.assertEqual(state["phase"], "waiting")

        b = await self._connect(self.bob, room.code)
        self.assertEqual((await self._receive_until(b, "hello"))["slot"], 2)
        state = await self._receive_until(a, "state")
        self.assertEqual(state["phase"], "playing")
        self.assertEqual(state["turn"], 1)

        # 2P는 자기 차례가 아니라서 쏠 수 없다.
        await b.send_json_to({"type": "shot", "vx": 100, "vy": -100})
        # 1P가 쏘면 두 사람 모두 같은 발사를 받는다.
        await a.send_json_to({"type": "shot", "vx": 500, "vy": -600})
        for comm in (a, b):
            shot = await self._receive_until(comm, "shot")
            self.assertEqual((shot["slot"], shot["vx"], shot["vy"]), (1, 500, -600))

        # 1P 화면 기준으로 2P 돼지가 모두 쓰러졌다 → 2P 화면에 sync가 가고 1P 승리
        await a.send_json_to({"type": "settle", "blocks": _without_pigs(2)})
        sync = await self._receive_until(b, "sync")
        self.assertEqual(sync["from"], 1)
        self.assertEqual(len(sync["blocks"]), len(_without_pigs(2)))
        state = await self._receive_until(b, "state")
        while state["phase"] != "over":
            state = await self._receive_until(b, "state")
        self.assertEqual(state["winner"], 1)

        await a.disconnect()
        await b.disconnect()

        results = await sync_to_async(
            lambda: sorted((m.user.username, m.result, m.shots_used) for m in Match.objects.all())
        )()
        self.assertEqual(results, [("alice", "win", 1), ("bob", "lose", 0)])

    async def test_outsider_and_anonymous_are_rejected(self):
        room = rooms.create_room(self.alice.id, "alice")
        a = await self._connect(self.alice, room.code)
        b = await self._connect(self.bob, room.code)
        c = await self._connect(self.carol, room.code)
        msg = await self._receive_until(c, "error")
        self.assertIn("가득", msg["message"])
        await c.wait()

        anon = WebsocketCommunicator(
            application, f"/ws/battle/{room.code}/", headers=[(b"origin", b"http://localhost")]
        )
        await anon.connect()
        msg = await self._receive_until(anon, "error")
        self.assertIn("로그인", msg["message"])

        await a.disconnect()
        await b.disconnect()

    async def test_leaving_mid_game_forfeits_after_grace(self):
        old_grace = consumers.RECONNECT_GRACE_SECONDS
        consumers.RECONNECT_GRACE_SECONDS = 0.1
        try:
            room = rooms.create_room(self.alice.id, "alice")
            a = await self._connect(self.alice, room.code)
            b = await self._connect(self.bob, room.code)
            await self._receive_until(a, "hello")
            await b.disconnect()
            state = await self._receive_until(a, "state")
            while state["phase"] != "over":
                state = await self._receive_until(a, "state")
            self.assertEqual((state["winner"], state["reason"]), (1, "left"))
            await a.disconnect()
        finally:
            consumers.RECONNECT_GRACE_SECONDS = old_grace

        count = await sync_to_async(Match.objects.filter(user=self.alice, result="win").count)()
        self.assertEqual(count, 1)

    async def test_reconnect_within_grace_keeps_game(self):
        room = rooms.create_room(self.alice.id, "alice")
        a = await self._connect(self.alice, room.code)
        b = await self._connect(self.bob, room.code)
        await b.disconnect()
        b2 = await self._connect(self.bob, room.code)
        self.assertEqual((await self._receive_until(b2, "hello"))["slot"], 2)
        await self._receive_until(b2, "sync")  # 다시 들어오면 현재 블록 상태부터 받는다
        state = await self._receive_until(b2, "state")
        self.assertEqual(state["phase"], "playing")
        self.assertTrue(state["players"]["2"]["connected"])
        self.assertNotIn(f"forfeit2", {k for k, t in room.timers.items() if not t.done()})
        await a.disconnect()
        await b2.disconnect()
