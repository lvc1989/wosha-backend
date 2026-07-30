import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
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
export async function storeFile(file) {
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
  return { url: `/uploads/${safeName}`, name: file.originalname };
}

export const storageConfigured = configured;
