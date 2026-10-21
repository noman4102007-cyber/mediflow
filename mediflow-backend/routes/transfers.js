// routes/transfers.js
// Lets a clinic request a transfer from a surplus clinic, and lets the provider
// accept/reject/complete it. On completion, stock actually moves as a new batch
// on the receiver's side (carrying over the expiry date) and is decremented FEFO
// on the provider's side — same as real stock movement.

const express = require("express");
const db = require("../db/database");
const { requireAuth } = require("../middleware/auth");
const { getStockBreakdown, decrementFEFO } = require("../utils/stock");

const router = express.Router();
router.use(requireAuth);

router.post("/", (req, res) => {
  const { providerClinicId, medicineName, quantity } = req.body;
  if (!providerClinicId || !medicineName || !quantity) {
    return res.status(400).json({ error: "providerClinicId, medicineName, and quantity are required." });
  }

  const info = db
    .prepare(
      `INSERT INTO transfer_requests (requester_clinic_id, provider_clinic_id, medicine_name, quantity)
       VALUES (?, ?, ?, ?)`
    )
    .run(req.clinic.id, providerClinicId, medicineName, quantity);

  res.status(201).json({ id: info.lastInsertRowid, status: "pending" });
});

router.get("/", (req, res) => {
  const rows = db
    .prepare(
      `SELECT t.*, rc.name AS requester_name, pc.name AS provider_name
       FROM transfer_requests t
       JOIN clinics rc ON rc.id = t.requester_clinic_id
       JOIN clinics pc ON pc.id = t.provider_clinic_id
       WHERE t.requester_clinic_id = ? OR t.provider_clinic_id = ?
       ORDER BY t.created_at DESC`
    )
    .all(req.clinic.id, req.clinic.id);

  res.json({ transfers: rows });
});

router.put("/:id", (req, res) => {
  const { status } = req.body;
  const validStatuses = ["accepted", "rejected", "completed"];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${validStatuses.join(", ")}` });
  }

  const transfer = db.prepare("SELECT * FROM transfer_requests WHERE id = ?").get(req.params.id);
  if (!transfer) return res.status(404).json({ error: "Transfer request not found." });
  if (transfer.provider_clinic_id !== req.clinic.id) {
    return res.status(403).json({ error: "Only the provider clinic can update this request." });
  }

  if (status === "completed") {
    const providerMedicine = db
      .prepare("SELECT * FROM medicines WHERE clinic_id = ? AND name = ?")
      .get(transfer.provider_clinic_id, transfer.medicine_name);

    if (!providerMedicine) {
      return res.status(400).json({ error: "Provider no longer stocks this medicine." });
    }

    const { usableStock, nearestExpiry } = getStockBreakdown(db, providerMedicine.id);
    if (usableStock < transfer.quantity) {
      return res.status(400).json({ error: "Provider no longer has enough stock to complete this transfer." });
    }

    decrementFEFO(db, providerMedicine.id, transfer.quantity);

    let requesterMedicine = db
      .prepare("SELECT * FROM medicines WHERE clinic_id = ? AND name = ?")
      .get(transfer.requester_clinic_id, transfer.medicine_name);

    if (!requesterMedicine) {
      const info = db
        .prepare(
          `INSERT INTO medicines (clinic_id, name, unit, manual_daily_usage) VALUES (?, ?, ?, 0)`
        )
        .run(transfer.requester_clinic_id, transfer.medicine_name, providerMedicine.unit);
      requesterMedicine = { id: info.lastInsertRowid };
    }

    // The transferred stock keeps the expiry date it had at the donor clinic
    db.prepare(
      `INSERT INTO medicine_batches (medicine_id, quantity, expiry_date) VALUES (?, ?, ?)`
    ).run(requesterMedicine.id, transfer.quantity, nearestExpiry || null);
  }

  db.prepare(`UPDATE transfer_requests SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(
    status,
    req.params.id
  );

  res.json({ success: true });
});

module.exports = router;
