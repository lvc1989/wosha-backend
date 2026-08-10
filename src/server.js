import express from "express";
import "express-async-errors";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

// Without these, a single unhandled promise rejection anywhere in the app — a typo'd
// .then() with no .catch(), a stray async callback — terminates the entire Node
// process by default in modern Node versions, taking down every logged-in user's
// session at once instead of just failing the one request that caused it.
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection (server stayed up):", reason);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception (server stayed up):", err);
});

import authRoutes from "./routes/auth.js";
import locationRoutes from "./routes/locations.js";
import customerRoutes from "./routes/customers.js";
import serviceRoutes from "./routes/services.js";
import bookingRoutes from "./routes/bookings.js";
import invoiceRoutes from "./routes/invoices.js";
import staffRoutes from "./routes/staff.js";
import productRoutes from "./routes/products.js";
import expenseRoutes from "./routes/expenses.js";
import supplierRoutes from "./routes/suppliers.js";
import purchaseOrderRoutes from "./routes/purchaseOrders.js";
import messageRoutes from "./routes/messages.js";
import promotionRoutes from "./routes/promotions.js";
import cashflowRoutes from "./routes/cashflow.js";
import complianceRoutes from "./routes/compliance.js";
import printerRoutes from "./routes/printers.js";
import businessPlanRoutes from "./routes/businessPlan.js";
import reminderRoutes from "./routes/reminders.js";
import settingsRoutes from "./routes/settings.js";
import customFieldRoutes from "./routes/customFields.js";
import notificationPrefRoutes from "./routes/notificationPrefs.js";
import categoryRoutes from "./routes/categories.js";
import poCatalogRoutes from "./routes/poCatalog.js";
import attachmentPermissionRoutes from "./routes/attachmentPermissions.js";
import generalManagerRoutes from "./routes/generalManagers.js";
import manualJobRoutes from "./routes/manualJobs.js";
import payrollRateRoutes from "./routes/payrollRates.js";
import backupRoutes from "./routes/backup.js";
import messageTemplateRoutes from "./routes/messageTemplates.js";
import incomingPaymentRoutes from "./routes/incomingPayments.js";
import supplierPaymentRoutes from "./routes/supplierPayments.js";
import paymentCodeRoutes from "./routes/paymentCodes.js";
import appIconRoutes from "./routes/appIcon.js";
import { requireAuth, requirePrimaryOwner } from "./middleware/auth.js";
import mammoth from "mammoth";
import { storeFile, storageConfigured } from "./utils/storage.js";
import { pool } from "./db/pool.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.set("trust proxy", 1);
const corsOrigin = process.env.CORS_ORIGIN;
app.use(cors({ origin: !corsOrigin || corsOrigin === "*" ? "*" : corsOrigin.split(","), exposedHeaders: ["X-Total-Count"] }));
// This is a live business app, not a static site — every response should reflect what's
// actually in the database right now, never a cached copy from a proxy or the phone's browser.
app.use((req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
app.use(express.json({ limit: "5mb" }));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

app.post("/api/upload", requireAuth, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file received." });
  try {
    const baseUrl = `${req.protocol}://${req.get("x-forwarded-host") || req.get("host")}`;
    const result = await storeFile(req.file, baseUrl);
    res.json(result);
  } catch (err) {
    console.error("Upload failed:", err);
    res.status(500).json({ error: "Couldn't store the file." });
  }
});

const WORD_MIMETYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

app.post("/api/upload/print-attachment", requireAuth, requirePrimaryOwner, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file received." });
  try {
    if (req.file.mimetype === WORD_MIMETYPE) {
      const { value: html } = await mammoth.convertToHtml({ buffer: req.file.buffer });
      return res.json({ type: "docx", html });
    }
    if (req.file.mimetype.startsWith("image/")) {
      const baseUrl = `${req.protocol}://${req.get("x-forwarded-host") || req.get("host")}`;
      const result = await storeFile(req.file, baseUrl);
      return res.json({ type: "image", url: result.url });
    }
    res.status(400).json({ error: "Please upload an image or a Word (.docx) file." });
  } catch (err) {
    console.error("Print attachment upload failed:", err);
    res.status(500).json({ error: "Couldn't process that file." });
  }
});

// Serves files stored in the database (the fallback used when cloud storage isn't
// configured) — public and cacheable, since these are exactly the kind of files (logos,
// profile pictures, attachments) that are meant to be viewed by anyone with the link.
app.get("/api/uploads/:id", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT data, mimetype FROM uploaded_files WHERE id = $1", [req.params.id]);
    if (!rows[0]) return res.status(404).send("Not found");
    res.set("Content-Type", rows[0].mimetype || "application/octet-stream");
    res.set("Cache-Control", "public, max-age=31536000, immutable");
    res.send(rows[0].data);
  } catch {
    res.status(404).send("Not found");
  }
});

app.get("/api/health", (req, res) => res.json({ ok: true, time: new Date().toISOString(), cloudStorage: storageConfigured }));

app.use("/api/auth", authRoutes);
app.use("/api/locations", locationRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/services", serviceRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/invoices", invoiceRoutes);
app.use("/api/staff", staffRoutes);
app.use("/api/products", productRoutes);
app.use("/api/expenses", expenseRoutes);
app.use("/api/suppliers", supplierRoutes);
app.use("/api/purchase-orders", purchaseOrderRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/promotions", promotionRoutes);
app.use("/api/cashflow", cashflowRoutes);
app.use("/api/compliance", complianceRoutes);
app.use("/api/printers", printerRoutes);
app.use("/api/business-plan", businessPlanRoutes);
app.use("/api/reminders", reminderRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/custom-fields", customFieldRoutes);
app.use("/api/notification-prefs", notificationPrefRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/po-catalog", poCatalogRoutes);
app.use("/api/attachment-permissions", attachmentPermissionRoutes);
app.use("/api/general-managers", generalManagerRoutes);
app.use("/api/manual-jobs", manualJobRoutes);
app.use("/api/payroll-rates", payrollRateRoutes);
app.use("/api/backup", backupRoutes);
app.use("/api/message-templates", messageTemplateRoutes);
app.use("/api/incoming-payments", incomingPaymentRoutes);
app.use("/api/supplier-payments", supplierPaymentRoutes);
app.use("/api/payment-codes", paymentCodeRoutes);
app.use("/api/app-icon", appIconRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong on the server." });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Wosha API running on http://localhost:${PORT}`));
