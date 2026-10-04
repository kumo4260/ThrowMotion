# ThrowMotion - 슬링샷 대전 게임

브라우저에서 새총으로 새를 날려 돼지를 맞히는 물리 게임입니다.
마우스로 당기거나, **웹캠 앞에서 손 제스처(MediaPipe Hands)**로 조작할 수 있습니다.

배포 주소: https://throwmotion.onrender.com

## 현재 구현된 기능

- 맵 2개
  - 맵 1 - 대형 피라미드 (새 4마리, 돼지 1마리)
  - 맵 2 - 트윈 타워 (새 6마리, 돼지 2마리)
- Phaser 3 Arcade Physics 기반 블록 파괴 물리 (나무 hp1 / 돌 hp2)
- 조준선 + 발사 궤적 미리보기
- 승리(돼지 전부 제거) / 패배(새 소진) / 다시하기 게임 루프
- 조작 모드 2가지 (상단 버튼으로 전환)
  - **마우스 모드**: 새를 클릭한 채 당겼다가 놓으면 발사
  - **캠 모드**: MediaPipe Hands로 손을 인식해서 주먹을 쥐면 당기고, 손을 펴면 발사

## 조작 방법

### 마우스 모드 (기본)

1. 화면 왼쪽의 새를 마우스로 클릭한 채 당깁니다 (최대 당김 거리 제한 있음).
2. 마우스를 놓으면 당긴 방향의 반대쪽으로 발사됩니다.

### 캠 모드

1. 상단의 **캠 모드** 버튼을 누르고 브라우저의 카메라 권한을 허용합니다.
2. 오른쪽 위 미리보기 창에 손이 보이면 주먹을 쥡니다. 주먹을 쥔 순간의 손 위치가 기준점이 됩니다.
3. 주먹을 쥔 채 손을 움직이면 그만큼 새총이 당겨집니다.
4. 손을 펴면 발사됩니다. 손이 화면 밖으로 나가도 발사됩니다.

카메라와 손 인식 모델은 CDN(jsDelivr, Google Storage)에서 불러오므로 인터넷 연결이 필요합니다.
브라우저는 `localhost` 또는 HTTPS 주소에서만 카메라를 허용합니다.

상단 버튼으로 맵 1 / 맵 2 전환과 다시하기도 할 수 있습니다.

## 로컬 실행

```bash
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
DJANGO_DEBUG=1 python manage.py runserver
# Windows PowerShell: $env:DJANGO_DEBUG="1"; python manage.py runserver
```

브라우저에서 http://127.0.0.1:8000 접속.

`DEBUG`는 기본으로 꺼져 있고 `DJANGO_DEBUG=1`일 때만 켜집니다.
DEBUG가 꺼진 상태에서는 정적 파일(JS)을 `collectstatic` 결과에서만 제공하므로,
로컬에서는 `DJANGO_DEBUG=1`을 켜고 실행하세요.

## 배포 (Render)

Render Web Service로 배포되어 있습니다.

| 항목 | 값 |
| --- | --- |
| Build Command | `pip install -r requirements.txt && python manage.py collectstatic --noinput` |
| Start Command | `gunicorn slingshot_game.wsgi` (`Procfile`과 동일) |

- 정적 파일은 WhiteNoise가 `staticfiles/`에서 제공합니다.
- 허용 도메인은 `slingshot_game/settings.py`의 `ALLOWED_HOSTS`에 있습니다.
  도메인이 바뀌면 여기에 추가해야 합니다.
- `main`에 푸시하면 Render가 자동으로 다시 배포합니다 (Render 설정에서 Auto-Deploy가 켜져 있는 경우).

## 폴더 구조

```
ThrowMotion/
├── manage.py
├── requirements.txt        # Django, whitenoise, gunicorn
├── Procfile                # gunicorn 실행 명령
├── slingshot_game/         # Django 프로젝트 설정 (settings, urls, wsgi)
└── game/                   # 게임 앱
    ├── views.py            # 게임 화면 렌더링
    ├── urls.py
    ├── templates/game/index.html
    └── static/game/js/
        ├── maps.js         # 맵 2개 데이터
        ├── game.js         # Phaser 게임 로직 (물리, 슬링샷, 승패 판정, 모드 전환)
        └── hand_control.js # MediaPipe Hands 손 인식, 주먹/손 폄 판정
```

슬링샷 당기기/발사 로직은 `game.js`의 `beginPull` / `movePull` / `finishPull`에만 있고,
마우스 이벤트와 `hand_control.js`(`window.campullBegin/Move/End`)가 모두 이 메서드를 호출합니다.

## 다음 단계

- 4주차 이후 백엔드 작업(회원가입/로그인, 전적 API)은 `game` 앱 옆에 `accounts`,
  `matches` 같은 앱을 추가해 확장할 예정입니다.
