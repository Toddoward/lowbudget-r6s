/**
 * WebMCP schemas — the contract external LLM / AI agents use to play.
 * Mirrors AGENT_CONTEXT.md at the repository root.
 */
export const WEBMCP_VERSION = '1.0.0';

export const ACTION_SCHEMA = {
  $id: 'r6s-2015/webmcp/action',
  type: 'object',
  description: 'One control frame. Continuous inputs (move, fire hold, interact hold) persist for durationMs (default 250 ms) unless replaced by a newer action.',
  properties: {
    move: { type: 'object', properties: { forward: { type: 'number', minimum: -1, maximum: 1 }, strafe: { type: 'number', minimum: -1, maximum: 1, description: '+ = right' }, sprint: { type: 'boolean' } } },
    lookLerp: {
      type: 'object',
      description: 'Rotate toward a target orientation with the same angular-rate limit as a human (≤ 540°/s), interpolated by `rate` per 1/60 s.',
      properties: {
        yaw: { type: 'number', description: 'absolute compass heading in degrees (0 = North, 90 = East)' },
        pitch: { type: 'number', description: 'absolute pitch in degrees (+ up, -85..85)' },
        yawDelta: { type: 'number', description: 'relative degrees, + = right (use vision[].yawDelta directly)' },
        pitchDelta: { type: 'number', description: 'relative degrees, + = up' },
        targetId: { type: 'string', description: 'track a currently visible entity id from data-first-person-vision' },
        rate: { type: 'number', minimum: 0.01, maximum: 1, default: 0.25 },
      },
    },
    stance: { enum: ['stand', 'crouch', 'prone'] },
    lean: { enum: ['left', 'right', 'none', 'Q', 'E'] },
    fire: { oneOf: [{ type: 'boolean' }, { type: 'object', properties: { burst: { type: 'integer', minimum: 1, maximum: 30 } } }] },
    ads: { type: 'boolean' },
    reload: { type: 'boolean' },
    melee: { type: 'boolean' },
    switchWeapon: { enum: ['primary', 'secondary', 'gadget', 'universal'] },
    gadget: { enum: ['use', 'detonate', 'equip', 'equip_universal', 'key', 'key_hold', 'key_universal', 'key_universal_hold'], description: "use = fire the equipped gadget once (place/throw/launch/swing); detonate = remote trigger; key/key_universal = tap the human [G]/[X] context key (equip tool, throw, toggle Montagne shield, Blitz flash, detonate); key_hold/key_universal_hold = hold it (durationMs ≥ 1.6 s) to PLACE a charge/EDD/LMG on what you're looking at" },
    ping: { type: 'boolean', description: 'spot the enemy under your crosshair (team sees it 5 s) or drop a ping marker' },
    interact: { oneOf: [{ type: 'boolean' }, { enum: ['press', 'hold'] }], description: 'context action [F]: barricade, reinforce, vault, hostage, plant/defuse, rappel hook' },
    rappel: { enum: ['start', 'up', 'down', 'left', 'right', 'stop', 'invert', 'swing', 'detach'] },
    drone: { type: 'object', description: 'prep phase (attackers): drive the drone', properties: { forward: { type: 'number' }, strafe: { type: 'number' }, jump: { type: 'boolean' } } },
    durationMs: { type: 'integer', minimum: 16, maximum: 5000, default: 250 },
  },
  additionalProperties: false,
} as const;

export const OBSERVATION_SCHEMA = {
  $id: 'r6s-2015/webmcp/observation',
  type: 'object',
  properties: {
    tick: { type: 'integer' },
    self: { type: 'object', description: 'data-self-state' },
    vision: { type: 'array', description: 'data-first-person-vision: only entities inside the camera frustum AND not occluded (Rapier raycast) — holes in walls count as see-through.' },
    acoustic: { type: 'array', description: 'data-acoustic-cues: sounds from the last 3 s with relative direction (16-point compass, N = straight ahead) or Above_Floor / Below_Floor.' },
    match: { type: 'object', description: 'data-match-state: mode, phase, timer, mission, objective site (public knowledge), score' },
  },
} as const;

export const TOOLS = [
  { name: 'r6_observe', description: 'Return the current first-person observation (self, vision, acoustic cues, match).', inputSchema: { type: 'object', properties: { agentId: { type: 'string' } } } },
  { name: 'r6_act', description: 'Apply one control frame (see action schema).', inputSchema: { type: 'object', properties: { agentId: { type: 'string' }, action: ACTION_SCHEMA } } },
  { name: 'r6_join_room', description: 'Join a PvP room with a nickname and a 6-character code like R6-8492. mode "local" = same-browser tabs (QA builds only).', inputSchema: { type: 'object', properties: { nickname: { type: 'string' }, roomCode: { type: 'string' }, mode: { enum: ['online', 'local'] } }, required: ['nickname', 'roomCode'] } },
  { name: 'r6_start_terrorist_hunt', description: 'Start single-player Terrorist Hunt.', inputSchema: { type: 'object', properties: { difficulty: { enum: ['Normal', 'Hard', 'Realistic'] }, mission: { enum: ['elimination', 'bomb', 'hostage', 'secure', 'random'] } } } },
  { name: 'r6_select_loadout', description: 'In a PvP lobby: choose squad / operator / attacker spawn / ready.', inputSchema: { type: 'object', properties: { squad: { enum: ['A', 'B'] }, operator: { type: 'string' }, spawn: { enum: ['construction', 'docks', 'apc', 'sidestreet'] }, ready: { type: 'boolean' } } } },
  { name: 'r6_map_knowledge', description: 'Static House layout (rooms, floors, stairs, hatches, openings) — the same knowledge a human player has.', inputSchema: { type: 'object', properties: {} } },
];
