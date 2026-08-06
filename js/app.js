import { watchAuth, login, logout } from "./auth.js";
import {
  getCustomer, createOrder, createOrders, getOrderByDocketNo, getOrderByUniqueCode, makeDocketNo,
  generateUniqueCode, generateUniqueCodes, fetchOrders, updateOrderStatus, savePacking,
  fetchPackedUnassignedOrders, createTransferNote, fetchTransferNotes, fetchOrdersByIds,
  fetchWorkflowStages, fetchStatusHistory, changeOrderStatus, logStatusHistory, searchOrders,
  fetchAllOrdersForDashboard,
} from "./db.js";
import { SERVICE_TYPES, statusLabel } from "./constants.js";
import { parseProductionSummary } from "./xlsx-import.js";
import { qrDataUrl } from "./qr.js";
import { printElement } from "./print.js";

const CUSTOMER_ID = "sheraton";
let customer = null;
let currentUserEmail = "";
let workflowStages = [];

// ---------- Auth ----------
const viewLogin = document.getElementById("view-login");
const viewApp = document.getElementById("view-app");
const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.textContent = "";
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  try {
    await login(email, password);
  } catch (err) {
    loginError.textContent = "Sign-in failed — check email and password.";
  }
});

document.getElementById("btn-logout").addEventListener("click", () => logout());

watchAuth(async (user) => {
  if (user) {
    viewLogin.classList.add("hidden");
    viewApp.classList.remove("hidden");
    document.getElementById("user-email").textContent = user.email;
    currentUserEmail = user.email;
    await initCustomerAndUI();
  } else {
    viewApp.classList.add("hidden");
    viewLogin.classList.remove("hidden");
  }
});

// ---------- Global search (also the "scan anywhere" QR lookup) ----------
const globalSearch = document.getElementById("global-search");
const searchResults = document.getElementById("search-results");
let searchDebounce = null;

globalSearch.addEventListener("input", () => {
  clearTimeout(searchDebounce);
  const q = globalSearch.value.trim();
  if (!q) { searchResults.classList.add("hidden"); return; }
  searchDebounce = setTimeout(() => runGlobalSearch(q), 250);
});

globalSearch.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  clearTimeout(searchDebounce);
  const q = globalSearch.value.trim();
  if (q) runGlobalSearch(q, true);
});

document.addEventListener("click", (e) => {
  if (!e.target.closest(".topbar-search")) searchResults.classList.add("hidden");
});

async function runGlobalSearch(q, openIfSingle) {
  try {
    const results = await searchOrders(CUSTOMER_ID, q);
    if (openIfSingle && results.length === 1) {
      openBillModal(results[0]);
      searchResults.classList.add("hidden");
      globalSearch.value = "";
      return;
    }
    renderSearchResults(results);
  } catch (err) {
    renderSearchResults([]);
  }
}

function renderSearchResults(results) {
  searchResults.innerHTML = "";
  if (results.length === 0) {
    searchResults.innerHTML = `<div class="sr-empty">No bills found.</div>`;
  } else {
    results.forEach((o) => {
      const item = document.createElement("div");
      item.className = "sr-item";
      item.innerHTML = `<b>${o.uniqueCode || o.docketNo}</b> — ${o.guestName || o.customerName || "—"} · Room ${o.roomNumber || o.roomOrBillNo} · <span class="chip ${o.status}">${statusLabel(o.status)}</span>`;
      item.addEventListener("click", () => {
        openBillModal(o);
        searchResults.classList.add("hidden");
        globalSearch.value = "";
      });
      searchResults.appendChild(item);
    });
  }
  searchResults.classList.remove("hidden");
}

// ---------- Tabs ----------
function activateTab(tabName) {
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
  document.querySelector(`.tab-btn[data-tab="${tabName}"]`).classList.add("active");
  document.querySelectorAll("main > section").forEach((s) => s.classList.add("hidden"));
  document.getElementById(`tab-${tabName}`).classList.remove("hidden");
  if (tabName === "dashboard") refreshDashboard();
  if (tabName === "orders") refreshOrders();
  if (tabName === "transactions") {
    const activeSub = document.querySelector('.subtab-btn[data-parent="transactions"].active')?.dataset.subtab;
    if (activeSub === "packing") document.getElementById("scan-input").focus();
    if (activeSub === "dispatch") refreshTransferTab();
  }
}

document.querySelectorAll(".tab-btn").forEach((btn) => {
  if (btn.id === "collection-tab-btn") return; // handled by the dropdown below
  btn.addEventListener("click", () => {
    closeCollectionMenu();
    activateTab(btn.dataset.tab);
  });
});

// ---------- Collection: dropdown to pick Upload / Enter bill ----------
const collectionBtn = document.getElementById("collection-tab-btn");
const collectionMenu = document.getElementById("collection-dropdown-menu");

function closeCollectionMenu() {
  collectionMenu.classList.add("hidden");
  collectionBtn.setAttribute("aria-expanded", "false");
}

collectionBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  const isOpen = !collectionMenu.classList.contains("hidden");
  if (isOpen) { closeCollectionMenu(); return; }
  collectionMenu.classList.remove("hidden");
  collectionBtn.setAttribute("aria-expanded", "true");
});

document.querySelectorAll(".tab-dropdown-item").forEach((item) => {
  item.addEventListener("click", () => {
    activateTab("entry");
    document.querySelectorAll(`#tab-entry > [id^="subtab-"]`).forEach((s) => s.classList.add("hidden"));
    document.getElementById(`subtab-${item.dataset.subtab}`).classList.remove("hidden");
    closeCollectionMenu();
  });
});

document.addEventListener("click", (e) => {
  if (!e.target.closest(".tab-dropdown")) closeCollectionMenu();
});

// ---------- Sub-tabs ----------
document.querySelectorAll(".subtab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const parent = btn.dataset.parent;
    document.querySelectorAll(`.subtab-btn[data-parent="${parent}"]`).forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll(`#tab-${parent} > [id^="subtab-"]`).forEach((s) => s.classList.add("hidden"));
    document.getElementById(`subtab-${btn.dataset.subtab}`).classList.remove("hidden");
    if (btn.dataset.subtab === "packing") document.getElementById("scan-input").focus();
    if (btn.dataset.subtab === "dispatch") refreshTransferTab();
  });
});

async function refreshOrders() {
  const orders = await fetchOrders(CUSTOMER_ID);
  renderOrders(orders);
}

document.getElementById("btn-refresh-orders").addEventListener("click", refreshOrders);

// ---------- Init customer + build item picker ----------
async function initCustomerAndUI() {
  customer = await getCustomer(CUSTOMER_ID);
  if (!customer || !customer.catalog?.length) {
    document.querySelector("main").innerHTML =
      '<div class="empty-state">Sheraton catalog isn\'t loaded yet. Run <code>seed.html</code> once from your own machine, then reload this page.</div>';
    return;
  }

  const serviceSelect = document.getElementById("f-service");
  serviceSelect.innerHTML = "";
  (customer.serviceTypes || SERVICE_TYPES).forEach((s) => {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = `${s.name} (+${s.surchargePct}%)`;
    serviceSelect.appendChild(opt);
  });

  buildItemPicker(customer.catalog);
  wireSummaryRecalc();
  recalcSummary();
  workflowStages = await fetchWorkflowStages();
  const statusSelect = document.getElementById("bm-status-select");
  statusSelect.innerHTML = "";
  workflowStages.forEach((s) => {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = s.name;
    statusSelect.appendChild(opt);
  });
  await refreshOrders();
  await refreshDashboard();
}

// ---------- Dashboard ----------
async function refreshDashboard() {
  const orders = await fetchAllOrdersForDashboard(CUSTOMER_ID);
  const today = new Date().toISOString().slice(0, 10);
  const isToday = (iso) => !!iso && iso.slice(0, 10) === today;
  const countBy = (pred) => orders.filter(pred).length;

  const cards = [
    { label: "Total bills", value: orders.length },
    { label: "Received", value: countBy((o) => o.status === "received") },
    { label: "Processing", value: countBy((o) => o.status === "processing") },
    { label: "Packed", value: countBy((o) => o.status === "packed") },
    { label: "Dispatched", value: countBy((o) => o.status === "dispatched") },
    { label: "Delivered", value: countBy((o) => o.status === "delivered") },
    { label: "Cancelled", value: countBy((o) => o.status === "cancelled") },
    { label: "Today's bills", value: countBy((o) => isToday(o.createdAt)) },
    { label: "Today's packed", value: countBy((o) => isToday(o.packedAt)) },
    { label: "Today's dispatch", value: countBy((o) => isToday(o.dispatchedAt)) },
  ];
  document.getElementById("dash-cards").innerHTML = cards.map((c) => `
    <div class="dash-card"><div class="dc-value">${c.value}</div><div class="dc-label">${c.label}</div></div>
  `).join("");

  renderBarChart("chart-status", workflowStages.map((s) => ({
    label: s.name, value: countBy((o) => o.status === s.id),
  })));

  const last7 = [...Array(7)].map((_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (6 - i));
    return d.toISOString().slice(0, 10);
  });
  const shortDate = (iso) => iso.slice(5).replace("-", "/");
  renderBarChart("chart-packing", last7.map((d) => ({
    label: shortDate(d), value: countBy((o) => o.packedAt && o.packedAt.slice(0, 10) === d),
  })));
  renderBarChart("chart-dispatch", last7.map((d) => ({
    label: shortDate(d), value: countBy((o) => o.dispatchedAt && o.dispatchedAt.slice(0, 10) === d),
  })));

  const byOperator = {};
  orders.forEach((o) => { if (o.packedBy) byOperator[o.packedBy] = (byOperator[o.packedBy] || 0) + 1; });
  renderBarChart("chart-operator", Object.entries(byOperator).map(([label, value]) => ({ label, value })));
}

function renderBarChart(containerId, rows) {
  const el = document.getElementById(containerId);
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.every((r) => r.value === 0)) {
    el.innerHTML = `<div class="empty-state">No data yet.</div>`;
    return;
  }
  el.innerHTML = rows.map((r) => `
    <div class="bar-row">
      <span class="br-label" title="${r.label}">${r.label}</span>
      <span class="br-track"><span class="br-fill" style="width:${(r.value / max) * 100}%"></span></span>
      <span class="br-value">${r.value}</span>
    </div>
  `).join("");
}

function buildItemPicker(catalog) {
  const container = document.getElementById("item-picker");
  container.innerHTML = "";
  const byCategory = {};
  catalog.forEach((it) => {
    (byCategory[it.category] ||= []).push(it);
  });
  Object.entries(byCategory).forEach(([category, items]) => {
    const block = document.createElement("div");
    block.className = "category-block";
    const h3 = document.createElement("h3");
    h3.textContent = category;
    block.appendChild(h3);
    const grid = document.createElement("div");
    grid.className = "item-grid";
    items.forEach((it) => {
      const row = document.createElement("div");
      row.className = "item-row";
      row.innerHTML = `
        <div>
          <div class="item-name">${it.item}</div>
          <div class="item-rate">Rs ${it.rate}</div>
        </div>
        <input type="number" class="item-qty" min="0" step="1" value="" data-category="${category}" data-item="${it.item}" data-rate="${it.rate}">
      `;
      grid.appendChild(row);
    });
    block.appendChild(grid);
    container.appendChild(block);
  });
}

function wireSummaryRecalc() {
  document.getElementById("item-picker").addEventListener("input", (e) => {
    if (e.target.classList.contains("item-qty")) {
      e.target.closest(".item-row").classList.toggle("active", Number(e.target.value) > 0);
      recalcSummary();
    }
  });
  document.getElementById("f-service").addEventListener("change", recalcSummary);
  document.getElementById("f-pickup").addEventListener("input", recalcSummary);
}

function currentLines() {
  return Array.from(document.querySelectorAll(".item-qty"))
    .map((el) => ({
      category: el.dataset.category,
      item: el.dataset.item,
      rate: Number(el.dataset.rate),
      qty: Number(el.value) || 0,
    }))
    .filter((l) => l.qty > 0)
    .map((l) => ({ ...l, lineTotal: l.rate * l.qty }));
}

function currentServiceType() {
  const id = document.getElementById("f-service").value;
  return (customer?.serviceTypes || SERVICE_TYPES).find((s) => s.id === id) || SERVICE_TYPES[0];
}

function recalcSummary() {
  const lines = currentLines();
  const totalPieces = lines.reduce((s, l) => s + l.qty, 0);
  const standardValue = lines.reduce((s, l) => s + l.lineTotal, 0);
  const service = currentServiceType();
  const surcharge = Math.round((standardValue * service.surchargePct) / 100);
  const pickup = Number(document.getElementById("f-pickup").value) || 0;
  const total = standardValue + surcharge + pickup;

  document.getElementById("s-pieces").textContent = totalPieces;
  document.getElementById("s-standard").textContent = `Rs ${standardValue}`;
  document.getElementById("s-surcharge").textContent = `Rs ${surcharge}`;
  document.getElementById("s-pickup").textContent = `Rs ${pickup}`;
  document.getElementById("s-total").textContent = `Rs ${total}`;

  return { lines, totalPieces, standardValue, surcharge, pickup, total, service };
}

// ---------- Save & print ----------
document.getElementById("btn-save-print").addEventListener("click", async () => {
  const saveMsg = document.getElementById("save-msg");
  const billNumber = document.getElementById("f-bill-number").value.trim();
  const roomNumber = document.getElementById("f-room").value.trim();
  const guestName = document.getElementById("f-guest-name").value.trim();
  const customerMobile = document.getElementById("f-mobile").value.trim();
  const packingMethod = document.getElementById("f-packing-method").value;
  const summary = recalcSummary();

  if (!billNumber) { saveMsg.textContent = "Enter a bill number."; saveMsg.className = "err"; return; }
  if (summary.lines.length === 0) { saveMsg.textContent = "Tick at least one item."; saveMsg.className = "err"; return; }

  const btn = document.getElementById("btn-save-print");
  btn.disabled = true;
  saveMsg.textContent = "Saving…";
  saveMsg.className = "";

  try {
    const docketNo = makeDocketNo(customer.code || "SH");
    const { uniqueCode, receiptNumber } = await generateUniqueCode(CUSTOMER_ID);
    const order = {
      customerId: CUSTOMER_ID,
      customerName: customer.name,
      docketNo,
      orderDate: new Date().toISOString().slice(0, 10),
      roomOrBillNo: roomNumber || billNumber,
      billNumber,
      roomNumber,
      guestName,
      customerMobile,
      packingMethod,
      uniqueCode,
      receiptNumber,
      serviceType: summary.service,
      lines: summary.lines,
      totalPieces: summary.totalPieces,
      standardValue: summary.standardValue,
      surchargeValue: summary.surcharge,
      pickupFee: summary.pickup,
      totalBillValue: summary.total,
      createdBy: currentUserEmail,
    };
    order.id = await createOrder(order);
    printReceipt(order);
    saveMsg.textContent = `Saved — ${uniqueCode}`;
    saveMsg.className = "ok";
    resetForm();
    refreshOrders();
  } catch (err) {
    saveMsg.textContent = "Could not save — check connection and try again.";
    saveMsg.className = "err";
  } finally {
    btn.disabled = false;
  }
});

function resetForm() {
  document.getElementById("f-bill-number").value = "";
  document.getElementById("f-room").value = "";
  document.getElementById("f-guest-name").value = "";
  document.getElementById("f-mobile").value = "";
  document.getElementById("f-pickup").value = "";
  document.querySelectorAll(".item-qty").forEach((el) => {
    el.value = "";
    el.closest(".item-row").classList.remove("active");
  });
  recalcSummary();
}

// ---------- Print receipt (~4x6in) ----------
async function printReceipt(order) {
  document.getElementById("r-bill-number").textContent = order.billNumber || order.roomOrBillNo || "—";
  document.getElementById("r-receipt-number").textContent = order.receiptNumber || "—";
  document.getElementById("r-unique-code").textContent = order.uniqueCode || "—";
  document.getElementById("r-customer-name").textContent = order.guestName || "—";
  document.getElementById("r-room-number").textContent = order.roomNumber || order.roomOrBillNo || "—";
  document.getElementById("r-packing-method").textContent = order.packingMethod || "Folded";

  const tbody = document.getElementById("r-items");
  tbody.innerHTML = "";
  order.lines.forEach((l) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${l.item}</td><td style="text-align:right">${l.qty}</td>`;
    tbody.appendChild(tr);
  });
  document.getElementById("r-total-qty").textContent = order.totalPieces;
  document.getElementById("r-qr-img").src = await qrDataUrl(order.uniqueCode || order.docketNo);

  printElement("print-receipt", "size:101.6mm 152.4mm; margin:0;");
  if (order.id) logStatusHistory(order.id, "receipt printed", currentUserEmail).catch(() => {});
}

// ---------- Import from Excel ----------
let pendingImport = [];
let visibleImport = [];
let importSortDir = "asc";

document.getElementById("import-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  const status = document.getElementById("import-status");
  const preview = document.getElementById("import-preview");
  preview.classList.add("hidden");
  if (!file) return;

  status.textContent = "Reading file…";
  try {
    const { orders, warnings, sheetName } = await parseProductionSummary(file, customer);
    pendingImport = orders;
    if (warnings.length) {
      status.textContent = warnings.join(" ");
      return;
    }
    status.textContent = `Read "${sheetName}" — found ${orders.length} bill${orders.length === 1 ? "" : "s"}. Review below, then import.`;

    const dates = orders.map((o) => o.orderDate).sort();
    document.getElementById("import-from").value = "";
    document.getElementById("import-to").value = "";
    document.getElementById("import-from").min = dates[0] || "";
    document.getElementById("import-from").max = dates[dates.length - 1] || "";
    document.getElementById("import-to").min = dates[0] || "";
    document.getElementById("import-to").max = dates[dates.length - 1] || "";
    importSortDir = "asc";

    renderImportPreview();
    preview.classList.remove("hidden");
  } catch (err) {
    status.textContent = "Could not read that file — check it's the Production Summary workbook.";
  }
});

function renderImportPreview() {
  const from = document.getElementById("import-from").value;
  const to = document.getElementById("import-to").value;

  visibleImport = pendingImport
    .filter((o) => (!from || o.orderDate >= from) && (!to || o.orderDate <= to))
    .sort((a, b) => (a.orderDate < b.orderDate ? -1 : a.orderDate > b.orderDate ? 1 : 0) * (importSortDir === "asc" ? 1 : -1));

  document.getElementById("import-sort-icon").textContent = importSortDir === "asc" ? "↓" : "↑";
  document.getElementById("import-filter-count").textContent =
    from || to ? `Showing ${visibleImport.length} of ${pendingImport.length} bills` : `${pendingImport.length} bills`;

  const tbody = document.getElementById("import-preview-body");
  tbody.innerHTML = "";
  visibleImport.forEach((o) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${o.docketNo}</td><td>${o.orderDate}</td><td>${o.roomOrBillNo}</td><td>${o.serviceType.name}</td><td class="num">${o.totalPieces}</td><td class="num">${o.totalBillValue}</td>`;
    tbody.appendChild(tr);
  });
}

document.getElementById("import-from").addEventListener("change", renderImportPreview);
document.getElementById("import-to").addEventListener("change", renderImportPreview);
document.getElementById("btn-import-clear-filter").addEventListener("click", () => {
  document.getElementById("import-from").value = "";
  document.getElementById("import-to").value = "";
  renderImportPreview();
});
document.getElementById("import-sort-date").addEventListener("click", () => {
  importSortDir = importSortDir === "asc" ? "desc" : "asc";
  renderImportPreview();
});

document.getElementById("btn-confirm-import").addEventListener("click", async () => {
  const status = document.getElementById("import-status");
  const btn = document.getElementById("btn-confirm-import");
  if (visibleImport.length === 0) { status.textContent = "No bills in the current filter to import."; return; }
  btn.disabled = true;
  status.textContent = `Assigning ${visibleImport.length} unique codes…`;
  try {
    const codes = await generateUniqueCodes(CUSTOMER_ID, visibleImport.length);
    const toImport = visibleImport.map((o, i) => ({ ...o, uniqueCode: codes[i].uniqueCode, receiptNumber: codes[i].receiptNumber }));
    status.textContent = "Importing…";
    const created = await createOrders(toImport, currentUserEmail);
    status.textContent = `Imported ${created.length} bills. Preparing QR tags to print…`;
    await printTagSheet(created);
    status.textContent = `Imported and tagged ${created.length} bills. Attach a tag to each bag before wash.`;
    document.getElementById("import-preview").classList.add("hidden");
    document.getElementById("import-file").value = "";
    pendingImport = [];
    visibleImport = [];
  } catch (err) {
    status.textContent = "Import failed — check connection and try again.";
  } finally {
    btn.disabled = false;
  }
});

async function printTagSheet(orders) {
  const grid = document.getElementById("tag-grid");
  grid.innerHTML = "";
  for (const o of orders) {
    const qr = await qrDataUrl(o.uniqueCode || o.docketNo);
    const tag = document.createElement("div");
    tag.className = "tag";
    tag.innerHTML = `
      <img src="${qr}" alt="QR">
      <div class="t-info">
        <div class="t-room">${o.roomOrBillNo}</div>
        <div>${o.orderDate} · ${o.serviceType.name}</div>
        <div class="t-docket">${o.uniqueCode || o.docketNo}</div>
      </div>
    `;
    grid.appendChild(tag);
  }
  printElement("print-tags", "size:A4; margin:12mm;");
}

// ---------- Pack / Scan ----------
const scanInput = document.getElementById("scan-input");
let scannedOrder = null;

scanInput.addEventListener("keydown", async (e) => {
  if (e.key !== "Enter") return;
  const code = scanInput.value.trim();
  scanInput.value = "";
  if (!code) return;
  await handleScan(code);
});

async function handleScan(code) {
  const status = document.getElementById("scan-status");
  const detail = document.getElementById("pack-bill-detail");
  status.textContent = "Looking up…";
  status.className = "";
  detail.classList.add("hidden");
  scannedOrder = null;
  try {
    // Older-style codes (from before the unique-code system) are still matched by docket number.
    const order = (await getOrderByUniqueCode(code)) || (await getOrderByDocketNo(CUSTOMER_ID, code));
    if (!order) {
      status.textContent = `No bill found for "${code}".`;
      status.className = "err";
      return;
    }
    scannedOrder = order;
    status.textContent = order.status === "packed"
      ? `Already packed (${order.packetCount ?? "?"} packets) — re-saving will reprint stickers.`
      : `Loaded Room ${order.roomOrBillNo}.`;
    status.className = order.status === "packed" ? "" : "ok";

    document.getElementById("pk-customer").textContent = order.guestName || order.customerName || "—";
    document.getElementById("pk-room").textContent = order.roomNumber || order.roomOrBillNo || "—";
    document.getElementById("pk-bill-number").textContent = order.billNumber || order.roomOrBillNo || "—";
    document.getElementById("pk-receipt-code").textContent = order.uniqueCode || order.docketNo || "—";
    document.getElementById("pk-packing-method").textContent = order.packingMethod || "Folded";
    document.getElementById("pk-total-qty").textContent = order.totalPieces;
    const itemsBody = document.getElementById("pk-items");
    itemsBody.innerHTML = "";
    order.lines.forEach((l) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${l.item}</td><td style="text-align:right">${l.qty}</td>`;
      itemsBody.appendChild(tr);
    });
    document.getElementById("pk-packet-count").value = order.packetCount || 1;
    document.getElementById("pack-save-msg").textContent = "";
    detail.classList.remove("hidden");
    document.getElementById("pk-packet-count").focus();
  } catch (err) {
    status.textContent = "Scan failed — check connection and try again.";
    status.className = "err";
  }
}

document.getElementById("btn-save-packing").addEventListener("click", async () => {
  const msg = document.getElementById("pack-save-msg");
  const btn = document.getElementById("btn-save-packing");
  const packetCount = Number(document.getElementById("pk-packet-count").value);
  if (!scannedOrder) return;
  if (!packetCount || packetCount < 1) { msg.textContent = "Enter a packet count of at least 1."; msg.className = "err"; return; }

  btn.disabled = true;
  msg.textContent = "Saving…";
  msg.className = "";
  try {
    await savePacking(scannedOrder.id, packetCount, currentUserEmail);
    await printStickers(scannedOrder, packetCount);
    msg.textContent = `Saved — ${packetCount} sticker${packetCount === 1 ? "" : "s"} printed. Marked packed.`;
    msg.className = "ok";
    document.getElementById("pack-bill-detail").classList.add("hidden");
    document.getElementById("scan-status").textContent = "";
    scannedOrder = null;
    scanInput.value = "";
    scanInput.focus();
  } catch (err) {
    msg.textContent = "Could not save packing — check connection and try again.";
    msg.className = "err";
  } finally {
    btn.disabled = false;
  }
});

async function printStickers(order, packetCount) {
  const list = document.getElementById("sticker-list");
  list.innerHTML = "";
  const code = order.uniqueCode || order.docketNo;
  const qr = await qrDataUrl(code);
  for (let i = 1; i <= packetCount; i++) {
    const sticker = document.createElement("div");
    sticker.className = "sticker";
    sticker.innerHTML = `
      <div class="sk-top">
        <div class="sk-customer">${order.guestName || order.customerName || "—"}</div>
        <div class="sk-packet">Packet ${i} of ${packetCount}</div>
      </div>
      <div class="sk-body">
        <img src="${qr}" alt="QR">
        <div class="sk-info">
          <div><span>Room</span> <b>${order.roomNumber || order.roomOrBillNo || "—"}</b></div>
          <div><span>Bill No</span> <b>${order.billNumber || order.roomOrBillNo || "—"}</b></div>
          <div><span>Receipt</span> <b>${code}</b></div>
        </div>
      </div>
    `;
    list.appendChild(sticker);
  }
  printElement("print-stickers", "size:101.6mm 50.8mm; margin:0;");
  if (order.id) logStatusHistory(order.id, "stickers printed", currentUserEmail, `${packetCount} packet(s)`).catch(() => {});
}

async function printLabel(order) {
  document.getElementById("lb-hotel").textContent = order.customerName;
  document.getElementById("lb-room").textContent = order.roomOrBillNo;
  document.getElementById("lb-meta").textContent = `${order.orderDate} · ${order.serviceType.name} · ${order.docketNo}`;
  const items = document.getElementById("lb-items");
  items.innerHTML = "";
  order.lines.forEach((l) => {
    const li = document.createElement("li");
    li.textContent = `${l.item} × ${l.qty}`;
    items.appendChild(li);
  });
  document.getElementById("lb-total-label").textContent = `${order.totalPieces} pcs`;
  document.getElementById("lb-total-value").textContent = `Rs ${order.totalBillValue}`;
  document.getElementById("lb-qr").src = await qrDataUrl(order.uniqueCode || order.docketNo);

  printElement("print-label", "size:100mm 130mm; margin:4mm;");
}

// ---------- Orders tab: grouped by hotel, then date, expandable ----------
let ordersCache = [];

function renderOrders(orders) {
  ordersCache = orders;
  const container = document.getElementById("orders-groups");
  const empty = document.getElementById("orders-empty");
  container.innerHTML = "";
  empty.classList.toggle("hidden", orders.length > 0);

  const byHotel = {};
  orders.forEach((o) => (byHotel[o.customerName || "—"] ||= []).push(o));

  Object.entries(byHotel).forEach(([hotelName, hotelOrders]) => {
    const totalPieces = hotelOrders.reduce((s, o) => s + (o.totalPieces || 0), 0);
    const group = document.createElement("div");
    group.className = "hotel-group";
    group.innerHTML = `
      <div class="hotel-group-head">
        <h3>${hotelName}</h3>
        <span class="hg-meta">${hotelOrders.length} bill${hotelOrders.length === 1 ? "" : "s"} · ${totalPieces} pcs</span>
      </div>
    `;

    const byDate = {};
    hotelOrders.forEach((o) => (byDate[o.orderDate || "—"] ||= []).push(o));
    const dates = Object.keys(byDate).sort((a, b) => (a < b ? 1 : -1));

    dates.forEach((date) => {
      const dayOrders = byDate[date];
      const dayPieces = dayOrders.reduce((s, o) => s + (o.totalPieces || 0), 0);
      const statusCounts = {};
      dayOrders.forEach((o) => (statusCounts[o.status || "received"] = (statusCounts[o.status || "received"] || 0) + 1));

      const dateGroup = document.createElement("div");
      dateGroup.className = "date-group";
      const chips = Object.entries(statusCounts)
        .map(([st, n]) => `<span class="chip ${st}">${n} ${statusLabel(st)}</span>`)
        .join("");
      dateGroup.innerHTML = `
        <div class="date-group-row">
          <span class="dg-date">${date}</span>
          <span class="dg-stats"><span>${dayOrders.length} bills</span><span>${dayPieces} pcs</span><span class="dg-chips">${chips}</span></span>
          <span class="dg-toggle">Expand ▾</span>
        </div>
        <div class="date-group-body hidden">
          <table>
            <thead><tr><th>Docket</th><th>Room / bill no.</th><th>Service</th><th>Pieces</th><th>Total (Rs)</th><th>Status</th></tr></thead>
            <tbody></tbody>
          </table>
        </div>
      `;

      const row = dateGroup.querySelector(".date-group-row");
      const body = dateGroup.querySelector(".date-group-body");
      const toggle = dateGroup.querySelector(".dg-toggle");
      row.addEventListener("click", () => {
        const isHidden = body.classList.toggle("hidden");
        toggle.textContent = isHidden ? "Expand ▾" : "Collapse ▴";
      });

      const tbody = dateGroup.querySelector("tbody");
      dayOrders.forEach((o) => {
        const tr = document.createElement("tr");
        tr.className = "bill-row";
        tr.innerHTML = `
          <td>${o.docketNo || ""}</td>
          <td>${o.roomOrBillNo || ""}</td>
          <td>${o.serviceType?.name || ""}</td>
          <td class="num">${o.totalPieces ?? ""}</td>
          <td class="num">${o.totalBillValue ?? ""}</td>
          <td><span class="chip ${o.status}">${statusLabel(o.status || "received")}</span></td>
        `;
        tr.addEventListener("click", () => openBillModal(o));
        tbody.appendChild(tr);
      });

      group.appendChild(dateGroup);
    });

    container.appendChild(group);
  });
}

// ---------- Bill detail modal ----------
const billModal = document.getElementById("bill-modal");
let modalOrder = null;

function openBillModal(order) {
  modalOrder = order;
  document.getElementById("bm-title").textContent = `Room / bill ${order.roomOrBillNo}`;
  const guestBits = [order.guestName, order.customerMobile].filter(Boolean).join(" · ");
  document.getElementById("bm-meta").innerHTML = `
    ${order.customerName} · ${order.orderDate} · ${order.serviceType?.name} ·
    <span class="chip ${order.status}">${statusLabel(order.status || "received")}</span><br>
    Bill No ${order.billNumber || order.roomOrBillNo} · Unique code ${order.uniqueCode || "—"} · Packing ${order.packingMethod || "—"}
    ${guestBits ? `<br>${guestBits}` : ""}
  `;

  const tbody = document.getElementById("bm-lines");
  tbody.innerHTML = "";
  order.lines.forEach((l) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${l.item}</td><td>${l.category}</td><td style="text-align:right">${l.qty}</td><td style="text-align:right">${l.rate}</td><td style="text-align:right">${l.lineTotal}</td>`;
    tbody.appendChild(tr);
  });

  document.getElementById("bm-totals").innerHTML = `
    <span>${order.totalPieces} pcs</span>
    <span>Surcharge Rs ${order.surchargeValue}</span>
    <span>Pickup Rs ${order.pickupFee}</span>
    <b>Total Rs ${order.totalBillValue}</b>
  `;

  document.getElementById("bm-status-select").value = order.status;
  document.getElementById("bm-status-remarks").value = "";
  document.getElementById("bm-status-msg").textContent = "";
  loadBillHistory(order.id);

  billModal.classList.remove("hidden");
}

async function loadBillHistory(orderId) {
  const box = document.getElementById("bm-history");
  box.innerHTML = "Loading history…";
  try {
    const history = await fetchStatusHistory(orderId);
    if (history.length === 0) { box.innerHTML = ""; return; }
    box.innerHTML = `<div style="font-weight:600; color:var(--ink); margin-bottom:4px;">History</div>` + history.map((h) => `
      <div class="h-row">
        <span>${new Date(h.createdAt).toLocaleString()}</span>
        <b>${statusLabel(h.stage)}</b>
        <span>${h.changedBy || "—"}</span>
        ${h.remarks ? `<span>· ${h.remarks}</span>` : ""}
      </div>
    `).join("");
  } catch (err) {
    box.innerHTML = "";
  }
}

document.getElementById("bm-close").addEventListener("click", () => billModal.classList.add("hidden"));
billModal.addEventListener("click", (e) => { if (e.target === billModal) billModal.classList.add("hidden"); });
document.getElementById("bm-print-receipt").addEventListener("click", () => modalOrder && printReceipt(modalOrder));
document.getElementById("bm-print-label").addEventListener("click", () => modalOrder && printLabel(modalOrder));

document.getElementById("bm-status-save").addEventListener("click", async () => {
  const msg = document.getElementById("bm-status-msg");
  if (!modalOrder) return;
  const stage = document.getElementById("bm-status-select").value;
  const remarks = document.getElementById("bm-status-remarks").value.trim();
  msg.textContent = "Saving…";
  msg.className = "";
  try {
    await changeOrderStatus(modalOrder.id, stage, currentUserEmail, remarks);
    modalOrder.status = stage;
    msg.textContent = `Status updated to ${statusLabel(stage)}.`;
    msg.className = "ok";
    loadBillHistory(modalOrder.id);
    refreshOrders();
  } catch (err) {
    msg.textContent = "Could not update status — check connection and try again.";
    msg.className = "err";
  }
});

// ---------- Transactions: Dispatch ----------
let transferCandidates = [];
const selectedForTransfer = new Set();

async function refreshTransferTab() {
  transferCandidates = await fetchPackedUnassignedOrders(CUSTOMER_ID);
  selectedForTransfer.clear();
  document.getElementById("tn-select-all").checked = false;
  renderTransferCandidates();
  await renderTransferHistory();
}

function visibleTransferCandidates() {
  const q = document.getElementById("tn-search").value.trim().toLowerCase();
  if (!q) return transferCandidates;
  return transferCandidates.filter((o) =>
    [o.uniqueCode, o.docketNo, o.billNumber, o.roomOrBillNo, o.roomNumber, o.guestName, o.customerName]
      .filter(Boolean).some((v) => String(v).toLowerCase().includes(q))
  );
}

function renderTransferCandidates() {
  const rows = visibleTransferCandidates();
  const tbody = document.getElementById("tn-candidates-body");
  const empty = document.getElementById("tn-candidates-empty");
  tbody.innerHTML = "";
  empty.classList.toggle("hidden", rows.length > 0);
  document.getElementById("tn-filter-count").textContent =
    `${rows.length} of ${transferCandidates.length} bills · ${selectedForTransfer.size} selected`;

  rows.forEach((o) => {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = selectedForTransfer.has(o.id);
    cb.addEventListener("change", () => {
      if (cb.checked) selectedForTransfer.add(o.id);
      else selectedForTransfer.delete(o.id);
      document.getElementById("tn-filter-count").textContent =
        `${rows.length} of ${transferCandidates.length} bills · ${selectedForTransfer.size} selected`;
    });
    td.appendChild(cb);
    tr.appendChild(td);
    const packedTime = o.packedAt ? new Date(o.packedAt).toLocaleString() : "—";
    tr.insertAdjacentHTML("beforeend", `
      <td>${o.uniqueCode || o.docketNo}</td>
      <td>${o.billNumber || o.roomOrBillNo}</td>
      <td>${o.guestName || o.customerName || "—"}</td>
      <td>${o.roomNumber || o.roomOrBillNo}</td>
      <td class="num">${o.packetCount ?? "—"}</td>
      <td>${packedTime}</td>
      <td>${o.packedBy || "—"}</td>
      <td><span class="chip ${o.status}">${statusLabel(o.status)}</span></td>
    `);
    tbody.appendChild(tr);
  });
}

document.getElementById("tn-search").addEventListener("input", renderTransferCandidates);

document.getElementById("tn-select-all").addEventListener("change", (e) => {
  const rows = visibleTransferCandidates();
  rows.forEach((o) => { if (e.target.checked) selectedForTransfer.add(o.id); else selectedForTransfer.delete(o.id); });
  renderTransferCandidates();
});

document.getElementById("btn-create-transfer").addEventListener("click", async () => {
  const msg = document.getElementById("transfer-msg");
  const btn = document.getElementById("btn-create-transfer");
  const chosen = transferCandidates.filter((o) => selectedForTransfer.has(o.id));
  const driverName = document.getElementById("tn-driver").value.trim();
  const vehicleNumber = document.getElementById("tn-vehicle").value.trim();
  const destinationOutlet = document.getElementById("tn-destination").value.trim();

  if (chosen.length === 0) { msg.textContent = "Tick at least one bill."; msg.className = "err"; return; }
  if (!driverName) { msg.textContent = "Enter a driver name."; msg.className = "err"; return; }

  btn.disabled = true;
  msg.textContent = "Creating dispatch…";
  msg.className = "";
  try {
    const transferNo = `TN-${customer.code}-${makeDocketNo("").replace(/^-/, "")}`;
    const note = await createTransferNote({
      customerId: CUSTOMER_ID, transferNo, driverName, vehicleNumber, destinationOutlet,
      orders: chosen, dispatchedBy: currentUserEmail,
    });
    await printTransferNote(note, chosen);
    msg.textContent = `Transfer note ${note.transferNo} created — ${chosen.length} bills dispatched.`;
    msg.className = "ok";
    document.getElementById("tn-driver").value = "";
    document.getElementById("tn-vehicle").value = "";
    document.getElementById("tn-destination").value = "";
    await refreshTransferTab();
  } catch (err) {
    msg.textContent = "Could not create dispatch — check connection and try again.";
    msg.className = "err";
  } finally {
    btn.disabled = false;
  }
});

async function renderTransferHistory() {
  const notes = await fetchTransferNotes(CUSTOMER_ID);
  const tbody = document.getElementById("tn-history-body");
  const empty = document.getElementById("tn-history-empty");
  tbody.innerHTML = "";
  empty.classList.toggle("hidden", notes.length > 0);

  notes.forEach((n) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${n.transferNo}</td><td>${n.transferDate}</td><td>${n.driverName || "—"}</td>
      <td>${n.destinationOutlet || "—"}</td><td class="num">${n.orderIds.length}</td>
      <td class="num">${n.totalPackets ?? "—"}</td><td class="row-actions"></td>
    `;
    const btn = document.createElement("button");
    btn.textContent = "Reprint";
    btn.addEventListener("click", async () => {
      const orders = await fetchOrdersByIds(n.orderIds);
      printTransferNote(n, orders);
    });
    tr.querySelector(".row-actions").appendChild(btn);
    tbody.appendChild(tr);
  });
}

async function printTransferNote(note, orders) {
  document.getElementById("tn-ref").innerHTML = `${note.transferNo}<br>${note.transferDate}`;
  document.getElementById("tn-print-customer").innerHTML = `<b>${customer.name}</b>`;
  document.getElementById("tn-print-date").textContent = note.vehicleNumber ? `Vehicle: ${note.vehicleNumber}` : "";
  document.getElementById("tn-print-driver").innerHTML = `Driver: <b>${note.driverName || "—"}</b>`;
  document.getElementById("tn-print-destination").innerHTML = `Destination: <b>${note.destinationOutlet || "—"}</b>`;
  const tbody = document.getElementById("tn-print-lines");
  tbody.innerHTML = "";
  orders.forEach((o) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${o.uniqueCode || o.docketNo}</td><td>${o.billNumber || o.roomOrBillNo}</td><td>${o.roomNumber || o.roomOrBillNo}</td><td style="text-align:right">${o.packetCount ?? "—"}</td>`;
    tbody.appendChild(tr);
  });
  document.getElementById("tn-print-total-label").textContent = `Total — ${orders.length} bills, ${note.totalPackets ?? orders.reduce((s,o)=>s+(o.packetCount||0),0)} packets`;
  printElement("print-transfer", "size:A4; margin:16mm;");
  orders.forEach((o) => logStatusHistory(o.id, "transfer note printed", currentUserEmail, note.transferNo).catch(() => {}));
}
