# NimWizard — User Guide

## Contents

1. [Global Controls](#1-global-controls)
2. [Org Chart](#2-org-chart)
3. [Contacts](#3-contacts)
4. [Meetings](#4-meetings)
5. [Tasks](#5-tasks)
6. [Timelines](#6-timelines)
7. [Diagrams](#7-diagrams)
8. [Products](#8-products)
9. [Deal Engine](#9-deal-engine)
10. [Pricebook](#10-pricebook)
11. [Customer Configs](#11-customer-configs)
12. [Contract Manager](#12-contract-manager)

---

## 1. Global Controls

### Currency Toggle (USD / AUD)
The **CurrencyBar** appears in the Products and Deal Engine top bars.

- **USD** — all price inputs and displays are in US dollars. FX label shows `1 USD = x AUD`.
- **AUD** — all price inputs and displays are in Australian dollars. FX label shows `1 AUD = y USD`.
- The FX rate field is always visible. Enter the exchange rate for the active direction and press **Enter** or click away to apply.
- Switching modes instantly recalculates all displayed prices, sell inputs, and net inputs across the entire table.

---

## 2. Org Chart

Build a visual reporting hierarchy for your accounts.

### Adding contacts to the chart
1. Select contacts from the left panel — they appear as nodes on the canvas.
2. Drag nodes to position them.

### Drawing relationships
- **Solid line** — standard reporting line (drag from one node to another).
- **Dotted line** — indirect / matrix reporting.
- **Peer line** — same-level relationship (no hierarchy implied).

### Saving charts
- Click **Save Chart** to name and store the current layout.
- Switch between saved charts using the dropdown at the top.
- Each saved chart stores its own node positions and relationship lines.

---

## 3. Contacts

A shared contact list used across Org Chart, Meetings, and other modules.

### Fields
| Field | Notes |
|---|---|
| Name | Required |
| Title | Job title |
| Organisation | Company / account |
| Level | c-level → individual contributor |
| Email | Clickable mailto link |
| Phone | Free text |

### Operations
- **Add** — click **+ New Contact** in the top bar.
- **Edit** — click any contact row to open the edit drawer.
- **Delete** — use the delete button inside the drawer.
- **Search** — live filter by name, title, or organisation.

---

## 4. Meetings

Record meeting notes and track action items.

### Creating a meeting
1. Click **+ New Meeting**.
2. Set title, date, and attendees (picked from your Contacts list).
3. Add discussion notes in the free-text field.

### Action items
- Add action items with text, assignee, priority (low / medium / high), and due date.
- Mark items done with the checkbox.
- Link an action to an existing Task using the **Task** picker — the task progress updates automatically.

---

## 5. Tasks

Bucket-based task management with sub-tasks and scheduling.

### Buckets
- Buckets are columns (e.g. "Backlog", "In Progress", "Done").
- Add, rename, reorder, and colour-code buckets from the bucket menu.

### Tasks
Each task has:
- **Text** — the task name / description.
- **Priority** — low / medium / high.
- **Start date / Due date** — displayed in the Gantt view.
- **Progress** — 0–100 % slider.
- **Notes** — free-text notes.
- **Sub-tasks** — nested items, each with their own priority, dates, and progress.
- **Predecessors** — link to other tasks that must complete first.
- **Timeline link** — associate with a swim lane item in a Timeline.

### Views
- **Board** — Kanban columns.
- **Timeline** — Gantt chart of all tasks and sub-tasks with drag-to-reschedule.

---

## 6. Timelines

Interactive Gantt-style timelines.

### Timescales
Days · Weeks · Months · Quarters · Years. Each supports a secondary sub-timescale for the row headers.

### Year modes
- **Calendar** — Jan–Dec.
- **Financial (AU)** — Jul–Jun.

### Swim lanes
- Add lanes with a label and colour.
- Lanes can be nested (drag to create parent–child lane groups).
- Collapse lanes to save screen space.

### Items
Each timeline item is a **bar** or **milestone**:
- Set start/end dates, progress, colour, and notes.
- Link to a Task (progress stays in sync).
- Add **sub-items** inside a bar for finer breakdown.
- Set predecessor items for dependency arrows.

### Milestones
- Diamond-shaped markers at a specific date.
- Show as a vertical line across all lanes.

### Freeze periods
Shade a date range to indicate a code freeze, holiday, or blackout window.

### Column width
- Drag column resize handles to widen/narrow date columns.
- Per-column overrides are saved.

---

## 7. Diagrams

Embed draw.io diagrams stored in your account.

- Click **+ New Diagram** to open a blank draw.io canvas.
- All draw.io tools are available (shapes, connectors, tables, etc.).
- Diagrams auto-save to Firestore on close.
- Click any diagram card to reopen it in the editor.

---

## 8. Products

The product catalogue. Each product has a pricing **configuration table** — a structured bill-of-materials with groups, subgroups, and individual rows.

### Left panel
- Lists all products with their config total in the active currency.
- Search by name; filter by pricing type (One-Time / Recurring).
- Click a product to open it in the right pane.
- **Clone** / **Delete** buttons appear below the active product name.
- Click **+ New Product** in the top bar to create one.

### Product detail pane

#### Toolbar
- **Product name** — edit inline at the left of the toolbar.
- **+ Row** — add a row to the selected group (or to the only group if there is one).
- **+ Group** — add a new top-level group.
- **Columns** — show/hide individual columns (Cost, Floor, Unit, Term, etc.).
- **Paste Excel** — import rows from an Excel copy-paste.
- **Save** — saves the product and syncs the config name with the product name.

#### Groups
A product can have multiple top-level **groups**, each independently set to **One-Time** or **Recurring**.

| Control | Purpose |
|---|---|
| Group label | Click to rename |
| One-Time / Recurring | Toggle pricing type |
| Qty (multiplier) | Scales the entire group's total (e.g. 3 sites) |
| Disc% | Applies a uniform discount to all rows in the group |
| Net | Editable — changes here proportionally scale unlocked rows |
| Total | Net × group qty; read-only |
| ▲ ▼ | Reorder groups |
| × | Delete group |

#### Subgroups
Inside a group you can add **subgroups** — coloured blocks that visually bundle related rows.

| Control | Purpose |
|---|---|
| Subgroup label | Click to rename |
| Qty | Multiplier applied to the subgroup's total |
| Disc% | Group-level discount applied to all rows inside |
| Net | Sum of child rows; edit to proportionally scale unlocked rows |
| Total | Subgroup net × subgroup qty |
| Colour picker | Pick a highlight colour for the subgroup block |
| × | Delete subgroup |

#### Rows
Each row in a group or subgroup has:

| Column | Notes |
|---|---|
| Code | Product / SKU code |
| Description | Line item label |
| Qty | Unit quantity |
| Cost | Cost price (hidden by default) |
| Floor | Floor sell price (hidden by default) |
| Sell | Sell price per unit |
| Unit | Billing unit (recurring groups only): months / years / per unit / per site / per user |
| Term | Contract term in months (recurring groups only) |
| Disc% | Discount % applied to sell price |
| Net | Sell × (1 − disc%); edit to back-calculate the discount |
| Total | Net × qty × term (recurring) or Net × qty (one-time) |
| 🔒 | Price lock toggle |
| × | Delete row |

#### Price locking
Click the **padlock icon** on any row to lock its sell price:

- **Unlocked** (grey padlock) — row scales normally when the group or subgroup net is edited.
- **Locked** (amber padlock) — row's sell price is fixed. When you edit a group or subgroup net, locked rows stay exactly as-is. Only the unlocked rows are scaled proportionally to reach the target net.
- If all rows in a group are locked, editing the group net is a no-op.
- Useful for fixed-price components (e.g. hardware with a set cost) that should never be discounted when you adjust the overall deal value.

#### Net editing — how scaling works
When you type a new value in a **Group Net** or **Subgroup Net** field:

1. The locked rows' net contribution is calculated and held fixed.
2. The remaining target (= entered net − locked net) is distributed proportionally across unlocked rows — each unlocked row's sell price scales by the same ratio, preserving relative proportions.
3. If the group/subgroup is recurring, term months are factored in correctly.

**Group net** = direct rows net + sum of subgroup display-nets (subgroup qty applies to TOTAL only, not to the group net field).

**Subgroup net** = sum of its direct rows.

#### Column visibility
Click **Columns** in the toolbar to toggle Cost, Floor, Unit, Term, and other columns. Hidden columns take no space in the table.

#### Paste from Excel
1. Copy rows from Excel (columns: Description, ProductID, Quantity, Cost Price, Floor Price, Sell Price, Unit, Term).
2. Click **Paste Excel** in the toolbar.
3. Paste into the text area and click **Apply**.
4. Rows with no ProductID and no prices are interpreted as group/subgroup headers.

#### Export / Import
- **Export JSON** — full product catalogue export (all products, all configs).
- **Export Excel (all fields)** — spreadsheet with every product field.
- **Export Config Excel** — active product's configuration table only (for sharing with customers).
- **Import JSON** — re-import a previously exported JSON file; existing products with matching IDs are updated.

---

## 9. Deal Engine

Build quotes from the product catalogue.

### Line items
- Add products from the catalogue with a quantity and sell price.
- Each line item shows cost, sell, margin $, and margin % (colour-coded: green ≥ 20 %, amber 10–20 %, red < 10 % or floor violation).
- Freight config: ocean / air / mixed, with per-unit costs.

### Discount rules
- **Direct** — fixed % or $ off a specific line.
- **Volume (units)** — discount kicks in above a qty threshold.
- **Volume (value)** — discount kicks in above a $ value threshold.
- **Category** — discount applied to all items in a product category.
- **Conditional** — if product A is in the deal, discount product B.

### Scenarios
Clone the current deal as Scenario A / B / C and compare them side by side in the scenario comparison view.

### Summary panel
Shows: total cost, total sell, total margin, list value, perceived savings %, discount budget used / remaining. Highlights any floor price violations.

### Optimizer
Toggle the goal (Maximize Margin / Maximize Perceived Value), click **Optimize Deal**, and review recommendations with impact estimates. Apply individual recommendations or all at once.

---

## 10. Pricebook

Create customer-specific pricebooks.

- Pick products from the catalogue and set a unit price for each entry.
- Override the FX rate per entry or set a pricebook-level default FX rate.
- Toggle freight inclusion per line.
- Add special terms (free-text lines) per entry.
- Set **uplift** — CPI-linked or fixed % — applied annually or at renewal.
- Set validity window (valid from / valid to dates).
- Export to share with the customer.

---

## 11. Customer Configs

Record what a customer currently has installed or licensed.

- Add line items by linking to a product in the catalogue (or entering free text if no match exists).
- Track quantity and notes per line.
- Useful as a reference when building a renewal deal or upgrade quote.

---

## 12. Contract Manager

Track contracts across your accounts.

### Contract types
Master Agreement · SOW · Amendment · Renewal

### Fields
- Contract number, title, customer, type
- Start date / end date
- Contract value (USD)
- Billing model: subscription / one-time / mixed
- Payment terms: Net-30 / Net-60 / Net-90 / upfront / milestone / custom
- Special terms (free text)
- Parent contract (SOWs link back to their master agreement)

### Notifications
Add named notification dates (e.g. "Renewal Notice 90 days out") and mark them as notified when actioned.

### Attachments
Upload contract PDFs and supporting documents. Files are stored in Firebase Storage and linked to the contract record.
