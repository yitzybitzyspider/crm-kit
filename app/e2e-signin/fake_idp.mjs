// team hub, issue 58: a stand-in identity provider for the throwaway stack.
//
// Google cannot be reached from a test, and Supabase's auth service does not
// let the Google provider point anywhere but Google. So the stack of the
// signin workflow's "sign-ups off" job is given one more OAuth provider,
// Supabase's "keycloak" one, pointed here (app/e2e-signin/stack_config.py).
// A sign-in through it runs the same code in Supabase's auth service as a
// Google one after Google answers: find an account by verified email, link
// the new identity to it, or refuse a new account because sign-ups are off.
//
// It answers for whoever the test last set with POST /next. Only the
// workflow starts it, on GitHub's runner, which is thrown away after.
//
//   node fake_idp.mjs          (port from HUB_FAKE_IDP_PORT, else 54399)
//
// Routes, all under /realms/hub, as the keycloak provider expects:
//   POST /next                                  {email, email_verified, sub, name} or {cancel: true}
//   GET  /protocol/openid-connect/auth          sends the browser back with a code
//   POST /protocol/openid-connect/token         the code for an access token
//   GET  /protocol/openid-connect/userinfo      who the access token is
//   GET  /health                                answers ok
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

if (!process.env.CI && process.env.HUB_FAKE_IDP_OK !== "1") {
  console.error(
    "fake_idp.mjs runs on a throwaway CI runner only (CI is not set). Stopping.",
  );
  process.exit(2);
}

const PORT = Number(process.env.HUB_FAKE_IDP_PORT ?? 54399);
const BASE = "/realms/hub";

let next = null;
const codes = new Map();
const tokens = new Map();

const body = (request) =>
  new Promise((resolve) => {
    let text = "";
    request.on("data", (chunk) => (text += chunk));
    request.on("end", () => resolve(text));
  });

const send = (response, status, json) => {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(json));
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://stand-in");
  console.log(`${request.method} ${url.pathname}`);
  try {
    if (url.pathname === "/health") return send(response, 200, { ok: true });

    if (request.method === "POST" && url.pathname === "/next") {
      next = JSON.parse((await body(request)) || "null");
      return send(response, 200, { next });
    }

    if (url.pathname === `${BASE}/protocol/openid-connect/auth`) {
      const redirect = new URL(url.searchParams.get("redirect_uri") ?? "");
      redirect.searchParams.set("state", url.searchParams.get("state") ?? "");
      if (!next || next.cancel) {
        // what Google sends back when the person presses Cancel
        redirect.searchParams.set("error", "access_denied");
        redirect.searchParams.set("error_description", "The user cancelled");
      } else {
        const code = randomUUID();
        codes.set(code, next);
        redirect.searchParams.set("code", code);
      }
      response.writeHead(302, { location: redirect.toString() });
      return response.end();
    }

    if (request.method === "POST" && url.pathname === `${BASE}/protocol/openid-connect/token`) {
      const form = new URLSearchParams(await body(request));
      const who = codes.get(form.get("code") ?? "");
      if (!who) return send(response, 400, { error: "invalid_grant" });
      codes.delete(form.get("code"));
      const token = randomUUID();
      tokens.set(token, who);
      return send(response, 200, {
        access_token: token,
        token_type: "Bearer",
        expires_in: 300,
      });
    }

    if (url.pathname === `${BASE}/protocol/openid-connect/userinfo`) {
      const token = (request.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
      const who = tokens.get(token);
      if (!who) return send(response, 401, { error: "invalid_token" });
      return send(response, 200, {
        sub: who.sub,
        email: who.email,
        email_verified: who.email_verified,
        name: who.name,
        preferred_username: who.email,
      });
    }

    send(response, 404, { error: "not_found", path: url.pathname });
  } catch (error) {
    send(response, 500, { error: String(error) });
  }
});

// Every interface: the auth service runs in Docker and reaches this through
// the runner's docker0 address; the browser on the runner uses the same one.
server.listen(PORT, "0.0.0.0", () => {
  console.log(`stand-in identity provider on port ${PORT}`);
});
