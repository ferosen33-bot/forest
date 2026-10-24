# Bereitet die Tiere von OpenGameArt (Modelle „created for the wonderful world of Kelgar“, CC0) für das
# Spiel auf – Hirsch, Ricke und Hase liegen dort als .blend-Dateien mit Skelett und Bewegungen vor:
# - Szene säubern (Boden, Kamera, Lichter raus), Materialien mit Farb- und Normalen-Texturen neu aufbauen,
# - Bewegungen auswählen und umbenennen; dem Rotwild fehlt ein Schritt – der Gang wird hier über die
#   Fuß-IK des Skeletts erzeugt (Kreuzgang: hinten links, vorne links, hinten rechts, vorne rechts),
# - als GLB ausgeben (IK wird beim Export in die Knochen eingebacken).
#
# Braucht Blender als Python-Modul (pip install bpy).
# Aufruf: python prepare-animals.py <stag|doe|rabbit> <eingabe.blend> <ausgabe.glb>
import math
import sys

import bpy
from mathutils import Matrix, Vector

kind, src, out = sys.argv[1], sys.argv[2], sys.argv[3]

# Eingebettete Skripte der Datei nie ausführen.
bpy.context.preferences.filepaths.use_scripts_auto_execute = False
bpy.ops.wm.open_mainfile(filepath=src, load_ui=False)

DEER_CLIPS = {
    'Idle.000': 'Idle', 'Idle.001': 'Idle2', 'Eat.001': 'Eat', 'LookAround.000': 'Look',
    'LookAround.001': 'Look2', 'Run': 'Run', 'Die.000': 'Die', 'Die.001': 'Die2',
}
CONFIG = {
    'stag': {
        'clips': DEER_CLIPS,
        'materials': {
            'Body': ('body', 'deer-body-normal.png'),
            'Head': ('head', 'Head'),
            'Antlers': ('deer-antlers.png', 'deer-antlers-normal.png'),
        },
        'walk': True,
    },
    'doe': {
        'clips': DEER_CLIPS,
        'materials': {'body': ('doe-body', None), 'head': ('doe-head', None)},
        'walk': True,
    },
    'rabbit': {
        'clips': {
            'Sitting.000': 'Idle', 'Sitting.001': 'Idle2', 'Guarding': 'Look', 'Running': 'Run',
            'Jump': 'Jump', 'Dying.000': 'Die', 'Dying.001': 'Die2',
        },
        'materials': {'Fur.001': ('rabbot-skinn', 'rabbit-NORM'), 'Fur': ('Fur-skin', None)},
        'alpha': {'Fur'},
        'walk': False,
    },
}[kind]

# --- Szene säubern -------------------------------------------------------------------------------
for o in list(bpy.data.objects):
    if o.type not in ('MESH', 'ARMATURE') or (o.type == 'MESH' and o.parent is None):
        bpy.data.objects.remove(o, do_unlink=True)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
for o in bpy.data.objects:
    if o.type == 'MESH' and o.animation_data:
        o.animation_data_clear()

# Bei der Ricke heißt der linke Vorderfuß anders als in ihren Bewegungen – sonst bliebe das Bein steif.
if 'IK-Frontleg_L' in arm.data.bones and 'IK-Fronleg_L' not in arm.data.bones:
    arm.data.bones['IK-Frontleg_L'].name = 'IK-Fronleg_L'

# --- Materialien ---------------------------------------------------------------------------------
def image(name):
    if name is None:
        return None
    img = bpy.data.images.get(name)
    if img is None:
        raise SystemExit(f'Bild fehlt: {name}')
    return img


for mat in bpy.data.materials:
    spec = CONFIG['materials'].get(mat.name)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.clear()
    outp = nodes.new('ShaderNodeOutputMaterial')
    bsdf = nodes.new('ShaderNodeBsdfPrincipled')
    links.new(bsdf.outputs['BSDF'], outp.inputs['Surface'])
    bsdf.inputs['Roughness'].default_value = 0.85
    if spec is None:
        # Augen: dunkel und feucht glänzend.
        bsdf.inputs['Base Color'].default_value = (0.02, 0.015, 0.01, 1)
        bsdf.inputs['Roughness'].default_value = 0.15
        continue
    color, normal = (image(n) for n in spec)
    tex = nodes.new('ShaderNodeTexImage')
    tex.image = color
    links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    if mat.name in CONFIG.get('alpha', ()):
        links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
        mat.blend_method = 'CLIP'
        color.file_format = 'PNG'
    else:
        color.file_format = 'JPEG'
    if normal is not None:
        nt = nodes.new('ShaderNodeTexImage')
        nt.image = normal
        normal.colorspace_settings.name = 'Non-Color'
        normal.file_format = 'JPEG'
        nm = nodes.new('ShaderNodeNormalMap')
        links.new(nt.outputs['Color'], nm.inputs['Color'])
        links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
for img in bpy.data.images:
    if img.size[0] > 1024:
        img.scale(1024, 1024)

# --- Bewegungen ----------------------------------------------------------------------------------
clips = CONFIG['clips']
for a in list(bpy.data.actions):
    if a.name not in clips:
        bpy.data.actions.remove(a)
for a in list(bpy.data.actions):
    a.name = clips[a.name]
    a.use_fake_user = True


def make_walk():
    """Gang über die Fuß-IK: Standphase gleitet der Huf nach hinten, Schwungphase hebt er sich und greift vor."""
    frames = 28  # bei 24 Bildern/s gut eine Sekunde je Doppelschritt
    stride = 2.3  # Weg des Hufs relativ zum Körper (Skelett-Einheiten; Widerrist ≈ 3,4)
    duty = 0.62  # Anteil der Standphase
    feet = {
        # Knochen: (Phase, Hubhöhe, Huf-Knochen, Beugung des Hufs in der Schwungphase)
        'IK-Backleg_L': (0.0, 0.55, 'Backleg_L.002', 0.9),
        'IK-Fronleg_L': (0.25, 0.75, 'Frontleg_L.002', 0.7),
        'IK-Backleg_R': (0.5, 0.55, 'Backleg_R.002', 0.9),
        'IK-Frontleg_R': (0.75, 0.75, 'Frontleg_R.002', 0.7),
    }
    forward = Vector((0, -1, 0))  # das Tier schaut entlang −Y
    up = Vector((0, 0, 1))
    action = bpy.data.actions.new('Walk')
    action.use_fake_user = True
    arm.animation_data_create()
    arm.animation_data.action = action
    pose = arm.pose.bones
    for pb in pose:
        pb.location = (0, 0, 0)
        pb.rotation_mode = 'QUATERNION'
        pb.rotation_quaternion = (1, 0, 0, 0)

    def move(name, delta, f):
        """Versatz im Skelettraum in die lokale Lage des Knochens umrechnen und als Schlüssel setzen."""
        bone = arm.data.bones[name]
        pose[name].location = bone.matrix_local.to_3x3().inverted() @ delta
        pose[name].keyframe_insert('location', frame=f)

    for f in range(frames + 1):
        t = f / frames
        for name, (phase, lift, hoof, flex) in feet.items():
            u = (t - phase) % 1.0
            if u < duty:
                # Standphase: Huf steht, der Körper zieht darüber hinweg.
                x = stride / 2 - stride * (u / duty)
                h = 0.0
                bend = 0.0
            else:
                s = (u - duty) / (1 - duty)
                e = s * s * (3 - 2 * s)
                x = -stride / 2 + stride * e
                h = lift * math.sin(math.pi * s) ** 1.4
                bend = flex * math.sin(math.pi * min(1.0, s * 1.25))
            move(name, forward * x + up * h, f)
            pb = pose[hoof]
            pb.rotation_quaternion = Matrix.Rotation(bend, 4, 'X').to_quaternion()
            pb.keyframe_insert('rotation_quaternion', frame=f)
        # Rumpf: leichtes Auf und Ab zweimal je Doppelschritt, Kopf nickt mit den Vorderbeinen.
        bob = math.cos(4 * math.pi * t)
        move('IK-Hip', up * (-0.05 + 0.05 * bob), f)
        move('IK-Backbone', up * (-0.04 + 0.04 * math.cos(4 * math.pi * (t - 0.12))), f)
        nod = math.cos(4 * math.pi * (t - 0.3))
        move('IK-Head', up * (-0.12 + 0.09 * nod) + forward * (0.08 + 0.06 * nod), f)
    arm.animation_data.action = None


if CONFIG['walk']:
    make_walk()

print('Bewegungen:', sorted(a.name for a in bpy.data.actions))
for o in bpy.data.objects:
    if o.type == 'MESH':
        print('Mesh', o.name, 'Dreiecke', sum(len(p.vertices) - 2 for p in o.data.polygons))

bpy.ops.export_scene.gltf(
    filepath=out,
    export_format='GLB',
    export_animations=True,
    export_animation_mode='ACTIONS',
    export_force_sampling=True,
    export_optimize_animation_size=True,
    export_def_bones=True,
    export_yup=True,
    export_image_format='AUTO',
    export_jpeg_quality=85,
    export_cameras=False,
    export_lights=False,
)
print('geschrieben:', out)
