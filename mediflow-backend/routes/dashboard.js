// routes/dashboard.js
// Powers dashboard.html's summary cards.

const express = require("express");
const db = require("../db/database");
const { requireAuth } = require("../middleware/auth");
const { computeRisk } = require("../utils/risk");
const { getStockBreakdown, getDailyUsage } = require("../utils/stock");

const router = express.Router();
router.use(requireAuth);

// GET /api/dashboard/summary
router.get("/summary", (req, res) => {
  const rows = db
    .prepare("SELECT * FROM medicines WHERE clinic_id = ?")
    .all(req.clinic.id);

  const counts = { CRITICAL: 0, MEDIUM: 0, STABLE: 0 };
  let expiringSoon = 0;

  for (const m of rows) {
    const stockInfo = getStockBreakdown(db, m.id);
    const { dailyUsage } = getDailyUsage(db, m.id, m.manual_daily_usage);
    const { status } = computeRisk(stockInfo.usableStock, dailyUsage);
    counts[status]++;
    if (stockInfo.isExpiringSoon) expiringSoon++;
  }

  res.json({
    clinicName: req.clinic.name,
    critical: counts.CRITICAL,
    medium: counts.MEDIUM,
    stable: counts.STABLE,
    expiringSoon,
    totalMedicines: rows.length,
  });
});

module.exports = router;
