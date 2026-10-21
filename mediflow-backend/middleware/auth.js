// middleware/auth.js
// Verifies the JWT sent in the Authorization header and attaches
// the logged-in clinic's info to req.clinic for downstream routes.

const jwt = require("jsonwebtoken");

function requireAuth(req, res, next) {
  const header = req.headers["authorization"] || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Missing or invalid Authorization header." });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.clinic = { id: payload.clinicId, code: payload.clinicCode, name: payload.clinicName };
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token." });
  }
}

module.exports = { requireAuth };
