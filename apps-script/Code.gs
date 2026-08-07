/**
 * LaundroPlus Bill & Pack - Google Sheets backend.
 *
 * Setup: paste this whole file into a bound Apps Script project on your
 * Google Sheet (Extensions -> Apps Script), then Deploy -> New deployment
 * -> Web app -> Execute as: Me -> Who has access: Anyone -> Deploy.
 * Copy the resulting /exec URL into js/backend-config.js on the app side.
 *
 * Every sheet tab is created automatically on first use - you do not need
 * to create any tabs by hand.
 */

const CUSTOMER_HEADERS = ["id", "name", "code", "billing_address", "vat_reg_no", "catalog_json", "service_types_json", "invoice_cycle"];
const ORDER_HEADERS = [
  "id", "customer_id", "customer_name", "docket_no", "order_date", "room_or_bill_no",
  "service_type_json", "lines_json", "total_pieces", "standard_value", "surcharge_value",
  "pickup_fee", "total_bill_value", "status", "bill_number", "guest_name", "customer_mobile",
  "room_number", "packing_method", "unique_code", "receipt_number", "packet_count",
  "packed_by", "packed_at", "dispatched_by", "dispatched_at", "transfer_note_id", "created_at",
];
const TRANSFER_HEADERS = ["id", "customer_id", "transfer_no", "transfer_date", "driver_name", "vehicle_number", "destination_outlet", "order_ids_json", "total_pieces", "total_packets", "created_at"];
const WORKFLOW_HEADERS = ["id", "name", "sort_order", "is_active", "color"];
const STATUS_HISTORY_HEADERS = ["id", "order_id", "stage", "changed_by", "remarks", "created_at"];
const USERS_HEADERS = ["email", "password_hash", "role"];
const SESSION_HEADERS = ["token", "email", "created_at"];
const CODE_COUNTER_HEADERS = ["customer_id", "next_seq"];
const DEFAULT_SERVICE_TYPES = [
  { id: "same-day", name: "Same Day Service", surchargePct: 0 },
  { id: "express", name: "Express Service", surchargePct: 50 },
  { id: "special", name: "Special Service", surchargePct: 100 },
];

// ---------- HTTP entry points ----------

function doGet(e) {
  return respond_({ ok: true, message: "LaundroPlus API is running. Use POST." });
}

function doPost(e) {
  ensureSheets_();
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return respond_({ error: "Bad request body" });
  }
  const action = body.action;
  const params = body.params || {};

  try {
    if (action === "login") return respond_(login_(params));
    if (action === "createUser") return respond_(createUser_(Object.assign({}, params, { token: body.token })));

    const ctx = requireSession_(body.token);

    const handlers = {
      ensureCustomerSeeded: () => ensureCustomerSeeded_(params),
      getCustomer: () => getCustomer_(params.customerId),
      fetchCustomers: () => fetchCustomers_(),
      generateUniqueCode: () => generateUniqueCode_(params.customerId),
      generateUniqueCodes: () => generateUniqueCodes_(params.customerId, params.count),
      createOrder: () => createOrder_(params.order, ctx),
      createOrders: () => createOrders_(params.orders, params.createdBy),
      getOrderByDocketNo: () => getOrderByDocketNo_(params.customerId, params.docketNo),
      getOrderByUniqueCode: () => getOrderByUniqueCode_(params.uniqueCode),
      fetchOrders: () => fetchOrders_(params.customerId),
      updateOrderStatus: () => updateOrderStatus_(params.orderId, params.status),
      savePacking: () => savePacking_(params.orderId, params.packetCount, params.packedBy),
      fetchWorkflowStages: () => fetchWorkflowStages_(),
      logStatusHistory: () => { logStatusHistory_(params.orderId, params.stage, params.changedBy, params.remarks); return { ok: true }; },
      fetchStatusHistory: () => fetchStatusHistory_(params.orderId),
      changeOrderStatus: () => changeOrderStatus_(params.orderId, params.stage, params.changedBy, params.remarks),
      fetchOrCreateUserRole: () => getUserRole_(params.email),
      fetchPackedUnassignedOrders: () => fetchPackedUnassignedOrders_(params.customerId),
      createTransferNote: () => createTransferNote_(params),
      fetchTransferNotes: () => fetchTransferNotes_(params.customerId),
      searchOrders: () => searchOrders_(params.customerId, params.query),
      fetchAllOrdersForDashboard: () => fetchAllOrdersForDashboard_(params.customerId),
      fetchOrdersByIds: () => fetchOrdersByIds_(params.orderIds),
      logout: () => logout_(body.token),
    };
    if (!handlers[action]) throw new Error("Unknown action: " + action);
    return respond_(handlers[action]());
  } catch (err) {
    return respond_({ error: String((err && err.message) || err) });
  }
}

function respond_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---------- Sheet bootstrap ----------

function ensureSheets_() {
  getSheet_("Customers", CUSTOMER_HEADERS);
  getSheet_("Orders", ORDER_HEADERS);
  getSheet_("TransferNotes", TRANSFER_HEADERS);
  const wf = getSheet_("WorkflowStages", WORKFLOW_HEADERS);
  if (wf.getLastRow() < 2) {
    wf.getRange(2, 1, 7, 5).setValues([
      ["received", "Received", 1, true, "amber"],
      ["processing", "Processing", 2, true, "accent"],
      ["packed", "Packed", 3, true, "accent"],
      ["dispatched", "Dispatched", 4, true, "green"],
      ["delivered", "Delivered", 5, true, "green"],
      ["returned", "Returned", 6, true, "red"],
      ["cancelled", "Cancelled", 7, true, "red"],
    ]);
  }
  getSheet_("StatusHistory", STATUS_HISTORY_HEADERS);
  getSheet_("Users", USERS_HEADERS);
  getSheet_("Sessions", SESSION_HEADERS);
  getSheet_("CodeCounters", CODE_COUNTER_HEADERS);
}

// ---------- Generic sheet helpers ----------

function getSheet_(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
  }
  return sheet;
}

function readAll_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0];
  return values.slice(1)
    .filter((r) => r.some((c) => c !== ""))
    .map((r) => {
      const obj = {};
      headers.forEach((h, i) => {
        let v = r[i];
        if (v instanceof Date) v = v.toISOString();
        obj[h] = v;
      });
      return obj;
    });
}

function appendObj_(sheet, obj) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  sheet.appendRow(headers.map((h) => (obj[h] !== undefined ? obj[h] : "")));
}

function updateById_(sheet, id, patch) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const idIdx = headers.indexOf("id");
  const data = sheet.getDataRange().getValues();
  for (let r = 1; r < data.length; r++) {
    if (String(data[r][idIdx]) === String(id)) {
      Object.keys(patch).forEach((k) => {
        const idx = headers.indexOf(k);
        if (idx >= 0) sheet.getRange(r + 1, idx + 1).setValue(patch[k]);
      });
      return true;
    }
  }
  return false;
}

function updateByIds_(sheet, ids, patch) {
  const idSet = {};
  ids.forEach((id) => (idSet[String(id)] = true));
  const range = sheet.getDataRange();
  const data = range.getValues();
  const headers = data[0];
  const idIdx = headers.indexOf("id");
  const patchEntries = Object.keys(patch).map((k) => [headers.indexOf(k), patch[k]]).filter(([idx]) => idx >= 0);
  for (let r = 1; r < data.length; r++) {
    if (idSet[String(data[r][idIdx])]) {
      patchEntries.forEach(([idx, val]) => { data[r][idx] = val; });
    }
  }
  range.setValues(data);
}

function safeParse_(str, fallback) {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch (e) { return fallback; }
}

function hashPassword_(password) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password);
  return bytes.map((b) => ((b + 256) % 256).toString(16).padStart(2, "0")).join("");
}

// ---------- Auth ----------

function login_(params) {
  const email = String(params.email || "").trim().toLowerCase();
  const password = params.password || "";
  const sheet = getSheet_("Users", USERS_HEADERS);
  const row = readAll_(sheet).find((r) => String(r.email).toLowerCase() === email);
  if (!row) throw new Error("No account for that email.");
  if (row.password_hash !== hashPassword_(password)) throw new Error("Incorrect password.");
  const token = Utilities.getUuid();
  appendObj_(getSheet_("Sessions", SESSION_HEADERS), { token, email: row.email, created_at: new Date().toISOString() });
  return { token, email: row.email, role: row.role };
}

function createUser_(params) {
  const email = String(params.email || "").trim().toLowerCase();
  const password = params.password || "";
  if (!email || !password) throw new Error("Email and password required.");
  const sheet = getSheet_("Users", USERS_HEADERS);
  const rows = readAll_(sheet);
  if (rows.some((r) => String(r.email).toLowerCase() === email)) throw new Error("That email already has an account.");

  const isBootstrap = rows.length === 0;
  let allowed = isBootstrap;
  if (!allowed && params.token) {
    const ctx = tryGetSession_(params.token);
    if (ctx && ctx.role === "admin") allowed = true;
  }
  if (!allowed) throw new Error("Only an existing admin can add new users.");

  const role = isBootstrap ? "admin" : (params.role || "operator");
  appendObj_(sheet, { email, password_hash: hashPassword_(password), role });
  return { email, role };
}

function logout_(token) {
  const sheet = getSheet_("Sessions", SESSION_HEADERS);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const tokenIdx = headers.indexOf("token");
  const data = sheet.getDataRange().getValues();
  for (let r = data.length - 1; r >= 1; r--) {
    if (data[r][tokenIdx] === token) { sheet.deleteRow(r + 1); break; }
  }
  return { ok: true };
}

function tryGetSession_(token) {
  if (!token) return null;
  const row = readAll_(getSheet_("Sessions", SESSION_HEADERS)).find((r) => r.token === token);
  if (!row) return null;
  const user = readAll_(getSheet_("Users", USERS_HEADERS)).find((r) => String(r.email).toLowerCase() === String(row.email).toLowerCase());
  return { email: row.email, role: user ? user.role : "operator" };
}

function requireSession_(token) {
  const ctx = tryGetSession_(token);
  if (!ctx) throw new Error("Not signed in - session invalid or expired.");
  return ctx;
}

function getUserRole_(email) {
  const row = readAll_(getSheet_("Users", USERS_HEADERS)).find((r) => String(r.email).toLowerCase() === String(email).toLowerCase());
  return row ? row.role : "operator";
}

// ---------- Customers ----------

function fetchCustomers_() {
  return readAll_(getSheet_("Customers", CUSTOMER_HEADERS)).map((row) => ({ id: row.id, name: row.name, code: row.code }));
}

function getCustomer_(customerId) {
  const row = readAll_(getSheet_("Customers", CUSTOMER_HEADERS)).find((r) => r.id === customerId);
  if (!row) return null;
  return {
    id: row.id, name: row.name, code: row.code,
    billingAddress: row.billing_address, vatRegNo: row.vat_reg_no,
    catalog: safeParse_(row.catalog_json, []), serviceTypes: safeParse_(row.service_types_json, DEFAULT_SERVICE_TYPES),
    invoiceCycle: row.invoice_cycle,
  };
}

function ensureCustomerSeeded_(params) {
  const existing = getCustomer_(params.customerId);
  if (existing) return existing;
  appendObj_(getSheet_("Customers", CUSTOMER_HEADERS), {
    id: params.customerId, name: params.name, code: params.code,
    billing_address: params.billingAddress || "", vat_reg_no: params.vatRegNo || "",
    catalog_json: JSON.stringify(params.catalog || []),
    service_types_json: JSON.stringify(DEFAULT_SERVICE_TYPES),
    invoice_cycle: "1-15 / 16-EOM",
  });
  return getCustomer_(params.customerId);
}

// ---------- Sequential unique codes (LockService keeps this safe under concurrent saves) ----------

function generateUniqueCode_(customerId) {
  return generateUniqueCodes_(customerId, 1)[0];
}

function generateUniqueCodes_(customerId, count) {
  if (!count) return [];
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = getSheet_("CodeCounters", CODE_COUNTER_HEADERS);
    const data = sheet.getDataRange().getValues();
    let rowIdx = -1;
    for (let r = 1; r < data.length; r++) if (data[r][0] === customerId) { rowIdx = r; break; }
    let start;
    if (rowIdx === -1) {
      start = 1;
      sheet.appendRow([customerId, 1 + count]);
    } else {
      start = data[rowIdx][1];
      sheet.getRange(rowIdx + 1, 2).setValue(start + count);
    }
    const customer = getCustomer_(customerId);
    const prefix = customer ? customer.code : "BILL";
    const codes = [];
    for (let i = 0; i < count; i++) {
      const seq = start + i;
      const padded = String(seq).padStart(8, "0");
      codes.push({ uniqueCode: prefix + padded, receiptNumber: padded });
    }
    return codes;
  } finally {
    lock.releaseLock();
  }
}

// ---------- Orders ----------

function orderToRowObj_(order, extra) {
  const o = Object.assign({}, order, extra || {});
  return {
    id: o.id, customer_id: o.customerId, customer_name: o.customerName,
    docket_no: o.docketNo, order_date: o.orderDate, room_or_bill_no: o.roomOrBillNo,
    service_type_json: JSON.stringify(o.serviceType), lines_json: JSON.stringify(o.lines),
    total_pieces: o.totalPieces, standard_value: o.standardValue,
    surcharge_value: o.surchargeValue, pickup_fee: o.pickupFee,
    total_bill_value: o.totalBillValue, status: o.status || "received",
    bill_number: o.billNumber, guest_name: o.guestName, customer_mobile: o.customerMobile,
    room_number: o.roomNumber, packing_method: o.packingMethod,
    unique_code: o.uniqueCode, receipt_number: o.receiptNumber,
    packet_count: "", packed_by: "", packed_at: "", dispatched_by: "", dispatched_at: "",
    transfer_note_id: "", created_at: o.createdAt,
  };
}

function orderRowToObj_(row) {
  return {
    id: row.id, customerId: row.customer_id, customerName: row.customer_name,
    docketNo: row.docket_no, orderDate: row.order_date, roomOrBillNo: row.room_or_bill_no,
    serviceType: safeParse_(row.service_type_json, null), lines: safeParse_(row.lines_json, []),
    totalPieces: Number(row.total_pieces) || 0, standardValue: Number(row.standard_value) || 0,
    surchargeValue: Number(row.surcharge_value) || 0, pickupFee: Number(row.pickup_fee) || 0,
    totalBillValue: Number(row.total_bill_value) || 0, status: row.status,
    billNumber: row.bill_number, guestName: row.guest_name, customerMobile: row.customer_mobile,
    roomNumber: row.room_number, packingMethod: row.packing_method, uniqueCode: row.unique_code,
    receiptNumber: row.receipt_number, packetCount: row.packet_count ? Number(row.packet_count) : null,
    packedBy: row.packed_by || null, packedAt: row.packed_at || null,
    dispatchedBy: row.dispatched_by || null, dispatchedAt: row.dispatched_at || null,
    transferNoteId: row.transfer_note_id || null, createdAt: row.created_at,
  };
}

function createOrder_(order, ctx) {
  const sheet = getSheet_("Orders", ORDER_HEADERS);
  const id = Utilities.getUuid();
  const createdAt = new Date().toISOString();
  appendObj_(sheet, orderToRowObj_(order, { id, createdAt }));
  logStatusHistory_(id, "received", order.createdBy || (ctx && ctx.email), "");
  return { id };
}

function createOrders_(orders, createdBy) {
  const sheet = getSheet_("Orders", ORDER_HEADERS);
  const createdAt = new Date().toISOString();
  const created = [];
  const rows = orders.map((order) => {
    const id = Utilities.getUuid();
    created.push(Object.assign({}, order, { id }));
    const obj = orderToRowObj_(order, { id, createdAt });
    return ORDER_HEADERS.map((h) => (obj[h] !== undefined ? obj[h] : ""));
  });
  const startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, rows.length, ORDER_HEADERS.length).setValues(rows);
  logStatusHistoryBulk_(created.map((o) => o.id), "received", createdBy);
  return created;
}

function fetchOrders_(customerId) {
  return readAll_(getSheet_("Orders", ORDER_HEADERS))
    .filter((r) => r.customer_id === customerId)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, 200)
    .map(orderRowToObj_);
}

function fetchAllOrdersForDashboard_(customerId) {
  return readAll_(getSheet_("Orders", ORDER_HEADERS))
    .filter((r) => r.customer_id === customerId)
    .map(orderRowToObj_);
}

function getOrderByDocketNo_(customerId, docketNo) {
  const row = readAll_(getSheet_("Orders", ORDER_HEADERS)).find((r) => r.customer_id === customerId && r.docket_no === docketNo);
  return row ? orderRowToObj_(row) : null;
}

function getOrderByUniqueCode_(uniqueCode) {
  const row = readAll_(getSheet_("Orders", ORDER_HEADERS)).find((r) => r.unique_code === uniqueCode);
  return row ? orderRowToObj_(row) : null;
}

function fetchPackedUnassignedOrders_(customerId) {
  return readAll_(getSheet_("Orders", ORDER_HEADERS))
    .filter((r) => r.customer_id === customerId && r.status === "packed" && !r.transfer_note_id)
    .sort((a, b) => ((a.packed_at || "") < (b.packed_at || "") ? 1 : -1))
    .map(orderRowToObj_);
}

function searchOrders_(customerId, query) {
  const q = String(query || "").toLowerCase();
  const cols = ["unique_code", "docket_no", "bill_number", "room_number", "room_or_bill_no", "guest_name", "customer_mobile"];
  return readAll_(getSheet_("Orders", ORDER_HEADERS))
    .filter((r) => r.customer_id === customerId && cols.some((c) => String(r[c] || "").toLowerCase().includes(q)))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, 20)
    .map(orderRowToObj_);
}

function fetchOrdersByIds_(orderIds) {
  const idSet = {};
  (orderIds || []).forEach((id) => (idSet[id] = true));
  return readAll_(getSheet_("Orders", ORDER_HEADERS)).filter((r) => idSet[r.id]).map(orderRowToObj_);
}

function updateOrderStatus_(orderId, status) {
  updateById_(getSheet_("Orders", ORDER_HEADERS), orderId, { status });
  return { ok: true };
}

function savePacking_(orderId, packetCount, packedBy) {
  const now = new Date().toISOString();
  updateById_(getSheet_("Orders", ORDER_HEADERS), orderId, {
    status: "packed", packet_count: packetCount, packed_by: packedBy || "", packed_at: now,
  });
  logStatusHistory_(orderId, "packed", packedBy, packetCount + " packet(s)");
  return { ok: true };
}

function changeOrderStatus_(orderId, stage, changedBy, remarks) {
  updateById_(getSheet_("Orders", ORDER_HEADERS), orderId, { status: stage });
  logStatusHistory_(orderId, stage, changedBy, remarks);
  return { ok: true };
}

// ---------- Workflow + status history ----------

function fetchWorkflowStages_() {
  return readAll_(getSheet_("WorkflowStages", WORKFLOW_HEADERS))
    .filter((r) => r.is_active === true || r.is_active === "TRUE" || r.is_active === "true")
    .sort((a, b) => Number(a.sort_order) - Number(b.sort_order))
    .map((r) => ({ id: r.id, name: r.name, sortOrder: Number(r.sort_order), color: r.color }));
}

function logStatusHistory_(orderId, stage, changedBy, remarks) {
  appendObj_(getSheet_("StatusHistory", STATUS_HISTORY_HEADERS), {
    id: Utilities.getUuid(), order_id: orderId, stage, changed_by: changedBy || "", remarks: remarks || "",
    created_at: new Date().toISOString(),
  });
}

function logStatusHistoryBulk_(orderIds, stage, changedBy) {
  if (!orderIds || !orderIds.length) return;
  const sheet = getSheet_("StatusHistory", STATUS_HISTORY_HEADERS);
  const createdAt = new Date().toISOString();
  const rows = orderIds.map((orderId) => [Utilities.getUuid(), orderId, stage, changedBy || "", "", createdAt]);
  const startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, rows.length, STATUS_HISTORY_HEADERS.length).setValues(rows);
}

function fetchStatusHistory_(orderId) {
  return readAll_(getSheet_("StatusHistory", STATUS_HISTORY_HEADERS))
    .filter((r) => r.order_id === orderId)
    .sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
    .map((r) => ({ stage: r.stage, changedBy: r.changed_by, remarks: r.remarks, createdAt: r.created_at }));
}

// ---------- Transfer notes / dispatch ----------

function createTransferNote_(params) {
  const orders = params.orders || [];
  const id = Utilities.getUuid();
  const totalPackets = orders.reduce((s, o) => s + (o.packetCount || 0), 0);
  const totalPieces = orders.reduce((s, o) => s + (o.totalPieces || 0), 0);
  const transferDate = new Date().toISOString().slice(0, 10);

  appendObj_(getSheet_("TransferNotes", TRANSFER_HEADERS), {
    id, customer_id: params.customerId, transfer_no: params.transferNo, transfer_date: transferDate,
    driver_name: params.driverName || "", vehicle_number: params.vehicleNumber || "",
    destination_outlet: params.destinationOutlet || "",
    order_ids_json: JSON.stringify(orders.map((o) => o.id)),
    total_pieces: totalPieces, total_packets: totalPackets, created_at: new Date().toISOString(),
  });

  const now = new Date().toISOString();
  updateByIds_(getSheet_("Orders", ORDER_HEADERS), orders.map((o) => o.id), {
    status: "dispatched", transfer_note_id: id, dispatched_by: params.dispatchedBy || "", dispatched_at: now,
  });
  logStatusHistoryBulk_(orders.map((o) => o.id), "dispatched", params.dispatchedBy);

  return {
    id, customerId: params.customerId, transferNo: params.transferNo, transferDate,
    orderIds: orders.map((o) => o.id), totalPieces,
    driverName: params.driverName, vehicleNumber: params.vehicleNumber,
    destinationOutlet: params.destinationOutlet, totalPackets,
  };
}

function fetchTransferNotes_(customerId) {
  return readAll_(getSheet_("TransferNotes", TRANSFER_HEADERS))
    .filter((r) => r.customer_id === customerId)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, 100)
    .map((r) => ({
      id: r.id, customerId: r.customer_id, transferNo: r.transfer_no, transferDate: r.transfer_date,
      orderIds: safeParse_(r.order_ids_json, []), totalPieces: Number(r.total_pieces) || 0,
      driverName: r.driver_name, vehicleNumber: r.vehicle_number, destinationOutlet: r.destination_outlet,
      totalPackets: r.total_packets ? Number(r.total_packets) : null,
    }));
}
