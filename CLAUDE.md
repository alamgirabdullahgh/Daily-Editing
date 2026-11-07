# Rules for working on this repo (read first)

These are the owner's standing rules for every app built here. Do not wait to be asked.

1. **In-app update is mandatory.** Every app must check for a newer version by itself on start,
   have a manual "check for update" button, and offer a one-tap update. Version = build number
   stamped by the build workflow; the release notes contain `build: N`.
2. **Android APK** is built by GitHub Actions and published at the `latest` release. Every push to `main` rebuilds it.
3. **Free and light.** Prefer free AI services; keep the app small.
4. **Auto-switch on quota errors.** Multiple API keys and fallback models must be supported.
5. **Bengali UI** for the user-facing text.
6. **Never write the owner's GitHub token into files, commits, logs or remote URLs.**
   Tell the owner to revoke it when the work is done.
