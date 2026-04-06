import { Room, Client } from "colyseus";
import { CityState, PlayerSchema } from "./CityState";

// Input message sent by the client each frame
interface InputMessage {
  x: number;
  y: number;
  direction: string;
  isWalking: boolean;
}

// Chat message from a client
interface ChatMessage {
  text: string;
}

// Outfit change request
interface OutfitMessage {
  outfitId: string;
}

export class CityRoom extends Room<CityState> {
  maxClients = 50;

  onCreate(): void {
    this.setState(new CityState());

    this.onMessage("input", (client: Client, data: InputMessage) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      player.x = data.x;
      player.y = data.y;
      player.direction = data.direction;
      player.isWalking = data.isWalking;
    });

    this.onMessage("chat", (client: Client, data: ChatMessage) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      const text = data.text.slice(0, 140);
      player.chatMsg = text;

      // Clear chat bubble after 4 seconds
      this.clock.setTimeout(() => {
        const p = this.state.players.get(client.sessionId);
        if (p) p.chatMsg = "";
      }, 4000);
    });

    this.onMessage("outfit", (client: Client, data: OutfitMessage) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      player.outfitId = data.outfitId;
    });
  }

  onJoin(client: Client, options: { wallet?: string }): void {
    const player = new PlayerSchema();

    // Spawn at plaza center (matching mapGenerator spawn point)
    player.x = 12 * 32 + 16;
    player.y = 8 * 32 + 16;
    player.direction = "down";
    player.outfitId = "default";
    player.wallet = options.wallet ?? "";

    this.state.players.set(client.sessionId, player);

    console.log(`[CityRoom] ${client.sessionId} joined (wallet: ${player.wallet || "none"})`);
  }

  onLeave(client: Client): void {
    this.state.players.delete(client.sessionId);
    console.log(`[CityRoom] ${client.sessionId} left`);
  }

  onDispose(): void {
    console.log("[CityRoom] disposed");
  }
}
