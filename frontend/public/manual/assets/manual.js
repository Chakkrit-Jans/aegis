// Bilingual toggle shared by every manual page. Default = Thai; remembers choice.
(function () {
  var KEY = "aegis_manual_lang";
  function apply(lang) {
    document.documentElement.classList.toggle("lang-en", lang === "en");
    document.querySelectorAll(".langbar button").forEach(function (b) {
      b.classList.toggle("on", b.getAttribute("data-lang") === lang);
    });
  }
  var saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) {}
  apply(saved === "en" ? "en" : "th");
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest(".langbar button");
    if (!b) return;
    var lang = b.getAttribute("data-lang");
    try { localStorage.setItem(KEY, lang); } catch (e) {}
    apply(lang);
  });
})();
