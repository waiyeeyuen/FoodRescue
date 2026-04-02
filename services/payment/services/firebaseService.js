import admin from "firebase-admin";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "../utils/config.js";

let db;

if (!admin.apps.length) {
  if (!config.firebaseServiceAccountPath) {
    throw new Error(
      "[payment/firebase] Missing FIREBASE_SERVICE_ACCOUNT_PATH (see services/payment/.env)"
    );
  }

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const paymentRoot = path.resolve(__dirname, "..");

  const serviceAccountPath = path.isAbsolute(config.firebaseServiceAccountPath)
    ? config.firebaseServiceAccountPath
    : path.resolve(paymentRoot, config.firebaseServiceAccountPath);

  const serviceAccountRaw = fs.readFileSync(serviceAccountPath, "utf8");
  const serviceAccount = JSON.parse(serviceAccountRaw);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

db = admin.firestore();

export { db, admin };
