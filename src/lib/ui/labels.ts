/** Display labels for enum values returned by the domain services. Unknown values are humanised. */

const TRANSMISSION: Record<string, string> = { AUTOMATIC: "Automatic", MANUAL: "Manual" };
const FUEL: Record<string, string> = { PETROL: "Petrol", DIESEL: "Diesel", HYBRID: "Hybrid", ELECTRIC: "Electric" };

function humanize(value: string): string {
  const s = value.toLowerCase().replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const transmissionLabel = (v: string) => TRANSMISSION[v] ?? humanize(v);
export const fuelLabel = (v: string) => FUEL[v] ?? humanize(v);

/** Filter options for the search service's transmission and fuel enums. */
export const TRANSMISSION_OPTIONS = Object.entries(TRANSMISSION).map(([value, label]) => ({ value, label }));
export const FUEL_OPTIONS = Object.entries(FUEL).map(([value, label]) => ({ value, label }));

export const SORT_LABELS = {
  "price-asc": "Price: low to high",
  "price-desc": "Price: high to low",
  name: "Name (A–Z)",
} as const;

export function pluralize(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
