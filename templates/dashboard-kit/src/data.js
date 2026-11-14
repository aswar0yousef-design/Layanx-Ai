/*
 * Shared data: the signed-in user, the people tasks and deals belong to, and "today".
 * Components read these with fallbacks, so a missing one never breaks the build.
 * Each page keeps its own sample data in its own file; put the project's real data here or in a page,
 * as new exports, and import it where it is used.
 */
export const TODAY = "2026-11-13";

export const user = { name: "Sara Haddad", role: "Head of Sales", initials: "SH" };

export const people = {
  noor: { name: "Noor A.", hue: 18 },
  omar: { name: "Omar K.", hue: 200 },
  lina: { name: "Lina S.", hue: 280 },
  yusuf: { name: "Yusuf M.", hue: 140 },
};
