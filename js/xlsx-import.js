import * as XLSX from "https://esm.sh/xlsx@0.18.5";
import { SERVICE_TYPES } from "./constants.js";

// Mirrors the layout of the "Production Summary" sheet used today:
// row1 = category headers (sparse, marks the start column of each category)
// row7 = per-piece rate for that column
// row8 = item name for that column
// row9+ = one row per bill: A Date, G Delivery Type, H Room/Bill No, then item qty columns
// Item columns run from the first category's start column up to (not including) "Total Pieces".
const ROW_CATEGORIES = 0;
const ROW_RATES = 6;
const ROW_HEADERS = 7;
const DATA_START = 8;
const COL_DATE = 0;
const COL_DELIVERY_TYPE = 6;
const COL_ROOM = 7;
const COL_PICKUP_FEE = 125; // "Express Pick up & Delivery Charge"
const ITEM_START = 8; // column I

function toDateStr(v) {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "string" && v) return v.slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

function matchServiceType(deliveryTypeText, serviceTypes) {
  const text = String(deliveryTypeText || "").trim().toLowerCase();
  return (
    serviceTypes.find((s) => s.name.toLowerCase() === text) ||
    serviceTypes.find((s) => text.includes(s.name.toLowerCase().split(" ")[0])) ||
    serviceTypes[0]
  );
}

export async function parseProductionSummary(file, customer) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { cellDates: true });
  const sheetName = wb.SheetNames.find((n) => n.toLowerCase().includes("production")) || wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });

  // Find category boundaries from row 1.
  const bounds = [];
  const catRow = rows[ROW_CATEGORIES] || [];
  catRow.forEach((v, c) => {
    if (v) bounds.push(c);
  });

  // Item columns run until the first computed/summary column (e.g. "Total Pieces",
  // "Standerd Bill Value", ...) - stop there rather than at a blank-column gap, since
  // those summary headers sit immediately adjacent to the last real item with no gap.
  const headerRow = rows[ROW_HEADERS] || [];
  const SUMMARY_MARKERS = ["total pieces", "standerd bill value", "standard bill value"];
  let lastItemCol = ITEM_START;
  for (let c = ITEM_START; c < headerRow.length; c++) {
    const h = String(headerRow[c] || "").trim().toLowerCase();
    if (!h) continue;
    if (SUMMARY_MARKERS.some((m) => h.startsWith(m))) break;
    lastItemCol = c;
  }

  const categoryAt = (col) => {
    let current = "";
    for (const b of bounds) {
      if (b <= col) current = catRow[b];
      else break;
    }
    return current;
  };

  const rateRow = rows[ROW_RATES] || [];
  const serviceTypes = customer?.serviceTypes || SERVICE_TYPES;
  const code = customer?.code || "BILL";

  const orders = [];
  const warnings = [];
  let seq = 0;

  for (let r = DATA_START; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;
    const deliveryType = row[COL_DELIVERY_TYPE];
    const room = row[COL_ROOM];
    if (!deliveryType && !room) continue; // blank/summary row

    const lines = [];
    for (let c = ITEM_START; c <= lastItemCol; c++) {
      const qty = Number(row[c]) || 0;
      if (qty <= 0) continue;
      const itemName = String(headerRow[c] || "").replace(/\d+$/, "");
      const rate = Number(rateRow[c]) || 0;
      if (!itemName) continue;
      lines.push({ category: categoryAt(c), item: itemName, rate, qty, lineTotal: rate * qty });
    }
    if (lines.length === 0) continue;

    const service = matchServiceType(deliveryType, serviceTypes);
    const totalPieces = lines.reduce((s, l) => s + l.qty, 0);
    const standardValue = lines.reduce((s, l) => s + l.lineTotal, 0);
    const surchargeValue = Math.round((standardValue * service.surchargePct) / 100);
    const pickupFee = Number(row[COL_PICKUP_FEE]) || 0;
    const orderDate = toDateStr(row[COL_DATE]);

    seq += 1;
    orders.push({
      customerId: customer.id,
      customerName: customer.name,
      docketNo: `${code}-${orderDate.replace(/-/g, "")}-${String(seq).padStart(4, "0")}`,
      orderDate,
      roomOrBillNo: String(room ?? "").trim() || "(unspecified)",
      serviceType: service,
      lines,
      totalPieces,
      standardValue,
      surchargeValue,
      pickupFee,
      totalBillValue: standardValue + surchargeValue + pickupFee,
    });
  }

  if (orders.length === 0) warnings.push("No valid bill rows found — check this is the Production Summary sheet.");
  return { orders, warnings, sheetName };
}
