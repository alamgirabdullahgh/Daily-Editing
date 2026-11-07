# Daily Edit

A lightweight, free, AI-first editing studio. Small in size, powerful in results.

## Phase 1: Chat to complete video (`app/`)
Type a request such as "make a video of a deer's story". The app then does everything in one go:

1. **Script**: Gemini writes the title, scenes, narration and image prompts.
2. **Voice**: Gemini TTS (AI Studio audio) makes the narration for each scene.
3. **Images**: Nano Banana (Gemini image model) makes one image per scene in a consistent style.
4. **Video**: images (slow zoom) + voice + subtitles are combined in the browser and exported as a downloadable file.

No server and no install. Everything except the Gemini API calls runs on your device.

### Run
Open `app/index.html` in Chrome, or host the `app/` folder on GitHub Pages. Tap the gear icon and paste your Gemini API key (from Google AI Studio). The key stays in your browser's localStorage.

### Android APK
Every push to `main` builds `Daily-Edit.apk` with GitHub Actions (Capacitor, debug-signed) and publishes it at
`https://github.com/alamgirabdullahgh/Daily-Editing/releases/latest`. Open that page on your phone, download the APK and install it (allow "install unknown apps" for your browser when asked).
In the app, the finished video is saved/shared through the Android share sheet.

### Notes
- Model names are editable in settings, because Google renames models often.
- Recording happens in real time: a 60-second video takes about 60 seconds to assemble. Keep the tab open.
- Google Vids and YouTube Shorts creation have no public API, so Phase 1 assembles the video itself. Veo (Gemini video model) can be added later for animated clips.

## Roadmap
- Background removal (offline, on-device)
- Veo clips as an optional scene type
- Posts and captions with Gemini
- Offline AI models
