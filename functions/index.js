const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

/**
 * SUPERSONIC CLEANUP: Server-Side Scheduled Task
 * Runs every 60 minutes.
 * Checks for files where expiry date < now.
 * Deletes them from Firestore Permently.
 */
exports.cleanupExpiredFiles = functions.pubsub.schedule('every 60 minutes').onRun(async (context) => {
    const now = admin.firestore.Timestamp.now();

    console.log("Running Supersonic Cleanup at:", new Date().toISOString());

    try {
        const snapshot = await admin.firestore().collection('fileMetadata')
            .where('expiry', '<', now)
            .get();

        if (snapshot.empty) {
            console.log('No expired files found.');
            return null;
        }

        const batch = admin.firestore().batch();
        let count = 0;

        snapshot.docs.forEach((doc) => {
            batch.delete(doc.ref);
            count++;
        });

        await batch.commit();
        console.log(`Supersonic Cleanup: Deleted ${count} expired file(s).`);
        return null;

    } catch (error) {
        console.error('Supersonic Cleanup Failed:', error);
        return null;
    }
});

/**
 * OPTIONAL: Transaction-based Download Counter to enforce limits strictly.
 * This can be called via Callable Function if we want to move logic server-side entirely,
 * but for now, the scheduled cleanup is the critical safety net.
 */
