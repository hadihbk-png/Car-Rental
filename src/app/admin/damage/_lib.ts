import type { BadgeTone } from "@/components/ui/badge";

export const SEVERITY_TONE: Record<string, BadgeTone> = { MINOR: "info", MODERATE: "warning", MAJOR: "danger" };
export const STAGE_LABEL: Record<string, string> = { PICKUP: "At pick-up", RETURN: "At return", OTHER: "Other" };
