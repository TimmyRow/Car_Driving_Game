import type { Plugin } from "vite";
import { localDatabase } from "./local-db";
import { onlineApi } from "./online-api";

export function onlineDev(): Plugin {
  return {
    name: "velocity-online-local",
    configureServer(server) {
      const local = localDatabase();
      server.httpServer?.once("close", () => local.close());
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api/online/")) return next();
        try {
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of req) {
            size += chunk.length;
            if (size > 48_000) {
              res.writeHead(413, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Race update is too large." }));
              return;
            }
            chunks.push(Buffer.from(chunk));
          }
          const headers = new Headers();
          for (const [key, value] of Object.entries(req.headers))
            if (value)
              headers.set(key, Array.isArray(value) ? value.join(",") : value);
          const method = req.method ?? "GET";
          const request = new Request(`http://localhost${req.url}`, {
            method,
            headers,
            ...(method !== "GET" && method !== "HEAD"
              ? { body: Buffer.concat(chunks) }
              : {}),
          });
          const response = await onlineApi(request, local.db);
          res.writeHead(response.status, Object.fromEntries(response.headers));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (error) {
          server.config.logger.error(String(error));
          res.writeHead(503, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: "Online rooms are temporarily unavailable.",
            }),
          );
        }
      });
    },
  };
}
