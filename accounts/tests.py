from django.contrib.auth import get_user_model
from django.test import Client, TestCase
from django.urls import reverse

User = get_user_model()
PASSWORD = "slingshot-Pass-1234"


class SignupTests(TestCase):
    def test_signup_page_renders(self):
        res = self.client.get(reverse("signup"))
        self.assertEqual(res.status_code, 200)
        self.assertContains(res, "회원가입")

    def test_signup_creates_user_and_logs_in(self):
        res = self.client.post(
            reverse("signup"),
            {"username": "kumo", "password1": PASSWORD, "password2": PASSWORD},
        )
        self.assertRedirects(res, reverse("mode_select"))
        self.assertTrue(User.objects.filter(username="kumo").exists())
        self.assertIn("_auth_user_id", self.client.session)

    def test_signup_rejects_mismatched_passwords(self):
        res = self.client.post(
            reverse("signup"),
            {"username": "kumo", "password1": PASSWORD, "password2": "other-Pass-999"},
        )
        self.assertEqual(res.status_code, 200)
        self.assertFalse(User.objects.filter(username="kumo").exists())

    def test_signup_rejects_duplicate_username(self):
        User.objects.create_user("kumo", password=PASSWORD)
        self.client.post(
            reverse("signup"),
            {"username": "kumo", "password1": PASSWORD, "password2": PASSWORD},
        )
        self.assertEqual(User.objects.filter(username="kumo").count(), 1)


class LoginLogoutTests(TestCase):
    def setUp(self):
        User.objects.create_user("kumo", password=PASSWORD)

    def test_login_with_valid_credentials(self):
        res = self.client.post(reverse("login"), {"username": "kumo", "password": PASSWORD})
        self.assertRedirects(res, reverse("mode_select"))
        self.assertIn("_auth_user_id", self.client.session)

    def test_login_with_wrong_password(self):
        res = self.client.post(reverse("login"), {"username": "kumo", "password": "wrong"})
        self.assertEqual(res.status_code, 200)
        self.assertNotIn("_auth_user_id", self.client.session)

    def test_logout(self):
        self.client.login(username="kumo", password=PASSWORD)
        res = self.client.post(reverse("logout"))
        self.assertRedirects(res, reverse("home"))
        self.assertNotIn("_auth_user_id", self.client.session)


class NavTests(TestCase):
    def test_home_shows_login_links_for_anonymous(self):
        res = self.client.get(reverse("home"))
        self.assertEqual(res.status_code, 200)
        self.assertContains(res, reverse("login"))
        self.assertContains(res, reverse("signup"))

    def test_home_shows_user_for_logged_in(self):
        User.objects.create_user("kumo", password=PASSWORD)
        self.client.login(username="kumo", password=PASSWORD)
        res = self.client.get(reverse("home"))
        self.assertContains(res, "kumo")
        self.assertContains(res, reverse("mode_select"))


class ProxyCsrfTests(TestCase):
    """Render는 HTTPS를 앞단 프록시에서 끊고 서버에는 HTTP로 넘긴다(X-Forwarded-Proto: https)."""

    def setUp(self):
        User.objects.create_user("kumo", password=PASSWORD)

    def test_login_over_https_behind_proxy_passes_origin_check(self):
        client = Client(enforce_csrf_checks=True)
        res = client.get(reverse("login"), HTTP_HOST="throwmotion.onrender.com", HTTP_X_FORWARDED_PROTO="https")
        token = res.cookies["csrftoken"].value
        res = client.post(
            reverse("login"),
            {"username": "kumo", "password": PASSWORD, "csrfmiddlewaretoken": token},
            HTTP_HOST="throwmotion.onrender.com",
            HTTP_X_FORWARDED_PROTO="https",
            HTTP_ORIGIN="https://throwmotion.onrender.com",
            HTTP_REFERER="https://throwmotion.onrender.com/accounts/login/",
        )
        self.assertEqual(res.status_code, 302)
