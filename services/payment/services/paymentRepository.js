import { db, admin } from "./firebaseService.js";

const COLLECTION_NAME = "payments";

export async function createPayment(paymentRecord) {
  await db.collection(COLLECTION_NAME).doc(paymentRecord.paymentId).set(paymentRecord);
  return paymentRecord;
}

export async function getPaymentByIdFromDb(paymentId) {
  const doc = await db.collection(COLLECTION_NAME).doc(paymentId).get();

  if (!doc.exists) {
    return null;
  }

  return doc.data();
}

export async function getPaymentByOrderIdFromDb(orderId) {
  const snapshot = await db
    .collection(COLLECTION_NAME)
    .where("orderId", "==", orderId)
    .get();

  if (snapshot.empty) {
    return null;
  }

  const matches = snapshot.docs
    .map((doc) => doc.data())
    .sort((a, b) => {
      const aTime = new Date(a?.updatedAt?.toDate?.() || a?.updatedAt || a?.createdAt || 0).getTime();
      const bTime = new Date(b?.updatedAt?.toDate?.() || b?.updatedAt || b?.createdAt || 0).getTime();
      return bTime - aTime;
    });

  return matches[0] || null;
}

export async function getAllPaymentsFromDb() {
  const snapshot = await db.collection(COLLECTION_NAME).orderBy("createdAt", "desc").get();
  return snapshot.docs.map((doc) => doc.data());
}

export async function updatePayment(paymentId, updates) {
  await db.collection(COLLECTION_NAME).doc(paymentId).update({
    ...updates,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  return getPaymentByIdFromDb(paymentId);
}

export async function createOrUpdatePayment(paymentId, updates) {
  await db.collection(COLLECTION_NAME).doc(paymentId).set(
    {
      ...updates,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    },
    { merge: true }
  );

  return getPaymentByIdFromDb(paymentId);
}
