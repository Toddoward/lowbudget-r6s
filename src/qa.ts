/**
 * QA / debug features (local WebMCP agent slots, same-browser BroadcastChannel
 * rooms, tier X-ray, bridge overlay, free camera, fast rounds) ship only in
 * development and in builds made with VITE_QA=1 (the `develop` branch preview).
 * Production builds tree-shake them out of the UI (spec #24).
 */
// MODE (not DEV): `vite build` is always mode "production", even when the shell exports NODE_ENV=development
export const QA: boolean = import.meta.env.MODE === 'development' || import.meta.env.VITE_QA === '1';
