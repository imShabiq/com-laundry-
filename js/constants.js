export const COMPANY = {
  name: "LaundroPlus (Pvt) Ltd",
  addressLines: ["No. 331, Park Road,", "Colombo 05"],
  email: "info@laundroplus.lk",
  vatRegNo: "106533520-7000",
};

export const SERVICE_TYPES = [
  { id: "same-day", name: "Same Day Service", surchargePct: 0 },
  { id: "express", name: "Express Service", surchargePct: 50 },
  { id: "special", name: "Special Service", surchargePct: 100 },
];

export const ORDER_STATUSES = ["received", "packed", "dispatched"];

export function statusLabel(status) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}
