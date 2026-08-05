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
  };
}

export async function updateOrderStatus(orderId, status) {
  const { error } = await supabase.from("orders").update({ status }).eq("id", orderId);
  if (error) throw error;
}
