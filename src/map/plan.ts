/**
 * Plan scale of the House and its grounds. The layout numbers are the trace of the source model
 * (tools/level/README.md); every horizontal coordinate is multiplied by PLAN where the map data is
 * defined, while heights (storeys, stair rises, sills, props) stay as traced — the traced plan was
 * cramped next to the storey height (doors under 1.1 m, rooms a step across).
 */
export const PLAN = 1.3;
/** a traced horizontal coordinate → world metres */
export const P = (v: number) => v * PLAN;
