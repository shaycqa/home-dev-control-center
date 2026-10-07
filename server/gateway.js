import http from "node:http";
import httpProxy from "http-proxy";
import { config, fail } from "./core.js";
import { processInfo } from "./machine.js";
const gateways = new Map();
export async function gateway(port, record) {
  port = Number(port);
  const localPort = 45000 + record.httpsPort - 11000;
  if (gateways.has(port)) return gateways.get(port).localPort;
  const proxy = httpProxy.createProxyServer({
    target: `http://${record.address?.startsWith("[::1]") ? "[::1]" : "127.0.0.1"}:${port}`,
    ws: true,
    changeOrigin: true,
    xfwd: false,
  });
  proxy.on("proxyReq", strip);
  proxy.on("proxyReqWs", strip);
  function strip(out, req) {
    for (const h of [
      "tailscale-user-login",
      "tailscale-user-name",
      "tailscale-user-profile-pic",
      "tailscale-app-capabilities",
      "x-csrf-token",
    ])
      out.removeHeader(h);
    const cookies = (req.headers.cookie || "")
      .split(";")
      .filter((x) => !/^\s*hdc_session=/.test(x))
      .join(";");
    if (cookies.trim()) out.setHeader("cookie", cookies);
    else out.removeHeader("cookie");
  }
  proxy.on("error", (e, req, res) => {
    if (typeof res.writeHead === "function" && !res.headersSent)
      res.writeHead(502, { "Content-Type": "text/plain" });
    res.end("Development server unavailable");
  });
  async function authorize(req) {
    if (
      req.headers.host !==
        `${new URL(config.origin).hostname}:${record.httpsPort}` ||
      !config.allowedUsers.includes(req.headers["tailscale-user-login"])
    )
      fail("Tailscale owner required", 403);
    if (record.pid) {
      const p = await processInfo(record.pid).catch(() => null);
      if (!p || p.start !== record.start)
        fail(
          "Original process exited. Reopen the discovered server to expose its new process.",
          410,
        );
    }
  }
  const server = http.createServer(async (req, res) => {
    try {
      await authorize(req);
      proxy.web(req, res);
    } catch (e) {
      res.writeHead(e.status || 403, { "Content-Type": "text/plain" });
      res.end(e.message);
    }
  });
  server.on("upgrade", async (req, socket, head) => {
    try {
      await authorize(req);
      proxy.ws(req, socket, head);
    } catch {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(localPort, "127.0.0.1", resolve);
  });
  gateways.set(port, { server, proxy, localPort, record });
  return localPort;
}
export function updateGateway(port, record) {
  const existing = gateways.get(Number(port));
  if (existing) {
    Object.assign(existing.record, record);
    return existing.localPort;
  }
  return gateway(port, record);
}
export async function restoreGateways(exposures) {
  for (const [port, record] of Object.entries(exposures))
    await gateway(port, record);
}
