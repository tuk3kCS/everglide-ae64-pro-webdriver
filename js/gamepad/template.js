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
  <label>
    <button id="connect" class="button quiet" type="button">Connect keyboard</button>
    <button id="matchTravel" class="button quiet" disabled>Refresh travel limits</button>
  </label>
</div>

<section class="usb-device-control" aria-labelledby="usbDeviceTitle">
  <label class="usb-device-label" for="usbDeviceEnabled">
    <span><strong id="usbDeviceTitle">Xbox controller device</strong><small>Show or hide the Xbox device in Windows.</small></span>
    <input data-keyboard-input="allow" id="usbDeviceEnabled" type="checkbox" role="switch" aria-describedby="usbDeviceHint usbDeviceStatus" disabled>
  </label>
  <p id="usbDeviceHint">Changes take effect immediately and briefly reconnect the whole keyboard over USB. This setting lasts until power is disconnected; mappings are retained during this reconnect. Output mode “Gamepad off” only mutes controller input.</p>
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
    <button id="import" class="button quiet">Import</button>
    <button id="export" class="button quiet">Export</button>
    <input data-keyboard-input="allow" id="importFile" type="file" accept="application/json,.json" hidden>
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
        <strong id="selectedAction">Left trigger</strong>
        <small id="selectedHint">Analog travel mapping</small>
      </div>
      <button id="clearBinding" class="text-button">Remove assignment</button>
    </div>
    <div id="controlPicker" class="control-picker" aria-label="Controller action"></div>
  </section>
  <section class="card tuning-card">
    <div class="card-head">
      <div>
        <p class="eyebrow">02 / TUNE</p>
        <h2>Choose your travel window</h2>
        <p id="tuningLead">Below the start is zero. At full output, your trigger reaches 255.</p>
      </div>
      <span id="tuningControl" class="pill">LT</span>
    </div>
    <div id="analogEditor">
      <div class="range-inputs">
        <label>
          <span>START</span>
          <div class="unit-input">
            <input data-keyboard-input="allow" id="startMm" type="number" min="0" max="4" step="0.01" value="0.5">
            <b>mm</b>
          </div>
          <small>Output begins</small>
        </label>
        <label>
          <span>FULL OUTPUT</span>
          <div class="unit-input">
            <input data-keyboard-input="allow" id="endMm" type="number" min="0.01" max="4" step="0.01" value="3.5">
            <b>mm</b>
          </div>
          <small>Maximum controller value</small>
        </label>
        <label>
          <span>SWITCH TRAVEL</span>
          <div class="unit-input">
            <input data-keyboard-input="allow" id="maxTravelMm" type="number" min="0.01" max="10" step="0.01" value="4">
            <b>mm</b>
          </div>
          <small>Match your switch</small>
        </label>
      </div>
      <div class="curve-section">
        <div>
          <span class="eyebrow">RESPONSE CURVE</span>
          <div class="segmented" id="curveSelector">
            <button data-curve="linear" class="active">Linear</button>
            <button data-curve="smooth">Smooth</button>
          </div>
          <p id="curveDescription">A proportional response across your selected travel range.</p>
        </div>
        <figure class="curve-figure">
          <svg id="curveGraph" viewBox="0 0 330 150" role="img" aria-label="Travel to controller output curve">
            <defs>
              <linearGradient id="curveShade" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stop-color="#a6f1ce" stop-opacity=".25"/>
                <stop offset="1" stop-color="#a6f1ce" stop-opacity="0"/>
              </linearGradient>
            </defs>
            <path d="M20 12V130H312 M20 71H312 M166 12V130" class="chart-grid"/>
            <path id="curveArea" fill="url(#curveShade)"/>
            <polyline id="curveLine"/>
            <text x="20" y="146">0 mm</text>
            <text id="curveMax" x="312" y="146" text-anchor="end">4.00 mm</text>
            <text x="312" y="10" text-anchor="end">100%</text>
          </svg>
        </figure>
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

<footer>
  <span>Independent. Local. Yours.</span>
  <p>Save the draft in your browser or export it to a file. No factory website, account or cloud service is required.</p>
  <button id="restoreDefaults" class="text-button">Restore example profile</button>
</footer>
`;
