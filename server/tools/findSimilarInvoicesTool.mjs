export function findSimilarInvoicesTool(input = {}, { pairs } = {}) {
  return {
    candidates: pairs.slice(0, 8).map((pair) => ({
      id: pair.id,
      firstId: pair.firstId,
      secondId: pair.secondId,
      score: pair.score,
      classification: pair.classification,
      signals: pair.signals
    }))
  };
}
