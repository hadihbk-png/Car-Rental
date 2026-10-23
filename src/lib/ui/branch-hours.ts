/** Reads the branch's free-text opening hours ("Open 24 hours", "Daily 08:00-22:00") into pick-up time bounds. */

export interface BranchHours {
  open: string; // HH:mm
  close: string; // HH:mm (last bookable slot)
  allDay: boolean;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function parseOpeningHours(text: string | null | undefined): BranchHours | null {
  if (!text) return null;
  if (/24\s*(hours|hrs|h)\b|24\/7/i.test(text)) return { open: "00:00", close: "23:30", allDay: true };
  const m = /(\d{1,2}):(\d{2})\s*[-–to]+\s*(\d{1,2}):(\d{2})/i.exec(text);
  if (!m) return null;
  const [oh, om, ch, cm] = [m[1], m[2], m[3], m[4]].map(Number);
  if (oh > 23 || ch > 24 || om > 59 || cm > 59) return null;
  const open = `${pad(oh)}:${pad(om)}`;
  const close = ch === 24 ? "23:30" : `${pad(ch)}:${pad(cm)}`;
  if (close <= open) return null; // overnight hours: let the caller fall back to all day
  return { open, close, allDay: false };
}
