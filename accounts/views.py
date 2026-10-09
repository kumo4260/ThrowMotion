from django.contrib.auth import login
from django.contrib.auth.forms import UserCreationForm
from django.shortcuts import redirect, render


def signup(request):
    """
    회원가입. 가입이 끝나면 바로 로그인시키고 맵 선택 화면으로 보낸다.
    """
    if request.user.is_authenticated:
        return redirect("map_select")

    if request.method == "POST":
        form = UserCreationForm(request.POST)
        if form.is_valid():
            user = form.save()
            login(request, user)
            return redirect("map_select")
    else:
        form = UserCreationForm()

    return render(request, "accounts/signup.html", {"form": form})
