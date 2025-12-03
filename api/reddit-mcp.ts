// api/reddit-mcp.ts

// Environment variables this function expects:
//
// REDDIT_BRIDGE_URL
//   → your existing bridge:
//      https://reddit-sentiment-service-pcwdi0rel-bbbgggrrrs-projects.vercel.app/api/search_reddit_comments
//
// REDDIT_BRIDGE_BYPASS_SECRET (optional)
//   → the Vercel "Protection Bypass for Automation" secret for the *reddit-sentiment-service* project.
//      Used as x-vercel-protection-bypass header.
//
// MCP_WRAPPER_KEY (optional but recommended)
//   → a secret that Agent Builder must send as X-MCP-KEY to call this wrapper.

type RedditBridgeRequest = {
  subreddit: string;
  query: string;
  size?: number;
  before?: number;
  after?: number;
};

export default {
  async fetch(request: Request): Promise<Response> {
    try {
      if (request.method !== "POST") {
        return json(
          { error: "Method not allowed. Use POST." },
          405
        );
      }

      const wrapperKey = process.env.MCP_WRAPPER_KEY;
      if (wrapperKey) {
        const header = request.headers.get("x-mcp-key");
        if (!header || header !== wrapperKey) {
          return json({ error: "Unauthorised." }, 401);
        }
      }

      const bridgeUrl = process.env.REDDIT_BRIDGE_URL;
      if (!bridgeUrl) {
        return json(
          { error: "Server misconfigured: REDDIT_BRIDGE_URL not set." },
          500
        );
      }

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json(
          { error: "Request body must be valid JSON." },
          400
        );
      }

      // Very light validation – enough for now
      if (
        typeof (body as any).subreddit !== "string" ||
        typeof (body as any).query !== "string"
      ) {
        return json(
          {
            error:
              "Body must include string fields 'subreddit' and 'query'.",
          },
          400
        );
      }

      const payload: RedditBridgeRequest = {
        subreddit: (body as any).subreddit,
        query: (body as any).query,
        size: (body as any).size,
        before: (body as any).before,
        after: (body as any).after,
      };

      const bypassSecret =
        process.env.REDDIT_BRIDGE_BYPASS_SECRET;

      const headers: Record<string, string> = {
        "content-type": "application/json",
      };

      // If your reddit-sentiment-service is behind Vercel Authentication /
      // Deployment Protection, this header lets automation bypass it.
      // Value should be the "Protection Bypass for Automation" secret
      // from that project.
      if (bypassSecret) {
        headers["x-vercel-protection-bypass"] = bypassSecret;
      }

      // Forward to your existing bridge
      const upstream = await fetch(bridgeUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });

      const text = await upstream.text();

      // Try to parse JSON; if not JSON, just return raw text
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }

      if (!upstream.ok) {
        return json(
          {
            error: "Upstream bridge error.",
            status: upstream.status,
            detail: data,
          },
          502
        );
      }

      // Pass-through response for now – your agent can work with whatever
      // the bridge returns. You can add normalisation later.
      return json(
        {
          ok: true,
          bridge_status: upstream.status,
          bridge_url: bridgeUrl,
          data,
        },
        200
      );
    } catch (err: any) {
      return json(
        {
          error: "Unexpected server error.",
          detail:
            typeof err?.message === "string"
              ? err.message
              : "Unknown error",
        },
        500
      );
    }
  },
};

function json(
  data: unknown,
  status = 200
): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}
