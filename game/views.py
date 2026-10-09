from django.contrib.auth.decorators import login_required
from django.http import Http404
from django.shortcuts import render

from matches.models import Match

from .maps import BIG_MAPS, GROUND_HEIGHT, MAPS_BY_ID, PRACTICE_MAPS, pig_count

BLOCK_FILL = {"wood": "#c98a4b", "stone": "#8a8f98", "rock": "#5b5148"}


def home(request):
    """메인 페이지. 로그인 여부에 따라 '게임 시작' 또는 '로그인' 버튼을 보여준다."""
    return render(request, "game/home.html")


@login_required
def mode_select(request):
    """로그인 직후 화면: 솔로 플레이(맵 선택)와 1대1 멀티플레이(요새전 로비) 중에서 고른다."""
    return render(request, "game/mode_select.html")


def _card(map_data, wins_by_name):
    """맵 선택 카드에 필요한 값(미리보기 도형, 돼지 수, 클리어 횟수)을 만든다."""
    preview = []
    for b in map_data["blocks"]:
        if b["type"] == "pig":
            preview.append({"type": "pig", "x": b["x"], "y": b["y"], "r": b["w"] / 2})
        else:
            preview.append(
                {
                    "type": b["type"],
                    "left": b["x"] - b["w"] / 2,
                    "top": b["y"] - b["h"] / 2,
                    "w": b["w"],
                    "h": b["h"],
                    "fill": BLOCK_FILL[b["type"]],
                }
            )
    return {
        **map_data,
        "ground_y": map_data["height"] - GROUND_HEIGHT,
        # 미리보기는 아래쪽(바닥에서 700px)만 잘라서 보여준다. 위쪽은 거의 하늘이라서.
        "preview_top": max(0, map_data["height"] - 700),
        "preview_h": min(700, map_data["height"]),
        "preview_blocks": preview,
        "pigs": pig_count(map_data),
        "wins": wins_by_name.get(map_data["name"], 0),
    }


@login_required
def map_select(request):
    wins_by_name = {}
    for name in Match.objects.filter(user=request.user, result=Match.RESULT_WIN).values_list(
        "map_name", flat=True
    ):
        wins_by_name[name] = wins_by_name.get(name, 0) + 1

    groups = [
        {"title": "대형 맵", "css": "wide-cards", "maps": [_card(m, wins_by_name) for m in BIG_MAPS]},
        {"title": "연습 맵", "css": "", "maps": [_card(m, wins_by_name) for m in PRACTICE_MAPS]},
    ]
    return render(request, "game/map_select.html", {"groups": groups})


@login_required
def play(request, map_id):
    """
    게임 화면. 선택한 맵 데이터를 json_script로 넘기면 game.js가 읽어서 그린다.
    새총 조작은 마우스 드래그 또는 MediaPipe Hands 캠 모드(hand_control.js).
    """
    map_data = MAPS_BY_ID.get(map_id)
    if map_data is None:
        raise Http404("없는 맵입니다.")
    return render(request, "game/index.html", {"map": map_data})
