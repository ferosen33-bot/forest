/**
 * Zentrale Eingabeverwaltung: Tastatur-Zustand, Maus-Deltas und Pointer Lock.
 *
 * Tasten werden über `KeyboardEvent.code` (physische Position) abgefragt,
 * dadurch funktioniert WASD auf QWERTZ und QWERTY gleichermaßen.
 */

/** Logische Aktionen -> physische Tasten. Mehrfachbelegung ist erlaubt. */
export const KEY_BINDINGS = {
  forward: ['KeyW', 'ArrowUp'],
  backward: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  // Strg + W schließt im Browser den Tab (außer im Vollbild mit Keyboard Lock),
  // daher zusätzlich C als Ducken-Taste.
  crouch: ['ControlLeft', 'ControlRight', 'KeyC'],
  interact: ['KeyE'],
  hotbar1: ['Digit1'],
  hotbar2: ['Digit2'],
  hotbar3: ['Digit3'],
  hotbar4: ['Digit4'],
  hotbar5: ['Digit5'],
  hotbar6: ['Digit6'],
  inventory: ['Tab', 'KeyI'],
  /** Öffnet das Inventar direkt bei den Bauplänen. */
  craft: ['KeyB'],
  /** Bauvorschau drehen. */
  rotate: ['KeyR'],
  /** Im Pointer Lock fängt der Browser Esc selbst ab; hier nur für offene Fenster (Inventar). */
  cancel: ['Escape'],
  debug: ['F3'],
  /** Nachbearbeitung an/aus. */
  postfx: ['F4'],
  /** Debug: Zeitraffer, solange gehalten (nur mit sichtbarer Debug-Anzeige). */
  timeWarp: ['KeyT'],
  /** Inselkarte ein/aus. */
  map: ['KeyM'],
  /** Tagebuch ein/aus. */
  journal: ['KeyJ'],
  /** Fertigkeiten ein/aus. */
  skills: ['KeyK'],
  /** Debug: nächste Wetterlage (nur mit sichtbarer Debug-Anzeige). */
  weather: ['KeyY'],
} as const satisfies Record<string, readonly string[]>;

export type Action = keyof typeof KEY_BINDINGS;

export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  private mouseDX = 0;
  private mouseDY = 0;
  private wheel = 0;
  private mouseButtons = new Set<number>();
  private mousePressed = new Set<number>();
  private _locked = false;

  /** Wird aufgerufen, wenn sich der Pointer-Lock-Zustand ändert. */
  onLockChange: ((locked: boolean) => void) | null = null;

  constructor(private readonly element: HTMLElement) {
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleBlur);
    document.addEventListener('mousemove', this.handleMouseMove);
    document.addEventListener('mousedown', this.handleMouseDown);
    document.addEventListener('mouseup', this.handleMouseUp);
    document.addEventListener('wheel', this.handleWheel, { passive: true });
    document.addEventListener('pointerlockchange', this.handleLockChange);
    // Rechtsklick wird im Spiel benutzt (Bau abbrechen) – kein Kontextmenü.
    element.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  get locked(): boolean {
    return this._locked;
  }

  /**
   * Fordert Pointer Lock an (muss aus einer User-Geste heraus aufgerufen werden).
   * @returns false, wenn der Browser die Anfrage ablehnt.
   */
  async requestLock(): Promise<boolean> {
    try {
      // unadjustedMovement liefert rohe Mausdaten ohne OS-Beschleunigung (Chrome).
      await this.element.requestPointerLock({ unadjustedMovement: true });
      return true;
    } catch {
      try {
        await this.element.requestPointerLock();
        return true;
      } catch (err) {
        console.warn('Pointer Lock nicht verfügbar:', err);
        return false;
      }
    }
  }

  exitLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** Taste/Aktion wird aktuell gehalten. */
  isDown(action: Action): boolean {
    if (!this._locked) return false;
    return KEY_BINDINGS[action].some((code) => this.down.has(code));
  }

  /** Taste/Aktion wurde in diesem Frame neu gedrückt. */
  wasPressed(action: Action): boolean {
    return KEY_BINDINGS[action].some((code) => this.pressed.has(code));
  }

  isMouseDown(button = 0): boolean {
    return this._locked && this.mouseButtons.has(button);
  }

  wasMousePressed(button = 0): boolean {
    return this._locked && this.mousePressed.has(button);
  }

  /** Liefert die seit dem letzten Aufruf aufgelaufene Mausbewegung und setzt sie zurück. */
  consumeMouseDelta(): { dx: number; dy: number } {
    const delta = { dx: this.mouseDX, dy: this.mouseDY };
    this.mouseDX = 0;
    this.mouseDY = 0;
    return delta;
  }

  /** Mausrad-Rasten seit dem letzten Aufruf (+1 = nach unten), danach zurückgesetzt. */
  consumeWheel(): number {
    const steps = Math.sign(this.wheel);
    this.wheel = 0;
    return steps;
  }

  /** Am Ende jedes Frames aufrufen: setzt "gerade gedrückt"-Zustände zurück. */
  endFrame(): void {
    this.pressed.clear();
    this.mousePressed.clear();
  }

  dispose(): void {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleBlur);
    document.removeEventListener('mousemove', this.handleMouseMove);
    document.removeEventListener('mousedown', this.handleMouseDown);
    document.removeEventListener('mouseup', this.handleMouseUp);
    document.removeEventListener('wheel', this.handleWheel);
    document.removeEventListener('pointerlockchange', this.handleLockChange);
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    // Browser-Shortcuts unterdrücken, die das Spiel stören (Tab-Fokus, Space-Scroll, Strg+S ...).
    if (this._locked || e.code === 'Tab' || e.code === 'F3' || e.code === 'F4') e.preventDefault();
    if (!e.repeat) this.pressed.add(e.code);
    this.down.add(e.code);
  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    this.down.delete(e.code);
  };

  /** Fokusverlust: alle Tasten loslassen, sonst "klebt" z. B. W. */
  private handleBlur = (): void => {
    this.down.clear();
    this.mouseButtons.clear();
  };

  private handleMouseMove = (e: MouseEvent): void => {
    if (!this._locked) return;
    this.mouseDX += e.movementX;
    this.mouseDY += e.movementY;
  };

  private handleMouseDown = (e: MouseEvent): void => {
    this.mouseButtons.add(e.button);
    this.mousePressed.add(e.button);
  };

  private handleMouseUp = (e: MouseEvent): void => {
    this.mouseButtons.delete(e.button);
  };

  private handleWheel = (e: WheelEvent): void => {
    if (this._locked) this.wheel += e.deltaY;
  };

  private handleLockChange = (): void => {
    this._locked = document.pointerLockElement === this.element;
    if (!this._locked) this.handleBlur();
    // Klicks/Tasten aus Menüs (vor dem Lock) dürfen nicht als Spiel-Eingabe durchrutschen.
    this.pressed.clear();
    this.mousePressed.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.onLockChange?.(this._locked);
  };
}
