from django.contrib import admin

from .models import Match


@admin.register(Match)
class MatchAdmin(admin.ModelAdmin):
    list_display = ("user", "result", "map_name", "shots_used", "played_at")
    list_filter = ("result", "map_name")
    search_fields = ("user__username",)
