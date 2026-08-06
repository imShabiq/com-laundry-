import { supabase } from "./supabase-init.js";
import { SERVICE_TYPES } from "./constants.js";

export async function ensureCustomerSeeded(customerId, { name, code, billingAddress, vatRegNo, catalog }) {
  const { data: existing } = await supabase.from("customers").select("*").eq("id", customerId).maybeSingle();
  if (existing) return rowToCustomer(existing);

  const row = {
    id: customerId,
    name,
    code,
    billing_address: billingAddress,
    vat_reg_no: vatRegNo,
    catalog,
    service_types: SERVICE_TYPES,
    invoice_cycle: "1-15 / 16-EOM",
  };
  const { data, error } = await supabase.from("customers").insert(row).select().single();
  if (error) throw error;
  return rowToCustomer(data);
}

export async function getCustomer(customerId) {
  const { data, error } = await supabase.from("customers").select("*").eq("id", customerId).maybeSingle();
  if (error) throw error;
  return data ? rowToCustomer(data) : null;
}

function rowToCustomer(row) {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    billingAddress: row.billing_address,
    vatRegNo: row.vat_reg_no,
    catalog: row.catalog,
    serviceTypes: row.service_types,
    invoiceCycle: row.invoice_cycle,
  };
}

export function makeDocketNo(code) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${code}-${stamp}`;
}

export async function generateUniqueCode(customerId) {
  const { data, error } = await supabase.rpc("next_unique_code", { p_customer_id: customerId });
  if (error) throw error;
  return { uniqueCode: data, receiptNumber: data.replace(/^\D+/, "") };
}

export async function generateUniqueCodes(customerId, count) {
  if (count === 0) return [];
  const { data, error } = await supabase.rpc("next_unique_codes", { p_customer_id: customerId, p_count: count });
  if (error) throw error;
  return data.map((code) => ({ uniqueCode: code, receiptNumber: code.replace(/^\D+/, "") }));
}

function orderToRow(order) {
  return {
    customer_id: order.customerId,
    customer_name: order.customerName,
    docket_no: order.docketNo,
    order_date: order.orderDate,
    room_or_bill_no: order.roomOrBillNo,
    service_type: order.serviceType,
    lines: order.lines,
    total_pieces: order.totalPieces,
    standard_value: order.standardValue,
    surcharge_value: order.surchargeValue,
    pickup_fee: order.pickupFee,
    total_bill_value: order.totalBillValue,
    status: "received",
    bill_number: order.billNumber,
    guest_name: order.guestName,
    customer_mobile: order.customerMobile,
    room_number: order.roomNumber,
    packing_method: order.packingMethod,
    unique_code: order.uniqueCode,
    receipt_number: order.receiptNumber,
  };
}

export async function createOrder(order) {
  const { data, error } = await supabase.from("orders").insert(orderToRow(order)).select().single();
  if (error) throw error;
  await logStatusHistory(data.id, "received", order.createdBy);
  return data.id;
}

export async function createOrders(orders, createdBy) {
  const { data, error } = await supabase.from("orders").insert(orders.map(orderToRow)).select();
  if (error) throw error;
  await logStatusHistoryBulk(data.map((row) => row.id), "received", createdBy);
  return data.map(rowToOrder);
}

export async function getOrderByDocketNo(customerId, docketNo) {
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("customer_id", customerId)
    .eq("docket_no", docketNo)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToOrder(data) : null;
}

export async function getOrderByUniqueCode(uniqueCode) {
  const { data, error } = await supabase.from("orders").select("*").eq("unique_code", uniqueCode).maybeSingle();
  if (error) throw error;
  return data ? rowToOrder(data) : null;
}

export async function fetchOrders(customerId) {
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return data.map(rowToOrder);
}

function rowToOrder(row) {
  return {
    id: row.id,
    customerId: row.customer_id,
    customerName: row.customer_name,
    docketNo: row.docket_no,
    orderDate: row.order_date,
    roomOrBillNo: row.room_or_bill_no,
    serviceType: row.service_type,
    lines: row.lines,
    totalPieces: row.total_pieces,
    standardValue: row.standard_value,
    surchargeValue: row.surcharge_value,
    pickupFee: row.pickup_fee,
    totalBillValue: row.total_bill_value,
    status: row.status,
    billNumber: row.bill_number,
    guestName: row.guest_name,
    customerMobile: row.customer_mobile,
    roomNumber: row.room_number,
    packingMethod: row.packing_method,
    uniqueCode: row.unique_code,
    receiptNumber: row.receipt_number,
    packetCount: row.packet_count,
    packedBy: row.packed_by,
    packedAt: row.packed_at,
    dispatchedBy: row.dispatched_by,
    dispatchedAt: row.dispatched_at,
    createdAt: row.created_at,
  };
}

export async function updateOrderStatus(orderId, status) {
  const { error } = await supabase.from("orders").update({ status }).eq("id", orderId);
  if (error) throw error;
}

export async function savePacking(orderId, packetCount, packedBy) {
  const { error } = await supabase
    .from("orders")
    .update({ status: "packed", packet_count: packetCount, packed_by: packedBy, packed_at: new Date().toISOString() })
    .eq("id", orderId);
  if (error) throw error;
  await logStatusHistory(orderId, "packed", packedBy, `${packetCount} packet(s)`);
}

// ---------- Configurable workflow ----------
export async function fetchWorkflowStages() {
  const { data, error } = await supabase
    .from("workflow_stages")
    .select("*")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return data.map((row) => ({ id: row.id, name: row.name, sortOrder: row.sort_order, color: row.color }));
}

export async function logStatusHistory(orderId, stage, changedBy, remarks) {
  const { error } = await supabase.from("status_history").insert({ order_id: orderId, stage, changed_by: changedBy, remarks });
  if (error) throw error;
}

async function logStatusHistoryBulk(orderIds, stage, changedBy) {
  if (!orderIds.length) return;
  const { error } = await supabase
    .from("status_history")
    .insert(orderIds.map((orderId) => ({ order_id: orderId, stage, changed_by: changedBy })));
  if (error) throw error;
}

export async function fetchStatusHistory(orderId) {
  const { data, error } = await supabase
    .from("status_history")
    .select("*")
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data.map((row) => ({ stage: row.stage, changedBy: row.changed_by, remarks: row.remarks, createdAt: row.created_at }));
}

export async function changeOrderStatus(orderId, stage, changedBy, remarks) {
  const { error } = await supabase.from("orders").update({ status: stage }).eq("id", orderId);
  if (error) throw error;
  await logStatusHistory(orderId, stage, changedBy, remarks);
}

export async function fetchOrCreateUserRole(email) {
  const { data: existing } = await supabase.from("user_roles").select("*").eq("email", email).maybeSingle();
  if (existing) return existing.role;
  const { data, error } = await supabase.from("user_roles").insert({ email, role: "operator" }).select().single();
  if (error) throw error;
  return data.role;
}

export async function fetchPackedUnassignedOrders(customerId) {
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("customer_id", customerId)
    .eq("status", "packed")
    .is("transfer_note_id", null)
    .order("packed_at", { ascending: false });
  if (error) throw error;
  return data.map(rowToOrder);
}

export async function createTransferNote({ customerId, transferNo, driverName, vehicleNumber, destinationOutlet, orders, dispatchedBy }) {
  const totalPackets = orders.reduce((s, o) => s + (o.packetCount || 0), 0);
  const { data: note, error } = await supabase
    .from("transfer_notes")
    .insert({
      customer_id: customerId,
      transfer_no: transferNo,
      driver_name: driverName,
      vehicle_number: vehicleNumber,
      destination_outlet: destinationOutlet,
      order_ids: orders.map((o) => o.id),
      total_pieces: orders.reduce((s, o) => s + o.totalPieces, 0),
      total_packets: totalPackets,
    })
    .select()
    .single();
  if (error) throw error;

  const { error: updateError } = await supabase
    .from("orders")
    .update({
      status: "dispatched",
      transfer_note_id: note.id,
      dispatched_by: dispatchedBy,
      dispatched_at: new Date().toISOString(),
    })
    .in("id", orders.map((o) => o.id));
  if (updateError) throw updateError;

  await logStatusHistoryBulk(orders.map((o) => o.id), "dispatched", dispatchedBy);
  return rowToTransferNote(note);
}

export async function fetchTransferNotes(customerId) {
  const { data, error } = await supabase
    .from("transfer_notes")
    .select("*")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return data.map(rowToTransferNote);
}

export async function searchOrders(customerId, query) {
  const q = `%${query}%`;
  const cols = ["unique_code", "docket_no", "bill_number", "room_number", "room_or_bill_no", "guest_name", "customer_mobile"];
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("customer_id", customerId)
    .or(cols.map((c) => `${c}.ilike.${q}`).join(","))
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  return data.map(rowToOrder);
}

export async function fetchAllOrdersForDashboard(customerId) {
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(5000);
  if (error) throw error;
  return data.map(rowToOrder);
}

export async function fetchOrdersByIds(orderIds) {
  if (!orderIds.length) return [];
  const { data, error } = await supabase.from("orders").select("*").in("id", orderIds);
  if (error) throw error;
  return data.map(rowToOrder);
}

function rowToTransferNote(row) {
  return {
    id: row.id,
    customerId: row.customer_id,
    transferNo: row.transfer_no,
    transferDate: row.transfer_date,
    orderIds: row.order_ids,
    totalPieces: row.total_pieces,
    driverName: row.driver_name,
    vehicleNumber: row.vehicle_number,
    destinationOutlet: row.destination_outlet,
    totalPackets: row.total_packets,
  };
}
