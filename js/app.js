import { watchAuth, login, logout } from "./auth.js";
import { getCustomer, createOrder, makeDocketNo, subscribeOrders, updateOrderStatus } from "./db.js";
import { SERVICE_TYPES, statusLabel } from "./constants.js";

const CUSTOMER_ID = "sheraton";
let customer = null;
let ordersUnsub = null;

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
    await initCustomerAndUI();
  } else {
    viewApp.classList.add("hidden");
    viewLogin.classList.remove("hidden");
    if (ordersUnsub) { ordersUnsub(); ordersUnsub = null; }
  }
});

// ---------- Tabs ----------
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll("main > section").forEach((s) => s.classList.add("hidden"));
    document.getElementById(`tab-${btn.dataset.tab}`).classList.remove("hidden");
  });
});

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

  buildItemPicker(customer.catalog || SHERATON_CATALOG);
  wireSummaryRecalc();
  recalcSummary();

  if (ordersUnsub) ordersUnsub();
  ordersUnsub = subscribeOrders(CUSTOMER_ID, renderOrders);
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
  const room = document.getElementById("f-room").value.trim();
  const summary = recalcSummary();

  if (!room) { saveMsg.textContent = "Enter a room / bill number."; saveMsg.className = "err"; return; }
  if (summary.lines.length === 0) { saveMsg.textContent = "Tick at least one item."; saveMsg.className = "err"; return; }

  const btn = document.getElementById("btn-save-print");
  btn.disabled = true;
  saveMsg.textContent = "Saving…";
  saveMsg.className = "";

  try {
    const docketNo = makeDocketNo(customer.code || "SH");
    const order = {
      customerId: CUSTOMER_ID,
      customerName: customer.name,
      docketNo,
      orderDate: new Date().toISOString().slice(0, 10),
      roomOrBillNo: room,
      serviceType: summary.service,
      lines: summary.lines,
      totalPieces: summary.totalPieces,
      standardValue: summary.standardValue,
      surchargeValue: summary.surcharge,
      pickupFee: summary.pickup,
      totalBillValue: summary.total,
    };
    await createOrder(order);
    printDocket(order);
    saveMsg.textContent = `Saved — docket ${docketNo}`;
    saveMsg.className = "ok";
    resetForm();
  } catch (err) {
    saveMsg.textContent = "Could not save — check connection and try again.";
    saveMsg.className = "err";
  } finally {
    btn.disabled = false;
  }
});

function resetForm() {
  document.getElementById("f-room").value = "";
  document.getElementById("f-pickup").value = "";
  document.querySelectorAll(".item-qty").forEach((el) => {
    el.value = "";
    el.closest(".item-row").classList.remove("active");
  });
  recalcSummary();
}

// ---------- Print docket ----------
function printDocket(order) {
  document.getElementById("d-ref").innerHTML = `${order.docketNo}<br>${order.orderDate}`;
  document.getElementById("d-customer").innerHTML = `<b>${order.customerName}</b> · Room ${order.roomOrBillNo}`;
  document.getElementById("d-service").textContent = order.serviceType.name;

  const tbody = document.getElementById("d-lines");
  tbody.innerHTML = "";
  order.lines.forEach((l) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${l.item}</td><td style="text-align:right">${l.qty}</td><td style="text-align:right">${l.rate}</td><td style="text-align:right">${l.lineTotal}</td>`;
    tbody.appendChild(tr);
  });

  document.getElementById("d-total-label").textContent = `Total — ${order.totalPieces} pcs`;
  document.getElementById("d-total-value").textContent = `Rs ${order.totalBillValue}`;

  window.print();
}

// ---------- Orders tab ----------
function renderOrders(orders) {
  const tbody = document.getElementById("orders-tbody");
  const empty = document.getElementById("orders-empty");
  tbody.innerHTML = "";
  empty.classList.toggle("hidden", orders.length > 0);

  orders.forEach((o) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${o.docketNo || ""}</td>
      <td>${o.orderDate || ""}</td>
      <td>${o.roomOrBillNo || ""}</td>
      <td>${o.serviceType?.name || ""}</td>
      <td class="num">${o.totalPieces ?? ""}</td>
      <td class="num">${o.totalBillValue ?? ""}</td>
      <td><span class="chip ${o.status}">${statusLabel(o.status || "received")}</span></td>
      <td class="row-actions"></td>
    `;
    const actions = tr.querySelector(".row-actions");

    const reprintBtn = document.createElement("button");
    reprintBtn.textContent = "Print";
    reprintBtn.addEventListener("click", () => printDocket(o));
    actions.appendChild(reprintBtn);

    if (o.status === "received") {
      const b = document.createElement("button");
      b.textContent = "Mark packed";
      b.addEventListener("click", () => updateOrderStatus(o.id, "packed"));
      actions.appendChild(b);
    } else if (o.status === "packed") {
      const b = document.createElement("button");
      b.textContent = "Mark dispatched";
      b.addEventListener("click", () => updateOrderStatus(o.id, "dispatched"));
      actions.appendChild(b);
    }

    tbody.appendChild(tr);
  });
}
