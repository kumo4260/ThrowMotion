import json

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse

from matches.models import Match

from .maps import BIG_MAPS, MAPS, PRACTICE_MAPS, WALL_THICKNESS, pig_count

User = get_user_model()
PASSWORD = "slingshot-Pass-1234"


class MapDataTests(TestCase):
    def test_four_big_maps_about_three_times_wider(self):
        self.assertEqual(len(BIG_MAPS), 4)
        base_w = PRACTICE_MAPS[0]["width"]
        for m in BIG_MAPS:
            self.assertEqual(m["width"], base_w * 3)

    def test_map_ids_unique_and_every_map_has_a_pig(self):
        ids = [m["id"] for m in MAPS]
        self.assertEqual(len(ids), len(set(ids)))
        for m in MAPS:
            self.assertGreater(pig_count(m), 0, m["id"])

    def test_blocks_inside_world_and_above_ground(self):
        for m in MAPS:
            ground_y = m["height"] - 40
            for b in m["blocks"]:
                self.assertGreaterEqual(b["x"] - b["w"] / 2, 0, (m["id"], b))
                self.assertLessEqual(b["x"] + b["w"] / 2, m["width"], (m["id"], b))
                self.assertLessEqual(b["y"] + b["h"] / 2, ground_y + 0.5, (m["id"], b))
                self.assertGreaterEqual(b["y"] - b["h"] / 2, 0, (m["id"], b))

    def test_every_map_has_end_walls_clear_of_blocks_and_sling(self):
        for m in MAPS:
            left, right = sorted(m["walls"], key=lambda w: w["x"])
            ground_y = m["height"] - 40
            self.assertEqual(left["x"] - left["w"] / 2, 0, m["id"])
            self.assertEqual(right["x"] + right["w"] / 2, m["width"], m["id"])
            for w in (left, right):
                # 바닥까지 내려오고, 화면 위로 높이 솟아서 높이 쏜 새도 못 넘어간다
                self.assertAlmostEqual(w["y"] + w["h"] / 2, ground_y, msg=m["id"])
                self.assertLess(w["y"] - w["h"] / 2, -2000, m["id"])
            for b in m["blocks"]:
                self.assertGreaterEqual(b["x"] - b["w"] / 2, WALL_THICKNESS, (m["id"], b))
                self.assertLessEqual(b["x"] + b["w"] / 2, m["width"] - WALL_THICKNESS, (m["id"], b))
            self.assertGreater(m["slingAnchor"]["x"] - 18, WALL_THICKNESS, m["id"])


class FlowTests(TestCase):
    """메인 -> 로그인 -> 맵 선택 -> 게임 흐름."""

    def setUp(self):
        User.objects.create_user("kumo", password=PASSWORD)

    def test_map_select_and_play_require_login(self):
        for url in (reverse("map_select"), reverse("play", args=["meadow"])):
            res = self.client.get(url)
            self.assertRedirects(res, f"{reverse('login')}?next={url}")

    def test_login_then_map_select_then_play(self):
        res = self.client.post(reverse("login"), {"username": "kumo", "password": PASSWORD})
        self.assertRedirects(res, reverse("mode_select"))

        res = self.client.get(reverse("map_select"))
        self.assertEqual(res.status_code, 200)
        for m in MAPS:
            self.assertContains(res, reverse("play", args=[m["id"]]))

        res = self.client.get(reverse("play", args=["fortress"]))
        self.assertEqual(res.status_code, 200)
        self.assertContains(res, 'id="map-data"')
        self.assertContains(res, reverse("matches:record"))

    def test_mode_select_offers_solo_and_multiplayer(self):
        res = self.client.get(reverse("mode_select"))
        self.assertRedirects(res, f"{reverse('login')}?next={reverse('mode_select')}")

        self.client.login(username="kumo", password=PASSWORD)
        res = self.client.get(reverse("mode_select"))
        self.assertContains(res, f'href="{reverse("map_select")}"')
        self.assertContains(res, f'href="{reverse("battle:lobby")}"')

    def test_play_embeds_selected_map(self):
        self.client.login(username="kumo", password=PASSWORD)
        res = self.client.get(reverse("play", args=["cliff"]))
        data = json.loads(res.content.decode().split('id="map-data" type="application/json">')[1].split("</script>")[0])
        self.assertEqual(data["id"], "cliff")
        self.assertEqual(data["width"], 3600)

    def test_unknown_map_is_404(self):
        self.client.login(username="kumo", password=PASSWORD)
        res = self.client.get(reverse("play", args=["nope"]))
        self.assertEqual(res.status_code, 404)

    def test_login_next_returns_to_chosen_map(self):
        url = reverse("play", args=["canyon"])
        res = self.client.post(
            reverse("login"), {"username": "kumo", "password": PASSWORD, "next": url}
        )
        self.assertRedirects(res, url)

    def test_map_select_shows_clear_count(self):
        user = User.objects.get(username="kumo")
        Match.objects.create(user=user, result="win", map_name="초원 마을")
        Match.objects.create(user=user, result="win", map_name="초원 마을")
        Match.objects.create(user=user, result="lose", map_name="초원 마을")
        self.client.login(username="kumo", password=PASSWORD)
        res = self.client.get(reverse("map_select"))
        self.assertContains(res, "클리어 2회")
