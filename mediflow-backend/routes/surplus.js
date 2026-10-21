// routes/surplus.js
// Powers surplus.html. Surplus = the donor clinic's stock is STABLE (safe to share)
// AND we now surface expiry so a near-expiry surplus can be flagged urgent —
// better to redistribute soon-to-expire stock than let it go to waste.

const express = require("express");
const db = require("../db/database");
const { requireAuth } = require("../middleware/auth");
const { computeRisk } = require("../utils/risk");
const { getStockBreakdown, getDailyUsage } = require("../utils/stock");
const { haversineKm } = require("../utils/distance");

const router = express.Router();
router.use(requireAuth);

// GET /api/surplus/medicines -> list of medicine names to populate the dropdown
router.get("/medicines", (req, res) => {
  const rows = db.prepare("SELECT DISTINCT name FROM medicines ORDER BY name").all();
  res.json({ medicines: rows.map((r) => r.name) });
});

// GET /api/surplus/:medicineName -> other clinics with genuine surplus, nearest first
router.get("/:medicineName", (req, res) => {
  const medicineName = req.params.medicineName;

  const requester = db.prepare("SELECT * FROM clinics WHERE id = ?").get(req.clinic.id);

  const candidates = db
    .prepare(
      `SELECT m.id AS medicine_id, m.manual_daily_usage, m.unit, c.id AS clinic_id, c.name AS clinic_name,
              c.latitude, c.longitude
       FROM medicines m
       JOIN clinics c ON c.id = m.clinic_id
       WHERE m.name = ? AND c.id != ?`
    )
    .all(medicineName, req.clinic.id);

  const surplusClinics = candidates
    .map((c) => {
      const stockInfo = getStockBreakdown(db, c.medicine_id);
      const { dailyUsage } = getDailyUsage(db, c.medicine_id, c.manual_daily_usage);
      const { daysRemaining, status } = computeRisk(stockInfo.usableStock, dailyUsage);
      const distanceKm = haversineKm(requester.latitude, requester.longitude, c.latitude, c.longitude);

      return {
        clinicId: c.clinic_id,
        clinicName: c.clinic_name,
        stock: stockInfo.usableStock,
        unit: c.unit,
        daysRemainingForThem: daysRemaining,
        status,
        distanceKm,
        nearestExpiry: stockInfo.nearestExpiry,
        daysUntilExpiry: stockInfo.daysUntilExpiry,
        isExpiringSoon: stockInfo.isExpiringSoon,
      };
    })
    .filter((c) => c.status === "STABLE" && c.stock > 0)
    // Near-expiry surplus first (redistribute before it's wasted), then by distance
    .sort((a, b) => {
      if (a.isExpiringSoon !== b.isExpiringSoon) return a.isExpiringSoon ? -1 : 1;
      return a.distanceKm - b.distanceKm;
    });

  res.json({ medicine: medicineName, results: surplusClinics });
});

module.exports = router;
