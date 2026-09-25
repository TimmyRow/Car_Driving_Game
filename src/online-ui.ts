export const onlineMarkup = `
<section id="online-modal" class="layer modal-backdrop hidden" aria-label="Online race">
 <div class="panel online-panel">
  <div class="picker-heading"><div><div class="eyebrow">You. A friend. The open road.</div><h2>ONLINE RACE.</h2></div><button class="close-button" id="online-close" aria-label="Close online race">×</button></div>
  <p id="online-message" class="online-message" role="status" aria-live="polite">Race a friend live. Create a private room or join their six-character code.</p>
  <div id="online-entry">
   <label class="online-label" for="online-name">DRIVER NAME</label><input id="online-name" class="online-input" maxlength="18" minlength="2" autocomplete="nickname" placeholder="Your racing name">
   <div class="online-create-grid"><label class="online-label">ROUTE<select id="online-route" class="online-input"><option value="riviera">Riviera Run</option><option value="canyon">Ember Canyon</option><option value="alpine">Aster Ridge</option></select></label><label class="online-label">LAPS<select id="online-laps" class="online-input"><option value="1">1 lap</option><option value="2">2 laps</option></select></label></div>
   <button id="online-create" class="race-button"><span>CREATE ROOM</span><span>↗</span></button>
   <div class="online-divider">OR JOIN A FRIEND</div>
   <label class="online-label" for="online-code">ROOM CODE</label><div class="online-join-row"><input id="online-code" class="online-input" maxlength="6" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="ABC234"><button id="online-join" class="secondary-button">JOIN ROOM ↗</button></div>
  </div>
  <div id="online-room" hidden>
   <div class="online-room-code"><div><span class="online-label">PRIVATE ROOM</span><strong id="room-code"></strong></div><button class="secondary-button" id="room-copy">COPY CODE</button></div>
   <div class="online-route-summary" id="room-route"></div>
   <div class="online-drivers"><div><span class="driver-dot" id="room-host-color"></span><strong id="room-host-name"></strong><small>HOST</small></div><div><span class="driver-dot" id="room-guest-color"></span><strong id="room-guest-name">Waiting for a friend…</strong><small id="room-guest-ready"></small></div></div>
   <p id="room-status" class="online-message" role="status"></p>
   <button class="race-button" id="room-start"><span>START RACE</span><span>↗</span></button>
   <button class="race-button" id="room-ready"><span>I’M READY</span><span>↗</span></button>
   <button class="secondary-button" id="room-leave">LEAVE ROOM</button>
  </div>
  <p class="online-footnote">2 live drivers · shared collisions · all three routes<br>Keep the host’s game open. An online race keeps running when its menu is open.</p>
 </div>
</section>`;
