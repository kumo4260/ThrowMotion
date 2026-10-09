from django.contrib.auth.decorators import login_required
from django.shortcuts import redirect, render
from django.urls import reverse
from django.views.decorators.http import require_POST

from . import rooms
from .maps import BATTLE_MAP

LOBBY_ERRORS = {
    "missing": "없는 방이거나 이미 정리된 방입니다.",
    "full": "이미 두 사람이 들어가 있는 방입니다.",
}


@login_required
def lobby(request):
    """멀티플레이 로비: 방 만들기, 코드로 참가하기, 기다리는 방 목록."""
    waiting = [
        {"code": r.code, "owner": r.players[1].name}
        for r in rooms.open_rooms()
        if r.players[1].user_id != request.user.id
    ]
    return render(
        request,
        "battle/lobby.html",
        {"rooms": waiting, "error": LOBBY_ERRORS.get(request.GET.get("error", ""))},
    )


@login_required
@require_POST
def create(request):
    room = rooms.create_room(request.user.id, request.user.username)
    return redirect("battle:room", code=room.code)


@login_required
def join(request):
    code = (request.GET.get("code") or "").strip().upper()
    return redirect("battle:room", code=code) if code else redirect("battle:lobby")


def _lobby_with_error(key):
    return redirect(f"{reverse('battle:lobby')}?error={key}")


@login_required
def room(request, code):
    """요새전 게임 화면. 실제 입장(자리 배정)은 WebSocket 연결에서 한다."""
    r = rooms.get_room(code)
    if r is None:
        return _lobby_with_error("missing")
    if r.slot_of(request.user.id) is None and (r.players[2] is not None or r.phase != rooms.PHASE_WAITING):
        return _lobby_with_error("full")
    return render(request, "battle/room.html", {"room_code": r.code, "map": BATTLE_MAP})
