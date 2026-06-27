import { NextResponse } from 'next/server';
import { getAllSymbols } from '@/core/db/bars';
import { getOrDefault as getProvider } from '@/core/data/registry';

interface QuoteRow {
  symbol: string;
  price:  number;
  time:   string;
}

const MAX_QUOTES = 100;

/**
 * GET /api/quotes?symbols=AAPL,MSFT
 *
 * Fetches current provider quotes for explicit stored symbols only.
 * Indicators and scans remain based on persisted EOD bars.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const symbols = (url.searchParams.get('symbols') ?? '')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
      .slice(0, MAX_QUOTES);

    if (symbols.length === 0) {
      return NextResponse.json({ quotes: [] });
    }

    const metaBySymbol = new Map(getAllSymbols().map((m) => [m.symbol, m]));
    const quotes = await Promise.all(symbols.map(async (symbol): Promise<QuoteRow | null> => {
      const meta = metaBySymbol.get(symbol);
      if (!meta) return null;
      const provider = getProvider(meta.providerId);
      if (typeof provider.getQuote !== 'function') return null;
      const quote = await provider.getQuote(symbol);
      if (!quote || !isFinite(quote.price)) return null;
      return { symbol, price: quote.price, time: quote.time };
    }));

    return NextResponse.json({ quotes: quotes.filter((q): q is QuoteRow => q != null) });
  } catch (err) {
    console.error('[GET /api/quotes]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
