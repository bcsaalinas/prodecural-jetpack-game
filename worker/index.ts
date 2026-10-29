interface Env {
  ASSETS: Fetcher;
  CHANNEL: string;
  VERSION: string;
}

// Beta release identity. The page itself is the Vite build in ./dist.
// This handler only owns the small API so the lab can report which upload is live.
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/version") {
      return Response.json({
        name: "jetpack-mechanics-lab",
        version: env.VERSION,
        channel: env.CHANNEL,
      });
    }

    return env.ASSETS.fetch(request);
  },
};
