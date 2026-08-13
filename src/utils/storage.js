import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { pool } from "../db/pool.js";

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
// needed so the database-backed fallback below returns a URL that works from the frontend's
// domain too — a bare relative path only resolves correctly when both are on the same
// address, which they aren't once this is really deployed (frontend on Vercel, backend on
// Render).
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

  // Fallback: store the file's actual bytes in Postgres rather than the backend's own
  // disk. The backend's disk is wiped on every redeploy/restart on most hosts (that's
  // exactly what was causing uploaded logos and profile pictures to vanish); Postgres
  // is a separate, persistent service, so this survives redeploys with no extra setup.
  const { rows } = await pool.query(
    "INSERT INTO uploaded_files (data, mimetype, original_name) VALUES ($1,$2,$3) RETURNING id",
    [file.buffer, file.mimetype, file.originalname]
  );
  return { url: `${baseUrl}/api/uploads/${rows[0].id}`, name: file.originalname };
}

export const storageConfigured = configured;

// Deletes the underlying file to reclaim storage — used once an attachment has been
// downloaded and confirmed saved elsewhere, so it doesn't sit taking up space forever.
export async function deleteFile(url) {
  if (!url) return;
  if (configured) {
    const key = url.split("/").pop();
    try {
      await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
    } catch (err) {
      console.error("Couldn't delete file from cloud storage:", err.message);
    }
  } else if (url.includes("/api/uploads/")) {
    const id = url.split("/api/uploads/").pop();
    await pool.query("DELETE FROM uploaded_files WHERE id = $1", [id]).catch(() => {});
  }
}
