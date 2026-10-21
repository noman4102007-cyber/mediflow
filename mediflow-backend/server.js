// server.js
// Entry point. Wires up middleware and all route modules.

require("dotenv").config();
const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth");
const medicineRoutes = require("./routes/medicines");
const dashboardRoutes = require("./routes/dashboard");
const surplusRoutes = require("./routes/surplus");
const transferRoutes = require("./routes/transfers");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/api/health", (req, res) => res.json({ status: "ok" }));

app.use("/api/auth", authRoutes);
app.use("/api/medicines", medicineRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/surplus", surplusRoutes);
app.use("/api/transfers", transferRoutes);

// Fallback error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong on the server." });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`MediFlow backend running on http://localhost:${PORT}`);
});
