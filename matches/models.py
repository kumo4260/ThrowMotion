from django.conf import settings
from django.db import models


class Match(models.Model):
    """한 판의 결과(승/패)를 유저별로 저장한다."""

    RESULT_WIN = "win"
    RESULT_LOSE = "lose"
    RESULT_CHOICES = [
        (RESULT_WIN, "승리"),
        (RESULT_LOSE, "패배"),
    ]

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="matches",
    )
    result = models.CharField(max_length=4, choices=RESULT_CHOICES)
    map_name = models.CharField(max_length=100, blank=True)
    shots_used = models.PositiveSmallIntegerField(null=True, blank=True)
    played_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-played_at", "-id"]

    def __str__(self):
        return f"{self.user} {self.get_result_display()} ({self.played_at:%Y-%m-%d %H:%M})"
