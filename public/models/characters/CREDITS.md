# Figuren und Bewegungen

Aus [Mesh2Motion](https://github.com/mesh2motion/mesh2motion-app) von Scott Petrovic: „All 3d models, blend files,
rigs, animations“ stehen unter **CC0 1.0** (siehe `LICENSE-CC0.md`). Die Bewegungen bauen auf den CC0-Animationen von
Quaternius auf.

- Figuren: `monster`, `monster_3`, `monster_4`, `monster_5`, `killer_4` … `killer_7`, `male_10`, `hazmat_female`,
  `female_9`, `male_15`, `police_male`, `female_8`, `hazmat_suit_male` (unverändert)
- `base-anims.glb`, `addon-anims.glb`: Auszug aus `human-base-animations.glb` und `human-addon-animations.glb`
  (nur benötigte Bewegungen, ohne Finger- und Skalierungsspuren), erzeugt mit `scripts/prepare-characters.mjs`

## Hand in der Ich-Ansicht

`fp_arm.glb`: rechter Unterarm mit Hand, ausgeschnitten aus dem MakeHuman-Avatar `mpfb.glb` des Projekts
[TalkingHead](https://github.com/met4citizen/TalkingHead) („The avatar is licensed under CC0“), erstellt mit Blender
und [MPFB](https://static.makehumancommunity.org/mpfb.html). Zuschnitt: `scripts/prepare-fp-arm.mjs`.
