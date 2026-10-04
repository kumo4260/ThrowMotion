import json

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse

from .models import Match

User = get_user_model()
PASSWORD = "slingshot-Pass-1234"


class RecordMatchTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("kumo", password=PASSWORD)
        self.url = reverse("matches:record")

    def post_json(self, data):
        return self.client.post(self.url, json.dumps(data), content_type="application/json")

    def test_requires_login(self):
        res = self.post_json({"result": "win"})
        self.assertEqual(res.status_code, 401)
        self.assertEqual(Match.objects.count(), 0)

    def test_records_win_with_json(self):
        self.client.login(username="kumo", password=PASSWORD)
        res = self.post_json({"result": "win", "map_name": "맵 1", "shots_used": 3})
        self.assertEqual(res.status_code, 201)
        match = Match.objects.get()
        self.assertEqual(match.user, self.user)
        self.assertEqual(match.result, "win")
        self.assertEqual(match.map_name, "맵 1")
        self.assertEqual(match.shots_used, 3)
        self.assertEqual(res.json()["summary"], {"total": 1, "wins": 1, "losses": 0})

    def test_records_lose_with_form_data(self):
        self.client.login(username="kumo", password=PASSWORD)
        res = self.client.post(self.url, {"result": "lose"})
        self.assertEqual(res.status_code, 201)
        match = Match.objects.get()
        self.assertEqual(match.result, "lose")
        self.assertIsNone(match.shots_used)

    def test_rejects_invalid_result(self):
        self.client.login(username="kumo", password=PASSWORD)
        res = self.post_json({"result": "draw"})
        self.assertEqual(res.status_code, 400)
        self.assertEqual(Match.objects.count(), 0)

    def test_rejects_bad_shots_used(self):
        self.client.login(username="kumo", password=PASSWORD)
        self.assertEqual(self.post_json({"result": "win", "shots_used": "many"}).status_code, 400)
        self.assertEqual(self.post_json({"result": "win", "shots_used": -1}).status_code, 400)
        self.assertEqual(Match.objects.count(), 0)

    def test_rejects_malformed_json(self):
        self.client.login(username="kumo", password=PASSWORD)
        res = self.client.post(self.url, "{not json", content_type="application/json")
        self.assertEqual(res.status_code, 400)
        res = self.client.post(self.url, "[1, 2]", content_type="application/json")
        self.assertEqual(res.status_code, 400)

    def test_get_not_allowed(self):
        self.client.login(username="kumo", password=PASSWORD)
        self.assertEqual(self.client.get(self.url).status_code, 405)


class HistoryAndSummaryTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("kumo", password=PASSWORD)
        self.other = User.objects.create_user("rival", password=PASSWORD)
        Match.objects.create(user=self.user, result="win", map_name="맵 1")
        Match.objects.create(user=self.user, result="win", map_name="맵 2")
        Match.objects.create(user=self.user, result="lose", map_name="맵 1")
        Match.objects.create(user=self.other, result="lose", map_name="맵 2")

    def test_summary_counts_only_own_matches(self):
        self.client.login(username="kumo", password=PASSWORD)
        res = self.client.get(reverse("matches:summary"))
        self.assertEqual(res.json(), {"total": 3, "wins": 2, "losses": 1})

    def test_summary_requires_login(self):
        self.assertEqual(self.client.get(reverse("matches:summary")).status_code, 401)

    def test_history_page_lists_own_matches(self):
        self.client.login(username="rival", password=PASSWORD)
        res = self.client.get(reverse("matches:history"))
        self.assertEqual(res.status_code, 200)
        self.assertContains(res, "총 1판")
        self.assertEqual(len(res.context["matches"]), 1)

    def test_history_redirects_anonymous_to_login(self):
        res = self.client.get(reverse("matches:history"))
        self.assertRedirects(res, f"{reverse('login')}?next={reverse('matches:history')}")

    def test_deleting_user_deletes_matches(self):
        self.user.delete()
        self.assertEqual(Match.objects.count(), 1)
