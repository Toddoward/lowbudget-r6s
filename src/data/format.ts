/**
 * How data files are written (migration script, editor): 2-space JSON whose short arrays and small objects stay on one
 * line, so a weapon, a wall or a prop reads as one row. Numbers are rounded to 6 decimals (micrometres).
 */
const WIDTH = 110;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (n: number) => (Number.isInteger(n) ? n : Math.round(n * 1e6) / 1e6);
const clean = (v: unknown): unknown => (typeof v === 'number' ? num(v) : Array.isArray(v) ? v.map(clean) : isObj(v) ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, clean(x)])) : v);

function inline(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(inline).join(', ')}]`;
  if (isObj(v)) {
    const e = Object.entries(v);
    return e.length ? `{ ${e.map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`).join(', ')} }` : '{}';
  }
  return JSON.stringify(v);
}

function block(v: unknown, pad: string, depth: number): string {
  const one = inline(v);
  const flat = Array.isArray(v) ? v.every((x) => !isObj(x) && !Array.isArray(x)) : false;
  if (depth > 0 && pad.length + one.length <= WIDTH && (flat || !one.includes('{ {') )) {
    if (!isObj(v) || one.length <= 72 || !Object.values(v).some((x) => isObj(x))) return one;
  }
  const inner = pad + '  ';
  if (Array.isArray(v)) return v.length ? `[\n${v.map((x) => inner + block(x, inner, depth + 1)).join(',\n')}\n${pad}]` : '[]';
  if (isObj(v)) {
    const e = Object.entries(v);
    return e.length ? `{\n${e.map(([k, x]) => `${inner}${JSON.stringify(k)}: ${block(x, inner, depth + 1)}`).join(',\n')}\n${pad}}` : '{}';
  }
  return one;
}

export function formatJson(v: unknown): string {
  return block(clean(v), '', 0) + '\n';
}
