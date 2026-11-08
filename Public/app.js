const $ = id => document.getElementById(id);
const joinPanel = $("joinPanel"), roomPanel = $("roomPanel");
let socket = null, selfId = null, roomCode = "", localStream = null, audioContext = null;
let sourceNodes = [], peers = new Map(), peerMeta = new Map(), remoteStreams = new Map(), audioEls = new Map();
const rtcConfig = {
  iceServers: [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
    // Add your own TURN server credentials in public/app.js for reliable connections across restrictive NATs.
    // { urls: "turn:YOUR_TURN_HOST:3478", username: "YOUR_TURN_USERNAME", credential: "YOUR_TURN_PASSWORD" }
  ]
};
const canTransmit = role => role === "source" || role === "both";
function showError(id, message) { $(id).textContent = message || ""; }
function setState(message) { $("connectionState").textContent = message; }
function makeCode() { return "LINK-" + Math.random().toString(36).slice(2, 8).toUpperCase(); }
$("generate").onclick = () => $("room").value = makeCode();
$("room").value = makeCode();

$("join").onclick = () => {
  showError("joinError", "");
  const room = $("room").value.trim().toUpperCase();
  if (!/^[A-Z0-9-]{4,24}$/.test(room)) return showError("joinError", "Enter a room code with 4–24 letters, numbers or hyphens.");
  roomCode = room;
  const role = $("role").value;
  socket = io({
    transports: ["websocket", "polling"],
    auth: { room, name: $("name").value.trim() || "Guest", role, pin: $("pin").value }
  });
  socket.on("connect", () => setState("Connected to signaling server · establishing peer links"));
  socket.on("connect_error", err => showError("joinError", err.message));
  socket.on("app-error", message => showError("roomError", message));
  socket.on("room-ready", data => {
    selfId = data.selfId;
    joinPanel.classList.add("hidden"); roomPanel.classList.remove("hidden");
    $("roomTitle").textContent = data.room;
    $("startTx").disabled = !canTransmit(role);
    if (!canTransmit(role)) $("txMessage").textContent = "This device joined as a listener. Change its role to Source or Both to transmit.";
    renderDevices();
    // The newly joined peer initiates offers to all existing peers, avoiding offer glare.
    for (const peer of data.peers) createPeer(peer, true);
    updateCount();
  });
  socket.on("peer-joined", ({ peer }) => { peerMeta.set(peer.id, peer); renderDevices(); updateCount(); });
  socket.on("peer-left", ({ id }) => removePeer(id));
  socket.on("signal", handleSignal);
  socket.on("disconnect", () => setState("Signaling server disconnected"));
};

function createPeer(peer, initiate) {
  if (peers.has(peer.id)) return peers.get(peer.id);
  peerMeta.set(peer.id, peer);
  const pc = new RTCPeerConnection(rtcConfig);
  peers.set(peer.id, pc);
  pc.onicecandidate = e => { if (e.candidate && socket?.connected) socket.emit("signal", { to: peer.id, candidate: e.candidate }); };
  pc.ontrack = e => {
    const stream = e.streams[0] || new MediaStream([e.track]);
    remoteStreams.set(peer.id, stream);
    attachAudio(peer.id, stream);
    renderDevices();
  };
  pc.onconnectionstatechange = () => {
    if (["failed", "closed"].includes(pc.connectionState)) {
      if (pc.connectionState === "failed") setState("A peer connection failed. A TURN relay may be required on this network.");
    }
    renderDevices();
  };
  if (localStream && canTransmit($("role").value)) {
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  }
  if (initiate) pc.createOffer().then(offer => pc.setLocalDescription(offer)).then(() => {
    socket.emit("signal", { to: peer.id, description: pc.localDescription });
  }).catch(err => showError("roomError", "Could not create peer offer: " + err.message));
  renderDevices();
  return pc;
}

async function handleSignal({ from, description, candidate }) {
  const peer = peerMeta.get(from) || { id: from, name: "Remote device", role: "source" };
  const pc = createPeer(peer, false);
  try {
    if (description) {
      await pc.setRemoteDescription(description);
      if (description.type === "offer") {
        await pc.setLocalDescription(await pc.createAnswer());
        socket.emit("signal", { to: from, description: pc.localDescription });
      }
    }
    if (candidate) await pc.addIceCandidate(candidate);
  } catch (err) { showError("roomError", "Connection negotiation failed: " + err.message); }
}

function attachAudio(id, stream) {
  let audio = audioEls.get(id);
  if (!audio) {
    audio = document.createElement("audio");
    audio.autoplay = true; audio.playsInline = true; audio.controls = true;
    audioEls.set(id, audio);
  }
  audio.srcObject = stream;
  audio.play().catch(() => { /* Browser may require a tap; native controls remain available. */ });
}
function removePeer(id) {
  peers.get(id)?.close(); peers.delete(id); peerMeta.delete(id); remoteStreams.delete(id);
  const audio = audioEls.get(id); if (audio) { audio.pause(); audio.srcObject = null; audio.remove(); }
  audioEls.delete(id); renderDevices(); updateCount();
}
function updateCount() {
  const count = peerMeta.size + (selfId ? 1 : 0);
  $("deviceCount").textContent = `${count} device${count === 1 ? "" : "s"}`;
}
function renderDevices() {
  const root = $("devices"); root.innerHTML = "";
  const all = [...peerMeta.values()];
  if (selfId) all.unshift({ id: selfId, name: $("name").value.trim() || "This device", role: $("role").value, self: true });
  if (!all.length) root.innerHTML = '<div class="empty">Waiting for devices to join this room…</div>';
  for (const p of all) {
    const stream = remoteStreams.get(p.id);
    const pc = peers.get(p.id);
    const card = document.createElement("article"); card.className = "device";
    const top = document.createElement("div"); top.className = "device-top";
    const avatar = document.createElement("div"); avatar.className = "avatar"; avatar.textContent = (p.name || "?").slice(0,1).toUpperCase();
    const details = document.createElement("div");
    const name = document.createElement("div"); name.className = "device-name"; name.textContent = p.name + (p.self ? " (you)" : "");
    const role = document.createElement("div"); role.className = "device-role"; role.textContent = p.role;
    details.append(name, role);
    const dot = document.createElement("span"); dot.className = "live-dot" + (stream ? " on" : "");
    top.append(avatar, details, dot); card.append(top);
    if (p.self) {
      const note = document.createElement("div"); note.className = "no-audio"; note.textContent = localStream ? "Your audio is being shared." : "Transmission is currently off."; card.append(note);
    } else if (stream) {
      const row = document.createElement("div"); row.className = "audio-row";
      const audio = audioEls.get(p.id); if (audio) row.append(audio);
      card.append(row);
    } else {
      const note = document.createElement("div"); note.className = "no-audio";
      note.textContent = pc?.connectionState === "connected" ? "Connected · waiting for audio" : "Connecting or not transmitting";
      card.append(note);
    }
    root.append(card);
  }
  updateCount();
}

async function startTransmission() {
  showError("roomError", "");
  const wantMic = $("micEnabled").checked, wantSystem = $("systemEnabled").checked;
  if (!wantMic && !wantSystem) return $("txMessage").textContent = "Select at least one audio source.";
  const tracks = [];
  try {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    await audioContext.resume();
    const destination = audioContext.createMediaStreamDestination();
    if (wantMic) {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      const micSource = audioContext.createMediaStreamSource(mic);
      micSource.connect(destination); sourceNodes.push(micSource);
      mic.getTracks().forEach(t => tracks.push(t));
    }
    if (wantSystem) {
      if (!navigator.mediaDevices.getDisplayMedia) {
        $("txMessage").textContent = "This browser does not support shared-tab audio capture. Try desktop Chrome.";
      } else {
        try {
          const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
          const systemTracks = display.getAudioTracks();
          if (!systemTracks.length) $("txMessage").textContent = "No shared audio track was provided. In the picker, select a browser tab and enable 'Share tab audio'.";
          systemTracks.forEach(track => {
            const systemSource = audioContext.createMediaStreamSource(new MediaStream([track]));
            systemSource.connect(destination); sourceNodes.push(systemSource); tracks.push(track);
          });
          // Stop video capture immediately; the selected audio track remains the only transmitted media.
          display.getVideoTracks().forEach(track => track.stop());
          display.getTracks().filter(t => t.kind === "video").forEach(t => t.stop());
        } catch (err) {
          if (wantMic && tracks.length) { /* Continue with microphone if display capture was cancelled. */ }
          else throw err;
          $("txMessage").textContent = "Screen/tab sharing was cancelled; microphone transmission will continue.";
        }
      }
    }
    const mixedTrack = destination.stream.getAudioTracks()[0];
    if (!mixedTrack || (!tracks.length && !destination.stream.getAudioTracks().length)) throw new Error("No audio source was captured.");
    localStream = new MediaStream([mixedTrack]);
    // Keep source tracks alive for as long as the mixed output is sent.
    localStream._sourceTracks = tracks;
    for (const [id, pc] of peers) {
      const senders = pc.getSenders();
      const existing = senders.find(s => s.track?.kind === "audio");
      if (existing) await existing.replaceTrack(mixedTrack);
      else pc.addTrack(mixedTrack, localStream);
      // Renegotiate after adding the first outgoing track.
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit("signal", { to: id, description: pc.localDescription });
    }
    $("txBadge").textContent = "TRANSMITTING"; $("txBadge").className = "status on";
    $("startTx").disabled = true; $("stopTx").disabled = false;
    if (!peers.size) $("txMessage").textContent = "Transmitting locally. Other room members will receive audio when connected.";
    renderDevices();
  } catch (err) {
    stopTransmission();
    $("txMessage").textContent = "Could not start audio: " + err.message + ". Check browser permissions and HTTPS.";
  }
}
function stopTransmission() {
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    (localStream._sourceTracks || []).forEach(t => t.stop());
  }
  sourceNodes.forEach(n => { try { n.disconnect(); } catch {} }); sourceNodes = [];
  if (audioContext) audioContext.close().catch(() => {}); audioContext = null; localStream = null;
  for (const [id, pc] of peers) {
    pc.getSenders().forEach(sender => { if (sender.track?.kind === "audio") pc.removeTrack(sender); });
    pc.createOffer().then(offer => pc.setLocalDescription(offer)).then(() => socket?.emit("signal", { to: id, description: pc.localDescription })).catch(() => {});
  }
  $("txBadge").textContent = "NOT TRANSMITTING"; $("txBadge").className = "status off";
  $("startTx").disabled = $("role").value === "listener"; $("stopTx").disabled = true;
  renderDevices();
}
$("startTx").onclick = startTransmission;
$("stopTx").onclick = stopTransmission;
$("copyInvite").onclick = async () => {
  try { await navigator.clipboard.writeText(roomCode); $("copyInvite").textContent = "Copied!"; }
  catch { $("copyInvite").textContent = "Room: " + roomCode; }
};
$("leave").onclick = () => {
  stopTransmission(); socket?.disconnect(); socket = null;
  for (const id of [...peers.keys()]) removePeer(id);
  selfId = null; peerMeta.clear(); roomPanel.classList.add("hidden"); joinPanel.classList.remove("hidden");
  showError("roomError", ""); setState("Disconnected");
};