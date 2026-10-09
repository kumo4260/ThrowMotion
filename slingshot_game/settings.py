"""
임시 테스트용 Django
나중에 회원가입/로그인/전적 API
DATABASES, INSTALLED_APPS 의 'rest_framework' 등을 확장
"""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = "skeh-xmdnlsxpdlf-chwjfwjd-althsu-duwkclsrn"

# 로컬에서 `python manage.py runserver`로 테스트할 때는
# DJANGO_DEBUG=1 환경변수를 설정하면 DEBUG가 켜집니다. (배포 환경은 기본값 False 유지)
DEBUG = os.environ.get("DJANGO_DEBUG") == "1"

ALLOWED_HOSTS = ["throwmotion.onrender.com", "127.0.0.1", "localhost"]

# Render는 HTTPS를 앞단 프록시에서 처리하고 서버(daphne)에는 HTTP로 넘긴다.
# 프록시가 붙여 주는 X-Forwarded-Proto를 믿어야 Django가 HTTPS 요청으로 인식해서
# 로그인/회원가입 POST의 CSRF Origin 검사를 통과한다.
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
CSRF_TRUSTED_ORIGINS = ["https://throwmotion.onrender.com"]

INSTALLED_APPS = [
    # daphne가 맨 앞에 있어야 runserver도 WebSocket(ASGI)을 지원한다.
    "daphne",
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "game",
    "accounts",
    "matches",
    "channels",
    "battle",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "slingshot_game.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "slingshot_game.wsgi.application"
ASGI_APPLICATION = "slingshot_game.asgi.application"

# 1대1 요새전 WebSocket 메시지 전달. 방 상태가 서버 메모리에 있어서
# 서버 프로세스 하나(daphne 1개)로 돌리는 것을 전제로 메모리 레이어를 쓴다.
CHANNEL_LAYERS = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": BASE_DIR / "db.sqlite3",
    }
}

LANGUAGE_CODE = "ko-kr"
TIME_ZONE = "Asia/Seoul"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

LOGIN_URL = "login"
LOGIN_REDIRECT_URL = "mode_select"
LOGOUT_REDIRECT_URL = "home"
