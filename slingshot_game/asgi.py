"""
ASGI 진입점. 일반 HTTP 요청은 Django가, /ws/ 로 시작하는 WebSocket(1대1 요새전)은
Channels가 처리한다. 배포 시 daphne로 실행한다:
    daphne -b 0.0.0.0 -p $PORT slingshot_game.asgi:application
"""
import os

from django.core.asgi import get_asgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "slingshot_game.settings")
django_asgi_app = get_asgi_application()

from channels.auth import AuthMiddlewareStack  # noqa: E402  (Django 초기화 뒤에 import)
from channels.routing import ProtocolTypeRouter, URLRouter  # noqa: E402
from channels.security.websocket import AllowedHostsOriginValidator  # noqa: E402

from battle.routing import websocket_urlpatterns  # noqa: E402

application = ProtocolTypeRouter(
    {
        "http": django_asgi_app,
        "websocket": AllowedHostsOriginValidator(AuthMiddlewareStack(URLRouter(websocket_urlpatterns))),
    }
)
