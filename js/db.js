import { call } from "./backend.js";

export async function ensureCustomerSeeded(customerId, { name, code, billingAddress, vatRegNo, catalog }) {
  return call("ensureCustomerSeeded", { customerId, name, code, billingAddress, vatRegNo, catalog });
}

export async function getCustomer(customerId) {
  return call("getCustomer", { customerId });
}

export function makeDocketNo(code) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${code}-${stamp}`;
}

export async function generateUniqueCode(customerId) {
  return call("generateUniqueCode", { customerId });
}

export async function generateUniqueCodes(customerId, count) {
  if (count === 0) return [];
  return call("generateUniqueCodes", { customerId, count });
}

export async function createOrder(order) {
  const res = await call("createOrder", { order });
  return res.id;
}

export async function createOrders(orders, createdBy) {
  return call("createOrders", { orders, createdBy });
}

export async function getOrderByDocketNo(customerId, docketNo) {
  return call("getOrderByDocketNo", { customerId, docketNo });
}

export async function getOrderByUniqueCode(uniqueCode) {
  return call("getOrderByUniqueCode", { uniqueCode });
}

export async function fetchOrders(customerId) {
  return call("fetchOrders", { customerId });
}

export async function updateOrderStatus(orderId, status) {
  await call("updateOrderStatus", { orderId, status });
}

export async function savePacking(orderId, packetCount, packedBy) {
  await call("savePacking", { orderId, packetCount, packedBy });
}

export async function fetchWorkflowStages() {
  return call("fetchWorkflowStages", {});
}

export async function logStatusHistory(orderId, stage, changedBy, remarks) {
  await call("logStatusHistory", { orderId, stage, changedBy, remarks });
}

export async function fetchStatusHistory(orderId) {
  return call("fetchStatusHistory", { orderId });
}

export async function changeOrderStatus(orderId, stage, changedBy, remarks) {
  await call("changeOrderStatus", { orderId, stage, changedBy, remarks });
}

export async function fetchOrCreateUserRole(email) {
  return call("fetchOrCreateUserRole", { email });
}

export async function fetchPackedUnassignedOrders(customerId) {
  return call("fetchPackedUnassignedOrders", { customerId });
}

export async function createTransferNote({ customerId, transferNo, driverName, vehicleNumber, destinationOutlet, orders, dispatchedBy }) {
  return call("createTransferNote", { customerId, transferNo, driverName, vehicleNumber, destinationOutlet, orders, dispatchedBy });
}

export async function fetchTransferNotes(customerId) {
  return call("fetchTransferNotes", { customerId });
}

export async function searchOrders(customerId, query) {
  return call("searchOrders", { customerId, query });
}

export async function fetchAllOrdersForDashboard(customerId) {
  return call("fetchAllOrdersForDashboard", { customerId });
}

export async function fetchOrdersByIds(orderIds) {
  if (!orderIds.length) return [];
  return call("fetchOrdersByIds", { orderIds });
}
