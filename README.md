# NimWizard

A private sales productivity app built with React, TypeScript, Vite, Tailwind CSS, Zustand, and Firebase. All data is stored per-user in Firestore and synced in real time across devices.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + TypeScript + Vite |
| Styling | Tailwind CSS v4 |
| State | Zustand (with localStorage persistence) |
| Backend / Auth | Firebase (Firestore + Auth) |
| Deployment | Vercel (auto-deploy from `main`) |

---

## Modules

### Org Chart
Build and visualise organisational hierarchies. Drag contacts onto a canvas, draw solid reporting lines, dotted lines, and peer relationships. Save named charts and switch between them.

### Contacts
Manage a contact list with name, title, organisation, level, email, and phone. Contacts are shared across Org Chart and Meetings.

### Meetings
Record meeting notes and action items. Assign actions to attendees with priority and due date. Link actions to Tasks.

### Tasks
Kanban-style task board with buckets, sub-tasks, priorities, start/due dates, progress tracking, and Gantt-style predecessor relationships. Tasks can be linked to Timeline items.

### Timelines
Interactive Gantt-style timelines with swim lanes, milestones, freeze periods, and configurable timescales (days → years). Supports calendar and Australian financial year modes. Items can be linked to Tasks.

### Diagrams
Embed and edit draw.io diagrams stored in Firestore. Full draw.io editor opens inline.

### Products (Deal Engine — Products)
Product catalogue with pricing configurations:
- Products have one or more **configuration tables** (groups of line items)
- Each **group** is One-Time or Recurring, with a qty multiplier
- Groups contain direct **rows** and/or **subgroups**
- Rows have: product code, description, qty, cost, floor, sell price, discount %, net, total
- **Subgroup net** = sum of its rows; editing it proportionally scales all rows
- **Group net** = direct rows + subgroup display-nets; editing scales unlocked rows only
- **Price locking**: individual rows can be locked (padlock icon) — locked rows are excluded from group/subgroup net scaling; unlocked rows absorb the difference
- USD / AUD toggle with live FX rate; all prices convert in real time
- Clone, delete products from the left panel
- Export to JSON or Excel; import from JSON; paste rows directly from Excel

### Deal Engine — Deals
Build deals from products. Add line items, set quantities and sell prices, configure freight (ocean / air / mixed), apply discount rules, and compare scenarios side by side.

### Pricebook
Generate customer-specific pricebooks from the product catalogue. Set per-entry FX overrides, freight inclusion, special terms, and annual uplift (CPI or fixed %).

### Customer Configs
Record what products a customer currently has deployed. Reference products by ID or free text.

### Contract Manager
Track contracts (master agreements, SOWs, amendments, renewals) with start/end dates, billing model, payment terms, notifications, and file attachments.

---

## Development

```bash
npm install
npm run dev        # local dev server (http://localhost:5173)
npm run build      # production build
npm run preview    # preview production build locally
```

TypeScript strict check (runs on Vercel CI):
```bash
npx tsc -p tsconfig.app.json --noEmit
```

---

## Project Structure

```
src/
  components/         # Shared UI + feature-specific components
    products/         # ProductConfigEditor (the main pricing table)
    ui/               # CurrencyBar, Toast, etc.
    deals/            # Deal builder components
  engine/             # Pure TS pricing/freight/metrics/optimization logic
  hooks/              # useResizable, etc.
  lib/                # utils, exportUtils, firestore helpers
  pages/              # One file per route
  store/              # Zustand stores (useAppStore, useCurrency)
  types/              # index.ts — all shared TypeScript types
```

---

## Deployment

Push to `main` → Vercel auto-builds and deploys. Build command: `npm run build`. Output: `dist/`.
