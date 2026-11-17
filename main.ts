// Range trader for cbBTC/USDC on agent-fun/bars-replay/v1.
//
// Idea: on 1-minute bars BTC mostly mean-reverts inside its own recent range, while a
// full-size round trip costs ~26 bps (4 bps fee + 2 bps modelled slippage + ~20 bps of
// pool impact at this depth). Fast trend signals whipsaw: every EMA/MACD/RSI variant I
// backtested on the dev window lost money, and buy-and-hold made only ~$1. The trade
// that pays is the slow swing: buy near the bottom of the last 8 hours' range, sell
// near its top, and otherwise sit in cash.
//
// Rules (all BigInt arithmetic on the bars' raw integer prices, so two runs agree
// byte for byte):
//   - Keep the last WINDOW = 480 one-minute bars (8 hours) of high/low/close.
//   - Buy (all cash) when the latest close sits in the bottom 15% of that window's
//     high-low range AND the close ticked up from the previous bar (do not catch a
//     falling knife: wait for the first uptick).
//   - Sell (the whole position) when the latest close reaches the top 10% of the
//     range, or when the position is worth 1.5% less than it cost (hard stop).
//   - Never trade while warming up, never trade without a full 480-bar window, and
//     never send more than one order per reply.
//
// Dev-window grade (kit grade-local, process driver): net PnL +31.36 USDC on
// $1,000, 5 trades, max drawdown 0.72%, guardrails met, L1 regrade reproduced
// byte for byte.

import { runBars, type BarsState, type Batch, type OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const WINDOW = 480; // bars of history forming the range (8 hours)
const BUY_NUM = 3n; // buy when (close - low) / (high - low) <= 3/20 = 15%
const BUY_DEN = 20n;
const SELL_NUM = 9n; // sell when (close - low) / (high - low) >= 9/10 = 90%
const SELL_DEN = 10n;
const STOP_NUM = 985n; // sell when value <= 985/1000 of cost (a 1.5% stop)
const STOP_DEN = 1000n;
const MAX_SLIPPAGE_BPS = 100; // 1% past the latest close; a fill past it is refused

// Rolling window of [high, low, close] as raw integer prices.
const history: Array<[bigint, bigint, bigint]> = [];
let prevClose: bigint | null = null;

function onBatch(state: BarsState, batch: Batch): OrderInput[] {
  const bar = batch.bars.find((b) => b.symbol === SYMBOL);
  if (bar === undefined || state.warmingUp) return [];
  const high = BigInt(bar.h);
  const low = BigInt(bar.l);
  const close = BigInt(bar.c);
  history.push([high, low, close]);
  if (history.length > WINDOW) history.shift();
  const uptick = prevClose !== null && close > prevClose;
  prevClose = close;
  if (history.length < WINDOW) return [];

  let rangeHigh = history[0][0];
  let rangeLow = history[0][1];
  for (const [h, l] of history) {
    if (h > rangeHigh) rangeHigh = h;
    if (l < rangeLow) rangeLow = l;
  }
  const span = rangeHigh - rangeLow;
  if (span <= 0n) return [];

  const held = state.positions.get(SYMBOL);
  if (held !== undefined) {
    // Exit: top of the range, or the hard stop.
    if ((close - rangeLow) * SELL_DEN >= span * SELL_NUM) {
      return [{ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    }
    const value = state.value(SYMBOL, held.qty);
    if (value * STOP_DEN <= held.cost * STOP_NUM) {
      return [{ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    }
    return [];
  }
  // Entry: bottom of the range, on an uptick, with all cash.
  if ((close - rangeLow) * BUY_DEN <= span * BUY_NUM && uptick) {
    const cash = state.cash;
    const minNotional = BigInt(state.hello.fees.min_notional_quote_units);
    if (cash >= minNotional) {
      return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: cash, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    }
  }
  return [];
}

await runBars({ onBatch });
