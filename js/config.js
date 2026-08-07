// ThunderShadow public Firebase release configuration.
// Firebase Web App config values are public client identifiers, not secrets.
// Paste the exact firebaseConfig object from Firebase Console > Project settings > Your apps > Web app.
window.THUNDERSHADOW_CONFIG = Object.freeze({
  firebase: Object.freeze({
    apiKey: "AIzaSyDGqTjeeVadOW-gNvDC2rkiv5k2RV5VE4w",
    authDomain: "thundershadow.firebaseapp.com",
    projectId: "thundershadow",
    storageBucket: "thundershadow.firebasestorage.app",
    messagingSenderId: "1049349983676",
    appId: "1:1049349983676:web:0b8a46b27594385fc06fb9"
  }),

  // Keep the existing ThunderShadow Google OAuth Web Client ID here.
  // It is used only as an iOS/iPadOS Home-Screen PWA fallback for the FIRST Google sign-in.
  // After Firebase Auth signs in, Firebase persists the session across app closes.
  googleClientId: "1049349983676-rir4nhol0ojjgvrqphom4dd0o713l0un.apps.googleusercontent.com"
});
