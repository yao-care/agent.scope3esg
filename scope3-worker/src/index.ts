export default {
  async fetch(_request: Request, _env: unknown): Promise<Response> {
    return new Response('scope3-worker');
  },
};
