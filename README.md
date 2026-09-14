# Vista Owner RMS

React + Vite dashboard for the owners of the Vista counter. English throughout, integer sen
throughout, light mode only — the same choices as the POS.

**Status: connected to `api-vista`.** Sign in with the business account — the same one the
counter uses (`demo@vistahub.my` / `vista` in the demo seed) — and the dashboard reads the real
books from `GET /rms/snapshot`, re-reading every five seconds, so a sale rung at the counter shows
up within that. Every action (log an expense, settle an advance, Adjust Balance, force-close, menu
price and sold-out, settings, partner names, closing a period) is a request to the API, followed
by a fresh read. A period's settlement is computed and frozen by the server; the figures on screen
are a preview.

Signing in here gives an **owner session** (expires after 12 hours). The counter tablet signs in
with the same account but gets a counter session, which is refused here. **Settings → Counter
tablet** signs the counter out: it returns to its sign-in screen on its next request, keeping any
unsent sales on the device.

```bash
npm install
npm run dev      # http://localhost:5174 — reads api-vista on http://127.0.0.1:3000, start that first
npm run check    # oxlint + vitest + tsc + vite build
```

Point at a different API with `VITE_API_BASE_URL` (see `.env.example`). Set `VITE_DEMO=1` to run
on the generated demo history with no server at all.

## The six sections

| Section | What it answers |
|---|---|
| **Overview** | What happened this month, and what needs a decision |
| **Cashflow** | Where every ringgit went, with a running balance |
| **Expenses** | Log a spend in under twenty seconds |
| **Settlement** | What each partner is owed, and why |
| **Menu** | Prices and sold-out state |
| **Settings** | Ratios, brands, partners |

Six, not more, and on purpose. The predecessor product ended up with five overlapping places to
look at money, two of which disagreed with each other; the founder's own verdict was "a tad bit
complicated." The rule here: **money movement lives in Cashflow, money owed between partners lives
in Settlement, and Overview only ever summarises and links** — it never becomes a sixth place a
number gets computed a seventh way.

## Decisions worth knowing

**It never says "profit".** Vista tracks no cost of goods, so the headline figure is an
**operating result** — net sales minus operating expenses — and the tile says so in plain words.
The predecessor's dashboard subtracted a theoretical ingredient cost *and* the restock purchases
that were that same cost, rendering a 62%-margin business as near break-even. Nobody noticed for
months. Not calculating COGS at all is what makes that impossible here.

**Capital and drawings move money but are not expenses.** A chiller purchase and a partner
drawing both leave the bank, and both appear in Cashflow — but neither touches the operating
result. `isOperatingExpense` is the single place that distinction is made.

**Daily sales roll up in the ledger.** The API writes a revenue entry per order per brand, which
is right for traceability and unreadable as a cash book — 300 sales a day would bury every
expense and drawing. Cashflow groups them into one line per day per brand by default, with a
toggle to see every order. This is the same failure the predecessor shipped: 64 shift closes
produced ~288 near-identical rows and the ledger stopped being something anyone opened.

**The running balance orders by business date, not insertion.** Expenses get backdated routinely.
Ordering by id would drop a receipt entered on the 8th for the 3rd at the bottom of the book with
a balance beside it that means nothing.

**Shift variance is the owner's call, not the cashier's.** Closing a shift records the gap and
leaves it `UNRECONCILED`. The owner says what it was — bank fee, unrecorded sale, cashier error —
and *that* writes the balancing ledger entry. Until then Cashflow states plainly that the balance
is incomplete rather than implying it is settled.

**Expense splits are snapshots.** Each expense stores the ratio it was logged with, so changing
the ratio in Settings applies from now on and can never quietly rewrite a closed month. The split
slider only appears for a *shared* cost — applying 70/30 to a direct Food restock would bleed 30%
of it onto Drinks and corrupt both brands' results.

**A partner who pays out of pocket is reimbursed in full.** Both brands already bear their share
through the expense split in the operating result. Reimbursing only the counterparty's portion
would make the paying partner bear their own portion twice.

**Paid sales are immutable.** A counter cancel or exchange never edits one — it writes its own
linked reversing entry. Cashier corrections appear on the Owner's desk for oversight, link to
their ungrouped Cashflow rows, and flow through net sales, brand split, daily chart, and live
counter takings rather than being hidden inside the original order.

## Charts

One chart: daily net sales, stacked by brand. Two series, so a legend is always present and a
table view is one click away — identity is never colour alone.

The chart marks are **not** the brand identity colours. Validated against the surface, the brand
teal has a chroma of 0.092 (below the 0.1 floor — it reads grey as a large fill) and the brand
orange lands at 2.98:1 contrast, under the 3:1 minimum. `--color-chart-food` and
`--color-chart-drinks` are the nearest steps on the same hues that pass every check: lightness
band, chroma floor, CVD separation (ΔE 16.4 protan), normal-vision separation (ΔE 28.1) and
contrast. Identity chips and dots still use the brand colours.

Light mode only. A dark palette needs its own validated steps rather than an automatic flip, and
neither Vista app ships one.

## Demo data

Used only with `VITE_DEMO=1`. `src/data/fake/generate.ts` produces five weeks of trading from a
fixed seed: weekday/weekend
variation, Mondays closed, rent and utilities on their usual dates, restocks, three partner
drawings, a chiller the Drinks partner paid for and has never been reimbursed for, two historical
flagged sales, two cashier corrections, one sale priced offline against a stale menu, and one shift
whose bank total was RM 18.50 short. Thin data makes a bad dashboard look fine, which is why it is
not thin.

## Tests

33 tests cover the settlement maths and correction reporting — including that a sale the cashier
refunded is not paid out to the partners, with the same figures the server's period close is
tested against: shared splits summing exactly,
the host cut clamped at zero on a loss, a deficit carried forward and then recovered across
periods, capital assets excluded from the operating result, the stored split winning over the
current setting, running balance ordering by business date, same-price cross-brand exchanges,
owner activity cards, and corrected live takings.
