import Peer, { type DataConnection, type PeerOptions } from 'peerjs';
import type { NetMessage } from './Protocol';
import type { Link, Transport } from './Session';

/**
 * Verbindung über WebRTC (PeerJS): Ein öffentlicher Vermittlungsserver bringt die Rechner nur
 * zusammen, danach laufen die Daten direkt zwischen den Spielern. Klappt der direkte Weg nicht
 * (strenge Router), springt ein Relais-Server von PeerJS ein.
 *
 * Mit `?peer=host:port` lässt sich ein eigener Vermittlungsserver nutzen (z. B. `npx peerjs --port 9000`).
 */
export class PeerTransport implements Transport {
  private peer: Peer | null = null;

  constructor(private readonly server: string | null = null) {}

  private options(): PeerOptions {
    if (!this.server) return { debug: 1 };
    const [host, port] = this.server.split(':');
    const local = host === 'localhost' || host.startsWith('127.') || host.startsWith('192.168.') || host.startsWith('10.');
    return { host, port: Number(port) || (local ? 9000 : 443), path: '/', secure: !local, debug: 1 };
  }

  private open(id?: string): Promise<Peer> {
    this.close();
    return new Promise((resolve, reject) => {
      const peer = id ? new Peer(id, this.options()) : new Peer(this.options());
      this.peer = peer;
      const fail = (err: { type?: string; message?: string }) => {
        peer.destroy();
        if (this.peer === peer) this.peer = null;
        reject(new Error(explain(err)));
      };
      peer.once('open', () => {
        peer.off('error', fail);
        // Spätere Fehler (Server weg) nur melden – laufende Verbindungen bleiben bestehen.
        peer.on('error', (err) => console.warn('[Koop]', err));
        resolve(peer);
      });
      peer.once('error', fail);
    });
  }

  async listen(id: string, onLink: (link: Link) => void): Promise<void> {
    const peer = await this.open(id);
    peer.on('connection', (conn) => {
      conn.on('open', () => onLink(wrap(conn)));
    });
  }

  async connect(id: string): Promise<Link> {
    const peer = await this.open();
    return new Promise((resolve, reject) => {
      const conn = peer.connect(id, { reliable: true, serialization: 'json' });
      const timer = setTimeout(() => reject(new Error('Keine Verbindung – stimmt der Code, und ist die Lobby noch offen?')), 25000);
      conn.on('open', () => {
        clearTimeout(timer);
        resolve(wrap(conn));
      });
      peer.once('error', (err) => {
        clearTimeout(timer);
        reject(new Error(explain(err as { type?: string; message?: string })));
      });
    });
  }

  close(): void {
    this.peer?.destroy();
    this.peer = null;
  }
}

function wrap(conn: DataConnection): Link {
  const link: Link = {
    peer: conn.peer,
    onMessage: null,
    onClose: null,
    send(msg: NetMessage) {
      if (conn.open) conn.send(msg);
    },
    close() {
      conn.close();
    },
  };
  conn.on('data', (data) => link.onMessage?.(data));
  let closed = false;
  const closeOnce = () => {
    if (closed) return;
    closed = true;
    link.onClose?.();
  };
  conn.on('close', closeOnce);
  conn.on('error', closeOnce);
  return link;
}

function explain(err: { type?: string; message?: string }): string {
  switch (err.type) {
    case 'peer-unavailable':
      return 'Lobby nicht gefunden – stimmt der Code, und ist die Lobby noch offen?';
    case 'unavailable-id':
      return 'Dieser Lobby-Code ist gerade belegt – bitte noch einmal versuchen.';
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
      return 'Keine Verbindung zum Vermittlungsserver – Internet prüfen.';
    case 'browser-incompatible':
      return 'Dieser Browser kann kein WebRTC.';
    default:
      return err.message || 'Verbindung fehlgeschlagen.';
  }
}
