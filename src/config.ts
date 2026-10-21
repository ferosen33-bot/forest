/**
 * Zentrale Spiel-Konfiguration. Alle Balancing- und Qualitätswerte an einem Ort,
 * damit Tuning ohne Suche im Code möglich ist.
 */
export const CONFIG = {
  seed: 1337,

  world: {
    /** Kantenlänge der quadratischen Insel-Welt in Metern. */
    size: 1024,
    /** Abstand der Höhen-Samples in Metern (Render-Mesh und Kollision teilen dasselbe Raster). */
    cellSize: 2,
    /** Kantenlänge eines Terrain-Chunks in Metern (Einheit für Frustum-Culling). */
    chunkSize: 128,
    /** Zellgröße für Vegetation (feiner als Terrain-Chunks → genaueres Culling). */
    vegetationCellSize: 64,
    waterLevel: 0,
  },

  physics: {
    /** Feste Physik-Schrittweite (60 Hz). */
    timestep: 1 / 60,
    /** Maximal nachzuholende Schritte pro Frame (verhindert die "Spiral of Death"). */
    maxSubSteps: 5,
  },

  player: {
    radius: 0.35,
    standHeight: 1.8,
    crouchHeight: 1.1,
    /** Abstand Augenhöhe zur Kapseloberkante. */
    eyeFromTop: 0.15,
    walkSpeed: 4.2,
    sprintSpeed: 7.5,
    crouchSpeed: 2.0,
    swimSpeed: 3.0,
    groundAccel: 45,
    airAccel: 8,
    gravity: 20,
    jumpSpeed: 6.8,
    /** Sprung ist kurz nach Verlassen einer Kante noch möglich. */
    coyoteTime: 0.12,
    /** Sprungtaste wird kurz vor der Landung "vorgemerkt". */
    jumpBuffer: 0.15,
    maxSlopeDeg: 50,
    stepHeight: 0.45,
    /** Ab dieser Aufprallgeschwindigkeit (m/s) gibt es Fallschaden. */
    fallDamageSpeed: 13,
    fallDamagePerMs: 9,
    /** Ab dieser Wassertiefe (über den Füßen) wird geschwommen. */
    swimDepth: 1.15,
    mouseSensitivity: 0.0022,
    fov: 75,
    sprintFov: 83,
  },

  stats: {
    max: 100,
    /** Sättigung / Hydration sinken pro Sekunde um diese Werte. */
    hungerRate: 100 / (25 * 60),
    thirstRate: 100 / (15 * 60),
    sprintNeedsMultiplier: 1.8,
    staminaSprintCost: 16,
    staminaSwimCost: 4,
    staminaJumpCost: 9,
    staminaRegen: 22,
    staminaRegenDelay: 0.9,
    /** Unter diesem Wert ist man erschöpft, bis die Ausdauer wieder darüber liegt. */
    exhaustedThreshold: 20,
    starveDamage: 1.2,
    healthRegen: 0.35,
    /** Ab dieser Sättigung/Hydration regeneriert sich Gesundheit. */
    regenNeedsThreshold: 55,
    drinkAmount: 25,
  },

  ai: {
    /** Anzahl der Schrat-Lager auf der Insel. */
    camps: 4,
    perCamp: 3,
    /** Mindestabstand der Lager zum Spawnpunkt (m). */
    campMinDistance: 150,
    health: 80,
    walkSpeed: 1.7,
    runSpeed: 5.4,
    attackRange: 1.7,
    attackDamage: 13,
    /** Kopftreffer-Multiplikator. */
    headshotMultiplier: 2,
    sightDay: 32,
    sightNight: 14,
    /** Sichtweite nachts, wenn der Spieler eine Fackel trägt oder am Feuer steht. */
    sightLit: 34,
    fieldOfViewDeg: 120,
    /** Ab dieser Entfernung zum Spieler pausieren Gegner (Leistung). */
    activeRadius: 150,
    /** Zeit bis tote Gegner im Lager neu erscheinen (Spielsekunden). */
    respawnTime: 240,
  },

  time: {
    /** Dauer eines kompletten Tages in Echtzeit-Sekunden. */
    dayLength: 20 * 60,
    startHour: 7.5,
  },

  graphics: {
    maxPixelRatio: 2,
    shadowMapSize: 2048,
    /** Halbe Kantenlänge des Schatten-Frustums um den Spieler (m). */
    shadowRange: 60,
    /** Kamera-Far-Plane. Bei der dünnsten Nebeldichte (0.0085) ist ab ~350 m alles im Nebel. */
    viewDistance: 450,
    /** Vegetationszellen weiter weg liegen vollständig im Nebel und werden ausgeblendet. */
    vegetationDistance: 280,
    /** GPU-Gras: Radius um den Spieler und Rasterabstand der Büschel (0 = aus). */
    grassRadius: 36,
    grassSpacing: 0.55,
    /** Nachbearbeitung (Lichtstrahlen, Bloom, Vignette). Abschaltbar mit F4 oder ?nopost. */
    postProcessing: true,
  },
};

/** Typ der Konfiguration – erlaubt abgewandelte Varianten (z. B. anderer Seed per URL). */
export type GameConfig = typeof CONFIG;
