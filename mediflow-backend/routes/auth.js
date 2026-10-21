// routes/auth.js
// POST /api/auth/login
// Replaces the "Temporary demo login" in index.html with real
// clinic_code + password verification and a JWT session token.

const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../db/database");

const router = express.Router();

router.post("/login", (req, res) => {
  const { clinicId, password } = req.body;

  if (!clinicId || !password) {
    return res.status(400).json({ error: "Clinic ID and password are required." });
  }

  const clinic = db
    .prepare("SELECT * FROM clinics WHERE clinic_code = ?")
    .get(clinicId.trim().toLowerCase());

  if (!clinic) {
    return res.status(401).json({ error: "Invalid Clinic ID or password." });
  }

  const passwordMatches = bcrypt.compareSync(password, clinic.password_hash);
  if (!passwordMatches) {
    return res.status(401).json({ error: "Invalid Clinic ID or password." });
  }

  const token = jwt.sign(
    { clinicId: clinic.id, clinicCode: clinic.clinic_code, clinicName: clinic.name },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
  );

  res.json({
    token,
    clinic: {
      id: clinic.id,
      clinicCode: clinic.clinic_code,
      name: clinic.name,
      latitude: clinic.latitude,
      longitude: clinic.longitude,
    },
  });
});

module.exports = router;
