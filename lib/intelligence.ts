export type IntelligenceVariant = "none" | "lastBeen" | "mostBeen" | "firstVisitAge";

export const INTELLIGENCE_LABELS: Record<Exclude<IntelligenceVariant, "none">, string> = {
  lastBeen: "Last been",
  mostBeen: "Most been",
  firstVisitAge: "First visited",
};
