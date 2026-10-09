from django.urls import path

from . import views

app_name = "matches"

urlpatterns = [
    path("", views.history, name="history"),
    path("summary/", views.summary, name="summary"),
    path("record/", views.record, name="record"),
]
