# ThrowMotion - 슬링샷 대전 게임

브라우저에서 새총으로 새를 날려 돼지를 맞히는 물리 게임입니다.
마우스로 당기거나, **웹캠 앞에서 손 제스처(MediaPipe Hands)**로 조작할 수 있습니다.

배포 주소: https://throwmotion.onrender.com

## 현재 구현된 기능

- 메인 → 로그인/회원가입 → 맵 선택 → 게임 흐름의 웹페이지
- 대형 맵 4개(연습 맵보다 가로 3배, 3600×1050) + 연습 맵 2개(1200×700)
  - 초원 마을(쉬움), 바위 협곡(보통), 절벽 위의 성(어려움), 최종 요새(매우 어려움)
  - 연습 1 - 대형 피라미드, 연습 2 - 트윈 타워
- 대형 맵에서는 카메라가 날아가는 새를 따라가고, 시작할 때 목표물 쪽을 먼저 보여줍니다.
- Phaser 3 Arcade Physics 기반 블록 파괴 물리 (나무 hp1 / 돌 hp2 / 부서지지 않는 바위 지형)
- 조준선 + 발사 궤적 미리보기
- 승리(돼지 전부 제거) / 패배(새 소진) / 다시하기 게임 루프
- 유저별 승패 기록(전적)과 맵별 클리어 횟수
- 조작 모드 2가지 (게임 화면 상단 버튼으로 전환)
  - **마우스 모드**: 새를 클릭한 채 당겼다가 놓으면 발사
  - **캠 모드**: MediaPipe Hands로 손을 인식해서 주먹을 쥐면 당기고, 손을 펴면 발사

## 페이지 흐름

메인(`/`) → 로그인/회원가입(`/accounts/login/`, `/accounts/signup/`) → 맵 선택(`/maps/`) → 게임(`/play/<맵 id>/`)

- 맵 선택과 게임 화면은 로그인이 필요합니다. 로그인하지 않고 들어가면 로그인 화면으로 보내고, 로그인 후 원래 가려던 화면으로 돌아옵니다.
- 맵 id: `meadow`(초원 마을), `canyon`(바위 협곡), `cliff`(절벽 위의 성), `fortress`(최종 요새), `practice-1`, `practice-2`

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

### 공통

- 대형 맵에서는 방향키(←/→)나 마우스 휠로 맵을 둘러보고, 스페이스로 새총 위치로 돌아옵니다.
- 상단 버튼으로 다시하기, 맵 선택 화면으로 돌아가기가 가능합니다.

## 로컬 실행

```bash
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
python manage.py migrate
DJANGO_DEBUG=1 python manage.py runserver
# Windows PowerShell: $env:DJANGO_DEBUG="1"; python manage.py runserver
```

브라우저에서 http://127.0.0.1:8000 접속.

`DEBUG`는 기본으로 꺼져 있고 `DJANGO_DEBUG=1`일 때만 켜집니다.
DEBUG가 꺼진 상태에서는 정적 파일(JS)을 `collectstatic` 결과에서만 제공하므로,
로컬에서는 `DJANGO_DEBUG=1`을 켜고 실행하세요.

테스트 실행:

```bash
python manage.py test
```

## 배포 (Render)

Render Web Service로 배포되어 있습니다.

| 항목 | 값 |
| --- | --- |
| Build Command | `pip install -r requirements.txt && python manage.py collectstatic --noinput` |
| Start Command | `python manage.py migrate --noinput && gunicorn slingshot_game.wsgi` |

- **회원가입/전적 DB 테이블은 `migrate`로 만들어집니다.** Start Command에 `migrate`가 없으면
  회원가입·로그인에서 500 에러가 납니다. (Render 대시보드 → Settings에서 바꿉니다.)
- DB는 SQLite(`db.sqlite3`)라서 **Render가 다시 배포하거나 재시작하면 가입한 계정과 전적이 사라집니다.**
  계속 남기려면 Render PostgreSQL 같은 영구 DB로 바꿔야 합니다.
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
├── game/                   # 게임 앱
│   ├── maps.py             # 맵 데이터 (대형 맵 4개 + 연습 맵 2개)
│   ├── views.py            # 메인 / 맵 선택 / 게임 화면
│   ├── urls.py
│   ├── templates/game/     # base, home, map_select, index(게임)
│   └── static/game/js/
│       ├── game.js         # Phaser 게임 로직 (물리, 슬링샷, 카메라, 승패 판정, 모드 전환)
│       └── hand_control.js # MediaPipe Hands 손 인식, 주먹/손 폄 판정
├── accounts/               # 회원가입 / 로그인 / 로그아웃
└── matches/                # 유저별 승패 기록
```

슬링샷 당기기/발사 로직은 `game.js`의 `beginPull` / `movePull` / `finishPull`에만 있고,
마우스 이벤트와 `hand_control.js`(`window.campullBegin/Move/End`)가 모두 이 메서드를 호출합니다.

### 맵 데이터 (`game/maps.py`)

- 맵 데이터는 이 파일 한 곳에 있고, 게임 화면에는 선택한 맵만 JSON으로 넘깁니다.
- 블록 종류: `wood`(hp1), `stone`(hp2), `pig`(목표), `rock`(움직이지 않고 부서지지 않는 지형)
- 좌표는 월드 기준, 블록의 x/y는 중심 좌표입니다. 바닥 윗면은 `height - 40`입니다.

## 회원가입 / 로그인 / 전적 (accounts, matches 앱)

- `accounts` 앱: `/accounts/signup/` 회원가입, `/accounts/login/` 로그인, `/accounts/logout/` 로그아웃(POST)
  - Django 기본 `User` 모델과 인증 뷰를 그대로 사용합니다.
- `matches` 앱: 유저별 승/패 기록을 저장하는 `Match` 모델
  - `POST /matches/record/` : `{"result": "win"|"lose", "map_name": "...", "shots_used": 3}` 저장 (로그인 필요, CSRF 토큰 필요)
  - `GET /matches/summary/` : 내 전적 집계 JSON `{"total", "wins", "losses"}`
  - `GET /matches/` : 내 전적 페이지
- 게임 결과는 승리/패배 시 자동으로 저장되고, 맵 선택 화면에 맵별 클리어 횟수가 표시됩니다.
