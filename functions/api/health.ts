export const onRequest = async (): Promise<Response> =>
  new Response(JSON.stringify({ ok: true, service: 'r6s-original-2015 pages' }), { headers: { 'content-type': 'application/json' } });
