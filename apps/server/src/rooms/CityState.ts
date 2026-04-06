import { Schema, type, MapSchema } from "@colyseus/schema";

export class PlayerSchema extends Schema {
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("string") direction: string = "down";
  @type("string") outfitId: string = "default";
  @type("string") wallet: string = "";
  @type("string") chatMsg: string = "";
  @type("boolean") isWalking: boolean = false;
}

export class CityState extends Schema {
  @type({ map: PlayerSchema }) players = new MapSchema<PlayerSchema>();
}
