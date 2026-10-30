# LedgerAlpha - Unitized Pool Accounting Model

This document outlines the mathematical and ledger model of LedgerAlpha. By moving to a **Unitized Fund Pool** model, we treat the family portfolio like an investment trust or mutual fund, separating cash additions from individual stock allocation splits.

---

## 1. Core Definitions & Math

Let:
- $V_t$ be the **Net Asset Value (NAV)** of the portfolio at time $t$ (before any deposit/withdrawal at time $t$ occurs).
  $$V_t = C_t + \sum_{i} \left( Q_{i,t} \times P_{i,t} \right)$$
  Where:
  - $C_t$ is the cash balance of the portfolio immediately before time $t$.
  - $Q_{i,t}$ is the quantity of asset $i$ held in the portfolio.
  - $P_{i,t}$ is the current price of asset $i$ at time $t$.
- $U_t$ be the **Total Units Outstanding** in the pool immediately before time $t$.
- $NAVPU_t$ be the **Net Asset Value Per Unit** at time $t$:
  $$NAVPU_t = \frac{V_t}{U_t}$$
  *(For the initial state when $U_0 = 0$, the starting unit price is defined as $NAVPU_0 = \$1.00$)*

---

## 2. Event Types & Calculations

### A. Cash Deposits (DEPOSIT)
When Owner $O$ deposits cash $D$ at time $t$:
1. Calculate the current unit value $NAVPU_t$.
2. Issue new units $\Delta U_O$ to Owner $O$:
   $$\Delta U_O = \frac{D}{NAVPU_t}$$
3. Update the total units outstanding:
   $$U_{new} = U_t + \Delta U_O$$
4. Update the owner's unit balance:
   $$U_{O,new} = U_{O,t} + \Delta U_O$$
5. Update the cash balance of the portfolio:
   $$C_{new} = C_t + D$$

### B. Cash Withdrawals (WITHDRAWAL)
When Owner $O$ withdraws cash $W$ at time $t$:
1. Calculate the current unit value $NAVPU_t$.
2. Redeem units $\Delta U_O$ from Owner $O$:
   $$\Delta U_O = \frac{W}{NAVPU_t}$$
3. Update the total units outstanding:
   $$U_{new} = U_t - \Delta U_O$$
4. Update the owner's unit balance:
   $$U_{O,new} = U_{O,t} - \Delta U_O$$
5. Update the cash balance of the portfolio:
   $$C_{new} = C_t - W$$

### C. Buy Asset (BUY)
Buying quantity $Q$ of asset $i$ at price $P$ with fee $F$:
1. Reduce the cash balance:
   $$C_{new} = C_t - (Q \times P + F)$$
2. Increase the asset quantity:
   $$Q_{i,new} = Q_{i,t} + Q$$
3. *Note*: No units are issued or redeemed. The total portfolio value remains unchanged (except for the deduction of the transaction fee $F$). Ownership percentages do not change.

### D. Sell Asset (SELL)
Selling quantity $Q$ of asset $i$ at price $P$ with fee $F$:
1. Increase the cash balance:
   $$C_{new} = C_t + (Q \times P - F)$$
2. Decrease the asset quantity:
   $$Q_{i,new} = Q_{i,t} - Q$$
3. *Note*: No units are issued or redeemed. The total portfolio value remains unchanged (except for the transaction fee $F$). Ownership percentages do not change.

### E. Cash Dividend / Interest (DIVIDEND / FEE)
- Cash dividends increase the portfolio cash balance $C$, which increases the total value $V_t$, thereby raising $NAVPU_t$ for all existing unit holders proportionally. No new units are issued.
- Fees reduce the portfolio cash balance $C$, lowering the $NAVPU_t$ for all holders.

---

## 3. Owner Valuations & Reporting

At any reporting time $T$, we calculate:

- **Ownership Share** ($\text{Share}_O$):
  $$\text{Share}_{O,T} = \frac{U_{O,T}}{U_T}$$
- **Current Value** ($\text{Value}_{O,T}$):
  $$\text{Value}_{O,T} = \text{Share}_{O,T} \times V_T$$
- **Net Invested Cash** ($\text{Net Invested}_{O,T}$):
  $$\text{Net Invested}_{O,T} = \sum \text{Deposits}_{O} - \sum \text{Withdrawals}_{O}$$
- **Unrealized Gain / Loss**:
  $$\text{Gain/Loss}_{O,T} = \text{Value}_{O,T} - \text{Net Invested}_{O,T}$$
- **Return Percentage**:
  $$\text{Return Pct}_{O,T} = \frac{\text{Gain/Loss}_{O,T}}{\text{Net Invested}_{O,T}}$$

---

## 4. FIFO Lot Cohort Resolution

While ownership is managed at the unit pool level, individual buying decisions (lots) must be tracked for **Decision Grading** and **Realized Gains**:
- When a `BUY` transaction occurs, a new lot is recorded.
- When a `SELL` transaction occurs, the units sold are deducted from the earliest open lots (FIFO).
- Each lot's performance is graded by comparing its return to a benchmark (e.g. SPY) over the exact holding duration of that lot.


## Hosted edition (2026-10-29)

The supported cross-device edition lives in `site/` and uses private ChatGPT sign-in plus user-scoped D1 records. See [the as-built hosting specification](../sites-hosting.md) for its data model, accounting replay, prior-session cash-flow pricing, split conventions, atomic import/deduplication, quote freshness, storage bounds and recovery workflow. Root Prisma/API descriptions above describe the retained local prototype, not the hosted storage/write path. No production seed or reset runs.
