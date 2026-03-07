// firebaseAdmin.js
import admin from "firebase-admin";
import { readFile } from "fs/promises";

async function initFirebase() {
  const serviceAccount = JSON.parse(
    await readFile(new URL("./serviceAccountKey.json", import.meta.url))
  );
  
  const adminInstance = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  
  return adminInstance;
}

// Initialize on import
const adminInstance = await initFirebase();

export const db = adminInstance.firestore();
export const messaging = adminInstance.messaging();  // ✅ ADDED THIS
export default adminInstance;
