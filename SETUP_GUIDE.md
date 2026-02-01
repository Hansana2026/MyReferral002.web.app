# Firebase Setup Guide for Community Board

To make the "Community Board" work so **everyone** can see messages forever, you need to connect a free database.

## Step 1: Create a Project
1. Go to [firebase.google.com](https://firebase.google.com/) and log in with your Google account.
2. Click **Go to Console**.
3. Click **Add project**.
4. Name it (e.g., `referral-board`) and click **Continue**.
5. Disable Google Analytics (setup is faster without it) and click **Create project**.

## Step 2: Create the Database
1. In your new project dashboard, click **Build** -> **Firestore Database** in the sidebar.
2. Click **Create database**.
3. Choose a location (e.g., `nam5 (us-central)`).
4. **IMPORTANT**: Choose **Start in test mode** (this allows read/writes for 30 days, easiest for testing).
   * *Later for production, you can change rules, but Test Mode works immediately.*
5. Click **Create**.

## Step 3: Get Your Keys
1. Click the **Settings Gear** icon (top left next to Project Overview) -> **Project settings**.
2. Scroll down to the "Your apps" section.
3. Click the **</>** icon (Web).
4. Name nickname `web-app` and click **Register app**.
5. You will see a strict called `const firebaseConfig = { ... }`.
6. **COPY** the content inside the curly braces `{ ... }`.

## Step 4: Paste into Code
1. Open your project folder.
2. Go to `public/script.js`.
3. Find the `firebaseConfig` section at the top.
4. Replace the placeholder values with your real keys.

```javascript
// public/script.js

const firebaseConfig = {
    apiKey: "AIzaSyD...",            // <--- PASTE YOURS HERE
    authDomain: "...",
    projectId: "...",
    storageBucket: "...",
    messagingSenderId: "...",
    appId: "..."
};
```

## Step 5: Verify
1. Reload your webpage.
2. Post a message.
3. Reload again -> **The message should stay!**
4. Open the link on a phone -> **You should see the message there too!**
