# ThrowMotion - 슬링샷 대전 게임

브라우저에서 새총으로 새를 날려 돼지를 맞히는 물리 게임입니다.
마우스로 당기거나, **웹캠 앞에서 손 제스처(MediaPipe Hands)**로 조작할 수 있습니다.

- 대형 맵 4개(연습 맵보다 가로 3배) + 연습 맵 2개 (기본 피라미드 / 트윈 타워)
- Phaser.js Arcade Physics 기반 블록 파괴 물리 연산
- **웹캠/MediaPipe 대신 마우스 드래그**로 새총(슬링샷) 당기기(Grab)/발사(Release) 조작
- 조준선(가이드 라인) + 발사 궤적 미리보기
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
python manage.py migrate
python manage.py runserver
```

브라우저에서 http://127.0.0.1:8000 접속.

`DEBUG`는 기본으로 꺼져 있고 `DJANGO_DEBUG=1`일 때만 켜집니다.
DEBUG가 꺼진 상태에서는 정적 파일(JS)을 `collectstatic` 결과에서만 제공하므로,
로컬에서는 `DJANGO_DEBUG=1`을 켜고 실행하세요.

1. 화면 왼쪽의 빨간 새를 마우스로 클릭한 채 당깁니다(최대 당김 거리 제한 있음).
2. 마우스를 놓으면 당긴 방향의 반대쪽으로 발사됩니다.
3. 상단 버튼으로 다시하기, 맵 선택 화면으로 돌아가기가 가능합니다.
4. 대형 맵에서는 카메라가 날아가는 새를 따라갑니다. 방향키(←/→)나 마우스 휠로 맵을 둘러보고, 스페이스로 새총 위치로 돌아옵니다.

## 폴더 구조

```
ThrowMotion/
├── manage.py
├── requirements.txt
├── slingshot_game/        # Django 프로젝트 설정 (settings, urls)
└── game/                  # 게임 앱
    ├── maps.py             # 맵 데이터 (대형 맵 4개 + 연습 맵 2개)
    ├── views.py            # 메인 / 맵 선택 / 게임 화면
    ├── urls.py
    ├── templates/game/     # base, home, map_select, index(게임)
    └── static/game/js/
        ├── hand_control.js # 캠(MediaPipe Hands) 조작
        └── game.js         # Phaser 게임 로직 (물리, 슬링샷, 승패 판정)
```

슬링샷 당기기/발사 로직은 `game.js`의 `beginPull` / `movePull` / `finishPull`에만 있고,
마우스 이벤트와 `hand_control.js`(`window.campullBegin/Move/End`)가 모두 이 메서드를 호출합니다.

## 다음 단계

- `MAX_PULL`, `LAUNCH_POWER` 등 상수는 손가락 거리 기반 제스처 판정으로 교체될 값입니다.
- `launchBird()` 함수가 "발사" 로직의 핵심이라 MediaPipe의 Release 판정 결과를
  그대로 호출하면 됩니다.
- 4주차 이후 백엔드 작업(회원가입/전적 API)은 `game` 앱 옆에 `accounts`,
  `matches` 같은 앱을 추가해 확장하면 기존 구조를 그대로 재사용할 수 있습니다.

## 페이지 흐름

메인(`/`) → 로그인/회원가입(`/accounts/login/`, `/accounts/signup/`) → 맵 선택(`/maps/`) → 게임(`/play/<맵 id>/`)

- 맵 선택과 게임 화면은 로그인이 필요합니다. 로그인하지 않고 들어가면 로그인 화면으로 보내고, 로그인 후 원래 가려던 화면으로 돌아옵니다.
- 맵 데이터는 `game/maps.py` 한 곳에 있고, 게임 화면에는 선택한 맵만 JSON으로 넘깁니다.
  맵 id: `meadow`(초원 마을), `canyon`(바위 협곡), `cliff`(절벽 위의 성), `fortress`(최종 요새), `practice-1`, `practice-2`
- 블록 종류: `wood`(hp1), `stone`(hp2), `pig`(목표), `rock`(움직이지 않고 부서지지 않는 지형)

## 회원가입 / 로그인 / 전적 (accounts, matches 앱)

- `accounts` 앱: `/accounts/signup/` 회원가입, `/accounts/login/` 로그인, `/accounts/logout/` 로그아웃(POST)
  - Django 기본 `User` 모델과 인증 뷰를 그대로 사용합니다.
- `matches` 앱: 유저별 승/패 기록을 저장하는 `Match` 모델
  - `POST /matches/record/` : `{"result": "win"|"lose", "map_name": "...", "shots_used": 3}` 저장 (로그인 필요, CSRF 토큰 필요)
  - `GET /matches/summary/` : 내 전적 집계 JSON `{"total", "wins", "losses"}`
  - `GET /matches/` : 내 전적 페이지
- 게임 결과는 승리/패배 시 자동으로 저장되고, 맵 선택 화면에 맵별 클리어 횟수가 표시됩니다.

테스트 실행:

```bash
python manage.py test
```

배포 환경에서도 DB 테이블이 필요하므로 빌드 단계에 `python manage.py migrate`를 추가해야 합니다.
