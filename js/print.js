// Swaps the @page rule for the duration of one print job, so the docket/tag sheet (A4)
// and the sticker label (small thermal size) can each print at their correct page size
// from the same document.
export function printElement(elementId, pageSizeCss) {
  const el = document.getElementById(elementId);
  const styleTag = document.createElement("style");
  styleTag.textContent = `@page{ ${pageSizeCss} }`;
  document.head.appendChild(styleTag);
  el.classList.add("show");

  const cleanup = () => {
    el.classList.remove("show");
    styleTag.remove();
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  window.print();
}
