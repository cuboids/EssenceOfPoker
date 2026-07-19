import { escapeHtml } from "../ui.mjs";

export function renderConfigPageHtml({
  normalized,
  hideInactiveAssets,
  calibrationContext,
  playerCounts,
  tablePositions,
  archetypeNames,
  profiles,
}) {
  return `
    <section class="config-panel">
      <div class="section-header">
        <div>
          <h2>Config</h2>
          <p>Table and display preferences</p>
        </div>
      </div>
      <div class="config-row config-row-stack">
        <span>
          <span class="config-title">Players</span>
          <span class="config-copy">This determines how many positional opponent pages are shown.</span>
        </span>
        <span class="config-segmented" role="radiogroup" aria-label="Player count">
          ${playerCounts.map((count) => `
            <label>
              <input type="radio" name="player-count" value="${count}" ${normalized.playerCount === count ? "checked" : ""}>
              <span>${count}</span>
            </label>
          `).join("")}
        </span>
      </div>
      <div class="config-row config-row-stack">
        <span>
          <span class="config-title">Hero position</span>
          <span class="config-copy">All other occupied seats become villain pages.</span>
        </span>
        <span class="config-segmented" role="radiogroup" aria-label="Hero position">
          ${tablePositions.map((position) => {
            const isAvailable = normalized.positions.includes(position);
            return `
              <label class="${isAvailable ? "" : "is-disabled"}">
                <input type="radio" name="hero-position" value="${position}" ${normalized.heroPosition === position ? "checked" : ""} ${isAvailable ? "" : "disabled"}>
                <span>${position}</span>
              </label>
            `;
          }).join("")}
        </span>
      </div>
      <div class="config-row config-row-stack">
        <span>
          <span class="config-title">Starting stacks</span>
          <span class="config-copy">Stacks are in big blind units and cap bet, raise, call, and all-in sizes.</span>
        </span>
        <span class="stack-config-grid" aria-label="Starting stacks">
          ${normalized.positions.map((position) => `
            <label class="stack-config-field">
              <span>${position}</span>
              <input type="number" min="1" step="1" name="player-stack" value="${normalized.playerStacks[position]}" data-stack-position="${position}">
            </label>
          `).join("")}
        </span>
      </div>
      <label class="config-row">
        <span>
          <span class="config-title">Hide inactive assets</span>
          <span class="config-copy">Only active assets remain visible in each portfolio section.</span>
        </span>
        <span class="toggle-control config-toggle">
          <input id="hide-inactive-toggle" type="checkbox" ${hideInactiveAssets ? "checked" : ""}>
          <span class="toggle-track" aria-hidden="true"></span>
        </span>
      </label>
      <div class="config-row config-row-stack">
        <span>
          <span class="config-title">Calibration pool</span>
          <span class="config-copy">Stake and era are noisy skill proxies for empirical range weights.</span>
        </span>
        <span class="config-segmented" role="radiogroup" aria-label="Stake bucket">
          ${["micro", "small", "mid", "high"].map((bucket) => `
            <label>
              <input type="radio" name="calibration-stake-bucket" value="${bucket}" ${calibrationContext.stakeBucket === bucket ? "checked" : ""}>
              <span>${bucket}</span>
            </label>
          `).join("")}
        </span>
        <span class="config-segmented" role="radiogroup" aria-label="Year bucket">
          ${["2009-2010", "2011-2018", "2019+"].map((bucket) => `
            <label>
              <input type="radio" name="calibration-year-bucket" value="${bucket}" ${calibrationContext.yearBucket === bucket ? "checked" : ""}>
              <span>${bucket}</span>
            </label>
          `).join("")}
        </span>
      </div>
      <div class="config-row config-row-stack">
        <span>
          <span class="config-title">Player archetypes</span>
          <span class="config-copy">Soft profile weights adjust empirical action likelihoods. Leave all at 0 for the pure population baseline.</span>
        </span>
        <div class="archetype-grid">
          ${profiles.map((profile) => playerProfileConfigHtml(profile, archetypeNames)).join("")}
        </div>
      </div>
    </section>
  `;
}

function playerProfileConfigHtml({ playerId, label, profile }, archetypeNames) {
  return `
    <section class="archetype-card">
      <h3>${escapeHtml(label)}</h3>
      <div class="archetype-sliders">
        ${archetypeNames.map((name) => {
          const value = Math.round(Number(profile[name] || 0) * 100);
          return `
            <label>
              <span>${escapeHtml(archetypeLabel(name))}</span>
              <input type="range" min="0" max="100" step="5" value="${value}" data-archetype-player="${escapeHtml(playerId)}" data-archetype-name="${escapeHtml(name)}">
              <output>${value}%</output>
            </label>
          `;
        }).join("")}
      </div>
    </section>
  `;
}

function archetypeLabel(name) {
  return name
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
