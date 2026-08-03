import express from "express";
import sharp from "sharp";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "../db/pool.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = express.Router();

const SPECS = {
  "icon-192.png": { size: 192, maskable: false },
  "icon-512.png": { size: 512, maskable: false },
  "icon-maskable-192.png": { size: 192, maskable: true },
  "icon-maskable-512.png": { size: 512, maskable: true },
};

async function fetchLogoBytes(logoUrl) {
  if (logoUrl.startsWith("/uploads/")) {
    // Shouldn't normally happen now that uploads return absolute URLs, but handled
    // defensively in case an older record still has a relative path saved.
    const filePath = path.join(__dirname, "..", "..", logoUrl);
    return fs.readFileSync(filePath);
  }
  const res = await fetch(logoUrl);
  if (!res.ok) throw new Error("Couldn't fetch the logo image.");
  return Buffer.from(await res.arrayBuffer());
}

router.get("/:filename", async (req, res) => {
  const spec = SPECS[req.params.filename];
  if (!spec) return res.status(404).json({ error: "Unknown icon size requested." });

  try {
    const { rows } = await pool.query("SELECT logo_url, icon_background_color FROM business_settings WHERE id = 1");
    const settings = rows[0] || {};
    const bg = settings.icon_background_color || "#FFFFFF";

    // The visible logo/mark occupies the full canvas for the regular icon, but is
    // shrunk to Android's recommended ~75% safe zone for the maskable version, so
    // the OS's own circle/squircle crop never cuts off part of the mark.
    const innerSize = spec.maskable ? Math.round(spec.size * 0.72) : spec.size;
    const offset = Math.round((spec.size - innerSize) / 2);

    let markBuffer;
    if (settings.logo_url) {
      try {
        const raw = await fetchLogoBytes(settings.logo_url);
        markBuffer = await sharp(raw).resize(innerSize, innerSize, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
      } catch {
        markBuffer = null; // falls through to the default badge below
      }
    }
    if (!markBuffer) {
      const defaultSvg = path.join(__dirname, "..", "assets", spec.maskable ? "default-icon-maskable.svg" : "default-icon.svg");
      // The default badge already includes its own background, so it's rendered directly
      // at full size rather than composited onto a separate background layer.
      const png = await sharp(defaultSvg).resize(spec.size, spec.size).png().toBuffer();
      res.set("Content-Type", "image/png");
      res.set("Cache-Control", "public, max-age=3600");
      return res.send(png);
    }

    const canvas = sharp({ create: { width: spec.size, height: spec.size, channels: 4, background: bg } });
    const composed = await canvas.composite([{ input: markBuffer, left: offset, top: offset }]).png().toBuffer();
    res.set("Content-Type", "image/png");
    res.set("Cache-Control", "public, max-age=3600");
    res.send(composed);
  } catch (err) {
    console.error("App icon generation failed:", err);
    res.status(500).json({ error: "Couldn't generate the app icon." });
  }
});

export default router;
