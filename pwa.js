// Installable app: registers the service worker (sw.js), shows an Install app button when the browser offers
// installation (or install steps on iPhone/iPad, where Safari has no prompt), shows an Offline badge, and opens
// the page a notification points to when it's tapped.

let pwaInstallPrompt = null;

function pwaIsStandalone() {
  return window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function pwaIsIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function pwaShowInstallSteps() {
  const dialog = document.getElementById("install-dialog");
  if (!dialog) return;
  dialog.querySelector(".install-ios").hidden = !pwaIsIos();
  dialog.querySelector(".install-other").hidden = pwaIsIos();
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

function pwaSetupInstallButton() {
  const button = document.getElementById("app-install");
  if (!button) return;
  // Safari on iPhone/iPad never fires beforeinstallprompt, so offer the steps there instead.
  button.hidden = pwaIsStandalone() || !pwaIsIos();
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    pwaInstallPrompt = event;
    button.hidden = pwaIsStandalone();
  });
  window.addEventListener("appinstalled", () => {
    pwaInstallPrompt = null;
    button.hidden = true;
  });
  button.addEventListener("click", async () => {
    if (!pwaInstallPrompt) {
      pwaShowInstallSteps();
      return;
    }
    pwaInstallPrompt.prompt();
    const choice = await pwaInstallPrompt.userChoice.catch(() => null);
    if (choice?.outcome === "accepted") button.hidden = true;
    pwaInstallPrompt = null;
  });
}

function pwaSetupOfflineBadge() {
  const pill = document.getElementById("offline-pill");
  if (!pill) return;
  const update = () => { pill.hidden = navigator.onLine !== false; };
  window.addEventListener("online", update);
  window.addEventListener("offline", update);
  update();
}

function pwaRegister() {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
  navigator.serviceWorker.register("sw.js").catch((error) => console.warn("Offline support is unavailable.", error));
  navigator.serviceWorker.addEventListener("message", (event) => {
    const href = event.data?.type === "open" ? String(event.data.href || "") : "";
    if (href.startsWith("#")) location.hash = href;
  });
}

pwaSetupInstallButton();
pwaSetupOfflineBadge();
if (document.readyState === "complete") pwaRegister();
else window.addEventListener("load", pwaRegister, { once: true });
