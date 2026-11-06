import {
  MAX_PLAYERS,
  PROTOCOL,
  cleanName,
  hostPeerId,
  makeLobbyCode,
  normalizeLobbyCode,
  parseMessage,
  type NetMessage,
  type PlayerState,
} from './Protocol';

/**
 * Lobby-Logik (ohne Spiel und ohne Netzwerkbibliothek): Gastgeber eröffnet eine Lobby mit Code,
 * Mitspieler treten mit dem Code bei. Der Gastgeber nimmt bis zu drei Mitspieler an, leitet ihre
 * Figuren an alle weiter und meldet Kommen und Gehen.
 */

/** Eine Verbindung zur Gegenseite. */
export interface Link {
  readonly peer: string;
  send(msg: NetMessage): void;
  close(): void;
  onMessage: ((data: unknown) => void) | null;
  onClose: (() => void) | null;
}

/** Vermittlung (PeerJS oder – in Tests – im Speicher). */
export interface Transport {
  /** Unter `id` erreichbar werden; jede eingehende Verbindung landet bei `onLink`. */
  listen(id: string, onLink: (link: Link) => void): Promise<void>;
  /** Mit `id` verbinden. */
  connect(id: string): Promise<Link>;
  close(): void;
}

export type SessionRole = 'host' | 'client';

interface Guest {
  link: Link;
  name: string;
  state: PlayerState | null;
}

export class Session {
  role: SessionRole | null = null;
  code: string | null = null;
  /** Eigene Kennung in der Lobby (Gastgeber: „host“). */
  myId = '';
  /** Insel des Gastgebers (Mitspieler: aus dem Willkommen). */
  seed = 0;
  hostName = '';
  /** Statuszeile fürs Menü. */
  status = '';
  onStatus: ((text: string) => void) | null = null;
  /** Spielnachricht (alles außer Anmeldung) von `from` (Gastgeber: Kennung des Mitspielers; Mitspieler: „host“). */
  onMessage: ((msg: NetMessage, from: string) => void) | null = null;
  /** Hinweis fürs Spiel (beigetreten, gegangen, Verbindung verloren …). */
  onNotice: ((text: string) => void) | null = null;
  /** Gastgeber: Ein Mitspieler ist gegangen. */
  onLeave: ((id: string) => void) | null = null;

  private readonly guests = new Map<string, Guest>();
  private hostLink: Link | null = null;
  private nextGuest = 1;

  constructor(private readonly transport: Transport) {}

  get active(): boolean {
    return this.role !== null;
  }

  get isHost(): boolean {
    return this.role === 'host';
  }

  /** Gastgeber: verbundene Mitspieler. */
  get guestCount(): number {
    return this.guests.size;
  }

  get guestIds(): string[] {
    return [...this.guests.keys()];
  }

  guestName(id: string): string {
    return this.guests.get(id)?.name ?? '?';
  }

  /** Gastgeber: zuletzt gemeldete Figuren der Mitspieler. */
  guestStates(): PlayerState[] {
    return [...this.guests.values()].map((g) => g.state).filter((s): s is PlayerState => !!s);
  }

  /** Lobby eröffnen. @returns Code für die Mitspieler. */
  async host(name: string, seed: number, code = makeLobbyCode()): Promise<string> {
    this.leave();
    this.hostName = cleanName(name);
    this.seed = seed;
    this.setStatus('Lobby wird eröffnet …');
    await this.transport.listen(hostPeerId(code), (link) => this.accept(link));
    this.role = 'host';
    this.code = code;
    this.myId = 'host';
    this.setStatus(`Lobby ${code} offen – warte auf Mitspieler …`);
    return code;
  }

  /** Einer Lobby beitreten. @returns Seed der Insel des Gastgebers. */
  async join(input: string, name: string): Promise<number> {
    const code = normalizeLobbyCode(input);
    if (!code) throw new Error('Der Code hat sechs Zeichen, z. B. K7M2QX.');
    this.leave();
    this.setStatus(`Verbinde mit Lobby ${code} …`);
    const link = await this.transport.connect(hostPeerId(code));
    return new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => {
        link.close();
        reject(new Error('Der Gastgeber antwortet nicht.'));
      }, 25000);
      link.onMessage = (data) => {
        const msg = parseMessage(data);
        if (!msg) return;
        if (msg.t === 'reject') {
          clearTimeout(timeout);
          reject(new Error(msg.reason));
          link.close();
          return;
        }
        if (msg.t === 'welcome' && this.role === null) {
          clearTimeout(timeout);
          this.role = 'client';
          this.code = code;
          this.hostLink = link;
          this.myId = msg.id;
          this.seed = msg.seed;
          this.hostName = msg.host;
          this.setStatus(`Verbunden mit ${msg.host} (Lobby ${code})`);
          resolve(msg.seed);
          return;
        }
        if (this.role === 'client') this.onMessage?.(msg, 'host');
      };
      link.onClose = () => {
        clearTimeout(timeout);
        if (this.role === 'client') {
          this.onNotice?.(`Verbindung zu ${this.hostName} verloren.`);
          this.reset('Verbindung getrennt.');
        } else reject(new Error('Verbindung abgelehnt.'));
      };
      link.send({ t: 'hello', v: PROTOCOL, name: cleanName(name) });
    });
  }

  /** Gastgeber: neue Verbindung prüfen und aufnehmen. */
  private accept(link: Link): void {
    let id: string | null = null;
    link.onMessage = (data) => {
      const msg = parseMessage(data);
      if (!msg) return;
      if (!id) {
        if (msg.t !== 'hello') return;
        if (msg.v !== PROTOCOL) {
          link.send({ t: 'reject', reason: 'Ihr habt verschiedene Spielversionen – bitte beide aktualisieren.' });
          setTimeout(() => link.close(), 500);
          return;
        }
        if (this.guests.size >= MAX_PLAYERS - 1) {
          link.send({ t: 'reject', reason: 'Die Lobby ist voll.' });
          setTimeout(() => link.close(), 500);
          return;
        }
        id = `p${this.nextGuest++}`;
        const name = cleanName(msg.name);
        this.guests.set(id, { link, name, state: null });
        link.send({ t: 'welcome', v: PROTOCOL, id, seed: this.seed, host: this.hostName });
        this.broadcast({ t: 'notice', text: `${name} ist beigetreten.` }, id);
        this.onNotice?.(`${name} ist beigetreten.`);
        this.setStatus(this.hostStatus());
        return;
      }
      if (msg.t === 'state') {
        const g = this.guests.get(id);
        // Die Kennung vergibt der Gastgeber – niemand spricht für einen anderen.
        if (g) g.state = { ...msg.s, id, name: g.name };
        return;
      }
      this.onMessage?.(msg, id);
    };
    link.onClose = () => {
      if (!id) return;
      const g = this.guests.get(id);
      this.guests.delete(id);
      if (!g) return;
      this.broadcast({ t: 'notice', text: `${g.name} hat die Lobby verlassen.` });
      this.onNotice?.(`${g.name} hat die Lobby verlassen.`);
      this.onLeave?.(id);
      this.setStatus(this.hostStatus());
    };
  }

  private hostStatus(): string {
    const names = [...this.guests.values()].map((g) => g.name);
    return names.length ? `Lobby ${this.code} · mit ${names.join(', ')}` : `Lobby ${this.code} offen – warte auf Mitspieler …`;
  }

  /** Mitspieler → Gastgeber. */
  send(msg: NetMessage): void {
    this.hostLink?.send(msg);
  }

  /** Gastgeber → einen Mitspieler. */
  sendTo(id: string, msg: NetMessage): void {
    this.guests.get(id)?.link.send(msg);
  }

  /** Gastgeber → alle (außer `except`). */
  broadcast(msg: NetMessage, except?: string): void {
    for (const [id, g] of this.guests) if (id !== except) g.link.send(msg);
  }

  leave(): void {
    for (const g of this.guests.values()) g.link.close();
    this.hostLink?.close();
    this.transport.close();
    this.reset('');
  }

  private reset(status: string): void {
    this.guests.clear();
    this.hostLink = null;
    this.role = null;
    this.code = null;
    this.myId = '';
    this.setStatus(status);
  }

  private setStatus(text: string): void {
    this.status = text;
    this.onStatus?.(text);
  }
}

// ---------------------------------------------------------------------------
// Im Speicher (Tests)
// ---------------------------------------------------------------------------

/** Vermittlung im Speicher: alle Transporte eines Netzes sehen einander. */
export class MemoryNetwork {
  private readonly listeners = new Map<string, (link: Link) => void>();

  transport(): Transport {
    const net = this;
    const own: string[] = [];
    let counter = 0;
    return {
      async listen(id, onLink) {
        if (net.listeners.has(id)) throw new Error('Kennung vergeben');
        net.listeners.set(id, onLink);
        own.push(id);
      },
      async connect(id) {
        const onLink = net.listeners.get(id);
        if (!onLink) throw new Error('Lobby nicht gefunden.');
        const [a, b] = memoryPair(`c${++counter}`, id);
        onLink(b);
        return a;
      },
      close() {
        for (const id of own) net.listeners.delete(id);
        own.length = 0;
      },
    };
  }
}

function memoryPair(aName: string, bName: string): [Link, Link] {
  let open = true;
  const make = (peer: string): Link & { other?: Link } => ({
    peer,
    onMessage: null,
    onClose: null,
    send(msg) {
      if (!open) return;
      // Wie über das Netz: als Kopie, und erst „später“ (synchron genügt für Tests, aber ohne geteilte Objekte).
      const copy = JSON.parse(JSON.stringify(msg));
      this.other?.onMessage?.(copy);
    },
    close() {
      if (!open) return;
      open = false;
      a.onClose?.();
      b.onClose?.();
    },
  });
  const a = make(bName);
  const b = make(aName);
  a.other = b;
  b.other = a;
  return [a, b];
}
