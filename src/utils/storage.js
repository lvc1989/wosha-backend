import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, "..", "..", "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

const BUCKET = process.env.S3_BUCKET;
const REGION = process.env.S3_REGION || "auto";
const ENDPOINT = process.env.S3_ENDPOINT; // set this for Cloudflare R2; leave unset for real AWS S3
const ACCESS_KEY = process.env.S3_ACCESS_KEY_ID;
const SECRET_KEY = process.env.S3_SECRET_ACCESS_KEY;
const PUBLIC_URL_BASE = process.env.S3_PUBLIC_URL_BASE; // e.g. your R2 public bucket URL or CloudFront domain

const configured = !!(BUCKET && ACCESS_KEY && SECRET_KEY);

const client = configured
  ? new S3Client({
      region: REGION,
      ...(ENDPOINT ? { endpoint: ENDPOINT } : {}),
      credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
    })
  : null;

// file: { buffer, originalname, mimetype }  — returns { url, name }
// baseUrl: the backend's own actual public address (e.g. https://wosha-api-xxxx.onrender.com),
// needed so the local-disk fallback below returns a URL that works from the frontend's
// domain too — a bare "/uploads/x.jpg" only resolves correctly when both are on the same
// address, which they aren't once this is really deployed (frontend on Vercel, backend on
// Render). Without this, every uploaded photo/logo/attachment shows as "attached" but the
// image itself 404s, because the browser tries to load it from the frontend's own domain.
export async function storeFile(file, baseUrl) {
  const safeName = Date.now() + "-" + file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, "");

  if (configured) {
    await client.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: safeName,
      Body: file.buffer,
      ContentType: file.mimetype,
    }));
    const url = PUBLIC_URL_BASE ? `${PUBLIC_URL_BASE}/${safeName}` : `${ENDPOINT}/${BUCKET}/${safeName}`;
    return { url, name: file.originalname };
  }

  // Fallback: save to local disk. Fine for local development; on most cloud hosts
  // (e.g. Render's free tier) this disk is wiped on every restart/redeploy, so set
  // the S3_* variables in .env before relying on this for real use.
  fs.writeFileSync(path.join(uploadsDir, safeName), file.buffer);
  return { url: `${baseUrl}/uploads/${safeName}`, name: file.originalname };
}

export const storageConfigured = configured;

// Deletes the underlying file to reclaim storage — used once an attachment has been
// downloaded and confirmed saved elsewhere, so it doesn't sit taking up space forever.
export async function deleteFile(url) {
  if (!url) return;
  const key = url.split("/").pop();
  if (configured) {
    try {
      await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
    } catch (err) {
      console.error("Couldn't delete file from cloud storage:", err.message);
    }
  } else if (url.startsWith("/uploads/")) {
    const filePath = path.join(uploadsDir, key);
    fs.existsSync(filePath) && fs.unlinkSync(filePath);
  }
}
