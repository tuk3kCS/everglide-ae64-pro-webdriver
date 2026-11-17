/* Hardware controller assignment workspace. Edit the HTML layout below. */
window.AE64GamepadTemplate = `
<div class="gp-device-bar">
<div>
  <span id="deviceStatus">Uses the shared keyboard connection</span>
  <div id="compatibility" class="compatibility" role="status">
    <span class="compat-icon">○</span>
    <div>
        <strong>Ready to design your profile</strong>
        <p>Connect to read the keyboard profile and switch travel limits automatically.</p>
    </div>
  </div>
</div>
  <button id="connect" class="button quiet" type="button">Connect keyboard</button>
</div>

<section class="usb-device-control" aria-labelledby="usbDeviceTitle">
  <label class="usb-device-label" for="usbDeviceEnabled">
    <span><strong id="usbDeviceTitle">Xbox controller device</strong><small>Show or hide the Xbox device in Windows.</small></span>
    <input data-keyboard-input="allow" id="usbDeviceEnabled" type="checkbox" role="switch" aria-describedby="usbDeviceHint usbDeviceStatus" disabled>
  </label>
  <p id="usbDeviceHint">Changing this briefly reconnects the whole keyboard over USB. Firmware v0.8.1 saves this choice across power loss. Output mode “Gamepad off” mutes controller input.</p>
  <p id="usbDeviceStatus" role="status">Connect compatible custom firmware to change Xbox device visibility.</p>
</section>

<section class="profilebar" aria-label="Profile settings">
  <label class="profile-name">
    <span>LOCAL PROFILE</span>
    <input data-keyboard-input="allow" id="profileName" maxlength="64" value="Analog essentials" aria-label="Profile name">
  </label>
  <label>
    <span>KEYBOARD OUTPUT</span>
    <select data-keyboard-input="allow" id="outputMode">
      <option value="controller">Controller assignments only</option>
      <option value="mixed">Keyboard + controller</option>
      <option value="off">Gamepad off</option>
    </select>
  </label>
  <label>
    <span>CONTROLLER TYPE</span>
    <select data-keyboard-input="allow" id="transportMode">
      <option value="xinput">Xbox / XInput</option>
      <option value="hid">USB HID gamepad</option>
    </select>
  </label>
  <div class="profile-actions">
    <button id="apply" class="button primary" disabled>Apply to keyboard <span>↗</span></button>
  </div>
</section>

<div class="keyboard-travel-tools" style="display: none;">
  <p id="travelSyncStatus" role="status">Profile and travel limits are read automatically after connecting.</p>
  <p id="deviceTravel" role="status">Connect the keyboard to read its switch range.</p>
</div>

<div class="workspace-grid">
  <section class="card mapping-card">
    <div class="card-head">
      <div>
        <p class="eyebrow">01 / ASSIGN</p>
        <h2>A place for every control</h2>
        <p>Select a keyboard key, then choose its controller action.</p>
      </div>
      <span id="mappedCount" class="pill">0 assigned</span>
    </div>
    <div class="keyboard-wrap">
      <div id="keyboard" class="keyboard" aria-label="Physical AE64 Pro keyboard"></div>
    </div>
    <div class="keyboard-legend">
      <span><i class="legend-bound"></i>Assigned</span>
      <span><i class="legend-selected"></i>Selected</span>
      <small>Assignments refer to physical keys, independent of keyboard remaps.</small>
    </div>
    <div class="assignment-head">
      <span id="selectedKeyName">Q</span>
      <div>
        <strong id="selectedAction">Choose a controller action</strong>
        <small id="selectedHint">Choose a control below to assign it to Q.</small>
      </div>
      <button id="clearBinding" class="remove-assignment" type="button">Remove assignment</button>
    </div>
    <div id="controlPicker" class="control-picker" aria-label="Controller action"></div>
  </section>
  <section class="card tuning-card">
    <div class="card-head">
      <div>
        <p class="eyebrow">02 / TUNE</p>
        <h2>Choose your travel window</h2>
        <p id="tuningLead">Select an assigned key or choose a controller action to edit its travel window.</p>
      </div>
      <span id="tuningControl" class="pill">—</span>
    </div>
    <div id="analogEditor" hidden>
      <div class="range-inputs">
        <label>
          <span>START</span>
          <div class="unit-input">
            <input data-keyboard-input="allow" id="startMm" type="number" min="0" max="4" step="0.001" value="0.500">
            <b>mm</b>
          </div>
          <small>Start of the curve’s travel window</small>
        </label>
        <label>
          <span>END</span>
          <div class="unit-input">
            <input data-keyboard-input="allow" id="endMm" type="number" min="0.001" max="4" step="0.001" value="3.500">
            <b>mm</b>
          </div>
          <small>End of the curve’s travel window</small>
        </label>
        <label>
          <span>SWITCH TRAVEL</span>
          <div class="unit-input">
            <input data-keyboard-input="allow" id="maxTravelMm" type="number" min="0.01" max="10" step="0.001" value="4.000">
            <b>mm</b>
          </div>
          <small>Match your switch</small>
        </label>
      </div>
      <div class="curve-section">
        <div class="curve-header"><h3>Analog curve</h3><span id="curveDescription"></span></div>
        <figure class="curve-figure">
          <svg id="curveGraph" viewBox="0 0 336 176" role="group" aria-label="Key travel in millimeters versus controller output from 0 to 255">
            <defs>
              <linearGradient id="curveShade" x2="0%" y2="100%">
                <stop offset="0" stop-opacity=".28"/>
                <stop offset="1" stop-opacity=".04"/>
              </linearGradient>
            </defs>
            <path d="M33 15H312V145H33Z M33 47.5H312 M33 80H312 M33 112.5H312 M102.75 15V145 M172.5 15V145 M242.25 15V145" class="chart-grid"/>
            <path id="curveArea" fill="url(#curveShade)"/>
            <polyline id="curveLine"/>
            <circle data-keyboard-input="allow" data-curve-point="0" tabindex="0" role="button" r="5"><title></title></circle>
            <circle data-keyboard-input="allow" data-curve-point="1" tabindex="0" role="button" r="5"><title></title></circle>
            <circle data-keyboard-input="allow" data-curve-point="2" tabindex="0" role="button" r="5"><title></title></circle>
            <circle data-keyboard-input="allow" data-curve-point="3" tabindex="0" role="button" r="5"><title></title></circle>
            <text x="25" y="18" text-anchor="end">255</text>
            <text x="25" y="83" text-anchor="end">128</text>
            <text x="25" y="148" text-anchor="end">0</text>
            <text id="curveMin" x="33" y="159"></text>
            <text id="curveMax" x="312" y="159" text-anchor="end"></text>
            <text x="172.5" y="172" text-anchor="middle">Key travel</text>
          </svg>
        </figure>
        <div class="curve-point-fields">
          <label>Point<select id="curvePoint" data-keyboard-input="allow"><option value="0">1</option><option value="1">2</option><option value="2">3</option><option value="3">4</option></select></label>
          <label>Travel (mm)<input id="curvePointTravel" type="number" inputmode="decimal" min="0" max="10" step="0.001" title="Snaps to the nearest supported position" data-keyboard-input="allow"></label>
          <label>Output (0–255)<input id="curvePointOutput" type="number" inputmode="numeric" min="0" max="255" step="1" data-keyboard-input="allow"></label>
        </div>
        <div class="curve-preset-header">Curve presets</div>
        <div class="curve-presets" id="curveSelector" role="group" aria-label="Curve presets"></div>
      </div>
    </div>
    <div id="digitalEditor" class="digital-inheritance" hidden>
      <span>◎</span>
      <div>
        <h3>The same press you already know</h3>
        <p>Digital controller buttons follow this key’s normal actuation and Rapid Trigger state. Configure those settings in the keyboard driver; there is no separate gamepad threshold.</p>
        <a href="#performance" data-gamepad-performance>Open keyboard settings →</a>
      </div>
    </div>
    <p id="editorError" class="inline-error" role="alert"></p>
  </section>
  <section class="card behavior-card">
    <div class="card-head">
      <div>
        <p class="eyebrow">03 / BALANCE</p>
        <h2>Make the sticks yours</h2>
        <p>Choose how opposing directions and diagonals behave.</p>
      </div>
    </div>
    <div id="stickSettings" class="stick-settings"></div>
  </section>
</div>

`;
