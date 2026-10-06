#!/usr/bin/env node
/**
 * A tiny HTTPS front for the game so phones get a secure context (needed for
 * the live camera). No dependencies; forwards everything, streaming included,
 * to the Next.js server on this machine.
 *   npm run field:https   (after npm run certs)
 */
import fs from "node:fs";
import http from "node:http";
import https from "node:https";

const TARGET = Number(process.env.PORT ?? 3000);
const PORT = Number(process.env.HTTPS_PORT ?? 3443);
const key = fs.readFileSync("certificates/key.pem");
const cert = fs.readFileSync("certificates/cert.pem");

https
  .createServer({ key, cert }, (req, res) => {
    const upstream = http.request(
      { host: "127.0.0.1", port: TARGET, path: req.url, method: req.method, headers: { ...req.headers, "x-forwarded-proto": "https" } },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      },
    );
    upstream.on("error", () => {
      res.writeHead(502, { "content-type": "text/plain" });
      res.end("The game server isn't running on this computer (npm run field).");
    });
    req.pipe(upstream);
  })
  .listen(PORT, "0.0.0.0", () => console.log(`HTTPS proxy on :${PORT} → http://127.0.0.1:${TARGET}`));
