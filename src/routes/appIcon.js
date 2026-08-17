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

    // The maskable version stays at Android's recommended ~72% safe zone so the OS's own
    // circle/squircle crop never cuts off part of the mark. The regular icon uses a small,
    // deliberate margin (~92% of the canvas) — visible but modest — rather than either the
    // logo's own uncontrolled margin (if its source image already has padding baked in) or
    // a full edge-to-edge fill with no margin at all.
    const innerSize = spec.maskable ? Math.round(spec.size * 0.72) : Math.round(spec.size * 0.92);
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
      // Short, not absent — a changed logo should show up within about a minute
      // for anyone freshly loading the app, not sit stale for up to an hour (the
      // old setting). Still long enough to avoid regenerating the image on every
      // single request when the logo hasn't changed.
      res.set("Cache-Control", "public, max-age=60");
      return res.send(png);
    }

    const canvas = sharp({ create: { width: spec.size, height: spec.size, channels: 4, background: bg } });
    let composed = await canvas.composite([{ input: markBuffer, left: offset, top: offset }]).png().toBuffer();

    if (!spec.maskable) {
      // ~22% corner radius matches the soft, rounded-square look of modern app icons
      // (iOS/Android/desktop), rather than a hard-edged square that only looks right
      // once an OS applies its own mask on top.
      const radius = Math.round(spec.size * 0.22);
      const roundedMask = Buffer.from(
        `<svg width="${spec.size}" height="${spec.size}"><rect width="${spec.size}" height="${spec.size}" rx="${radius}" ry="${radius}"/></svg>`
      );
      composed = await sharp(composed).composite([{ input: roundedMask, blend: "dest-in" }]).png().toBuffer();
    }

    res.set("Content-Type", "image/png");
    res.set("Cache-Control", "public, max-age=60");
    res.send(composed);
  } catch (err) {
    console.error("App icon generation failed:", err);
    res.status(500).json({ error: "Couldn't generate the app icon." });
  }
});

export default router;
