// Persistent observer storage seam. Real SQLite wiring is intentionally kept
// behind this small contract so the terminal observer does not acquire DB
// details or FalsifyMe authority.

export function createMemoryStore() {
  const observations = new Map();
  let cursor = null;
  return {
    readCursor: () => cursor,
    hasObservation: (id) => observations.has(id),
    appendObservation: (observation) => {
      if (observations.has(observation.id)) return false;
      observations.set(observation.id, structuredClone(observation));
      cursor = observation.id;
      return true;
    },
    list: () => [...observations.values()].map((x) => structuredClone(x)),
  };
}
