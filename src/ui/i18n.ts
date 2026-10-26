/**
 * Tiny i18n layer (Korean / English).
 *
 *  t('menu.play')                → string in the current language
 *  t('action.reinforce|2')       → "key|arg|arg" packed form (game code can hand
 *                                  the HUD a single string; args fill {0} {1}…)
 *  applyDom(root)                → fills [data-i18n], [data-i18n-ph], [data-i18n-title]
 *
 * Default language follows the browser (ko → Korean), saved in localStorage.
 */
export type Lang = 'ko' | 'en';

type Entry = { ko: string; en: string };
const D: Record<string, Entry> = {
  /* ---------------------------------------------------------------- brand & menu */
  'brand.sub': { ko: '테무 에디션 · 브라우저 전술 FPS', en: 'TEMU EDITION · BROWSER TACTICAL FPS' },
  'brand.tag': { ko: '비상업 팬 오마주 · 오리지널 House (2015) · 로우폴리 · 실시간 파괴', en: 'Non-commercial fan tribute · Original House (2015) · low-poly · real-time destruction' },
  'menu.quick': { ko: '빠른 시작', en: 'Quick Play' },
  'menu.quickSub': { ko: '테러리스트 헌트 · 혼자서 바로', en: 'Terrorist Hunt · solo, right now' },
  'menu.pvp': { ko: '멀티플레이', en: 'Multiplayer' },
  'menu.pvpSub': { ko: '닉네임 + 방 코드로 친구와', en: 'Friends via nickname + room code' },
  'menu.settings': { ko: '설정', en: 'Settings' },
  'menu.controls': { ko: '조작법', en: 'Controls' },
  'menu.th': { ko: '테러리스트 헌트', en: 'Terrorist Hunt' },
  'menu.thSub': { ko: '오퍼레이터·미션·난이도를 골라 출동', en: 'Pick operator, mission and difficulty' },
  'menu.quickSub2': { ko: '{0}(으)로 바로 출동 · 무작위 미션', en: 'Deploy now as {0} · random mission' },
  'menu.settingsSub': { ko: '언어 · 감도 · 그래픽', en: 'Language · sensitivity · video' },
  'menu.controlsSub': { ko: '키 확인 · 키 바꾸기', en: 'View & rebind keys' },
  'menu.localAgents': { ko: '로컬 WebMCP 에이전트 팀원', en: 'Local WebMCP agent teammates' },
  'menu.agentGuide': { ko: 'AI 에이전트 접속 가이드 (WebMCP)', en: 'AI agent guide (WebMCP)' },
  'menu.badCode': { ko: '방 코드를 입력하세요 (예: R6-8492)', en: 'Enter a room code (e.g. R6-8492)' },
  'set.crouchTap': { ko: '탭: 앉기 토글 · 길게: 엎드리기', en: 'Tap: toggle · hold: prone' },
  'set.noModifiers': { ko: 'Ctrl/Alt/⌘ 키는 브라우저 단축키와 겹쳐서 쓸 수 없습니다', en: 'Ctrl/Alt/⌘ clash with browser shortcuts and can’t be bound' },
  'help.close': { ko: '[{0}] 닫기', en: '[{0}] close' },
  'help.context': { ko: '상호작용 키는 바라보는 대상에 따라 바뀝니다: 바리케이드 · 벽 강화 · 레펠 · 인질 · 폭탄 · 탄약 상자. 화면 아래 안내를 보세요.', en: 'Interact changes with what you look at: barricade · reinforce · rappel · hostage · bomb · ammo crate. Watch the prompt under the crosshair.' },
  'help.rappel': { ko: '레펠: 외벽이나 지붕 끝을 보고 상호작용. W/S 오르내리기, A/D 옆으로, 앉기 키로 거꾸로, 상호작용으로 창문 돌파, 넘어가기 키로 내리기.', en: 'Rappel: look at an outer wall or roof edge and interact. W/S climb, A/D traverse, crouch to invert, interact to breach a window, vault to let go.' },
  'help.walls': { ko: '벽: 소프트월은 총알·근접·폭약으로 뚫립니다. 강화된 벽은 써마이트만 뚫을 수 있습니다. 반파괴 벽은 샛기둥이 남습니다.', en: 'Walls: soft walls take bullets, melee and charges. Reinforced walls only open to Thermite. Semi walls keep their studs.' },
  'menu.back': { ko: '뒤로', en: 'Back' },
  'menu.deploy': { ko: '출동', en: 'Deploy' },
  'menu.operator': { ko: '오퍼레이터', en: 'Operator' },
  'menu.mission': { ko: '미션', en: 'Mission' },
  'menu.tod': { ko: '시간대', en: 'Time of day' },
  'menu.difficulty': { ko: '난이도', en: 'Difficulty' },
  'menu.spawn': { ko: '진입 지점', en: 'Spawn' },
  'menu.random': { ko: '무작위', en: 'Random' },
  'menu.morning': { ko: '아침', en: 'Morning' },
  'menu.night': { ko: '밤', en: 'Night' },
  'menu.nickname': { ko: '닉네임', en: 'Nickname' },
  'menu.roomCode': { ko: '방 코드', en: 'Room code' },
  'menu.createRoom': { ko: '새 방 만들기', en: 'Create room' },
  'menu.joinRoom': { ko: '참가', en: 'Join' },
  'menu.roomHint': { ko: '친구에게 받은 코드를 입력하거나, 새 방을 만들어 코드를 공유하세요.', en: 'Enter a code from a friend, or create a room and share its code.' },
  'menu.loading': { ko: '불러오는 중…', en: 'Loading…' },
  'menu.loadPhysics': { ko: '물리 엔진과 3D 에셋을 불러오는 중…', en: 'Loading physics and 3D assets…' },
  'menu.loadHouse': { ko: 'House를 짓는 중…', en: 'Building the House…' },
  'menu.loadSuburb': { ko: '주변 동네를 짓는 중…', en: 'Building the neighbourhood…' },
  'menu.loadNav': { ko: '봇 내비게이션 계산 중…', en: 'Baking bot navigation…' },
  'menu.ready': { ko: '준비 완료', en: 'Ready' },
  'menu.failed': { ko: '시작하지 못했습니다: {0}. WebGL2와 WebAssembly가 필요합니다.', en: 'Failed to start: {0}. WebGL2 + WebAssembly are required.' },
  'menu.attackers': { ko: '공격팀', en: 'Attackers' },
  'menu.defenders': { ko: '수비팀', en: 'Defenders' },
  'menu.speed': { ko: '속도', en: 'Speed' },
  'menu.armor': { ko: '방어력', en: 'Armor' },
  'menu.role': { ko: '역할', en: 'Role' },
  'menu.continue': { ko: '이어하기', en: 'Continue' },

  'mission.random': { ko: '무작위', en: 'Random' },
  'mission.elimination': { ko: '섬멸', en: 'Classic (eliminate)' },
  'mission.bomb': { ko: '폭탄 해체', en: 'Disarm Bomb' },
  'mission.hostage': { ko: '인질 구출', en: 'Hostage Rescue' },
  'mission.secure': { ko: '구역 확보', en: 'Secure Area' },
  'missionShort.elimination': { ko: '섬멸', en: 'CLASSIC' },
  'missionShort.bomb': { ko: '폭탄', en: 'BOMB' },
  'missionShort.hostage': { ko: '인질', en: 'HOSTAGE' },
  'missionShort.secure': { ko: '구역 확보', en: 'SECURE AREA' },
  'diff.Normal': { ko: '보통', en: 'Normal' },
  'diff.Hard': { ko: '어려움', en: 'Hard' },
  'diff.Realistic': { ko: '현실적', en: 'Realistic' },
  'spawn.construction': { ko: '공사장 (북)', en: 'Construction Site (N)' },
  'spawn.docks': { ko: '강가 부두 (동)', en: 'River Docks (E)' },
  'spawn.apc': { ko: '장갑차 구역 (남서)', en: 'APC Area (SW)' },
  'spawn.sidestreet': { ko: '옆길 (남)', en: 'Side Street (S)' },

  /* ---------------------------------------------------------------- roles */
  'role.breacher': { ko: '브리처', en: 'Breacher' },
  'role.hardBreacher': { ko: '하드 브리처', en: 'Hard Breacher' },
  'role.support': { ko: '서포터', en: 'Support' },
  'role.intel': { ko: '정보', en: 'Intel' },
  'role.fragger': { ko: '공격수', en: 'Fragger' },
  'role.anchor': { ko: '앵커', en: 'Anchor' },
  'role.trapper': { ko: '트래퍼', en: 'Trapper' },
  'role.antiGadget': { ko: '안티 가젯', en: 'Anti-gadget' },
  'role.shield': { ko: '방패', en: 'Shield' },
  'role.flank': { ko: '로머', en: 'Roamer' },

  /* ---------------------------------------------------------------- settings */
  'set.title': { ko: '설정', en: 'Settings' },
  'set.tabGeneral': { ko: '일반', en: 'General' },
  'set.tabControls': { ko: '조작', en: 'Controls' },
  'set.tabVideo': { ko: '그래픽', en: 'Video' },
  'set.language': { ko: '언어', en: 'Language' },
  'set.sens': { ko: '마우스 감도', en: 'Mouse sensitivity' },
  'set.adsSens': { ko: '조준 시 감도 배율', en: 'ADS sensitivity multiplier' },
  'set.invertY': { ko: '마우스 상하 반전', en: 'Invert mouse Y' },
  'set.fov': { ko: '시야각 (FOV)', en: 'Field of view' },
  'set.quality': { ko: '그래픽 품질', en: 'Quality' },
  'set.qHigh': { ko: '높음 (블룸, 2k 그림자)', en: 'High (bloom, 2k shadows)' },
  'set.qMed': { ko: '중간', en: 'Medium' },
  'set.qLow': { ko: '낮음', en: 'Low' },
  'set.volume': { ko: '음량', en: 'Volume' },
  'set.leanToggle': { ko: '기울이기 방식', en: 'Lean mode' },
  'set.crouchToggle': { ko: '앉기 방식', en: 'Crouch mode' },
  'set.adsToggle': { ko: '조준 방식', en: 'Aim mode' },
  'set.hold': { ko: '누르고 있기', en: 'Hold' },
  'set.toggle': { ko: '토글', en: 'Toggle' },
  'set.fullscreen': { ko: '전체 화면 + 브라우저 단축키 잠금', en: 'Fullscreen + lock browser shortcuts' },
  'set.fullscreenHint': { ko: '플레이 중 Ctrl+W/T/N 같은 브라우저 단축키가 게임을 끊지 않게 합니다 (Chrome, 전체 화면에서만 동작).', en: 'Keeps browser shortcuts like Ctrl+W/T/N from interrupting play (Chrome, fullscreen only).' },
  'set.crosshair': { ko: '조준점 색', en: 'Crosshair color' },
  'set.rebindHint': { ko: '바꿀 동작을 클릭한 뒤 새 키를 누르세요. Esc는 취소, Backspace는 해제.', en: 'Click an action, then press the new key. Esc cancels, Backspace clears.' },
  'set.pressKey': { ko: '키를 누르세요…', en: 'Press a key…' },
  'set.reset': { ko: '기본값으로', en: 'Reset to defaults' },
  'set.conflict': { ko: '{0}에도 쓰이던 키라서 거기서 해제했습니다.', en: 'That key was bound to {0}; it was cleared there.' },
  'set.close': { ko: '닫기', en: 'Close' },

  /* ---------------------------------------------------------------- key actions */
  'key.forward': { ko: '앞으로', en: 'Move forward' },
  'key.back': { ko: '뒤로', en: 'Move back' },
  'key.left': { ko: '왼쪽', en: 'Strafe left' },
  'key.right': { ko: '오른쪽', en: 'Strafe right' },
  'key.sprint': { ko: '달리기', en: 'Sprint' },
  'key.crouch': { ko: '앉기 (길게: 엎드리기)', en: 'Crouch (hold: prone)' },
  'key.prone': { ko: '엎드리기', en: 'Prone' },
  'key.leanL': { ko: '왼쪽 기울이기', en: 'Lean left' },
  'key.leanR': { ko: '오른쪽 기울이기', en: 'Lean right' },
  'key.fire': { ko: '사격', en: 'Fire' },
  'key.ads': { ko: '조준', en: 'Aim down sights' },
  'key.reload': { ko: '재장전', en: 'Reload' },
  'key.melee': { ko: '근접 공격', en: 'Melee' },
  'key.interact': { ko: '상호작용 (상황별)', en: 'Interact (context)' },
  'key.vault': { ko: '넘어가기 / 올라서기', en: 'Vault / climb' },
  'key.gadget': { ko: '오퍼레이터 가젯 (상황별)', en: 'Operator gadget (context)' },
  'key.gadget2': { ko: '보조 가젯', en: 'Secondary gadget' },
  'key.primary': { ko: '주무기', en: 'Primary weapon' },
  'key.secondary': { ko: '보조무기', en: 'Secondary weapon' },
  'key.observe': { ko: '드론 / 감시 카메라', en: 'Drone / cameras' },
  'key.ping': { ko: '적 표시 (핑)', en: 'Ping / spot' },
  'key.flashlight': { ko: '손전등', en: 'Flashlight' },
  'key.score': { ko: '점수판', en: 'Scoreboard' },
  'key.help': { ko: '도움말', en: 'Help' },
  'key.xray': { ko: '[QA] 벽체 X-ray', en: '[QA] Wall X-ray' },
  'key.overlay': { ko: '[QA] WebMCP 오버레이', en: '[QA] WebMCP overlay' },
  'key.none': { ko: '없음', en: 'None' },
  'key.group.move': { ko: '이동', en: 'Movement' },
  'key.group.combat': { ko: '전투', en: 'Combat' },
  'key.group.gear': { ko: '장비 · 정보', en: 'Gear · intel' },
  'key.group.ui': { ko: '인터페이스', en: 'Interface' },

  /* ---------------------------------------------------------------- HUD */
  'hud.compass': { ko: '북,북동,동,남동,남,남서,서,북서', en: 'N,NE,E,SE,S,SW,W,NW' },
  'hud.iqScan': { ko: '전자장비 탐지', en: 'ELECTRONICS SCAN' },
  'hud.shieldExt': { ko: '방패 펼침', en: 'SHIELD EXTENDED' },
  'hud.blinded': { ko: '섬광!', en: 'FLASHED' },
  'hint.nextMate': { ko: '다음 아군', en: 'Next teammate' },
  'hint.skipPrep': { ko: '준비 단계 건너뛰기', en: 'Skip prep' },
  'hint.drone': { ko: '드론', en: 'Drone' },
  'hint.cams': { ko: '감시 카메라', en: 'Cameras' },
  'hint.ping': { ko: '핑', en: 'Ping' },
  'hint.allKeys': { ko: '전체 조작', en: 'All controls' },
  'hint.clickToLock': { ko: '클릭해서 조작 시작', en: 'Click to take control' },
  'gname.hammer': { ko: '브리칭 해머', en: 'Breaching Hammer' },
  'gname.ash_round': { ko: '브리칭탄', en: 'Breaching Round' },
  'gname.thermite': { ko: '써마이트 폭약', en: 'Exothermic Charge' },
  'gname.emp': { ko: 'EMP 수류탄', en: 'EMP Grenade' },
  'gname.cluster': { ko: '집속탄', en: 'Cluster Charge' },
  'gname.scanner': { ko: '전자 탐지기', en: 'Spectre Detector' },
  'gname.shield_ext': { ko: '확장 방패', en: 'Extendable Shield' },
  'gname.flash_shield': { ko: '섬광 방패', en: 'Flash Shield' },
  'gname.gas': { ko: '원격 가스 수류탄', en: 'Remote Gas Grenade' },
  'gname.jammer': { ko: '신호 교란기', en: 'Signal Disruptor' },
  'gname.castle': { ko: '방탄 바리케이드', en: 'Armor Panel' },
  'gname.heartbeat': { ko: '심박 센서', en: 'Cardiac Sensor' },
  'gname.ads': { ko: 'ADS 요격기', en: 'ADS Magpie' },
  'gname.battery': { ko: '쇼크 와이어', en: 'Shock Wire' },
  'gname.edd': { ko: '진입 거부 장치', en: 'Entry Denial Device' },
  'gname.turret': { ko: '거치형 기관총', en: 'Mounted LMG' },
  'gname.breach': { ko: '브리칭 차지', en: 'Breach Charge' },
  'gname.barricade': { ko: '바리케이드', en: 'Barricades' },
  'gname.reinforce': { ko: '벽 강화', en: 'Reinforce' },
  'hud.reloading': { ko: '재장전 중', en: 'RELOADING' },
  'hud.reloadHint': { ko: '재장전 [{0}]', en: 'RELOAD [{0}]' },
  'hud.reinforce': { ko: '강화 {0}', en: 'Reinforce {0}' },
  'hud.left': { ko: '{0}개', en: '×{0}' },
  'hud.phasePrepAtk': { ko: '준비 단계 · 드론 정찰', en: 'PREPARATION · DRONE' },
  'hud.phasePrepDef': { ko: '준비 단계 · 방어 공사', en: 'PREPARATION · FORTIFY' },
  'hud.phaseAction': { ko: '작전 단계', en: 'ACTION' },
  'hud.phaseOver': { ko: '라운드 종료', en: 'ROUND OVER' },
  'hud.phaseLobby': { ko: '대기실', en: 'LOBBY' },
  'hud.stand': { ko: '서기', en: 'STAND' },
  'hud.crouch': { ko: '앉기', en: 'CROUCH' },
  'hud.prone': { ko: '엎드리기', en: 'PRONE' },
  'hud.rappel': { ko: '레펠', en: 'RAPPEL' },
  'hud.rappelInv': { ko: '레펠 · 거꾸로', en: 'RAPPEL · INVERTED' },
  'hud.leanL': { ko: '왼쪽 기울임', en: 'LEAN L' },
  'hud.leanR': { ko: '오른쪽 기울임', en: 'LEAN R' },
  'hud.day': { ko: '아침', en: 'MORNING' },
  'hud.night': { ko: '밤', en: 'NIGHT' },
  'hud.drone': { ko: '드론', en: 'DRONE' },
  'hud.droneHelp': { ko: '이동 {0}{1}{2}{3} · 점프 {4} · 핑 {5} · 돌아가기 {6}', en: 'Drive {0}{1}{2}{3} · hop {4} · ping {5} · back {6}' },
  'hud.dronePrepHelp': { ko: '준비 단계: 드론으로 목표를 찾으세요 · Enter로 건너뛰기', en: 'Prep phase: find the objective with your drone · Enter to skip' },
  'hud.jammed': { ko: '신호 교란됨', en: 'SIGNAL JAMMED' },
  'hud.droneDestroyed': { ko: '드론 파괴됨', en: 'DRONE DESTROYED' },
  'hud.cam': { ko: '감시 카메라', en: 'CAMERA' },
  'hud.camHelp': { ko: '다음 카메라 {0} / 클릭 · 핑 {1} · 돌아가기 {2}', en: 'Next camera {0} / click · ping {1} · back {2}' },
  'hud.camDestroyed': { ko: '카메라 신호 없음', en: 'NO SIGNAL' },
  'hud.dead': { ko: '전투 불능', en: 'YOU ARE DOWN' },
  'hud.spectating': { ko: '관전 중: {0}', en: 'SPECTATING {0}' },
  'hud.nextMate': { ko: '다음 아군 보기 [Space]', en: 'Next teammate [Space]' },
  'hud.enemiesLeft': { ko: '남은 적 {0}', en: 'Hostiles left {0}' },
  'hud.kills': { ko: '처치 {0}', en: 'Kills {0}' },
  'hud.scan': { ko: '심박 스캔', en: 'HEARTBEAT SCAN' },
  'hud.xray': { ko: 'X-RAY', en: 'X-RAY' },
  'hud.spotted': { ko: '적 발견!', en: 'SPOTTED' },
  'hud.ping': { ko: '여기', en: 'HERE' },
  'hud.gadgetReady': { ko: '[{0}] {1}', en: '[{0}] {1}' },
  'hud.squad': { ko: '분대', en: 'Squad' },
  'hud.objective': { ko: '목표', en: 'Objective' },
  'hud.clickToPlay': { ko: '클릭하여 계속', en: 'Click to continue' },
  'hud.ammo': { ko: '탄약 보급', en: 'Ammo' },
  'hud.youAre': { ko: '당신은 {0}', en: 'You are {0}' },
  'hud.attacking': { ko: '공격팀', en: 'ATTACKING' },
  'hud.defending': { ko: '수비팀', en: 'DEFENDING' },
  'hud.round': { ko: '라운드 {0}', en: 'ROUND {0}' },

  /* ---------------------------------------------------------------- context actions */
  'action.barricadeWindow': { ko: '[{F}] 길게: 창문 바리케이드', en: 'Hold [{F}] Barricade window' },
  'action.barricadeDoor': { ko: '[{F}] 길게: 문 바리케이드', en: 'Hold [{F}] Barricade door' },
  'action.reinforce': { ko: '[{F}] 길게: 벽 강화 (남은 수 {0})', en: 'Hold [{F}] Reinforce ({0} left)' },
  'action.vault': { ko: '[{V}] 넘어가기', en: '[{V}] Vault over' },
  'action.climb': { ko: '[{V}] 올라서기', en: '[{V}] Climb up' },
  'action.rappel': { ko: '[{F}] 레펠', en: '[{F}] Rappel' },
  'action.rappelHelp': { ko: '[W/S] 오르내리기 · [A/D] 옆으로 · [{C}] 거꾸로 · [{F}] 창문 돌파 · [{V}] 내리기', en: '[W/S] climb · [A/D] traverse · [{C}] invert · [{F}] breach & swing · [{V}] detach' },
  'action.mount': { ko: '[{F}] 기관총 거치 (나가기: {F}/{V})', en: '[{F}] Mount LMG (leave: {F}/{V})' },
  'action.ammo': { ko: '[{F}] 탄약 보급', en: '[{F}] Resupply ammo' },
  'action.ammoFull': { ko: '탄약 가득', en: 'Ammo full' },
  'action.putDownHostage': { ko: '[{F}] 인질 내려놓기', en: '[{F}] Put down hostage' },
  'action.secureHostage': { ko: '[{F}] 길게: 인질 확보', en: 'Hold [{F}] Secure hostage' },
  'action.disarmBomb': { ko: '[{F}] 길게: 폭탄 해체', en: 'Hold [{F}] Disarm bomb' },
  'action.plantDefuser': { ko: '[{F}] 길게: 해체기 설치', en: 'Hold [{F}] Plant defuser' },
  'action.disableDefuser': { ko: '[{F}] 길게: 해체기 무력화', en: 'Hold [{F}] Disable defuser' },
  'action.deployCastle': { ko: '방탄 바리케이드 설치 중…', en: 'Deploying Armor Panel…' },
  'action.placing': { ko: '설치 중…', en: 'Placing…' },
  'gadget.place': { ko: '[{0}] {1} 설치', en: '[{0}] Place {1}' },
  'gadget.throw': { ko: '[{0}] {1} 던지기', en: '[{0}] Throw {1}' },
  'gadget.fire': { ko: '[{0}] {1} 발사', en: '[{0}] Fire {1}' },
  'gadget.detonate': { ko: '[{0}] 기폭', en: '[{0}] Detonate' },
  'gadget.equip': { ko: '[{0}] {1}', en: '[{0}] {1}' },
  'gadget.needTarget': { ko: '{0}: 설치할 곳을 조준하세요', en: '{0}: aim at a valid surface' },
  'gadget.none': { ko: '남은 수량 없음', en: 'None left' },

  /* ---------------------------------------------------------------- banners & results */
  'banner.th': { ko: '테러리스트 헌트 — {0}', en: 'TERRORIST HUNT — {0}' },
  'banner.thSub': { ko: '{0} · {1} · {2} · 드론 정찰 (Enter: 건너뛰기)', en: '{0} · {1} · {2} · drone phase (Enter to skip)' },
  'banner.action': { ko: '작전 개시', en: 'ACTION PHASE' },
  'banner.actionAtk': { ko: '돌파하고 소탕하라', en: 'Breach and clear' },
  'banner.actionDef': { ko: '목표를 사수하라', en: 'Hold the objective' },
  'banner.win': { ko: '임무 성공', en: 'MISSION ACCOMPLISHED' },
  'banner.lose': { ko: '임무 실패', en: 'MISSION FAILED' },
  'banner.roundWon': { ko: '라운드 승리', en: 'ROUND WON' },
  'banner.roundLost': { ko: '라운드 패배', en: 'ROUND LOST' },
  'banner.matchWon': { ko: '매치 승리', en: 'MATCH WON' },
  'banner.matchLost': { ko: '매치 패배', en: 'MATCH LOST' },
  'banner.roundSub': { ko: '{0} · {1} · 당신은 {2}', en: '{0} · {1} · you are {2}' },
  'result.title.win': { ko: '임무 성공', en: 'Mission accomplished' },
  'result.title.lose': { ko: '임무 실패', en: 'Mission failed' },
  'result.kills': { ko: '처치', en: 'Kills' },
  'result.time': { ko: '소요 시간', en: 'Time' },
  'result.accuracy': { ko: '명중률', en: 'Accuracy' },
  'result.headshots': { ko: '헤드샷', en: 'Headshots' },
  'result.retry': { ko: '다시 출동', en: 'Redeploy' },
  'result.change': { ko: '오퍼레이터 변경', en: 'Change operator' },
  'result.menu': { ko: '메인 메뉴', en: 'Main menu' },
  'reason.defuserDisabled': { ko: '해체기 무력화', en: 'Defuser disabled' },
  'reason.bombDefused': { ko: '폭탄 해체', en: 'Bomb defused' },
  'reason.defuserDone': { ko: '해체 완료', en: 'Defuser completed' },
  'reason.atkDead': { ko: '공격팀 전멸', en: 'Attackers eliminated' },
  'reason.defDead': { ko: '수비팀 전멸', en: 'Defenders eliminated' },
  'reason.timeout': { ko: '시간 초과', en: 'Time expired' },
  'reason.allDown': { ko: '아군 전원 사망', en: 'All operators down' },
  'reason.eliminated': { ko: '적 전원 사살', en: 'All hostiles eliminated' },
  'reason.bombs': { ko: '폭탄 해체 완료', en: 'Bombs disarmed' },
  'reason.extracted': { ko: '인질 구출 완료', en: 'Hostage extracted' },
  'reason.secured': { ko: '구역 확보 완료', en: 'Area secured' },
  'reason.hostageKilledAtk': { ko: '공격팀이 인질을 사살함', en: 'Hostage killed by attackers' },
  'reason.hostageKilledDef': { ko: '수비팀이 인질을 사살함', en: 'Hostage killed by defenders' },

  /* ---------------------------------------------------------------- objectives */
  'obj.eliminate': { ko: '화이트 마스크를 전원 제거하세요', en: 'Eliminate all White Masks' },
  'obj.disarm': { ko: '폭탄을 해체하세요 (남은 {0}개)', en: 'Disarm the bombs ({0} left)' },
  'obj.plantDefuser': { ko: '폭탄에 해체기를 설치하세요', en: 'Plant the defuser on a bomb' },
  'obj.protectDefuser': { ko: '해체기 설치됨 — 지켜내세요!', en: 'Defuser planted — protect it!' },
  'obj.locateHostage': { ko: '인질을 찾아 확보하세요 — {0}', en: 'Locate & secure the hostage — {0}' },
  'obj.escort': { ko: '인질을 탈출 지점으로 호송하세요', en: 'Escort the hostage to an extraction zone' },
  'obj.hostageKia': { ko: '인질 사망', en: 'Hostage KIA' },
  'obj.secure': { ko: '생화학 용기를 확보하세요 — {0}', en: 'Secure the biohazard container — {0}' },
  'obj.contested': { ko: '교전 중 — 방을 정리하세요', en: 'CONTESTED — clear the room' },
  'obj.defuserIn': { ko: '해체기 {0}초', en: 'DEFUSER {0}s' },

  /* ---------------------------------------------------------------- pause, lobby, misc */
  'pause.title': { ko: '일시 정지', en: 'Paused' },
  'pause.resume': { ko: '계속하기', en: 'Resume' },
  'pause.quit': { ko: '메인 메뉴로', en: 'Quit to menu' },
  'pause.leaveConfirm': { ko: '경기를 나가시겠어요?', en: 'Leave the match?' },
  'lobby.title': { ko: '방', en: 'Room' },
  'lobby.start': { ko: '경기 시작 (방장)', en: 'Start match (host)' },
  'lobby.leave': { ko: '나가기', en: 'Leave' },
  'lobby.ready': { ko: '준비', en: 'Ready' },
  'lobby.unready': { ko: '준비 취소', en: 'Unready' },
  'lobby.moveTo': { ko: '{0} 분대로', en: 'To squad {0}' },
  'lobby.empty': { ko: '비어 있음', en: 'empty' },
  'lobby.hint': { ko: '코드를 공유하세요. A 분대가 먼저 공격하고 매 라운드 공수가 바뀝니다. 3승 선취. 라운드마다 미션·사이트·시간대가 무작위입니다.', en: 'Share the code. Squad A attacks first; sides swap every round. First to 3. Every round rolls a random mission, site and time of day.' },
  'lobby.copy': { ko: '코드 복사', en: 'Copy code' },
  'lobby.copied': { ko: '복사했습니다', en: 'Copied' },
  'lobby.online': { ko: '온라인', en: 'ONLINE' },
  'lobby.prepPick': { ko: '준비 단계 · 오퍼레이터', en: 'PREP · operator' },
  'lobby.matchOver': { ko: '매치 종료 {0}:{1}', en: 'MATCH OVER {0}:{1}' },
  'net.disconnected': { ko: '연결이 끊겼습니다: {0}', en: 'Disconnected: {0}' },
  'net.reconnecting': { ko: '다시 연결하는 중… ({0})', en: 'Reconnecting… ({0})' },
  'net.reconnected': { ko: '다시 연결되었습니다', en: 'Reconnected' },
  'net.error': { ko: '방: {0}', en: 'Room: {0}' },
  'toast.quality': { ko: '성능: 그래픽 품질을 {0}(으)로 낮췄습니다 (설정에서 변경 가능)', en: 'Performance: quality lowered to {0} (override in Settings)' },
  'toast.flashOn': { ko: '손전등 켬', en: 'Flashlight on' },
  'toast.flashOff': { ko: '손전등 끔', en: 'Flashlight off' },
  'toast.noDrone': { ko: '사용할 수 있는 드론이 없습니다', en: 'No drone available' },
  'toast.noCams': { ko: '작동하는 카메라가 없습니다', en: 'No working cameras' },
  'toast.resupplied': { ko: '탄약을 보급했습니다', en: 'Ammo resupplied' },

  /* ---------------------------------------------------------------- floors & places */
  'floor.B': { ko: '지하', en: 'B' },
  'floor.1F': { ko: '1층', en: '1F' },
  'floor.2F': { ko: '2층', en: '2F' },
  'room.storage': { ko: '창고', en: 'Storage Room' },
  'room.training': { ko: '트레이닝룸', en: 'Training Room' },
  'room.bstairs': { ko: '지하 계단', en: 'Basement Stairs' },
  'room.garage': { ko: '차고', en: 'Garage' },
  'room.laundry': { ko: '세탁실', en: 'Laundry Room' },
  'room.sidestairs_b': { ko: '측면 계단', en: 'Side Stairs' },
  'room.backhall_b': { ko: '뒷 복도', en: 'Back Hallway' },
  'room.living': { ko: '거실', en: 'Living Room' },
  'room.lobby': { ko: '로비', en: 'Lobby' },
  'room.office': { ko: '서재', en: 'Office' },
  'room.dining': { ko: '식당', en: 'Dining Room' },
  'room.kitchen': { ko: '주방', en: 'Kitchen' },
  'room.backentry': { ko: '후문', en: 'Back Entrance' },
  'room.bathroom': { ko: '욕실', en: 'Bathroom' },
  'room.westhall': { ko: '서쪽 홀', en: 'West Hall' },
  'room.hallway2': { ko: '2층 복도', en: 'Upper Hallway' },
  'room.workshop': { ko: '작업실', en: 'Workshop' },
  'room.master': { ko: '안방', en: 'Master Bedroom' },
  'room.closet': { ko: '드레스룸', en: 'Walk-in Closet' },
  'room.kids': { ko: '아이 방', en: "Kids' Room" },
  'place.Lobby Stairs': { ko: '로비 계단', en: 'Lobby Stairs' },
  'place.Basement Stairs': { ko: '지하 계단', en: 'Basement Stairs' },
  'place.Side Stairs': { ko: '측면 계단', en: 'Side Stairs' },
  'place.Storage Stairwell': { ko: '창고 외부 계단', en: 'Storage Stairwell' },
  'place.Roof': { ko: '옥상', en: 'Roof' },
  'place.Porch Roof': { ko: '포치 지붕', en: 'Porch Roof' },
  'place.Front Porch': { ko: '앞 포치', en: 'Front Porch' },
  'place.Back Porch': { ko: '뒤 포치', en: 'Back Porch' },
  'place.Garage Driveway': { ko: '차고 진입로', en: 'Garage Driveway' },
  'place.Construction Site': { ko: '공사장', en: 'Construction Site' },
  'place.River Docks': { ko: '강가 부두', en: 'River Docks' },
  'place.APC Area': { ko: '장갑차 구역', en: 'APC Area' },
  'place.Side Street': { ko: '옆길', en: 'Side Street' },
  'place.Front Yard': { ko: '앞마당', en: 'Front Yard' },
  'place.East Yard': { ko: '동쪽 마당', en: 'East Yard' },
  'place.West Yard': { ko: '서쪽 마당', en: 'West Yard' },
  'place.Back Yard': { ko: '뒷마당', en: 'Back Yard' },
  'place.Exterior': { ko: '외부', en: 'Exterior' },
};

const KEY = 'r6.lang';
let lang: Lang = (() => {
  try {
    const s = localStorage.getItem(KEY);
    if (s === 'ko' || s === 'en') return s;
  } catch { /* storage blocked */ }
  return typeof navigator !== 'undefined' && /^ko/i.test(navigator.language) ? 'ko' : 'en';
})();
const listeners = new Set<() => void>();
/** key-cap lookup for {F}/{V}/{C}-style placeholders (wired to the keybinds module) */
let keyCap: (action: string) => string = (a) => a;

export function getLang(): Lang { return lang; }
export function setLang(l: Lang) {
  lang = l;
  try { localStorage.setItem(KEY, l); } catch { /* ignore */ }
  document.documentElement.lang = l;
  for (const f of listeners) f();
}
export function onLangChange(f: () => void) { listeners.add(f); return () => listeners.delete(f); }
export function setKeyCapResolver(f: (action: string) => string) { keyCap = f; }

const CAP: Record<string, string> = { F: 'interact', V: 'vault', C: 'crouch', G: 'gadget', X: 'gadget2' };

/** translate; accepts "key|arg|arg" packed strings; unknown keys are returned as-is */
export function t(key: string, ...args: (string | number)[]): string {
  return tr(lang, key, args);
}
/** English regardless of the UI language (agent observations, logs) */
export function tEn(key: string, ...args: (string | number)[]): string {
  return tr('en', key, args);
}
function tr(l: Lang, key: string, args: (string | number)[]): string {
  if (!key) return '';
  let k = key;
  if (key.includes('|')) {
    const parts = key.split('|');
    k = parts[0];
    args = [...parts.slice(1), ...args];
  }
  const e = D[k];
  if (!e) return key;
  let s = e[l];
  s = s.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)] ?? ''));
  s = s.replace(/\{([A-Z])\}/g, (_, c) => keyCap(CAP[c] ?? c));
  return s;
}

export function has(key: string) { return key.split('|')[0] in D; }

/** "1F Living Room" style location → localized */
export function localizePlace(name: string): string {
  if (lang === 'en') return name;
  const m = name.match(/^(B|1F|2F) (.*)$/);
  if (m) {
    const room = Object.entries(D).find(([k, v]) => k.startsWith('room.') && v.en === m[2]);
    return `${t(`floor.${m[1]}`)} ${room ? room[1].ko : m[2]}`;
  }
  const p = D[`place.${name}`];
  if (p) return p.ko;
  const room = Object.entries(D).find(([k, v]) => k.startsWith('room.') && v.en === name);
  return room ? room[1].ko : name;
}

export function applyDom(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n!); });
  root.querySelectorAll<HTMLElement>('[data-i18n-ph]').forEach((el) => { (el as HTMLInputElement).placeholder = t(el.dataset.i18nPh!); });
  root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle!); });
}
