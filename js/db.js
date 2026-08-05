import {
  doc, getDoc, setDoc, collection, addDoc, query, where, orderBy, limit,
  onSnapshot, updateDoc, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { db } from "./firebase-init.js";
import { SERVICE_TYPES } from "./constants.js";

export async function ensureCustomerSeeded(customerId, { name, code, billingAddress, vatRegNo, catalog }) {
  const ref = doc(db, "customers", customerId);
  const snap = await getDoc(ref);
  if (snap.exists()) return snap.data();
  const data = {
    name, code, billingAddress, vatRegNo, catalog,
    serviceTypes: SERVICE_TYPES,
    invoiceCycle: "1-15 / 16-EOM",
    createdAt: serverTimestamp(),
  };
  await setDoc(ref, data);
  return data;
}

export async function getCustomer(customerId) {
  const snap = await getDoc(doc(db, "customers", customerId));
  return snap.exists() ? snap.data() : null;
}

export function makeDocketNo(code) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${code}-${stamp}`;
}

export async function createOrder(order) {
  const ref = await addDoc(collection(db, "orders"), {
    ...order,
    status: "received",
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export function subscribeOrders(customerId, callback) {
  const q = query(
    collection(db, "orders"),
    where("customerId", "==", customerId),
    orderBy("createdAt", "desc"),
    limit(200)
  );
  return onSnapshot(q, (snap) => {
    const orders = [];
    snap.forEach((d) => orders.push({ id: d.id, ...d.data() }));
    callback(orders);
  });
}

export async function updateOrderStatus(orderId, status) {
  await updateDoc(doc(db, "orders", orderId), { status });
}
