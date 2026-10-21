// routes/medicines.js
// Powers inventory.html, risk.html, and the new stock.html pharmacist page.

const express = require("express");
const db = require("../db/database");
const { requireAuth } = require("../middleware/auth");
const { computeRisk, recommendationFor } = require("../utils/risk");
const { getStockBreakdown, getDailyUsage, decrementFEFO } = require("../utils/stock");

const router = express.Router();
router.use(requireAuth);

function buildMedicineView(medicine) {
  const { usableStock, expiredStock, nearestExpiry, daysUntilExpiry, isExpiringSoon } =
    getStockBreakdown(db, medicine.id);
  const { dailyUsage, source } = getDailyUsage(db, medicine.id, medicine.manual_daily_usage);
  const { daysRemaining, status } = computeRisk(usableStock, dailyUsage);

  return {
    id: medicine.id,
    name: medicine.name,
    unit: medicine.unit,
    stock: usableStock,
    expiredStock,
    dailyUsage,
    usageSource: source, // "history" once real logs exist, "estimate" until then
    daysRemaining,
    status,
    nearestExpiry,
    daysUntilExpiry,
    isExpiringSoon,
  };
}

// GET /api/medicines -> full inventory for the logged-in clinic
router.get("/", (req, res) => {
  const rows = db
    .prepare("SELECT * FROM medicines WHERE clinic_id = ? ORDER BY name")
    .all(req.clinic.id);

  res.json({ medicines: rows.map(buildMedicineView) });
});

// GET /api/medicines/:name/risk -> single medicine detail + recommendation
router.get("/:name/risk", (req, res) => {
  const medicine = db
    .prepare("SELECT * FROM medicines WHERE clinic_id = ? AND name = ?")
    .get(req.clinic.id, req.params.name);

  if (!medicine) return res.status(404).json({ error: "Medicine not found for this clinic." });

  const view = buildMedicineView(medicine);
  let recommendation = recommendationFor(view.status);
  if (view.isExpiringSoon) {
    recommendation +=
      ` Note: current stock has a batch expiring in ${view.daysUntilExpiry} day(s) — consider using or transferring it soon to avoid waste.`;
  }

  res.json({ ...view, recommendation });
});

// POST /api/medicines -> add a new medicine, with an optional starting batch
router.post("/", (req, res) => {
  const { name, unit, manualDailyUsage, initialQuantity, expiryDate } = req.body;

  if (!name) return res.status(400).json({ error: "name is required." });

  try {
    const info = db
      .prepare(
        `INSERT INTO medicines (clinic_id, name, unit, manual_daily_usage) VALUES (?, ?, ?, ?)`
      )
      .run(req.clinic.id, name, unit || "units", manualDailyUsage || 0);

    const medicineId = info.lastInsertRowid;

    if (initialQuantity && initialQuantity > 0) {
      db.prepare(
        `INSERT INTO medicine_batches (medicine_id, quantity, expiry_date) VALUES (?, ?, ?)`
      ).run(medicineId, initialQuantity, expiryDate || null);
    }

    res.status(201).json({ id: medicineId });
  } catch (err) {
    if (err.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return res.status(409).json({ error: "This medicine already exists for your clinic." });
    }
    res.status(500).json({ error: "Failed to add medicine." });
  }
});

// PUT /api/medicines/:id -> update name/unit/manual usage estimate (NOT stock directly)
router.put("/:id", (req, res) => {
  const { manualDailyUsage, unit } = req.body;

  const existing = db
    .prepare("SELECT * FROM medicines WHERE id = ? AND clinic_id = ?")
    .get(req.params.id, req.clinic.id);
  if (!existing) return res.status(404).json({ error: "Medicine not found for this clinic." });

  db.prepare(
    `UPDATE medicines SET manual_daily_usage = ?, unit = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(
    manualDailyUsage != null ? manualDailyUsage : existing.manual_daily_usage,
    unit || existing.unit,
    req.params.id
  );

  res.json({ success: true });
});

// DELETE /api/medicines/:id
router.delete("/:id", (req, res) => {
  const info = db
    .prepare("DELETE FROM medicines WHERE id = ? AND clinic_id = ?")
    .run(req.params.id, req.clinic.id);
  if (info.changes === 0) return res.status(404).json({ error: "Medicine not found for this clinic." });
  res.json({ success: true });
});

// ---------- Batches (restocking) ----------

// POST /api/medicines/:id/batches -> pharmacist restocks: add a new batch with its own expiry
router.post("/:id/batches", (req, res) => {
  const { quantity, expiryDate } = req.body;
  if (!quantity || quantity <= 0) return res.status(400).json({ error: "quantity must be greater than 0." });

  const medicine = db
    .prepare("SELECT * FROM medicines WHERE id = ? AND clinic_id = ?")
    .get(req.params.id, req.clinic.id);
  if (!medicine) return res.status(404).json({ error: "Medicine not found for this clinic." });

  db.prepare(
    `INSERT INTO medicine_batches (medicine_id, quantity, expiry_date) VALUES (?, ?, ?)`
  ).run(medicine.id, quantity, expiryDate || null);

  res.status(201).json(buildMedicineView(medicine));
});

// GET /api/medicines/:id/batches -> list all batches (for expiry visibility)
router.get("/:id/batches", (req, res) => {
  const medicine = db
    .prepare("SELECT * FROM medicines WHERE id = ? AND clinic_id = ?")
    .get(req.params.id, req.clinic.id);
  if (!medicine) return res.status(404).json({ error: "Medicine not found for this clinic." });

  const batches = db
    .prepare(
      `SELECT id, quantity, expiry_date, received_at FROM medicine_batches
       WHERE medicine_id = ? AND quantity > 0 ORDER BY (expiry_date IS NULL), expiry_date ASC`
    )
    .all(medicine.id);

  res.json({ batches });
});

// ---------- Consumption (dispensing) ----------

// POST /api/medicines/:id/consumption -> pharmacist logs a dispense; decrements FEFO
router.post("/:id/consumption", (req, res) => {
  const { quantity, note } = req.body;
  if (!quantity || quantity <= 0) return res.status(400).json({ error: "quantity must be greater than 0." });

  const medicine = db
    .prepare("SELECT * FROM medicines WHERE id = ? AND clinic_id = ?")
    .get(req.params.id, req.clinic.id);
  if (!medicine) return res.status(404).json({ error: "Medicine not found for this clinic." });

  const { usableStock } = getStockBreakdown(db, medicine.id);
  if (quantity > usableStock) {
    return res.status(400).json({ error: `Only ${usableStock} ${medicine.unit} available.` });
  }

  decrementFEFO(db, medicine.id, quantity);
  db.prepare(`INSERT INTO consumption_log (medicine_id, quantity, note) VALUES (?, ?, ?)`).run(
    medicine.id,
    quantity,
    note || null
  );

  res.status(201).json(buildMedicineView(medicine));
});

// GET /api/medicines/:id/consumption -> recent usage history (for a chart later)
router.get("/:id/consumption", (req, res) => {
  const medicine = db
    .prepare("SELECT * FROM medicines WHERE id = ? AND clinic_id = ?")
    .get(req.params.id, req.clinic.id);
  if (!medicine) return res.status(404).json({ error: "Medicine not found for this clinic." });

  const logs = db
    .prepare(
      `SELECT quantity, logged_at, note FROM consumption_log
       WHERE medicine_id = ? ORDER BY logged_at DESC LIMIT 30`
    )
    .all(medicine.id);

  res.json({ logs });
});

module.exports = router;
