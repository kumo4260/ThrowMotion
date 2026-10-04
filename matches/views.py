import json

from django.contrib.auth.decorators import login_required
from django.http import JsonResponse
from django.shortcuts import render
from django.views.decorators.http import require_GET, require_POST

from .models import Match


def _summary(user):
    matches = Match.objects.filter(user=user)
    wins = matches.filter(result=Match.RESULT_WIN).count()
    total = matches.count()
    return {"total": total, "wins": wins, "losses": total - wins}


@login_required
@require_GET
def history(request):
    """내 전적 페이지."""
    return render(
        request,
        "matches/history.html",
        {
            "matches": Match.objects.filter(user=request.user)[:50],
            "summary": _summary(request.user),
        },
    )


@require_GET
def summary(request):
    """내 승/패 집계 (JSON)."""
    if not request.user.is_authenticated:
        return JsonResponse({"error": "login required"}, status=401)
    return JsonResponse(_summary(request.user))


@require_POST
def record(request):
    """
    게임이 끝났을 때 결과 한 건을 저장한다.
    JSON 본문 {"result": "win"|"lose", "map_name": "...", "shots_used": 3}
    또는 같은 이름의 폼 필드를 받는다.
    """
    if not request.user.is_authenticated:
        return JsonResponse({"error": "login required"}, status=401)

    if request.content_type == "application/json":
        try:
            data = json.loads(request.body or b"{}")
        except json.JSONDecodeError:
            return JsonResponse({"error": "invalid json"}, status=400)
        if not isinstance(data, dict):
            return JsonResponse({"error": "invalid json"}, status=400)
    else:
        data = request.POST

    result = data.get("result")
    if result not in (Match.RESULT_WIN, Match.RESULT_LOSE):
        return JsonResponse({"error": "result must be 'win' or 'lose'"}, status=400)

    map_name = str(data.get("map_name") or "")[:100]

    shots_used = data.get("shots_used")
    if shots_used in (None, ""):
        shots_used = None
    else:
        try:
            shots_used = int(shots_used)
        except (TypeError, ValueError):
            return JsonResponse({"error": "shots_used must be an integer"}, status=400)
        if not 0 <= shots_used <= 32767:
            return JsonResponse({"error": "shots_used out of range"}, status=400)

    match = Match.objects.create(
        user=request.user,
        result=result,
        map_name=map_name,
        shots_used=shots_used,
    )
    return JsonResponse(
        {
            "id": match.id,
            "result": match.result,
            "map_name": match.map_name,
            "shots_used": match.shots_used,
            "played_at": match.played_at.isoformat(),
            "summary": _summary(request.user),
        },
        status=201,
    )
