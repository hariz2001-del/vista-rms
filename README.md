# Vista Owner RMS

React + Vite dashboard for the owners of the Vista counter. English throughout, integer sen
throughout, light mode only — the same choices as the POS.

Part of the Vista system: [vista-pos](https://github.com/hariz2001-del/vista-pos) (cashier) · **vista-rms** (owner dashboard) · [vista-api](https://github.com/hariz2001-del/vista-api) (backend).

**Status: UI round.** Runs entirely on generated demo data (`src/data/fake/`) with an in-memory
store standing in for the API. `api-vista` has the money path but not expenses, ledger reporting
or settlement yet, so wiring this to it is the next step, not this one.

```bash
npm install
npm run dev      # http://localhost:5174
npm run check    # oxlint + vitest + tsc + vite build
```

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

**A partner who pays out of pocket is not owed the whole amount.** Their own brand's share was
always theirs to bear; only the counterparty's share is a debt. Settlement shows the RM 2,400
chiller as RM 1,200 owed, not RM 2,400.

**Paid sales are immutable.** Resolving a flag never edits one — a refund writes its own reversing
entry.

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

`src/data/fake/generate.ts` produces five weeks of trading from a fixed seed: weekday/weekend
variation, Mondays closed, rent and utilities on their usual dates, restocks, three partner
drawings, a chiller the Drinks partner paid for and has never been reimbursed for, two flagged
sales, one sale priced offline against a stale menu, and one shift whose bank total was RM 18.50
short. Thin data makes a bad dashboard look fine, which is why it is not thin.

## Tests

`src/domain/finance.test.ts` — 14 tests over the settlement maths: shared splits summing exactly,
the host cut clamped at zero on a loss, a deficit carried forward and then recovered across
periods, capital assets excluded from the operating result, the stored split winning over the
current setting, and the running balance ordering by business date.
