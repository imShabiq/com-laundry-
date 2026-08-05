import QRCode from "https://esm.sh/qrcode@1.5.3";

export async function qrDataUrl(text) {
  return QRCode.toDataURL(text, { margin: 1, width: 180 });
}
