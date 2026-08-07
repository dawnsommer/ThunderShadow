# ThunderShadow Firebase setup

ThunderShadow v10 uses **Firebase Authentication + Cloud Firestore** for optional cloud synchronization. IndexedDB remains the local source of truth.

## 1. Register the Web app

Firebase Console → Project settings → Your apps → **Add app → Web**.

Name it `ThunderShadow Web`. Firebase Hosting is not required; the app stays on GitHub Pages.

Copy the `firebaseConfig` object into `js/config.js`.

Keep your existing Google OAuth Web Client ID in `googleClientId`. ThunderShadow uses it only as the first-sign-in fallback for iPhone/iPad Home-Screen PWA mode.

## 2. Enable Google Authentication

Firebase Console → Authentication → Get started → Sign-in method → **Google** → Enable.

Set a project support email and Save.

Authentication → Settings → Authorized domains: ensure `dawnsommer.github.io` is present.

## 3. Create Cloud Firestore

Firebase Console → Firestore Database → Create database.

Choose a production location appropriate for you. Start in **Production mode**.

Then open the Firestore **Rules** tab and replace the rules with the contents of `firestore.rules`, then Publish.

The rule allows each signed-in user to access only:

`/users/{their Firebase uid}/...`

and blocks access to other users' data.

## 4. Existing Google OAuth client

For the iOS/iPadOS Home-Screen first-sign-in fallback, keep the existing OAuth Web Client configured with:

- Authorized JavaScript origin: `https://dawnsommer.github.io`
- Authorized redirect URI: `https://dawnsommer.github.io/ThunderShadow/`

No Google Drive scope is requested anymore.

## 5. First migration from Drive edition

Before replacing the old release, open the working ThunderShadow on your Mac and make sure its IndexedDB contains the current data (you can also export JSON as a safety backup).

Deploy Firebase v10. On the Mac, sign in with Google and press **Sync now** once. This seeds Firestore from the existing local IndexedDB.

Then open the new build on iPhone/iPad, sign in with the same Google account, and sync. The Firebase copy will populate that device's IndexedDB.

Do not clear the Mac IndexedDB until this first Firebase sync is verified.

## 6. Expected behavior

- Local saves always go to IndexedDB first.
- Firebase sync is debounced after local mutations.
- Closing and reopening the browser/PWA should preserve Firebase Authentication state until explicit Sign out or site-data clearing.
- If Firebase/network is unavailable, ThunderShadow continues locally.
- Signing out affects only that browser/PWA session; it does not erase cloud data.
