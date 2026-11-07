// Bundled into www/native.js at build time. Gives the web app a way to save/share
// the finished video inside the Android app (blob downloads do not work in a WebView).
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

function blobToBase64(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1]);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
}

window.DailyNative = {
  async save(blob, name) {
    const data = await blobToBase64(blob);
    const f = await Filesystem.writeFile({ path: name, data, directory: Directory.Cache });
    await Share.share({ title: name, url: f.uri, dialogTitle: "ভিডিও সেভ বা শেয়ার করুন" });
  },
};
