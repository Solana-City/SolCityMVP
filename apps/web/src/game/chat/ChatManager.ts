export type ChatChannel = "local" | "global" | "trade" | "system";

export interface ChatMessage {
  id: string;
  channel: ChatChannel;
  senderSessionId: string;
  senderName: string;
  text: string;
  timestamp: number;
  color?: string;
}

const MAX_LOG_SIZE = 200;

/**
 * Manages chat messages across multiple channels.
 * Messages appear as bubbles above avatars AND in a scrollable log.
 * Channels can be toggled on/off in the UI panel.
 *
 * Channel descriptions:
 *   local  - proximity-based, only players within range see it
 *   global - visible to everyone in the room
 *   trade  - trade requests and offers
 *   system - server announcements, join/leave notifications
 */
export class ChatManager {
  private log: ChatMessage[] = [];
  private activeChannel: ChatChannel = "local";
  private mutedChannels: Set<ChatChannel> = new Set();
  private listeners: Array<(msg: ChatMessage) => void> = [];
  private logListeners: Array<(log: ChatMessage[]) => void> = [];
  private counter = 0;

  getActiveChannel(): ChatChannel {
    return this.activeChannel;
  }

  setActiveChannel(channel: ChatChannel): void {
    this.activeChannel = channel;
    this.notifyLogListeners();
  }

  toggleMute(channel: ChatChannel): void {
    if (this.mutedChannels.has(channel)) {
      this.mutedChannels.delete(channel);
    } else {
      this.mutedChannels.add(channel);
    }
    this.notifyLogListeners();
  }

  isMuted(channel: ChatChannel): boolean {
    return this.mutedChannels.has(channel);
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

    for (const cb of this.listeners) cb(msg);
    this.notifyLogListeners();

    return msg;
  }

  addSystemMessage(text: string): void {
    this.addMessage("system", "system", "System", text, "#9945FF");
  }

  /** Returns messages for the active channel, excluding muted channels. */
  getVisibleLog(): ChatMessage[] {
    return this.log.filter(
      (m) => !this.mutedChannels.has(m.channel)
    );
  }

  /** Returns messages for a specific channel. */
  getChannelLog(channel: ChatChannel): ChatMessage[] {
    return this.log.filter((m) => m.channel === channel);
  }

  /** Subscribe to new messages (for bubble display). */
  onMessage(cb: (msg: ChatMessage) => void): void {
    this.listeners.push(cb);
  }

  /** Subscribe to log updates (for UI panel re-renders). */
  onLogUpdate(cb: (log: ChatMessage[]) => void): void {
    this.logListeners.push(cb);
  }

  private notifyLogListeners(): void {
    const visible = this.getVisibleLog();
    for (const cb of this.logListeners) cb(visible);
  }
}

export const CHANNEL_CONFIG: Record<
  ChatChannel,
  { label: string; color: string; prefix: string }
> = {
  local: { label: "Local", color: "#14F195", prefix: "" },
  global: { label: "Global", color: "#00D1FF", prefix: "[G] " },
  trade: { label: "Trade", color: "#FFD700", prefix: "[T] " },
  system: { label: "System", color: "#9945FF", prefix: "" },
};
