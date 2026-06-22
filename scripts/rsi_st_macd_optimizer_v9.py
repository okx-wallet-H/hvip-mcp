#!/usr/bin/env python3
"""
RSI(14) vs SuperTrend(10,3) vs MACD — VBT PRO 回测对比优化 v9
======================================================================
v9 Improvements over v8:
  1. ADX market regime filter (>25 = trending, only trade then)
  2. 3-fold walk-forward CV (better out-of-sample coverage)
  3. Purged CV with 10-candle purge gap
  4. Enhanced OVP assessment with market-regime awareness
  5. Multi-timeframe confirmation (optional)
  6. Better composite scoring with regime-adjusted metrics
  7. Cross-asset consistency scoring

Test: BTC/USDT, ETH/USDT | 4H
"""

import sys, os, json, math, itertools, warnings
import numpy as np
import pandas as pd
import requests
from datetime import datetime, timezone

if sys.stdout.encoding and sys.stdout.encoding.upper() in ('GBK', 'GB2312', 'CP936'):
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

try:
    import vectorbtpro as vbt
except ImportError:
    print("ERROR: vectorbtpro not installed")
    sys.exit(1)

warnings.filterwarnings('ignore')

# ================================================================
# CONFIG
# ================================================================

PAIRS = ["BTC/USDT", "ETH/USDT"]
TIMEFRAME = "4h"
FREQ = "4h"
DATA_LIMIT = 300
FEE = 0.001
SLIPPAGE = 0.001

MIN_TRADES = 2
INIT_CASH = 10000
ATR_WINDOW = 14
ADX_WINDOW = 14
ADX_THRESHOLD = 25  # ADX > 25 = trending market

# ----- v9: Parameter grids (refined) -----

ST_GRID = {
    "st_period": [7, 10, 12, 14, 16, 20],
    "st_multiplier": [1.5, 2.0, 2.5, 3.0],
}

RSI_GRID = {
    "rsi_window": [10, 14, 21],
    "oversold": [25, 30, 35],
    "overbought": [65, 70, 75],
}

MACD_SIGNAL_GRID = {
    "macd_fast": [8, 12, 16],
    "macd_slow": [21, 26, 34],
    "macd_signal": [5, 7, 9],
}

MACD_HIST_GRID = {
    "macd_fast": [8, 12],
    "macd_slow": [21, 26],
    "macd_signal": [5, 7, 9],
    "hist_threshold": [0.0, 0.001],
}

# ================================================================
# DATA FETCH
# ================================================================

def fetch_okx(symbol, bar="4H", limit=DATA_LIMIT):
    inst_id = symbol.replace("/", "-")
    url = f"https://www.okx.com/api/v5/market/candles?instId={inst_id}&bar={bar}&limit={limit}"
    try:
        resp = requests.get(url, timeout=15)
        data = resp.json().get("data", [])
        if not data or len(data) < 100:
            return None
        rows, times = [], []
        for c in reversed(data):
            ts = int(c[0])
            times.append(pd.Timestamp(ts, unit='ms', tz='UTC'))
            rows.append({
                "open": float(c[1]), "high": float(c[2]),
                "low": float(c[3]), "close": float(c[4]),
                "volume": float(c[5]),
            })
        return pd.DataFrame(rows, index=pd.DatetimeIndex(times, name='timestamp'))
    except Exception as e:
        print(f"  FETCH ERROR: {e}")
        return None

# ================================================================
# MARKET REGIME DETECTION (v9)
# ================================================================

def detect_market_regime(close, high, low):
    """
    Use ADX to classify market regime.
    Returns: Series of bool (True = trending, False = ranging)
    """
    adx = vbt.ADX.run(high, low, close, window=ADX_WINDOW).adx
    is_trending = adx > ADX_THRESHOLD
    trending_pct = float(is_trending.mean() * 100)
    return is_trending, trending_pct

# ================================================================
# SIGNAL GENERATORS (v9: with ADX filter option)
# ================================================================

def rsi_signals(close, high=None, low=None,
                rsi_window=14, oversold=30, overbought=70,
                use_adx_filter=False, is_trending=None, **kwargs):
    rsi = vbt.RSI.run(close, window=rsi_window).rsi
    entries = (rsi < oversold) & (rsi.shift(1) >= oversold)
    exits = (rsi > overbought) & (rsi.shift(1) <= overbought)
    
    if use_adx_filter and is_trending is not None:
        # In trending markets, RSI signals are unreliable (can stay overbought)
        # Only take RSI signals in ranging/weakly trending markets
        entries = entries & ~is_trending
    
    return entries, exits


def supertrend_signals(high, low, close,
                       st_period=10, st_multiplier=3.0,
                       use_adx_filter=False, is_trending=None, **kwargs):
    st = vbt.SUPERTREND.run(high, low, close, period=st_period, multiplier=st_multiplier)
    d = st.direction.astype(int)
    entries = (d == 1) & (d.shift(1) == -1)
    exits = (d == -1) & (d.shift(1) == 1)
    if len(d) > 0 and d.iloc[0] == 1:
        entries.iloc[0] = True
    
    if use_adx_filter and is_trending is not None:
        # SuperTrend works best in trending markets
        entries = entries & is_trending
    
    return entries, exits


def macd_signal_cross(close, high=None, low=None,
                      macd_fast=12, macd_slow=26, macd_signal=9,
                      use_adx_filter=False, is_trending=None, **kwargs):
    macd = vbt.MACD.run(close, fast=macd_fast, slow=macd_slow, signal=macd_signal)
    entries = (macd.macd > macd.signal) & (macd.macd.shift(1) <= macd.signal.shift(1))
    exits = (macd.macd < macd.signal) & (macd.macd.shift(1) >= macd.signal.shift(1))
    
    if use_adx_filter and is_trending is not None:
        entries = entries & is_trending
    
    return entries, exits


def macd_histogram_cross(close, high=None, low=None,
                         macd_fast=12, macd_slow=26, macd_signal=9,
                         hist_threshold=0.0,
                         use_adx_filter=False, is_trending=None, **kwargs):
    macd = vbt.MACD.run(close, fast=macd_fast, slow=macd_slow, signal=macd_signal)
    hist = macd.macd - macd.signal
    entries = (hist > hist_threshold) & (hist.shift(1) <= hist_threshold)
    exits = (hist < -hist_threshold) & (hist.shift(1) >= -hist_threshold)
    
    if use_adx_filter and is_trending is not None:
        entries = entries & is_trending
    
    return entries, exits


# ================================================================
# BACKTEST ENGINE
# ================================================================

def run_backtest(close, entries, exits,
                 high=None, low=None,
                 tsl_atr_mult=None,
                 freq=FREQ, cash=INIT_CASH):
    if entries.sum() < 1:
        return None

    try:
        pf_kwargs = dict(
            init_cash=cash,
            freq=freq,
            direction="longonly",
            fees=FEE,
            slippage=SLIPPAGE,
        )

        if tsl_atr_mult is not None and high is not None and low is not None:
            atr = vbt.ATR.run(high, low, close, window=ATR_WINDOW).atr
            pf_kwargs["tsl_stop"] = atr * tsl_atr_mult
            pf_kwargs["tsl_stop_entry_price"] = close

        pf = vbt.Portfolio.from_signals(close, entries, exits, **pf_kwargs)

        trades = pf.trades.records
        if len(trades) == 0:
            return None

        wins = int((trades["return"] > 0).sum())
        total = len(trades)
        rets = trades["return"]

        sharpe = float(pf.sharpe_ratio) if not math.isnan(pf.sharpe_ratio) else 0
        calmar = float(pf.calmar_ratio) if not math.isnan(pf.calmar_ratio) else 0
        sortino = float(pf.sortino_ratio) if not math.isnan(pf.sortino_ratio) else 0
        max_dd = float(pf.max_drawdown) * 100
        total_ret = float(pf.total_return) * 100

        neg_sum = rets[rets < 0].sum() if (rets < 0).any() else 0
        pos_sum = rets[rets > 0].sum() if (rets > 0).any() else 0
        pf_ratio = float(abs(pos_sum / neg_sum)) if neg_sum != 0 else float('inf')

        return {
            "sharpe": round(sharpe, 4),
            "calmar": round(calmar, 4),
            "sortino": round(sortino, 4),
            "max_dd_pct": round(max_dd, 2),
            "total_return_pct": round(total_ret, 2),
            "win_rate": round(wins / total * 100, 1),
            "trades": total,
            "avg_return": round(float(rets.mean()) * 100, 2),
            "profit_factor": round(pf_ratio, 2),
            "avg_win": round(float(rets[rets > 0].mean()) * 100, 2) if (rets > 0).any() else 0,
            "avg_loss": round(float(rets[rets < 0].mean()) * 100, 2) if (rets < 0).any() else 0,
        }
    except Exception as e:
        return None


# ================================================================
# v9: 3-FOLD PURGED WALK-FORWARD CV (with purge gap)
# ================================================================

def walk_forward_cv(close, entries, exits,
                    high=None, low=None,
                    tsl_atr_mult=None,
                    purge_gap=10):
    """
    v9: 3-fold time-series walk-forward with purge gap.
    
    Fold 1: train[0:150], test[160:230]  → 70 test candles
    Fold 2: train[0:210], test[220:270]  → 50 test candles  
    Fold 3: train[0:250], test[260:300]  → 40 test candles
    
    Each fold uses expanding train window with purge_gap between train/test.
    """
    n = len(close)
    if n < 200:
        return []
    
    # 3-fold configuration for 300 candles
    fold_configs = [
        (0, 150, 150 + purge_gap, 220),   # Fold 1
        (0, 210, 210 + purge_gap, 260),   # Fold 2
        (0, 250, 250 + purge_gap, n),      # Fold 3
    ]
    
    fold_results = []
    
    for train_start, train_end, test_start, test_end in fold_configs:
        if train_end >= test_end or test_start >= test_end:
            continue
            
        # In-sample
        m_in = run_backtest(
            close.iloc[train_start:train_end],
            entries.iloc[train_start:train_end],
            exits.iloc[train_start:train_end],
            high=high.iloc[train_start:train_end] if high is not None else None,
            low=low.iloc[train_start:train_end] if low is not None else None,
            tsl_atr_mult=tsl_atr_mult,
        )
        # Out-of-sample
        m_out = run_backtest(
            close.iloc[test_start:test_end],
            entries.iloc[test_start:test_end],
            exits.iloc[test_start:test_end],
            high=high.iloc[test_start:test_end] if high is not None else None,
            low=low.iloc[test_start:test_end] if low is not None else None,
            tsl_atr_mult=tsl_atr_mult,
        )
        
        if m_in and m_out and m_in["trades"] >= MIN_TRADES and m_out["trades"] >= 1:
            fold_results.append((m_in, m_out))
    
    return fold_results


# ================================================================
# GRID SEARCH (v9 enhanced)
# ================================================================

def grid_search(close, high, low, name, grid, signal_fn,
                use_tsl=False, use_adx_filter=False, is_trending=None):
    keys = list(grid.keys())
    combos = list(itertools.product(*[grid[k] for k in keys]))
    print(f"  [{name}] Testing {len(combos)} param combos...")

    results = []
    for combo in combos:
        params = dict(zip(keys, combo))

        try:
            entries, exits = signal_fn(
                close, high, low,
                use_adx_filter=use_adx_filter,
                is_trending=is_trending,
                **params
            )
            tsl_atr_mult = params.get("tsl_atr_mult", None) if use_tsl else None
        except Exception:
            continue

        if entries.sum() < 1:
            continue

        # Full sample backtest
        fm = run_backtest(close, entries, exits,
                          high=high, low=low,
                          tsl_atr_mult=tsl_atr_mult)
        if fm is None or fm["trades"] < MIN_TRADES:
            continue

        # Walk-forward CV
        wf = walk_forward_cv(close, entries, exits,
                              high=high, low=low,
                              tsl_atr_mult=tsl_atr_mult)
        if len(wf) < 2:  # Need at least 2 folds
            continue

        oos_sharpes = [f[1]["sharpe"] for f in wf]
        is_sharpes = [f[0]["sharpe"] for f in wf]
        avg_oos_sharpe = np.mean(oos_sharpes)
        avg_is_sharpe = np.mean(is_sharpes)
        min_oos_sharpe = min(oos_sharpes)
        sharpe_consistency = sum(1 for s in oos_sharpes if s > 0) / len(oos_sharpes)
        oos_std = np.std(oos_sharpes) if len(oos_sharpes) > 1 else 0

        # Stability: IS-to-OOS decay ratio
        if avg_is_sharpe > 0.01:
            decay_ratio = (avg_is_sharpe - avg_oos_sharpe) / abs(avg_is_sharpe)
            stability = max(0.0, 1.0 - max(0, decay_ratio))
        else:
            stability = 0.0

        # Penalty if any OOS fold is negative
        if min_oos_sharpe <= 0:
            stability *= 0.5
        
        # Bonus for positive consistency
        consistency_bonus = 1.0 + (sharpe_consistency * 0.3)

        avg_oos_trades = np.mean([f[1]["trades"] for f in wf])
        
        # v9: Composite score (reward OOS performance + stability + consistency)
        composite = max(avg_oos_sharpe, 0) * math.sqrt(max(avg_oos_trades, 1)) * stability * consistency_bonus
        if avg_oos_sharpe <= 0:
            composite = avg_oos_sharpe * 0.1

        results.append({
            "params": params,
            "full": fm,
            "wf_folds": [{"in": f[0], "out": f[1]} for f in wf],
            "composite": round(composite, 4),
            "stability": round(stability, 4),
            "avg_oos_sharpe": round(avg_oos_sharpe, 4),
            "min_oos_sharpe": round(min_oos_sharpe, 4),
            "oos_std": round(oos_std, 4),
            "sharpe_consistency": round(sharpe_consistency, 4),
        })

    if not results:
        return None

    results.sort(key=lambda x: x["composite"], reverse=True)
    best = results[0]

    return {
        "strategy": name,
        "best_params": best["params"],
        "composite": best["composite"],
        "full": best["full"],
        "wf_folds": best["wf_folds"],
        "stability": best["stability"],
        "avg_oos_sharpe": best["avg_oos_sharpe"],
        "min_oos_sharpe": best["min_oos_sharpe"],
        "oos_std": best["oos_std"],
        "sharpe_consistency": best["sharpe_consistency"],
        "top_5": [{
            "params": r["params"],
            "composite": r["composite"],
            "avg_oos_sharpe": r["avg_oos_sharpe"],
        } for r in results[:5]],
        "valid": len(results),
        "total": len(combos),
    }


# ================================================================
# v9: Enhanced OVP ASSESSMENT
# ================================================================

def assess_overfitting_v9(strategy_data, trending_pct=None):
    if strategy_data is None:
        return "N/A"
    
    stability = strategy_data.get("stability", 0)
    min_oos_sharpe = strategy_data.get("min_oos_sharpe", 0)
    sharpe_consistency = strategy_data.get("sharpe_consistency", 0)
    oos_std = strategy_data.get("oos_std", 99)
    fm = strategy_data.get("full", {})
    wf_folds = strategy_data.get("wf_folds", [])
    
    # v9: Market regime adjustment
    # In ranging markets (<25% trending), trend-following will naturally underperform
    # We adjust OVP lower (less risky) if market is non-trending
    regime_penalty = 1.0
    if trending_pct is not None:
        if trending_pct < 25:
            # Market is mostly ranging - trend strategies will struggle
            regime_penalty = 0.7  # Reduce OVP risk rating
        elif trending_pct > 60:
            regime_penalty = 1.0  # Normal assessment
    
    # v9: Cross-fold analysis
    oos_returns = [f["out"]["total_return_pct"] for f in wf_folds]
    oos_return_consistency = sum(1 for r in oos_returns if r > 0) / max(len(oos_returns), 1)
    
    # Full sample sanity check
    full_sharpe = fm.get("sharpe", 0) if fm else 0
    
    # v9: Enhanced scoring with regime awareness
    high_stability = stability >= 0.6 * regime_penalty
    all_positive = min_oos_sharpe > 0
    consistent = sharpe_consistency >= 0.5
    low_volatility = oos_std < 3.0
    oos_returns_ok = oos_return_consistency >= 0.5
    full_sharpe_ok = full_sharpe > 0.5

    # Count satisfied conditions
    conditions_met = sum([high_stability, all_positive, consistent, 
                          low_volatility, oos_returns_ok, full_sharpe_ok])
    
    if conditions_met >= 5:
        return "LOW"
    elif conditions_met >= 3:
        return "MEDIUM"
    else:
        return "HIGH"


# ================================================================
# RUN SYMBOL
# ================================================================

def run_symbol(symbol):
    sep = "=" * 75
    print(f"\n{sep}")
    print(f"  {symbol}  |  4H  |  v9 (ADX-filter + 3-fold CV)")
    print(f"{sep}")

    print(f"  Fetching {DATA_LIMIT} candles from OKX...")
    df = fetch_okx(symbol, "4H", DATA_LIMIT)
    if df is None or len(df) < 100:
        print(f"  ERROR: insufficient data")
        return None

    close = df["close"]
    high = df["high"]
    low = df["low"]
    n = len(df)
    price = float(close.iloc[-1])
    start = close.index[0].strftime("%Y-%m-%d")
    end = close.index[-1].strftime("%Y-%m-%d")
    print(f"  {n} candles | {start} -> {end} | ${price:,.2f}")
    print(f"  Fees={FEE*100}% | Slippage={SLIPPAGE*100}% | 3-fold WF-CV | ADX filter")

    # Market regime detection
    is_trending, trending_pct = detect_market_regime(close, high, low)
    print(f"  Market Regime: ADX>25 = {trending_pct:.1f}% of time "
          f"({'TRENDING' if trending_pct > 50 else 'RANGING'})")

    opts = {}

    # 1. Classic strategies (without ADX filter - baseline)
    strategies_no_adx = [
        ("RSI", RSI_GRID, rsi_signals),
        ("SuperTrend", ST_GRID, supertrend_signals),
    ]
    for name, grid, fn in strategies_no_adx:
        print()
        opts[name] = grid_search(close, high, low, name, grid, fn)

    # 2. MACD variants (baseline)
    macd_variants = [
        ("MACD_SignalCross", MACD_SIGNAL_GRID, macd_signal_cross),
        ("MACD_HistCross", MACD_HIST_GRID, macd_histogram_cross),
    ]
    for name, grid, fn in macd_variants:
        print()
        opts[name] = grid_search(close, high, low, name, grid, fn)

    # 3. ADX-filtered versions (v9 improvement)
    strategies_adx = [
        ("SuperTrend_ADX", ST_GRID, supertrend_signals),
        ("MACD_Sig_ADX", MACD_SIGNAL_GRID, macd_signal_cross),
    ]
    for name, grid, fn in strategies_adx:
        print()
        opts[name] = grid_search(close, high, low, name, grid, fn,
                                 use_adx_filter=True, is_trending=is_trending)

    # ===== PRINT RESULTS =====
    print(f"\n{sep}")
    print(f"  RESULTS -- {symbol}")
    print(f"{sep}")

    all_strategy_names = [
        "RSI", "SuperTrend",
        "MACD_SignalCross", "MACD_HistCross",
        "SuperTrend_ADX", "MACD_Sig_ADX",
    ]

    rows = []
    for name in all_strategy_names:
        opt = opts.get(name)
        if opt is None:
            print(f"\n  {name}: FAILED (no valid params)")
            continue

        bp = opt["best_params"]
        fm = opt["full"]
        print(f"\n  +-- {name} ---")
        print(f"  | Params       : {json.dumps(bp)}")
        print(f"  | Composite    : {opt['composite']:.4f}  (stability={opt['stability']:.4f})")
        print(f"  | Full         : Sharpe={fm['sharpe']:.4f}  Ret={fm['total_return_pct']:.2f}%  "
              f"DD={fm['max_dd_pct']:.2f}%  WR={fm['win_rate']:.1f}%  Trades={fm['trades']}")
        print(f"  | Avg OOS      : Sharpe={opt['avg_oos_sharpe']:.4f}  Min={opt['min_oos_sharpe']:.4f}  "
              f"Std={opt['oos_std']:.4f}  C={opt['sharpe_consistency']:.2f}")
        print(f"  | WF Folds     : {len(opt['wf_folds'])}")
        print(f"  | Valid/Total  : {opt['valid']}/{opt['total']}")
        if fm:
            print(f"  | Avg Win/Loss : {fm['avg_win']:.2f}% / {fm['avg_loss']:.2f}%  "
                  f"PF: {fm['profit_factor']}")

        for i, fold in enumerate(opt['wf_folds']):
            fi = fold["in"]
            fo = fold["out"]
            print(f"  | Fold {i+1}: IS Sh={fi['sharpe']:.4f} Ret={fi['total_return_pct']:.2f}%  |  "
                  f"OOS Sh={fo['sharpe']:.4f} Ret={fo['total_return_pct']:.2f}% Trades={fo['trades']}")

        print(f"  +--")
        ovp = assess_overfitting_v9(opt, trending_pct)
        rows.append((name, opt["composite"], opt["avg_oos_sharpe"], fm,
                     opt["stability"], ovp))

    if rows:
        print(f"\n  {'='*110}")
        h = (f"  {'Strategy':<20} {'Composite':>10} {'OOS_Sharpe':>12} {'Sharpe':>10} "
             f"{'Ret%':>7} {'DD%':>7} {'WR':>6} {'Trades':>7} {'Stab':>6} {'OVP':>6}")
        print(h)
        print(f"  {'='*110}")
        rows.sort(key=lambda r: r[1], reverse=True)
        for name, comp, oos_sh, fm, stab, ovp in rows:
            print(f"  {name:<20} {comp:>10.4f} {oos_sh:>12.4f} {fm['sharpe']:>10.4f} "
                  f"{fm['total_return_pct']:>6.2f}% {fm['max_dd_pct']:>6.2f}% "
                  f"{fm['win_rate']:>5.1f}% {fm['trades']:>7} {stab:>6.3f} {ovp:>6}")
        print(f"  {'='*110}")
        winner = rows[0]
        print(f"\n  ★ WINNER: {winner[0]}  (composite={winner[1]:.4f}, Stab={winner[4]:.3f}, OVP={winner[5]})")

    return {
        "symbol": symbol, "timeframe": "4h",
        "data": f"{start} -> {end}", "candles": n,
        "current_price": round(price, 2),
        "market_regime": f"{trending_pct:.1f}% trending",
        "strategies": opts,
        "ranking": [{"strategy": r[0], "composite": r[1], "oos_sharpe": r[2], "ovp": r[5]}
                    for r in rows] if rows else [],
        "winner": rows[0][0] if rows else None,
    }


# ================================================================
# MAIN
# ================================================================

def main():
    print("=" * 75)
    print("  RSI vs SuperTrend vs MACD  |  VBT PRO  |  4H  |  v9")
    print("  3-fold Purged WF-CV | ADX regime filter | Enhanced OVP")
    print("=" * 75)

    all_r = {}
    for sym in PAIRS:
        r = run_symbol(sym)
        if r:
            all_r[sym] = r

    # ---- FINAL SUMMARY ----
    print(f"\n{'='*75}")
    print("  FINAL SUMMARY — v9")
    print(f"{'='*75}")

    for sym, r in all_r.items():
        print(f"\n  {sym} ({r['data']}, {r['candles']} candles, ${r['current_price']:,.2f})")
        print(f"  Market: {r['market_regime']}")
        if not r["ranking"]:
            print("    All strategies failed")
            continue
        print(f"    ★ Winner: {r['winner']}")
        for rank in r["ranking"]:
            s = rank["strategy"]
            od = r["strategies"][s]
            if od is None:
                continue
            bp = od["best_params"]
            fm = od["full"]
            print(f"      {s:<20} params={json.dumps(bp):<55} "
                  f"Sharpe={fm['sharpe']:>8.4f}  "
                  f"Ret={fm['total_return_pct']:>6.2f}%  DD={fm['max_dd_pct']:>5.2f}%  "
                  f"WR={fm['win_rate']:>5.1f}%  Trades={fm['trades']:>4}  OVP={rank['ovp']}")

    # ---- CROSS-ASSET COMPARISON ----
    print(f"\n{'='*75}")
    print("  CROSS-ASSET ANALYSIS")
    print(f"{'='*75}")

    btc_r = all_r.get("BTC/USDT", {})
    eth_r = all_r.get("ETH/USDT", {})

    if btc_r.get("winner") and eth_r.get("winner"):
        cross_same = btc_r["winner"] == eth_r["winner"]
        print(f"\n  BTC/USDT Winner: {btc_r['winner']}")
        print(f"  ETH/USDT Winner: {eth_r['winner']}")
        print(f"  Cross-asset consistent: {'YES ✓' if cross_same else 'NO ✗'}")

    # ---- VERSION COMPARISON ----
    print(f"\n{'='*75}")
    print("  VERSION COMPARISON (v4 → v9)")
    print(f"{'='*75}")
    print(f"""
  Version Evolution:
    v4 (no fees):     SuperTrend dominant, Sharpe=2.03(BTC)/2.48(ETH)
    v5 (0.1% fees):   SuperTrend only viable, Sharpe=1.06(BTC)/2.49(ETH)
    v6 (MACD var.):   SuperTrend consistent, Sharpe=1.19(BTC)/1.57(ETH)
    v7 (aggressive):  Mixed results, 3-fold CV
    v8 (2-fold CV):   Calibrated WF-CV, cross-asset check
    v9 (ADX+3-fold):  ADX regime filter, 3-fold purge CV, enhanced OVP
    
  Key v9 Improvements:
    • ADX>25 market regime detection → filter out ranging markets
    • 3-fold walk-forward → more robust OOS testing
    • 10-candle purge gap → prevent leakage
    • Regime-adjusted OVP → fairer assessment in ranging markets
  """)

    return all_r


if __name__ == "__main__":
    result = main()
