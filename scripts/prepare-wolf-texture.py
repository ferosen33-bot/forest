# Macht aus der gemalten Hundetextur des CC0-Modells „3d wolf“ (OpenGameArt) ein graues Wolfsfell:
# - Farben über die Helligkeit auf Wolfstöne abbilden (dunkler Sattel, graubraune Flanken, helle Unterseite),
# - feine Haarstriche und grobe Fleckung darüberlegen, gemalte Augenbrauen verwischen,
# - die Comic-Augen (weiße Augäpfel mit großer Pupille) durch dunkle Wolfsaugen mit bernsteinfarbener Iris ersetzen.
#
# Aufruf: python prepare-wolf-texture.py <dog2Color.png> <Ausgabe.png>
import sys

import numpy as np
from PIL import Image, ImageFilter

src, out = sys.argv[1], sys.argv[2]
img = Image.open(src).convert('RGB')
W, H = img.size
rgb = np.asarray(img).astype(np.float32) / 255.0

# Gemalte Augenbrauen und harte Kanten im Gesicht weich machen (Bereich der Kopf-Insel).
face = img.crop((40, 40, 240, 130)).filter(ImageFilter.GaussianBlur(7))
blurred = np.asarray(img.copy()).astype(np.float32) / 255.0
blurred[40:130, 40:240] = np.asarray(face).astype(np.float32) / 255.0
rgb = blurred

# Schnauze: beim Hund dunkel, beim Wolf hell – nur die Nasenkuppe bleibt schwarz.
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
nose = np.hypot(xx - 135 * W / 1024, yy - 175 * H / 1024) < 26 * W / 1024
muzzle = (xx > 25 * W / 1024) & (xx < 225 * W / 1024) & (yy > 118 * H / 1024) & (yy < 235 * H / 1024)
dark = rgb.max(axis=2) < 0.3
lighten = (muzzle & dark & ~nose).astype(np.float32)
lighten = np.asarray(Image.fromarray((lighten * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(6))).astype(np.float32) / 255.0
rgb = rgb * (1 - lighten[..., None]) + np.array([0.62, 0.56, 0.45], dtype=np.float32) * lighten[..., None]

lum = rgb @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
sat = rgb.max(axis=2) - rgb.min(axis=2)

# Helligkeit → Wolfstöne (lineare Interpolation zwischen Stützstellen).
stops = np.array([0.0, 0.14, 0.3, 0.5, 0.78, 1.0], dtype=np.float32)
tones = np.array([
    [0.1, 0.09, 0.08],
    [0.22, 0.2, 0.17],
    [0.43, 0.37, 0.28],
    [0.57, 0.51, 0.41],
    [0.78, 0.74, 0.64],
    [0.88, 0.85, 0.78],
], dtype=np.float32)
wolf = np.stack([np.interp(lum, stops, tones[:, c]) for c in range(3)], axis=2)

rng = np.random.default_rng(7)


def noise(scale, blur=0.0, stretch=1):
    """Wertrauschen in [0, 1], `stretch` streckt es senkrecht (Haarstriche)."""
    small = rng.random((max(1, H // (scale * stretch)), max(1, W // scale))).astype(np.float32)
    im = Image.fromarray((small * 255).astype(np.uint8)).resize((W, H), Image.BICUBIC)
    if blur:
        im = im.filter(ImageFilter.GaussianBlur(blur))
    return np.asarray(im).astype(np.float32) / 255.0


hair = noise(1, 0.6, 5)  # feine, längliche Haare
hair2 = noise(2, 0.8, 4)
mottle = noise(48, 10)  # grobe Fleckung
agouti = noise(6, 1.5)  # Grannenhaare: dunkle Spitzen auf hellerem Grund
detail = 0.78 + 0.32 * (0.6 * hair + 0.4 * hair2)
wolf *= detail[..., None]
wolf *= (0.86 + 0.28 * mottle)[..., None]
# Graubraun mit leicht rötlichem Einschlag in den mittleren Tönen, dunkle Grannen dazwischen.
mid = np.clip(1 - np.abs(lum - 0.32) / 0.2, 0, 1)
wolf += (mid * (agouti - 0.5) * 0.12)[..., None] * np.array([1.0, 0.8, 0.55], dtype=np.float32)

# Augen: die weiße Fläche mit den Pupillen (UV oben Mitte) wird dunkel, um jede Pupille eine Iris.
white = (lum > 0.8) & (sat < 0.12)
region = np.zeros_like(white)
region[int(H * 0.15):int(H * 0.33), int(W * 0.47):int(W * 0.78)] = True
eye = white & region
pupils = [(566, 248), (676, 248)]
iris = np.zeros((H, W), dtype=np.float32)
pupil = np.zeros((H, W), dtype=np.float32)
for px, py in pupils:
    d = np.hypot((xx - px * W / 1024), (yy - py * H / 1024)) / (W / 1024)
    iris = np.maximum(iris, np.clip(1 - (d - 34) / 10, 0, 1))
    pupil = np.maximum(pupil, np.clip(1 - (d - 15) / 4, 0, 1))
eyeColor = np.zeros((H, W, 3), dtype=np.float32) + np.array([0.04, 0.03, 0.02], dtype=np.float32)
amber = np.array([0.62, 0.42, 0.12], dtype=np.float32) * (0.75 + 0.5 * hair2[..., None])
eyeColor = eyeColor * (1 - iris[..., None]) + amber * iris[..., None]
eyeColor = eyeColor * (1 - pupil[..., None]) + np.array([0.01, 0.01, 0.01], dtype=np.float32) * pupil[..., None]
# Pupillenränder der Vorlage (bläulicher Schimmer) mit erfassen.
near = np.zeros((H, W), dtype=bool)
for px, py in pupils:
    near |= np.hypot(xx - px * W / 1024, yy - py * H / 1024) < 40 * W / 1024
eyeMask = (eye | (near & region)).astype(np.float32)
eyeMask = np.asarray(Image.fromarray((eyeMask * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.5))).astype(np.float32) / 255.0
wolf = wolf * (1 - eyeMask[..., None]) + eyeColor * eyeMask[..., None]

Image.fromarray((np.clip(wolf, 0, 1) * 255).astype(np.uint8)).save(out)
print('geschrieben:', out)
