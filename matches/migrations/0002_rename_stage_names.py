from django.db import migrations

# 맵 이름을 "스테이지 N" 형식으로 바꾸면서, 기존 전적도 새 이름으로 맞춰서
# 맵 선택 화면의 클리어 횟수가 그대로 이어지게 한다.
RENAMES = {
    "초원 마을": "스테이지 1",
    "바위 협곡": "스테이지 2",
    "절벽 위의 성": "스테이지 3",
    "최종 요새": "스테이지 4",
    "연습 1 - 대형 피라미드": "연습 스테이지 1",
    "연습 2 - 트윈 타워": "연습 스테이지 2",
}


def forwards(apps, schema_editor):
    Match = apps.get_model("matches", "Match")
    for old, new in RENAMES.items():
        Match.objects.filter(map_name=old).update(map_name=new)


def backwards(apps, schema_editor):
    Match = apps.get_model("matches", "Match")
    for old, new in RENAMES.items():
        Match.objects.filter(map_name=new).update(map_name=old)


class Migration(migrations.Migration):
    dependencies = [("matches", "0001_initial")]

    operations = [migrations.RunPython(forwards, backwards)]
