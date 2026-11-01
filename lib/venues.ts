import { VENUE_IDS, type VenueId } from "./kind-values";

// Where the family sits. Each venue is one photo with up to eight seats drawn
// over it (percent of the screen). Seats keep to the bands above and below the
// video "table" so a face is never hidden behind it. Cushions are for children.
export { VENUE_IDS };
export type { VenueId };

export type SeatKind = "chair" | "sofa" | "cushion" | "swing";
export type Seat = { x: number; y: number; kind: SeatKind };
export type Venue = { id: VenueId; name: string; line: string; image: string; seats: Seat[] };

export const DEFAULT_VENUE: VenueId = "courtyard";

export const VENUES: Venue[] = [
  {
    id: "courtyard",
    name: "Courtyard",
    line: "Cane chairs by the tulsi plant, lamps coming on.",
    image: "/demo/venues/courtyard.jpg",
    seats: [
      { x: 18, y: 19, kind: "chair" },
      { x: 38, y: 17, kind: "chair" },
      { x: 62, y: 17, kind: "chair" },
      { x: 82, y: 19, kind: "chair" },
      { x: 16, y: 92, kind: "sofa" },
      { x: 40, y: 93, kind: "sofa" },
      { x: 64, y: 93, kind: "cushion" },
      { x: 84, y: 92, kind: "cushion" },
    ],
  },
  {
    id: "terrace",
    name: "Terrace",
    line: "Dusk above the city, low sofas round a fire bowl.",
    image: "/demo/venues/terrace.jpg",
    seats: [
      { x: 20, y: 18, kind: "sofa" },
      { x: 40, y: 16, kind: "sofa" },
      { x: 60, y: 16, kind: "sofa" },
      { x: 80, y: 18, kind: "sofa" },
      { x: 18, y: 92, kind: "chair" },
      { x: 42, y: 93, kind: "chair" },
      { x: 66, y: 93, kind: "cushion" },
      { x: 85, y: 92, kind: "cushion" },
    ],
  },
  {
    id: "pergola",
    name: "Pergola",
    line: "String lights over a wicker sofa in the garden.",
    image: "/demo/venues/pergola.jpg",
    seats: [
      { x: 22, y: 19, kind: "sofa" },
      { x: 42, y: 17, kind: "sofa" },
      { x: 62, y: 17, kind: "swing" },
      { x: 82, y: 19, kind: "chair" },
      { x: 20, y: 92, kind: "chair" },
      { x: 44, y: 93, kind: "chair" },
      { x: 68, y: 93, kind: "cushion" },
      { x: 86, y: 92, kind: "cushion" },
    ],
  },
  {
    id: "deck",
    name: "Beach deck",
    line: "Deck chairs and a slow sunset over the water.",
    image: "/demo/venues/deck.jpg",
    seats: [
      { x: 16, y: 19, kind: "chair" },
      { x: 36, y: 17, kind: "chair" },
      { x: 56, y: 17, kind: "chair" },
      { x: 76, y: 17, kind: "chair" },
      { x: 92, y: 20, kind: "chair" },
      { x: 24, y: 92, kind: "chair" },
      { x: 52, y: 93, kind: "cushion" },
      { x: 80, y: 92, kind: "cushion" },
    ],
  },
  {
    id: "lounge",
    name: "Fireside lounge",
    line: "A deep sofa, two armchairs and the fire low.",
    image: "/demo/venues/lounge.jpg",
    seats: [
      { x: 24, y: 18, kind: "sofa" },
      { x: 44, y: 16, kind: "sofa" },
      { x: 64, y: 16, kind: "sofa" },
      { x: 84, y: 18, kind: "chair" },
      { x: 14, y: 92, kind: "chair" },
      { x: 38, y: 93, kind: "chair" },
      { x: 62, y: 93, kind: "cushion" },
      { x: 84, y: 92, kind: "cushion" },
    ],
  },
  {
    id: "patio",
    name: "Patio",
    line: "A long table under bougainvillea, warm stone behind.",
    image: "/demo/venues/patio.jpg",
    seats: [
      { x: 18, y: 19, kind: "chair" },
      { x: 38, y: 17, kind: "chair" },
      { x: 58, y: 17, kind: "chair" },
      { x: 78, y: 19, kind: "chair" },
      { x: 20, y: 92, kind: "chair" },
      { x: 44, y: 93, kind: "chair" },
      { x: 68, y: 93, kind: "cushion" },
      { x: 88, y: 92, kind: "cushion" },
    ],
  },
];

export function venueOf(id: string | null | undefined): Venue {
  return VENUES.find((v) => v.id === id) ?? VENUES[0];
}

/**
 * Who sits where, in the order people arrived. Children take cushions, everyone
 * else the proper seats; when a kind runs out they take what is left.
 */
export function assignSeats(venue: Venue, people: { id: string; child: boolean }[]): Map<string, Seat> {
  const free = venue.seats.slice();
  const out = new Map<string, Seat>();
  for (const p of people) {
    if (!free.length) break;
    const i = free.findIndex((s) => (s.kind === "cushion") === p.child);
    out.set(p.id, free.splice(i >= 0 ? i : 0, 1)[0]);
  }
  return out;
}
