// utils/stock.js
// Turns raw batches + consumption logs into the numbers the rest of the app needs:
// current usable stock, a real (not guessed) daily usage rate, and expiry info.

const ROLLING_WINDOW_DAYS = 14;
const MIN_LOG_DAYS_FOR_REAL_AVERAGE = 3; // need at least a few logged days before trusting the average
const EXPIRING_SOON_DAYS = 30;

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoISO(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// Usable stock = sum of non-expired batches. Expired stock is tracked separately
// (it's not usable, but a clinic still needs to know it's sitting there as waste).
function getStockBreakdown(db, medicineId) {
  const today = todayISO();

  const usable = db
    .prepare(
      `SELECT COALESCE(SUM(quantity), 0) AS total FROM medicine_batches
       WHERE medicine_id = ? AND quantity > 0 AND (expiry_date IS NULL OR expiry_date >= ?)`
    )
    .get(medicineId, today).total;

  const expired = db
    .prepare(
      `SELECT COALESCE(SUM(quantity), 0) AS total FROM medicine_batches
       WHERE medicine_id = ? AND quantity > 0 AND expiry_date IS NOT NULL AND expiry_date < ?`
    )
    .get(medicineId, today).total;

  const nearestExpiry = db
    .prepare(
      `SELECT MIN(expiry_date) AS date FROM medicine_batches
       WHERE medicine_id = ? AND quantity > 0 AND expiry_date IS NOT NULL AND expiry_date >= ?`
    )
    .get(medicineId, today).date;

  let daysUntilExpiry = null;
  let isExpiringSoon = false;
  if (nearestExpiry) {
    daysUntilExpiry = Math.round(
      (new Date(nearestExpiry) - new Date(today)) / (1000 * 60 * 60 * 24)
    );
    isExpiringSoon = daysUntilExpiry <= EXPIRING_SOON_DAYS;
  }

  return { usableStock: usable, expiredStock: expired, nearestExpiry, daysUntilExpiry, isExpiringSoon };
}

// Real daily usage from the last 14 calendar days of logs. Falls back to the
// manual estimate until there's enough real history to trust.
function getDailyUsage(db, medicineId, manualFallback) {
  const since = daysAgoISO(ROLLING_WINDOW_DAYS);

  const row = db
    .prepare(
      `SELECT COALESCE(SUM(quantity), 0) AS total, COUNT(DISTINCT date(logged_at)) AS activeDays
       FROM consumption_log WHERE medicine_id = ? AND date(logged_at) >= ?`
    )
    .get(medicineId, since);

  if (row.activeDays >= MIN_LOG_DAYS_FOR_REAL_AVERAGE) {
    return {
      dailyUsage: Math.round((row.total / ROLLING_WINDOW_DAYS) * 100) / 100,
      source: "history",
    };
  }

  return { dailyUsage: Number(manualFallback) || 0, source: "estimate" };
}

// FEFO (first-expire-first-out): decrements the batches with the soonest expiry first,
// same as how a real pharmacy should dispense stock. Returns leftover if not enough stock.
function decrementFEFO(db, medicineId, quantity) {
  let remaining = quantity;
  const batches = db
    .prepare(
      `SELECT * FROM medicine_batches WHERE medicine_id = ? AND quantity > 0
       ORDER BY (expiry_date IS NULL) ASC, expiry_date ASC`
    )
    .all(medicineId);

  for (const batch of batches) {
    if (remaining <= 0) break;
    const deduct = Math.min(batch.quantity, remaining);
    db.prepare(`UPDATE medicine_batches SET quantity = quantity - ? WHERE id = ?`).run(
      deduct,
      batch.id
    );
    remaining -= deduct;
  }

  return remaining; // > 0 means there wasn't enough stock to fully cover the request
}

module.exports = {
  getStockBreakdown,
  getDailyUsage,
  decrementFEFO,
  ROLLING_WINDOW_DAYS,
  EXPIRING_SOON_DAYS,
};
