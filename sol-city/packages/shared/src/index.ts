export interface PlayerState {
  x: number;
  y: number;
  direction: "up" | "down" | "left" | "right";
  sessionId: string;
  wallet?: string;
  outfitId?: string;
}

export interface NPCDefinition {
  id: string;
  x: number;
  y: number;
  name: string;
  role: string;
  action: string;
  dialog: string[];
}

export interface MapZone {
  x: number;
  y: number;
  width: number;
  height: number;
  type: "npc" | "portal" | "trigger";
  data?: Record<string, unknown>;
}
