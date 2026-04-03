import { randomUUID } from "crypto";
import { db, admin } from "./firebaseService.js";

const COLLECTION_NAME = "payments";

function toMillis(value) {
  if (!value) return 0;
  if (typeof value?.toMillis === "function") return value.toMillis();
  const maybeDate = typeof value?.toDate === "function" ? value.toDate() : value;
  const ms = new Date(maybeDate).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

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

export async function claimStockCheckDispatch(paymentId, fallbackData = {}, claimTtlMs = 15000) {
  const docRef = db.collection(COLLECTION_NAME).doc(paymentId);

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(docRef);

    if (!snapshot.exists) {
      return { claimed: false, reason: "payment_not_found" };
    }

    const payment = snapshot.data() || {};

    if (payment.stockCheckPublished || payment.stockCheckPublishedAt) {
      return { claimed: false, reason: "already_published" };
    }

    const claimedAtMs = toMillis(payment.stockCheckDispatchClaimedAt);
    const hasActiveClaim =
      payment.stockCheckDispatchToken &&
      claimedAtMs &&
      Date.now() - claimedAtMs < claimTtlMs;

    if (hasActiveClaim) {
      return {
        claimed: false,
        reason: "in_progress",
        retryAfterMs: Math.max(0, claimTtlMs - (Date.now() - claimedAtMs)),
      };
    }

    const items =
      Array.isArray(payment.items) && payment.items.length > 0
        ? payment.items
        : (Array.isArray(fallbackData.items) ? fallbackData.items : []);
    const amountTotalRaw =
      payment.amountTotal ?? fallbackData.amountTotal ?? null;
    const amountTotal = Number.isFinite(Number(amountTotalRaw))
      ? Number(amountTotalRaw)
      : null;
    const currency = payment.currency || fallbackData.currency || "sgd";
    const orderId = payment.orderId || fallbackData.orderId || "";
    const userId = payment.userId || fallbackData.userId || "";

    const dispatchToken = randomUUID();
    const updates = {
      stockCheckDispatchToken: dispatchToken,
      stockCheckDispatchClaimedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    if ((!Array.isArray(payment.items) || payment.items.length === 0) && items.length > 0) {
      updates.items = items;
    }
    if (payment.amountTotal == null && amountTotal != null) {
      updates.amountTotal = amountTotal;
    }
    if (!payment.currency && currency) {
      updates.currency = currency;
    }
    if (!payment.orderId && orderId) {
      updates.orderId = orderId;
    }
    if (!payment.userId && userId) {
      updates.userId = userId;
    }

    transaction.set(docRef, updates, { merge: true });

    return {
      claimed: true,
      dispatchToken,
      queuePayload: {
        orderId,
        paymentId,
        userId,
        currency,
        amountTotal,
        items,
      },
    };
  });
}

export async function completeStockCheckDispatch(paymentId, dispatchToken) {
  const docRef = db.collection(COLLECTION_NAME).doc(paymentId);

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(docRef);

    if (!snapshot.exists) {
      return { updated: false, reason: "payment_not_found" };
    }

    const payment = snapshot.data() || {};

    if (payment.stockCheckPublished || payment.stockCheckPublishedAt) {
      return { updated: false, reason: "already_published" };
    }

    if (!dispatchToken || payment.stockCheckDispatchToken !== dispatchToken) {
      return { updated: false, reason: "token_mismatch" };
    }

    transaction.set(docRef, {
      stockCheckPublished: true,
      stockCheckPublishedAt: admin.firestore.FieldValue.serverTimestamp(),
      stockCheckDispatchToken: admin.firestore.FieldValue.delete(),
      stockCheckDispatchClaimedAt: admin.firestore.FieldValue.delete(),
    }, { merge: true });

    return { updated: true };
  });
}

export async function releaseStockCheckDispatch(paymentId, dispatchToken) {
  const docRef = db.collection(COLLECTION_NAME).doc(paymentId);

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(docRef);

    if (!snapshot.exists) {
      return { updated: false, reason: "payment_not_found" };
    }

    const payment = snapshot.data() || {};

    if (!dispatchToken || payment.stockCheckDispatchToken !== dispatchToken) {
      return { updated: false, reason: "token_mismatch" };
    }

    transaction.set(docRef, {
      stockCheckDispatchToken: admin.firestore.FieldValue.delete(),
      stockCheckDispatchClaimedAt: admin.firestore.FieldValue.delete(),
    }, { merge: true });

    return { updated: true };
  });
}
