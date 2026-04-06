import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { monitor } from "@colyseus/monitor";
import express from "express";
import http from "http";
import { CityRoom } from "./rooms/CityRoom";

const PORT = Number(process.env.PORT) || 2567;

const app = express();
app.use(express.json());

// Colyseus monitor (dev only)
app.use("/monitor", monitor());

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", rooms: "city" });
});

const server = http.createServer(app);
const gameServer = new Server({
  transport: new WebSocketTransport({ server }),
});

gameServer.define("city", CityRoom);

gameServer.listen(PORT).then(() => {
  console.log(`[Sol City Server] listening on ws://localhost:${PORT}`);
  console.log(`[Sol City Server] monitor at http://localhost:${PORT}/monitor`);
});
