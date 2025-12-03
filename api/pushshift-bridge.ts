// api/pushshift-bridge.ts
import { z } from "zod";

// ----- Configuration -----

// Set these in Vercel project settings → Environment Variables
const BRIDGE_URL = process.env.PUSHSHIFT_BRIDGE_URL;
const API_KEY = process.env.PUSHSHIFT_MCP_KEY;

// Simple input validation for the agent → bridge call
const RequestSchema = z.object({
  subreddit: z.string().min(1).describe("Subreddit name, e.g. 'movies'"),
  query: z.string().min(1).describe("Search keywords"),
  size: z.number().int().min(1).max(500).default(50),
  before: z.number().int().optional(), // unix timestamp (seconds)
  after: z.number().int().optional()   // unix timestamp (seconds)
});

type RequestBody = z.infer<typeof RequestSchema>;

// Shape we return to the agent
type NormalisedComment = {
  id: string;
  author: string | null;
  body: string;
  score: number | null;
  created_utc: number | null;
  permalink: string | null;
  subreddit: string | null;
};

export default {
  async fetch(request: Request): Promise<Response> {
    try {
      if (request.method !== "POST") {
        return jsonResponse(
          { error: "Method not allowed. Use POST." },
          405
        );
      }

      if (!BRIDGE_URL) {
        return jsonResponse(
          {
            error:
              "PUSHSHIFT_BRIDGE_URL is not configured on the server."
          },
          500
        );
      }

      if (!API_KEY) {
        return jsonResponse(
          {
            error:
              "PUSHSHIFT_MCP_KEY is not configured on the server."
          },
          500
        );
      }

      const authHeader = request.headers.get("x-mcp-key");
      if (!authHeader || authHeader !== API_KEY) {
        return jsonResponse({ error: "Unauthorised." }, 401);
      }

      let rawBody: unknown;
      try {
        rawBody = await request.json();
      } catch {
        return jsonResponse(
          { error: "Request body must be valid JSON." },
          400
        );
      }

      const parsed = RequestSchema.safeParse(rawBody);
      if (!parsed.success) {
        return jsonResponse(
          {
            error: "Invalid request body.",
            issues: parsed.error.issues
          },
          400
        );
      }

      const body: RequestBody = parsed.data;

      // ----- Call your existing Pushshift bridge -----
      // This assumes your existing bridge accepts POST JSON
      // with the same shape as `body`.
      const upstream = await fetch(BRIDGE_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(body)
      });

      if (!upstream.ok) {
        const text = await upstream.text().catch(() => "");
        return jsonResponse(
          {
            error: "Upstream Pushshift bridge error.",
            status: upstream.status,
            detail: text.slice(0, 500)
          },
          502
        );
      }

      const upstreamJson: any = await upstream.json();

      // Try to normalise a few common shapes:
      // - { comments: [...] }
      // - { data: [...] }
      // - { results: [...] }
      const rawComments: any[] =
        upstreamJson?.comments ??
        upstreamJson?.data ??
        upstreamJson?.results ??
        [];

      const comments: NormalisedComment[] = rawComments.map((c) => ({
        id: String(c.id ?? ""),
        author:
          c.author === undefined || c.author === null
            ? null
            : String(c.author),
        body: String(c.body ?? c.selftext ?? ""),
        score:
          typeof c.score === "number" ? c.score : null,
        created_utc:
          typeof c.created_utc === "number"
            ? c.created_utc
            : typeof c.created === "number"
            ? c.created
            : null,
        permalink:
          c.permalink === undefined || c.permalink === null
            ? null
            : String(c.permalink),
        subreddit:
          c.subreddit === undefined || c.subreddit === null
            ? null
            : String(c.subreddit)
      }));

      return jsonResponse(
        {
          ok: true,
          count: comments.length,
          comments
        },
        200
      );
    } catch (err: any) {
      return jsonResponse(
        {
          error: "Unexpected server error.",
          detail:
            typeof err?.message === "string"
              ? err.message
              : "Unknown error"
        },
        500
      );
    }
  }
};

// Helper: consistent JSON responses
function jsonResponse(
  data: unknown,
  status = 200
): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}
