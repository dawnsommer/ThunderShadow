// ThunderShadow public cloud configuration.
// The Cloudflare Worker owns Google OAuth refresh tokens. No Google client secret,
// refresh token, or Worker secret is stored in this static GitHub Pages app.
window.THUNDERSHADOW_CONFIG = Object.freeze({
  cloud: Object.freeze({
    appId: "thundershadow",
    workerUrl: "https://study-tools-auth-worker.summerofdawn20.workers.dev",
    returnUrl: "https://dawnsommer.github.io/ThunderShadow/",
    driveScope: "https://www.googleapis.com/auth/drive.appdata"
  })
});
