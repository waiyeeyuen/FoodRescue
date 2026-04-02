import admin from "firebase-admin";
import fs from "fs";
import { config } from "../utils/config.js";

let db;

if (!admin.apps.length) {
  const serviceAccountRaw = fs.readFileSync(config.firebaseServiceAccountPath, "utf8");
  const serviceAccount = JSON.parse(serviceAccountRaw);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

db = admin.firestore();

export { db, admin };