import admin from "firebase-admin";
import { readFile } from "fs/promises";
import { FieldValue } from "firebase-admin/firestore";

const serviceAccount = JSON.parse(
  await readFile(new URL("./serviceAccountKey.json", import.meta.url))
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

export const db = admin.firestore();
export const messaging = admin.messaging();
export { FieldValue };
export default admin;
