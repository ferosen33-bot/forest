# Tiere

Von [OpenGameArt](https://opengameart.org), jeweils **CC0** – „This model created for the wonderful world of Kelgar.“

- `stag.glb`: [Old Deer Male](https://opengameart.org/content/old-deer-male) (Modell, Skelett, Bewegungen, Farb- und
  Normalen-Texturen)
- `doe.glb`: [Deer Female](https://opengameart.org/content/deer-female)
- `rabbit.glb`: [Rabbit](https://opengameart.org/content/rabbit-0)

- `wolf.glb`: [3d wolf](https://opengameart.org/content/3d-wolf) von NewDLC (**CC0**). Das Modell hat ein Skelett,
  aber keine Bewegungen; seine gemalte Hundetextur wurde mit `scripts/prepare-wolf-texture.py` in ein graues
  Wolfsfell verwandelt (helle Schnauze, kleinere Augen mit bernsteinfarbener Iris).

Umgewandelt mit `scripts/prepare-animals.py` (Blender als Python-Modul):
- Szene gesäubert, Materialien neu aufgebaut, Bewegungen ausgewählt und umbenannt.
- Beim Rotwild einen Gang über die Fuß-IK ergänzt.

Texturen verkleinert mit `scripts/compress-animals.mjs`.
