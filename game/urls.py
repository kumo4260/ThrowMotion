from django.urls import path
from . import views

urlpatterns = [
    path("", views.home, name="home"),
    path("maps/", views.map_select, name="map_select"),
    path("play/<slug:map_id>/", views.play, name="play"),
]
