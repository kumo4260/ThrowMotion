from django.shortcuts import render


def index(request):
    """
    임시 플레이용 게임 화면.
    지금은 마우스 드래그로 새총을 조작하고, 추후 MediaPipe Hands 연동 시
    static/game/js/game.js 의 슬링샷 입력 부분만 손 좌표 입력으로 교체하면 됩니다.
    """
    return render(request, "game/index.html")
