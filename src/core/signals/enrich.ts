import 'server-only';
import type { AssetClass, TradeIdea } from '@/core/types';
import { classScope } from '@/core/edge/types';
import { EdgeIndex } from '@/core/edge/context';
import { gateIdea, type EnrichedTradeIdea } from './gate';

/**
 * Join trade ideas with their strategy's backtested edge and apply the
 * quality gate. Gated ideas are kept (gate.passed = false) so the UI can
 * render the muted "insufficient edge" row - the user must see that the
 * system is filtering, not broken.
 */
export function enrichIdeas(
  ideas: TradeIdea[],
  index: EdgeIndex,
  assetClassOf: (symbol: string) => AssetClass | null,
): EnrichedTradeIdea[] {
  return ideas.map((idea) => {
    const assetClass = assetClassOf(idea.symbol);
    const edge = index.resolve(idea.strategyId, idea.symbol, assetClass);
    const classEdge = assetClass
      ? index.get(idea.strategyId, classScope(assetClass))
      : null;
    const gate = gateIdea({ rr: idea.rr, classEdge, assetClass });
    return { ...idea, edge, gate };
  });
}
