// Cloudflare/Sites entry point. Static files are emitted to dist/client.
export default {
  async fetch(request, env) {
    if (!env.ASSETS?.fetch) return new Response("Static asset binding unavailable.", { status: 500 });
    const response = await env.ASSETS.fetch(request);
    if (response.status !== 404) return response;
    const url = new URL(request.url);
    url.pathname = "/index.html";
    return env.ASSETS.fetch(new Request(url, request));
  },
};
