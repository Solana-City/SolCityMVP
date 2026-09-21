/**
 * The city's own events, for the "Coming up" row of Today in Solana City.
 *
 * Add an entry when there is something to announce (a tournament, a season
 * start, a party at a building). Nothing here needs daily upkeep: past events
 * drop off by themselves, and the row also fills from Superteam hackathon
 * deadlines. Dates are UTC, YYYY-MM-DD.
 */
export interface CityEvent {
  date: string;
  title: string;
  /** Optional page for the event. */
  url?: string;
}

export const CITY_EVENTS: CityEvent[] = [];
