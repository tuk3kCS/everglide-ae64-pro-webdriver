// Cloudflare/Sites entry point. Static files are emitted to dist/client.
export default {
  async fetch(request, env) {
    if (!env.ASSETS?.fetch) return new Response("Static asset binding unavailable.", { status: 500 });
    const response = await env.ASSETS.fetch(request);
    if (response.status !== 404) return response;
    const url = new URL(request.url);
    if (url.pathname === "/v2") {
      url.pathname = "/v2/";
      return Response.redirect(url, 308);
    }
    if (url.pathname.startsWith("/v2/")) {
      if (url.pathname !== "/v2/") return response;
      url.pathname = "/v2/index.html";
      return env.ASSETS.fetch(new Request(url, request));
    }
    url.pathname = "/index.html";
    return env.ASSETS.fetch(new Request(url, request));
  },
};
