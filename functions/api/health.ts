export const onRequest = async (): Promise<Response> =>
  new Response(JSON.stringify({ ok: true, service: 'r6s-temu pages' }), { headers: { 'content-type': 'application/json' } });
