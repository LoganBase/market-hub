/**
 * Market Hub — Relative Rotation Graph (RRG) data
 * GET /api/sector-cycle
 *
 * Computes RS-Ratio and RS-Momentum for all 11 GICS sector ETFs vs SPY
 * using the JdK Relative Rotation Graph methodology.
 *
 * Algorithm (weekly, last trading day of each ISO week):
 *   RS-Line    = sector_close / SPY_close
 *   RS-Ratio   = EWM(10, RS-Line) / EWM(26, RS-Line) × 100   (>100 = outperforming)
 *   RS-Momentum = RS-Ratio / EWM(5, RS-Ratio) × 100           (>100 = momentum building)
 *
 * Returns last 13 weekly data points per sector (12 trail + current dot).
 * Requires ~2 years of daily data in D1 for EWM warm-up.
 */

const SECTORS = [
  { sym: 'XLK',  label: 'Technology',      color: '#818cf8', type: 'cyclical'  },
  { sym: 'XLY',  label: 'Consumer Disc.',  color: '#f59e0b', type: 'cyclical'  },
  { sym: 'XLC',  label: 'Comm. Services',  color: '#22d3ee', type: 'cyclical'  },
  { sym: 'XLI',  label: 'Industrials',     color: '#a855f7', type: 'cyclical'  },
  { sym: 'XLF',  label: 'Financials',      color: '#3b82f6', type: 'cyclical'  },
  { sym: 'XLE',  label: 'Energy',          color: '#f97316', type: 'cyclical'  },
  { sym: 'XLB',  label: 'Materials',       color: '#84cc16', type: 'cyclical'  },
  { sym: 'XLV',  label: 'Health Care',     color: '#ef4444', type: 'defensive' },
  { sym: 'XLP',  label: 'Consumer Staples', color: '#94a3b8', type: 'defensive' },
  { sym: 'XLU',  label: 'Utilities',       color: '#fbbf24', type: 'defensive' },
  { sym: 'XLRE', label: 'Real Estate',     color: '#34d399', type: 'defensive' },
];

const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

function ewm(values, span) {
  const alpha = 2 / (span + 1);
  let s = null;
  return values.map(v => {
    if (v == null) return null;
    s = s == null ? v : alpha * v + (1 - alpha) * s;
    return s;
  });
}

// Returns the Monday date string (YYYY-MM-DD) for the ISO week containing dateStr
function weekStart(dateStr) {
  const d   = new Date(dateStr + 'T12:00:00Z');
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  const offset = dow === 0 ? 6 : dow - 1;
  const mon = new Date(d.getTime() - offset * 86400000);
  return mon.toISOString().slice(0, 10);
}

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' } });
  }

  const db = context.env.DB;
  if (!db) return new Response(JSON.stringify({ error: 'D1 not available' }), { status: 500, headers: CORS });

  try {
    // 2 years of daily data — needed for EWM(26) warm-up before the 13-week trail window
    const start = new Date();
    start.setDate(start.getDate() - 730);
    const startStr = start.toISOString().slice(0, 10);

    const allSyms     = ['SPY', ...SECTORS.map(s => s.sym)];
    const placeholders = allSyms.map(() => '?').join(',');

    const { results } = await db.prepare(`
      SELECT dp.date, dp.symbol, dp.close
      FROM daily_prices dp
      INNER JOIN (
        SELECT DISTINCT date FROM daily_prices WHERE symbol = 'SPY' AND date >= ?
      ) d ON dp.date = d.date
      WHERE dp.symbol IN (${placeholders})
      ORDER BY dp.date ASC
    `).bind(startStr, ...allSyms).all();

    // Build per-date map
    const byDate = {};
    for (const row of results) {
      if (!byDate[row.date]) byDate[row.date] = {};
      byDate[row.date][row.symbol] = row.close;
    }
    const allDates = Object.keys(byDate).sort();

    // Aggregate to weekly: last close of each ISO week (later dates overwrite earlier ones)
    const weekMap = {}; // weekStartStr -> { date, SYM: close, ... }
    for (const date of allDates) {
      const wk = weekStart(date);
      if (!weekMap[wk]) weekMap[wk] = { weekDate: date };
      Object.assign(weekMap[wk], byDate[date]);
      weekMap[wk].weekDate = date; // track last date in this week
    }
    const weekKeys = Object.keys(weekMap).sort();

    const sectorData = SECTORS.map(sec => {
      // Build daily RS-Line for EWM warm-up
      const rsLine = allDates.map(d => {
        const s   = byDate[d]?.[sec.sym];
        const spy = byDate[d]?.SPY;
        return (s != null && spy != null && spy !== 0) ? s / spy : null;
      });

      // EWM on daily RS-Line (deep warm-up before windowing to weekly)
      const e10 = ewm(rsLine, 10);
      const e26 = ewm(rsLine, 26);

      // Build a map from date -> RS-Ratio (daily resolution, for weekly sampling)
      const rsRatioByDate = {};
      for (let i = 0; i < allDates.length; i++) {
        if (e10[i] != null && e26[i] != null && e26[i] !== 0) {
          rsRatioByDate[allDates[i]] = (e10[i] / e26[i]) * 100;
        }
      }

      // Sample RS-Ratio at the last trading day of each week
      const weeklyRSRatio = weekKeys.map(wk => {
        const lastDate = weekMap[wk].weekDate;
        return rsRatioByDate[lastDate] ?? null;
      });

      // RS-Momentum = RS-Ratio / EWM(5, RS-Ratio) × 100
      const e5mom  = ewm(weeklyRSRatio, 5);
      const rsMom  = weeklyRSRatio.map((v, i) =>
        (v != null && e5mom[i] != null && e5mom[i] !== 0) ? (v / e5mom[i]) * 100 : null
      );

      // Return last 13 weekly points (12 trail + current)
      const TRAIL = 13;
      const from  = Math.max(0, weekKeys.length - TRAIL);
      const trail = weekKeys.slice(from).map((wk, i) => {
        const idx = from + i;
        return {
          week:    wk,
          rsRatio: weeklyRSRatio[idx] != null ? +weeklyRSRatio[idx].toFixed(3) : null,
          rsMom:   rsMom[idx] != null ? +rsMom[idx].toFixed(3) : null,
        };
      });

      return { sym: sec.sym, label: sec.label, color: sec.color, type: sec.type, trail };
    });

    return new Response(JSON.stringify({ sectors: sectorData }), {
      headers: { ...CORS, 'Cache-Control': 'public, max-age=3600' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS });
  }
}
