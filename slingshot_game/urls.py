from django.contrib import admin
from django.urls import path, include

urlpatterns = [
    path("admin/", admin.site.urls),
    path("accounts/", include("accounts.urls")),
    path("matches/", include("matches.urls")),
    path("battle/", include("battle.urls")),
    path("", include("game.urls")),
]
