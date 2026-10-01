import { createServer as createHttp } from "node:http";
import { createServer as createHttps } from "node:https";
import { readFileSync } from "node:fs";
import { createApp } from "./app";
import { configFromEnv } from "./config";

/**
 * Refuses to start without TLS unless it is explicitly behind a TLS-terminating proxy (BEHIND_PROXY=1, e.g. Caddy), in which case it
 * only listens on the loopback interface.
 */
function main() {
  const env = process.env;
  const cfg = configFromEnv(env);
  const app = createApp(cfg);
  const port = Number(env.PORT ?? 8443);
  let server;
  if (env.TLS_CERT && env.TLS_KEY) {
    server = createHttps({ cert: readFileSync(env.TLS_CERT), key: readFileSync(env.TLS_KEY), minVersion: "TLSv1.2" }, (q, r) => void app.handle(q, r));
    server.listen(port, env.BIND ?? "0.0.0.0", () => console.log(`Licensing server (HTTPS) on :${port}`));
  } else if (env.BEHIND_PROXY === "1") {
    server = createHttp((q, r) => void app.handle(q, r));
    server.listen(port, "127.0.0.1", () => console.log(`Licensing server on 127.0.0.1:${port} (behind a TLS proxy)`));
  } else {
    console.error("Refusing to start without TLS. Set TLS_CERT and TLS_KEY, or run behind a TLS proxy such as Caddy with BEHIND_PROXY=1. See docs/DEPLOYMENT.md.");
    process.exit(1);
  }
  const stop = () => { server.close(() => { app.close(); process.exit(0); }); };
  process.on("SIGTERM", stop); process.on("SIGINT", stop);
}
try { main(); } catch (e) { console.error((e as Error).message); process.exit(1); }
