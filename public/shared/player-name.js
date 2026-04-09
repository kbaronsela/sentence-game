(function () {
  var KEY = "sentenceGamesPlayerName";

  function load() {
    try {
      return localStorage.getItem(KEY) || "";
    } catch (e) {
      return "";
    }
  }

  function persist(raw) {
    var t = String(raw || "").trim();
    try {
      if (t) {
        localStorage.setItem(KEY, t);
      } else {
        localStorage.removeItem(KEY);
      }
    } catch (e) {}
  }

  function init() {
    var el = document.getElementById("input-name");
    if (!el) return;

    var saved = load();
    if (saved && !String(el.value || "").trim()) {
      el.value = saved;
    }

    el.addEventListener("input", function () {
      persist(el.value);
    });
    el.addEventListener("blur", function () {
      persist(el.value);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
