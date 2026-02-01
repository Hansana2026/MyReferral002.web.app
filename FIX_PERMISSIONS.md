# 🚨 CRITICAL FIX: Database Permissions

Your messages are **blocked by the cloud** because the security rules are in "Private" or "Locked" mode. You must switch them to "Public" so the website can save data.

## How to Fix (Takes 20 seconds)

1.  Go to the [Firebase Console](https://console.firebase.google.com/).
2.  Open your project **myreferral002**.
3.  In the left sidebar, click **Build** -> **Firestore Database**.
4.  At the top tabs, click **Rules**.
5.  **Delete** the current code and **Paste** this exact code:

```text
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```

6.  Click **Publish**.

## Why did this happen?
When you created the database, if you didn't select "Test Mode", Firebase blocks all writes by default to prevent hackers. Since this is a public referral board, you need `allow read, write: if true;` so your users can post.
