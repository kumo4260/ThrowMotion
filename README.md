# 슬링샷 대전 게임 - 임시 테스트 버전 (1주차 프로토타입)

현재 버전은 1~3주차 목표 중 아래 부분을 구현한 **임시 테스트 빌드**입니다.

- 임시 맵 2개 (기본 피라미드 / 트윈 타워)
- Phaser.js Arcade Physics 기반 블록 파괴 물리 연산
- **웹캠/MediaPipe 대신 마우스 드래그**로 새총(슬링샷) 당기기(Grab)/발사(Release) 조작
- 조준선(가이드 라인) + 발사 궤적 미리보기
- 승리(돼지 전부 제거) / 패배(새 소진) / 다시하기 게임 루프

MediaPipe Hands 연동은 다음 단계 작업이며, `game/static/game/js/game.js` 안의
`dragstart` / `drag` / `dragend` 세 이벤트 핸들러만 손가락 좌표 기반 로직으로
교체하면 됩니다. (손 벌림 정도로 Grab 판정 → 손 이동으로 drag → 손 펴면 dragend)

## 실행 방법

```bash
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
python manage.py runserver
```

브라우저에서 http://127.0.0.1:8000 접속.

## 조작 방법

1. 화면 왼쪽의 빨간 새를 마우스로 클릭한 채 당깁니다(최대 당김 거리 제한 있음).
2. 마우스를 놓으면 당긴 방향의 반대쪽으로 발사됩니다.
3. 상단 버튼으로 맵 전환(맵1/맵2) 및 다시하기가 가능합니다.

## 폴더 구조

```
slingshot_game/
├── manage.py
├── requirements.txt
├── slingshot_game/        # Django 프로젝트 설정 (settings, urls)
└── game/                  # 게임 앱
    ├── views.py            # 게임 화면 렌더링
    ├── urls.py
    ├── templates/game/index.html
    └── static/game/js/
        ├── maps.js         # 임시 맵 2개 데이터
        └── game.js         # Phaser 게임 로직 (물리, 슬링샷, 승패 판정)
```

## 다음 단계 (2~3주차)와의 연결 지점

- `MAX_PULL`, `LAUNCH_POWER` 등 상수는 손가락 거리 기반 제스처 판정으로 교체될 값입니다.
- `launchBird()` 함수가 "발사" 로직의 핵심이라 MediaPipe의 Release 판정 결과를
  그대로 호출하면 됩니다.
- 4주차 이후 백엔드 작업(회원가입/전적 API)은 `game` 앱 옆에 `accounts`,
  `matches` 같은 앱을 추가해 확장하면 기존 구조를 그대로 재사용할 수 있습니다.
