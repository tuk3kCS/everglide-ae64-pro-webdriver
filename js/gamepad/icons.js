/* Shared artwork for the controller actions supported by the firmware. */
(function (root) {
  "use strict";
  const files = Object.freeze({
    A: "01_button_a.png", B: "02_button_b.png", X: "03_button_x.png", Y: "04_button_y.png",
    START: "05_start.png", BACK: "06_back.png",
    DPAD_UP: "08_dpad_up.png", DPAD_DOWN: "09_dpad_down.png", DPAD_LEFT: "10_dpad_left.png", DPAD_RIGHT: "11_dpad_right.png",
    "LY+": "12_left_stick_up.png", "LY-": "13_left_stick_down.png", "LX-": "14_left_stick_left.png", "LX+": "15_left_stick_right.png", L3: "16_left_stick_press.png",
    "RY+": "17_right_stick_up.png", "RY-": "18_right_stick_down.png", "RX-": "19_right_stick_left.png", "RX+": "20_right_stick_right.png", R3: "21_right_stick_press.png",
    LB: "22_left_bumper.png", LT: "23_left_trigger.png", RB: "24_right_bumper.png", RT: "25_right_trigger.png",
  });
  const escape = (value) => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function html(control) {
    return Object.hasOwn(files, control) ? `<img class="controller-icon" src="assets/controller_icons/${files[control]}" alt="" aria-hidden="true" draggable="false" width="28" height="28">` : escape(control);
  }
  const api = Object.freeze({ files, html });root.AE64ControllerIcons = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
