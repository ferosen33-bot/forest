import { describe, expect, it } from 'vitest';
import { MemoryNetwork, Session } from './Session';
import { makeLobbyCode, normalizeLobbyCode, parseMessage, type NetMessage, type PlayerState } from './Protocol';

const state = (over: Partial<PlayerState> = {}): PlayerState => ({
  id: 'x',
  name: 'x',
  p: [1, 2, 3],
  yaw: 0,
  pitch: 0,
  speed: 0,
  crouch: false,
  item: null,
  swings: 0,
  hp: 1,
  dead: false,
  hidden: false,
  ...over,
});

describe('Koop-Lobby', () => {
  it('Codes: sechs gut lesbare Zeichen, Eingaben werden bereinigt', () => {
    const code = makeLobbyCode();
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
    expect(normalizeLobbyCode(code.toLowerCase())).toBe(code);
    expect(normalizeLobbyCode(' k7m-2qx ')).toBe('K7M2QX');
    expect(normalizeLobbyCode('ABC')).toBeNull();
    expect(normalizeLobbyCode('ABCDE!')).toBeNull();
  });

  it('Mitspieler tritt bei, bekommt den Seed und spricht nur für sich selbst', async () => {
    const net = new MemoryNetwork();
    const host = new Session(net.transport());
    const code = await host.host('Ferhat', 4242);
    const guest = new Session(net.transport());
    const notices: string[] = [];
    host.onNotice = (t) => notices.push(t);
    const seed = await guest.join(code.toLowerCase(), 'Ben');
    expect(seed).toBe(4242);
    expect(guest.role).toBe('client');
    expect(guest.hostName).toBe('Ferhat');
    expect(host.guestCount).toBe(1);
    expect(notices[0]).toContain('Ben');
    // Eine gefälschte Kennung wird überschrieben.
    guest.send({ t: 'state', s: state({ id: 'host', name: 'Hacker' }) });
    const s = host.guestStates()[0];
    expect(s.id).toBe(guest.myId);
    expect(s.name).toBe('Ben');
  });

  it('Spielnachrichten laufen in beide Richtungen; Gehen wird gemeldet', async () => {
    const net = new MemoryNetwork();
    const host = new Session(net.transport());
    const code = await host.host('A', 1);
    const guest = new Session(net.transport());
    await guest.join(code, 'B');
    const atHost: [NetMessage, string][] = [];
    const atGuest: NetMessage[] = [];
    host.onMessage = (m, from) => atHost.push([m, from]);
    guest.onMessage = (m) => atGuest.push(m);
    guest.send({ t: 'hit', enemy: 3, hit: { op: 'stun', seconds: 1 } });
    host.sendTo(guest.myId, { t: 'hurt', amount: 10, from: [0, 0, 0] });
    expect(atHost[0][0].t).toBe('hit');
    expect(atHost[0][1]).toBe(guest.myId);
    expect(atGuest[0].t).toBe('hurt');
    let left = '';
    host.onLeave = (id) => (left = id);
    guest.leave();
    expect(left).toBe('p1');
    expect(host.guestCount).toBe(0);
  });

  it('volle Lobby und falscher Code werden abgewiesen', async () => {
    const net = new MemoryNetwork();
    const host = new Session(net.transport());
    const code = await host.host('A', 1);
    for (let i = 0; i < 3; i++) await new Session(net.transport()).join(code, `G${i}`);
    await expect(new Session(net.transport()).join(code, 'Zu viel')).rejects.toThrow('voll');
    await expect(new Session(net.transport()).join('ZZZZZZ', 'X')).rejects.toThrow();
    await expect(new Session(net.transport()).join('abc', 'X')).rejects.toThrow('sechs');
  });

  it('kaputte Nachrichten werden verworfen', () => {
    expect(parseMessage(null)).toBeNull();
    expect(parseMessage({ t: 'hurt', amount: 1e9, from: [0, 0, 0] })).toBeNull();
    expect(parseMessage({ t: 'state', s: { id: 1 } })).toBeNull();
    expect(parseMessage({ t: 'unbekannt' })).toBeNull();
    expect(parseMessage({ t: 'hurt', amount: 5, from: [0, 0, 0] })).not.toBeNull();
  });

  it('verstummte Mitspieler fliegen nach zehn Sekunden aus der Lobby', async () => {
    const net = new MemoryNetwork();
    const host = new Session(net.transport());
    let t = 0;
    host.now = () => t;
    const code = await host.host('A', 1);
    const guest = new Session(net.transport());
    await guest.join(code, 'B');
    let left = '';
    host.onLeave = (id) => (left = id);
    t = 5000;
    guest.send({ t: 'state', s: state() });
    t = 12000;
    host.prune();
    expect(host.guestCount).toBe(1);
    t = 16000;
    host.prune();
    expect(host.guestCount).toBe(0);
    expect(left).toBe('p1');
  });
});
