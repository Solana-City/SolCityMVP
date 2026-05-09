export type ChatChannel = "local" | "global" | `dm:${string}`;

export interface ChatMessage {
  id: string;
  channel: ChatChannel;
  senderSessionId: string;
  senderName: string;
  text: string;
  timestamp: number;
  color?: string;
}

export interface DMChannel {
  sessionId: string;
  name: string;
  unread: number;
}

const MAX_LOG_SIZE = 200;
const MESSAGE_TTL_MS = 30_000; // messages disappear after 30 seconds
const CLEANUP_INTERVAL_MS = 5_000;

/**
 * Chat channels:
 *   local  - proximity-based, visible to nearby players
 *   global - visible to everyone in the room
 *   dm:xyz - private messages with player xyz (auto-created)
 */
export class ChatManager {
  private log: ChatMessage[] = [];
  private activeChannel: ChatChannel = "local";
  private dmChannels = new Map<string, DMChannel>();
  private listeners: Array<(msg: ChatMessage) => void> = [];
  private logListeners: Array<(log: ChatMessage[]) => void> = [];
  private counter = 0;
  private cleanupTimer: ReturnType<typeof setInterval>;

  constructor() {
    this.cleanupTimer = setInterval(() => this.purgeExpired(), CLEANUP_INTERVAL_MS);
  }

  destroy(): void {
    clearInterval(this.cleanupTimer);
  }

  private purgeExpired(): void {
    const cutoff = Date.now() - MESSAGE_TTL_MS;
    const before = this.log.length;
    this.log = this.log.filter((m) => m.senderSessionId === "system" || m.timestamp >= cutoff);
    if (this.log.length !== before) this.notifyLogListeners();
  }

  getActiveChannel(): ChatChannel {
    return this.activeChannel;
  }

  setActiveChannel(channel: ChatChannel): void {
    this.activeChannel = channel;
    if (channel.startsWith("dm:")) {
      const dm = this.dmChannels.get(channel);
      if (dm) dm.unread = 0;
    }
    this.notifyLogListeners();
  }

  getDMChannels(): DMChannel[] {
    return Array.from(this.dmChannels.values());
  }

  openDM(sessionId: string, name: string): ChatChannel {
    const key: ChatChannel = `dm:${sessionId}`;
    if (!this.dmChannels.has(key)) {
      this.dmChannels.set(key, { sessionId, name, unread: 0 });
    }
    this.setActiveChannel(key);
    this.notifyLogListeners();
    return key;
  }

  addMessage(
    channel: ChatChannel,
    senderSessionId: string,
    senderName: string,
    text: string,
    color?: string
  ): ChatMessage {
    const msg: ChatMessage = {
      id: `msg-${++this.counter}`,
      channel,
      senderSessionId,
      senderName,
      text,
      timestamp: Date.now(),
      color,
    };

    this.log.push(msg);
    if (this.log.length > MAX_LOG_SIZE) {
      this.log = this.log.slice(-MAX_LOG_SIZE);
    }

    // Track unread for DM channels
    if (channel.startsWith("dm:") && channel !== this.activeChannel) {
      const dm = this.dmChannels.get(channel);
      if (dm) dm.unread += 1;
    }

    for (const cb of this.listeners) cb(msg);
    this.notifyLogListeners();

    return msg;
  }

  addSystemMessage(text: string): void {
    this.addMessage("local", "system", "System", text, "#9945FF");
  }

  getVisibleLog(): ChatMessage[] {
    if (this.activeChannel.startsWith("dm:")) {
      return this.log.filter((m) => m.channel === this.activeChannel);
    }
    return this.log.filter(
      (m) => m.channel === this.activeChannel || (m.senderSessionId === "system" && this.activeChannel === "local")
    );
  }

  onMessage(cb: (msg: ChatMessage) => void): void {
    this.listeners.push(cb);
  }

  onLogUpdate(cb: (log: ChatMessage[]) => void): void {
    this.logListeners.push(cb);
  }

  private notifyLogListeners(): void {
    const visible = this.getVisibleLog();
    for (const cb of this.logListeners) cb(visible);
  }
}

export const CHANNEL_COLORS: Record<string, string> = {
  local: "#14F195",
  global: "#00D1FF",
  dm: "#FFD700",
  system: "#9945FF",
};

export function getChannelColor(channel: ChatChannel): string {
  if (channel.startsWith("dm:")) return CHANNEL_COLORS.dm;
  return CHANNEL_COLORS[channel] ?? "#888899";
}

export function getChannelLabel(channel: ChatChannel, dmChannels: Map<string, DMChannel> | DMChannel[]): string {
  if (channel === "local") return "Local";
  if (channel === "global") return "Global";
  if (channel.startsWith("dm:")) {
    const arr = Array.isArray(dmChannels) ? dmChannels : Array.from(dmChannels.values());
    const dm = arr.find((d) => `dm:${d.sessionId}` === channel);
    return dm?.name ?? channel.slice(3, 9);
  }
  return channel;
}
