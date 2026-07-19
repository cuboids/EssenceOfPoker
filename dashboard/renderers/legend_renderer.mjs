export function renderLegendHtml(documentRef, { bands, firstActiveIndex, lastActiveIndex }) {
  const legend = documentRef.getElementById("legend");
  legend.innerHTML = "";

  for (const [index, band] of bands.entries()) {
    if (index === firstActiveIndex) {
      legend.appendChild(legendBoundary(documentRef));
    }

    const item = documentRef.createElement("div");
    item.className = `legend-item ${band.active ? "is-active" : "is-inactive"}`;
    item.title = band.name;
    item.innerHTML = `<span class="legend-swatch" style="--swatch-color: ${band.color}"></span><span>${band.name}</span>`;
    legend.appendChild(item);

    if (index === lastActiveIndex) {
      legend.appendChild(legendBoundary(documentRef));
    }
  }
}

function legendBoundary(documentRef) {
  const separator = documentRef.createElement("span");
  separator.className = "legend-ceiling-separator";
  separator.setAttribute("aria-hidden", "true");
  return separator;
}
