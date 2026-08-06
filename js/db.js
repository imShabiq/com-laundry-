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
  return data.id;
}

export async function createOrders(orders) {
  const { data, error } = await supabase.from("orders").insert(orders.map(orderToRow)).select();
  if (error) throw error;
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
}

export async function fetchPackedUnassignedOrders(customerId) {
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("customer_id", customerId)
    .eq("status", "packed")
    .is("transfer_note_id", null)
    .order("order_date", { ascending: true });
  if (error) throw error;
  return data.map(rowToOrder);
}

export async function createTransferNote({ customerId, transferNo, orders }) {
  const { data: note, error } = await supabase
    .from("transfer_notes")
    .insert({
      customer_id: customerId,
      transfer_no: transferNo,
      order_ids: orders.map((o) => o.id),
      total_pieces: orders.reduce((s, o) => s + o.totalPieces, 0),
    })
    .select()
    .single();
  if (error) throw error;

  const { error: updateError } = await supabase
    .from("orders")
    .update({ status: "dispatched", transfer_note_id: note.id })
    .in("id", orders.map((o) => o.id));
  if (updateError) throw updateError;

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
  };
}
