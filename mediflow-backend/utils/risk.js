// utils/risk.js
// Single source of truth for risk classification.
// Previously this if/else was copy-pasted in dashboard.html, inventory.html,
// and risk.html — now every endpoint calls this instead.

const THRESHOLDS = {
  CRITICAL_DAYS: 3,
  MEDIUM_DAYS: 7,
};

function computeRisk(stock, dailyUsage) {
  // Guard against divide-by-zero / bad data
  const usage = Number(dailyUsage) || 0;
  const currentStock = Number(stock) || 0;

  const daysRemaining =
    usage > 0 ? currentStock / usage : currentStock > 0 ? Infinity : 0;

  let status;
  if (daysRemaining <= THRESHOLDS.CRITICAL_DAYS) {
    status = "CRITICAL";
  } else if (daysRemaining <= THRESHOLDS.MEDIUM_DAYS) {
    status = "MEDIUM";
  } else {
    status = "STABLE";
  }

  return {
    daysRemaining: Number.isFinite(daysRemaining)
      ? Math.round(daysRemaining * 10) / 10
      : null,
    status,
  };
}

function recommendationFor(status) {
  switch (status) {
    case "CRITICAL":
      return "Immediate action recommended. Check nearby clinics for surplus stock or initiate procurement.";
    case "MEDIUM":
      return "Monitor this medicine closely and consider replenishment.";
    default:
      return "Current stock appears sufficient. Continue normal monitoring.";
  }
}

module.exports = { computeRisk, recommendationFor, THRESHOLDS };
