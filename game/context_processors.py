from django.conf import settings


def features(request):
    """템플릿에서 멀티플레이 메뉴를 보여줄지 정할 수 있게 설정값을 넘긴다."""
    return {"multiplayer_enabled": settings.MULTIPLAYER_ENABLED}
