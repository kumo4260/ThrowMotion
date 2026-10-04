from django.contrib.auth import views as auth_views
from django.urls import path

from . import views

urlpatterns = [
    path("signup/", views.signup, name="signup"),
    path(
        "login/",
        auth_views.LoginView.as_view(
            template_name="accounts/login.html",
            redirect_authenticated_user=True,
        ),
        name="login",
    ),
    # Django 4.1부터 GET 로그아웃은 폐기 예정이라 POST로만 받는다.
    path("logout/", auth_views.LogoutView.as_view(), name="logout"),
]
