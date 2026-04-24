import { Client, Room } from "colyseus.js";
import Phaser from "phaser";

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL || "ws://localhost:2567";

export interface RemotePlayer {
  sessionId: string;
  x: number;
  y: number;
  direction: string;
  outfitId: string;
  wallet: string;
  chatMsg: string;
  isWalking: boolean;
}

type PlayerCallback = (sessionId: string, player: RemotePlayer) => void;
type RemoveCallback = (sessionId: string) => void;
type ChatCallback = (sessionId: string, msg: string) => void;

/**
 * Manages the Colyseus connection and translates state changes
 * into callbacks that the game scene can handle.
 *
 * Usage from CityScene:
 *   const net = new NetworkManager();
 *   await net.connect({ wallet: "7xKX...q3Fm" });
 *   net.onPlayerAdd((id, player) => { ... });
 *   net.onPlayerRemove((id) => { ... });
 *   net.sendInput(x, y, direction, isWalking);
 */
export class NetworkManager {
  private client: Client;
  private room: Room | null = null;
  private _sessionId: string = "";

  private addCallbacks: PlayerCallback[] = [];
  private removeCallbacks: RemoveCallback[] = [];
  private changeCallbacks: PlayerCallback[] = [];
  private chatCallbacks: ChatCallback[] = [];

  constructor() {
    this.client = new Client(SERVER_URL);
  }

  get sessionId(): string {
    return this._sessionId;
  }

  get connected(): boolean {
    return this.room !== null;
  }

  async connect(options: { wallet?: string } = {}): Promise<void> {
    try {
      this.room = await this.client.joinOrCreate("city", options);
      this._sessionId = this.room.sessionId;

      this.room.state.players.onAdd((player: any, sessionId: string) => {
        const remote = this.toRemotePlayer(sessionId, player);

        for (const cb of this.addCallbacks) cb(sessionId, remote);

        // Listen for changes on this player
        player.onChange(() => {
          const updated = this.toRemotePlayer(sessionId, player);
          for (const cb of this.changeCallbacks) cb(sessionId, updated);

          if (updated.chatMsg) {
            for (const cb of this.chatCallbacks) cb(sessionId, updated.chatMsg);
          }
        });
      });

      this.room.state.players.onRemove((_player: any, sessionId: string) => {
        for (const cb of this.removeCallbacks) cb(sessionId);
      });

      console.log(`[NetworkManager] connected as ${this._sessionId}`);
    } catch (err) {
      console.error("[NetworkManager] connection failed:", err);
      throw err;
    }
  }

  disconnect(): void {
    this.room?.leave();
    this.room = null;
    this._sessionId = "";
  }

  /** Sends local player position to the server. Call every frame. */
  sendInput(x: number, y: number, direction: string, isWalking: boolean): void {
    this.room?.send("input", { x, y, direction, isWalking });
  }

  /** Sends a chat message. */
  sendChat(text: string): void {
    this.room?.send("chat", { text });
  }

  /** Requests an outfit change. */
  sendOutfit(outfitId: string): void {
    this.room?.send("outfit", { outfitId });
  }

  onPlayerAdd(cb: PlayerCallback): void { this.addCallbacks.push(cb); }
  onPlayerRemove(cb: RemoveCallback): void { this.removeCallbacks.push(cb); }
  onPlayerChange(cb: PlayerCallback): void { this.changeCallbacks.push(cb); }
  onChat(cb: ChatCallback): void { this.chatCallbacks.push(cb); }

  private toRemotePlayer(sessionId: string, player: any): RemotePlayer {
    return {
      sessionId,
      x: player.x,
      y: player.y,
      direction: player.direction,
      outfitId: player.outfitId,
      wallet: player.wallet,
      chatMsg: player.chatMsg,
      isWalking: player.isWalking,
    };
  }
}
