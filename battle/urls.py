from django.urls import path

from . import views

app_name = "battle"

urlpatterns = [
    path("", views.lobby, name="lobby"),
    path("create/", views.create, name="create"),
    path("join/", views.join, name="join"),
    path("<str:code>/", views.room, name="room"),
]
