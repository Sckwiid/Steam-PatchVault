(function initSteamCommandModule(global) {
  "use strict";

  var App = global.SteamPatchArchive = global.SteamPatchArchive || {};

  function sanitizeId(value) {
    return String(value || "").replace(/[^0-9]/g, "");
  }

  function buildDownloadCommand(appId, depotId, manifestId) {
    var safeApp = sanitizeId(appId);
    var safeDepot = sanitizeId(depotId);
    var safeManifest = sanitizeId(manifestId);
    return ["download_depot", safeApp, safeDepot, safeManifest].join(" ").trim();
  }

  function fallbackCopy(text) {
    try {
      var textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "readonly");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      textarea.style.pointerEvents = "none";
      document.body.appendChild(textarea);
      textarea.select();
      textarea.setSelectionRange(0, textarea.value.length);
      var copied = document.execCommand("copy");
      document.body.removeChild(textarea);
      return copied;
    } catch (error) {
      return false;
    }
  }

  async function copyText(text) {
    var value = String(text || "");
    if (!value) {
      return { ok: false, method: "none", reason: "empty" };
    }

    if (global.isSecureContext && navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(value);
        return { ok: true, method: "clipboard" };
      } catch (error) {
        var fallbackOk = fallbackCopy(value);
        return {
          ok: fallbackOk,
          method: fallbackOk ? "execCommand" : "none",
          reason: fallbackOk ? "clipboard_blocked_fallback_used" : "clipboard_blocked"
        };
      }
    }

    var copied = fallbackCopy(value);
    return {
      ok: copied,
      method: copied ? "execCommand" : "none",
      reason: copied ? "insecure_context_fallback_used" : "insecure_context"
    };
  }

  function openSteamConsole() {
    try {
      global.location.href = "steam://open/console";
      return true;
    } catch (error) {
      return false;
    }
  }

  async function copyAndOpenSteamConsole(command) {
    var copyResult = await copyText(command);
    var opened = openSteamConsole();

    return {
      copied: copyResult.ok,
      copyMethod: copyResult.method,
      copyReason: copyResult.reason || "",
      opened: opened,
      instruction: "Colle la commande avec Ctrl+V puis appuie sur Entree."
    };
  }

  function getSteamConsoleFallbackTips() {
    return [
      "Si Steam ne s'ouvre pas automatiquement, lance Steam puis ouvre steam://open/console depuis Exécuter (Windows + R).",
      "Alternative: ajoute -console dans les options de lancement de Steam.",
      "Certaines anciennes versions peuvent nécessiter plusieurs commandes download_depot."
    ];
  }

  App.steamCommands = {
    buildDownloadCommand: buildDownloadCommand,
    copyText: copyText,
    openSteamConsole: openSteamConsole,
    copyAndOpenSteamConsole: copyAndOpenSteamConsole,
    getSteamConsoleFallbackTips: getSteamConsoleFallbackTips
  };
})(window);
