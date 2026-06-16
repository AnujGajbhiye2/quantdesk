import { describe, it, expect } from 'vitest';
import { toTradingViewSymbol, tradingViewChartUrl } from './symbol';

describe('toTradingViewSymbol', () => {
  it('US bare ticker - no suffix', () => {
    expect(toTradingViewSymbol('AMD')).toBe('AMD');
    expect(toTradingViewSymbol('AAPL')).toBe('AAPL');
    expect(toTradingViewSymbol('amd')).toBe('AMD'); // case-insensitive
  });

  it('India NSE (.NS)', () => {
    expect(toTradingViewSymbol('ABB.NS')).toBe('NSE:ABB');
    expect(toTradingViewSymbol('360ONE.NS')).toBe('NSE:360ONE');
  });

  it('India BSE (.BO)', () => {
    expect(toTradingViewSymbol('TCS.BO')).toBe('BSE:TCS');
  });

  it('London Stock Exchange (.L)', () => {
    expect(toTradingViewSymbol('GSK.L')).toBe('LSE:GSK');
    expect(toTradingViewSymbol('RIO.L')).toBe('LSE:RIO');
  });

  it('SIX Swiss Exchange (.SW)', () => {
    expect(toTradingViewSymbol('ZURN.SW')).toBe('SIX:ZURN');
  });

  it('Euronext Amsterdam (.AS)', () => {
    expect(toTradingViewSymbol('INGA.AS')).toBe('EURONEXT:INGA');
  });

  it('Euronext Paris (.PA)', () => {
    expect(toTradingViewSymbol('MC.PA')).toBe('EURONEXT:MC');
  });

  it('Xetra / Frankfurt (.DE)', () => {
    expect(toTradingViewSymbol('SAP.DE')).toBe('XETR:SAP');
  });

  it('Milan (.MI)', () => {
    expect(toTradingViewSymbol('ENI.MI')).toBe('MIL:ENI');
  });

  it('Hong Kong (.HK)', () => {
    expect(toTradingViewSymbol('0700.HK')).toBe('HKEX:0700');
  });

  it('Toronto (.TO)', () => {
    expect(toTradingViewSymbol('SHOP.TO')).toBe('TSX:SHOP');
  });

  it('unknown suffix - strips and returns base', () => {
    expect(toTradingViewSymbol('FOO.XX')).toBe('FOO');
  });
});

describe('tradingViewChartUrl', () => {
  it('produces a valid HTTPS tradingview.com URL', () => {
    const url = tradingViewChartUrl('INGA.AS');
    expect(url).toMatch(/^https:\/\/www\.tradingview\.com\/chart\/\?symbol=/);
    expect(url).toContain(encodeURIComponent('EURONEXT:INGA'));
  });

  it('US ticker URL is well-formed', () => {
    const url = tradingViewChartUrl('AMD');
    expect(url).toBe('https://www.tradingview.com/chart/?symbol=AMD');
  });
});
