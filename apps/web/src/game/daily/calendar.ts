/**
 * The city's own events, for the calendar on Today in Solana City.
 *
 * Add an entry when there is something to announce (a tournament, a season,
 * a party at a building). Nothing here needs daily upkeep: the calendar also
 * fills itself from Superteam bounty and hackathon deadlines. Dates are UTC,
 * YYYY-MM-DD; `end` makes it a range (shown as "starts" and "ends" with the
 * days between shaded).
 *
 *   { date: "2026-10-01", end: "2026-10-14", title: "Sol Mechs Season 1" }
 */
export interface CityEvent {
  date: string;
  end?: string;
  title: string;
  /** Optional page for the event. */
  url?: string;
}

export const CITY_EVENTS: CityEvent[] = [];
