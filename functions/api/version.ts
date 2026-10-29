interface Env {
  CHANNEL?: string;
  VERSION?: string;
}

// Pages Function for the same beta identity. Static files are served by Pages;
// this route is the Worker attached to that page.
export function onRequestGet(context: { env: Env }) {
  return Response.json({
    name: "jetpack-mechanics-lab",
    version: context.env.VERSION ?? "0.1.0",
    channel: context.env.CHANNEL ?? "beta",
  });
}
