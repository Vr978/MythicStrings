import type { ClientMsg, ServerMsg } from '../shared/protocol';

/** Owns one connection. A disconnected match is never silently restarted with a new identity. */
export class OnlineRoom {
  private socket: WebSocket | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  latency = 0;
  onMessage: (message: ServerMsg) => void = () => {};
  onDisconnect: () => void = () => {};

  async connect(first: ClientMsg): Promise<void> {
    const socket = this.socket = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { socket.close(); reject(new Error('Connection timed out. Check that the server is running.')); }, 8000);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Could not connect to the duel server.')); }, { once: true });
    });
    if (this.closed) { socket.close(); return; }
    socket.addEventListener('message', event => {
      try {
        const message = JSON.parse(String(event.data)) as ServerMsg;
        if (message.t === 'pong') this.latency = Math.round(performance.now() - message.at);
        this.onMessage(message);
      } catch { /* Ignore malformed messages without interrupting the duel. */ }
    });
    socket.addEventListener('close', () => {
      if (this.heartbeat) clearInterval(this.heartbeat);
      if (!this.closed) this.onDisconnect();
    });
    this.heartbeat = setInterval(() => this.send({ t: 'ping', at: performance.now() }), 5000);
    this.send(first);
  }

  send(message: ClientMsg): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  close(): void {
    this.closed = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.send({ t: 'leave' });
    this.socket?.close();
  }
}
