import { pairFromInput } from './toolUtils.mjs';

export function compareDocumentsTool(input = {}, { pairs } = {}) {
  const pair = pairFromInput(pairs, input);
  if (!pair) return { comparisonAvailable: false, signals: ['No valid document pair is available in the selected context.'] };
  return {
    comparisonAvailable: true,
    pairId: pair.id,
    classification: pair.classification,
    score: pair.score,
    signals: pair.signals,
    confidence: pair.score
  };
}
