/**
 * Crew cards the reader accepts (demo list, kept on the device).
 * A card carries one of these IDs as an NDEF text record; the reader may also report
 * the chip's hardware UID, which can be added here as another key.
 * Card IDs say who is holding the device. They are not a password: a card can be copied.
 */
export type CardTarget = ({ kind: "crew"; crewId: string; n: number } | { kind: "team" }) & { holder?: string };

export const CARDS: Record<string, CardTarget> = {
  "ORBITAL-CREW-01": { kind: "crew", crewId: "c1", n: 1 },
  "ORBITAL-CREW-02": { kind: "crew", crewId: "c2", n: 2 },
  "ORBITAL-CREW-03": { kind: "crew", crewId: "c3", n: 3 },
  "ORBITAL-CREW-04": { kind: "crew", crewId: "c4", n: 4 },
  "ORBITAL-CREW-05": { kind: "crew", crewId: "c5", n: 5 },
  "MISSION-CTRL-99": { kind: "team" },
  "TONOMETER-ADMIN-04": { kind: "team" },

  // Team cards, read by chip UID. The holder's name is shown only on the welcome message;
  // the health pages keep the fictional "Astronaut n" slot and its simulated data.
  "UID:736A70A3": { kind: "crew", crewId: "c1", n: 1, holder: "Alaz İhsan Çelik" },
  "UID:AC94CD05": { kind: "crew", crewId: "c2", n: 2, holder: "Ahmet Arabacıoğlu" },
  "UID:628F72FF": { kind: "team", holder: "Poyraz Söğüt" },
  "UID:042877621D2090": { kind: "team", holder: "Elif Arslan" },
};

/** One unknown ID, so the simulator can show the "not on the list" state. */
export const UNKNOWN_DEMO_CARD = "VISITOR-7731";

export function normalizeCardId(raw: string): string {
  // "uid: 04 28 77 …" and "UID:042877…" are the same card
  const id = raw.trim().toUpperCase().replace(/\s+/g, "");
  return id.startsWith("UID:") ? "UID:" + id.slice(4).replace(/[:-]/g, "") : id;
}

export function lookupCard(raw: string): CardTarget | null {
  return CARDS[normalizeCardId(raw)] ?? null;
}
