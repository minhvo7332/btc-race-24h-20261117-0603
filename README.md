# btc-race-24h-20261117-0603 — Range Trader

Entry for the [make.fun](https://make.fun/bounty/btc-race-24h-20261117-0603) bounty
"Race a BTC trading bot live for 24 hours". Owner: minhvo7332.

## The bot

`main.ts` trades cbBTC/USDC minute by minute on the `agent-fun/bars-replay/v1`
protocol (see `vendor/makefun-bars.ts`, a byte-identical copy of the kit's SDK
shim). It is a slow range trader:

- Keep the last 480 one-minute bars (8 hours) of high/low/close.
- **Buy** (all cash) when the latest close sits in the bottom 15% of that
  window's high–low range **and** the close ticked up from the previous bar
  (wait for the first uptick; do not catch a falling knife).
- **Sell** (the whole position) when the latest close reaches the top 10% of
  the range, or when the position is worth 1.5% less than it cost (hard stop).
- Never trade while warming up, never trade without a full 480-bar window,
  never send more than one order per reply. All decisions are integer
  arithmetic on the bars' raw integer prices, so two runs agree byte for byte.

## Why this shape

A full-size round trip costs ~26 bps (4 bps fee + 2 bps modelled slippage +
~20 bps of pool impact at this depth). On the dev window, fast trend signals
whipsaw: every EMA/MACD/RSI variant I backtested lost money, and buy-and-hold
made only ~$1. The trade that pays is the slow swing — buy near the bottom of
the last 8 hours' range, sell near its top, otherwise sit in cash.

## Local grade (dev window)

```
node cli/makefun.mjs grade-local --kit <kit> --bot . --driver process --worktree
```

Net PnL **+31.36 USDC** on $1,000, 5 trades, win rate 1.0, max drawdown 0.72%,
guardrails met, L1 regrade reproduced byte for byte.
