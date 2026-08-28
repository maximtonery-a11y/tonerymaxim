(function () {
  "use strict";

  if (window.__TM_PASSWORD_VISIBILITY__) return;
  window.__TM_PASSWORD_VISIBILITY__ = true;

  document.addEventListener("click", function (event) {
    var button = event.target.closest("[data-password-toggle]");
    if (!button) return;

    var inputId = button.getAttribute("aria-controls");
    var input = inputId ? document.getElementById(inputId) : null;
    if (!input || (input.type !== "password" && input.type !== "text")) return;

    var show = input.type === "password";
    input.type = show ? "text" : "password";
    button.setAttribute("aria-pressed", show ? "true" : "false");
    button.setAttribute("aria-label", show ? "Skryť heslo" : "Zobraziť heslo");

    var label = button.querySelector("b");
    if (label) label.textContent = show ? "Skryť" : "Zobraziť";
  });
})();
