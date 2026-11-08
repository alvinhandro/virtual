# Remote Audio Link

A consent-based browser application for real-time audio rooms. Multiple devices join one room; devices with the **Source** or **Both** role can explicitly share their microphone and/or browser-tab/system audio where supported. Other room members receive each transmitted audio stream.

## Important platform limits

- Microphone capture requires user permission and a secure context (HTTPS, or localhost during development).
- Browser system audio capture is not universally available. `getDisplayMedia()` typically requires a user to select a browser tab/screen and enable audio sharing. Desktop Chrome is the recommended source device.
- Android Chrome generally does not expose arbitrary phone system audio to websites. A web page cannot silently capture another app's audio.
- This starter uses peer-to-peer mesh WebRTC. Each source sends to each other room member. This is suitable for small rooms (roughly 2–6 devices depending on network/device capacity), not hundreds of listeners.
- STUN alone does not guarantee connections across every mobile carrier NAT/firewall. Configure a TURN relay for production reliability.
- All participants in a room can hear all active sources. Do not use this to monitor anyone without their knowledge and explicit consent.

## Run locally

Requirements: Node.js 20+.

```bash
npm install
cp .env.example .env
npm start
```

Open `http://localhost:3000` in Chrome. For testing on another device, localhost is not sufficient; deploy over HTTPS or use a trusted HTTPS tunnel. Do not expose the development server publicly without a PIN and proper deployment controls.

## Deploy on Render

1. Push this folder to a private GitHub repository.
2. In Render, create a **Web Service** from that repository.
3. Build command: `npm install`
4. Start command: `npm start`
5. Set `ROOM_PIN` to a long random secret in Render environment settings.
6. Keep `MAX_ROOM_SIZE` small (e.g. 6–12).
7. Deploy. Render provides HTTPS automatically.
8. Open the service URL on all devices and join using the same room code and PIN.

The included `render.yaml` is a starting blueprint. Set secrets in the Render dashboard; do not commit `.env`.

## TURN relay (recommended for real-world mobile networks)

Deploy a TURN server (for example, coturn) on a server with a public IP. Configure TLS/UDP ports and firewall rules according to the coturn documentation. Then add its credentials to `rtcConfig.iceServers` in `public/app.js`:

```js
{
  urls: ["turn:turn.example.com:3478?transport=udp", "turns:turn.example.com:5349"],
  username: "short-lived-username",
  credential: "short-lived-credential"
}
```

Do not put a permanent TURN password in public JavaScript. For production, generate time-limited TURN credentials on the backend and return them to authenticated clients. Restrict relay usage and monitor bandwidth.

## Security notes

- Use HTTPS only in production.
- Set a strong `ROOM_PIN`; room codes alone are not authentication.
- Share room code and PIN only with intended participants.
- The signaling server forwards SDP/ICE metadata, not the audio payload. Audio media travels over WebRTC's encrypted DTLS-SRTP transport (directly or via TURN).
- This starter has no user accounts, durable identity, room ownership, audit trail, or per-participant moderation. Anyone with the room code and PIN can join.
- Add authentication, rate limiting, per-room authorization, short-lived signed room tokens, TURN credential issuance, and abuse monitoring before public launch.
- Browser indicators and the app's visible transmission badge show when a participant is sharing. Participants can stop at any time.
- Avoid recording by default. If recording is added, obtain explicit consent from every participant and display a persistent recording indicator.

## Architecture

- `public/`: responsive browser client, microphone/display capture and Web Audio mixing.
- `server.js`: Express static hosting plus Socket.IO room signaling.
- WebRTC: peer-to-peer audio tracks, ICE candidate exchange and SDP offer/answer negotiation.
- Signaling: Socket.IO room membership, peer discovery and targeted signaling messages.

## Known MVP limitations

This is a runnable MVP, not a hardened commercial service. The mesh design can become bandwidth/CPU intensive as the room grows. For larger rooms, replace mesh with an SFU such as LiveKit, mediasoup or Janus. Also implement server-issued TURN credentials and real user authentication before inviting untrusted users.
