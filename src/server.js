import express from "express";
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
import { requireAuth } from "./middleware/auth.js";
import { storeFile, storageConfigured } from "./utils/storage.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

const app = express();
const corsOrigin = process.env.CORS_ORIGIN;
app.use(cors({ origin: !corsOrigin || corsOrigin === "*" ? "*" : corsOrigin.split(","), exposedHeaders: ["X-Total-Count"] }));
app.use(express.json({ limit: "5mb" }));

// Static file serving — only used as a fallback when real cloud storage isn't configured (see .env.example)
app.use("/uploads", express.static(uploadsDir));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

app.post("/api/upload", requireAuth, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file received." });
  try {
    const result = await storeFile(req.file);
    res.json(result);
  } catch (err) {
    console.error("Upload failed:", err);
    res.status(500).json({ error: "Couldn't store the file." });
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

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong on the server." });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Wosha API running on http://localhost:${PORT}`));
