"""
Electric Universe: a 360-degree panorama background for the portfolio.

Builds a procedural "tech / electric universe" around a camera at the world
origin and renders it as an equirectangular panorama. The website wraps that
image around the viewer and adds the fisheye lens and motion in the browser.

Run from the project folder (headless, no window):
    "C:\\Program Files\\Blender Foundation\\Blender 5.3\\blender.exe" -b -P blender/universe.py
    ... -P blender/universe.py -- --preview        quick 1024px test render
    ... -P blender/universe.py -- --seed 7         a different random layout
    ... -P blender/universe.py -- --no-render      only build + save the .blend

Or open blender/universe.blend in Blender to tweak by hand, then F12.

Outputs:
    assets/bg/universe-4k.webp   4096 x 2048  (desktop)
    assets/bg/universe-2k.webp   2048 x 1024  (phones, fallback)
    assets/bg/universe-tiny.webp   64 x 32    (blurred placeholder)
    blender/universe.blend
"""
import argparse
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

# ---------------------------------------------------------------- settings --
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT_DIR = os.path.join(ROOT, "assets", "bg")
BLEND_PATH = os.path.join(ROOT, "blender", "universe.blend")
FONT_DIR = os.path.join(ROOT, "blender", "fonts")   # downloaded on first run (git-ignored)

# The site's own fonts (Google Fonts, OFL). An old User-Agent makes the CSS API hand out .ttf.
FONT_CSS = ("https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@125,900"
            "&family=JetBrains+Mono:wght@500;700")

# Signs placed around the viewer. yaw: degrees, + = turning to the right.
# The website reads their positions from assets/bg/world.json, so moving or
# renaming a sign here only needs a re-render.
SIGN_DIST = 16.0
SIGN_Z = 1.0
SIGNS = [
    # yaws chosen so the gaps between sign edges are even (~17 degrees)
    ("profile", 49, "PROFILE", "[ 01 ]  WHO I AM"),
    ("work", 99, "SELECTED WORK", "[ 02 ]  PROJECTS"),
    ("stack", 156, "STACK & SKILLS", "[ 04 ]  TOOLS I USE"),
    ("experience", 209, "EXPERIENCE", "[ 03 ]  OUTSIDE CLASS"),
    ("certified", 258, "CERTIFIED", "[ 04.1 ]  CREDENTIALS"),
    ("contact", 307, "CONTACT", "[ 05 ]  OPEN THE CHANNEL"),
]
HERO = dict(dist=14.0, kicker="PORTFOLIO  //  SINGAPORE", line1="AZRI", line2="BIN AIDIR",
            sub="ASPIRING SOFTWARE ENGINEER")
SIGN_INFO = []   # filled while building; used to keep clutter out from in front of signs


def srgb(hex_str):
    """'#ff5b1f' -> linear RGBA tuple (Blender works in linear colour)."""
    h = hex_str.lstrip("#")
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return (*out, 1.0)


# Palette: matches the site (accent #ff5b1f, ink #ebe7dd) with a cool
# electric blue as the counter-colour. Change these to re-theme everything.
ACCENT = srgb("#ff5b1f")     # main neon
EMBER = srgb("#ffb15c")      # hot highlights
INK = srgb("#ebe7dd")        # warm white sparks
ELECTRIC = srgb("#5cc8ff")   # electric blue
DEEP = srgb("#0a1630")       # nebula base

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--preview", action="store_true")
ap.add_argument("--seed", type=int, default=3)
ap.add_argument("--samples", type=int, default=0)
ap.add_argument("--res", type=int, default=0)
ap.add_argument("--no-render", action="store_true")
args = ap.parse_args(argv)

RES = args.res or (1024 if args.preview else 4096)
SAMPLES = args.samples or (24 if args.preview else 160)
random.seed(args.seed)

FLOOR_Z = -4.0


# ----------------------------------------------------------------- helpers --
def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    return bpy.context.scene


def link(ob):
    bpy.context.scene.collection.objects.link(ob)
    return ob


def rand_unit():
    while True:
        v = Vector((random.uniform(-1, 1), random.uniform(-1, 1), random.uniform(-1, 1)))
        if 0.01 < v.length <= 1:
            return v.normalized()


def ring_point(r_min, r_max, z_min, z_max, ang=None):
    a = random.uniform(0, math.tau) if ang is None else ang
    r = random.uniform(r_min, r_max)
    return Vector((math.cos(a) * r, math.sin(a) * r, random.uniform(z_min, z_max)))


def sock(node, *names):
    for n in names:
        if n in node.inputs:
            return node.inputs[n]
    raise KeyError(f"{node.name}: none of {names}")


def new_material(name):
    mat = bpy.data.materials.new(name)
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    return mat, nt, out


def emission_material(name, color, strength, fade_dist=None, near_fade=0.0):
    """Pure emission. With fade_dist, it dims with distance from the camera,
    which reads as atmospheric depth without paying for volumetrics.
    near_fade also dims it right next to the camera (stops close-up blowout)."""
    mat, nt, out = new_material(name)
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = color
    if fade_dist:
        geo = nt.nodes.new("ShaderNodeNewGeometry")
        ln = nt.nodes.new("ShaderNodeVectorMath")
        ln.operation = "LENGTH"
        nt.links.new(geo.outputs["Position"], ln.inputs[0])
        mr = nt.nodes.new("ShaderNodeMapRange")
        mr.interpolation_type = "SMOOTHSTEP"
        mr.inputs["From Min"].default_value = 0
        mr.inputs["From Max"].default_value = fade_dist
        mr.inputs["To Min"].default_value = strength
        mr.inputs["To Max"].default_value = strength * 0.06
        nt.links.new(ln.outputs["Value"], mr.inputs["Value"])
        result = mr.outputs["Result"]
        if near_fade:
            near = nt.nodes.new("ShaderNodeMapRange")
            near.interpolation_type = "SMOOTHSTEP"
            near.inputs["From Min"].default_value = 4.0
            near.inputs["From Max"].default_value = near_fade
            near.inputs["To Min"].default_value = 0.03
            nt.links.new(ln.outputs["Value"], near.inputs["Value"])
            mul = nt.nodes.new("ShaderNodeMath")
            mul.operation = "MULTIPLY"
            nt.links.new(result, mul.inputs[0])
            nt.links.new(near.outputs["Result"], mul.inputs[1])
            result = mul.outputs["Value"]
        nt.links.new(result, em.inputs["Strength"])
    else:
        em.inputs["Strength"].default_value = strength
    nt.links.new(em.outputs[0], out.inputs["Surface"])
    return mat


def dark_metal(name, roughness=0.25):
    mat, nt, out = new_material(name)
    b = nt.nodes.new("ShaderNodeBsdfPrincipled")
    b.inputs["Base Color"].default_value = (0.006, 0.006, 0.008, 1)
    b.inputs["Metallic"].default_value = 0.85
    b.inputs["Roughness"].default_value = roughness
    nt.links.new(b.outputs[0], out.inputs["Surface"])
    return mat


def mesh_object(name, bm, mat):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    me.materials.append(mat)
    return link(ob)


def curve_object(name, polylines, radius, mat):
    """Many polylines in one curve object = one draw, cheap to render."""
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = radius
    cu.bevel_resolution = 1
    for pts in polylines:
        sp = cu.splines.new("POLY")
        sp.points.add(len(pts) - 1)
        for p, co in zip(sp.points, pts):
            p.co = (co.x, co.y, co.z, 1.0)
    cu.materials.append(mat)
    return link(bpy.data.objects.new(name, cu))


def wireframe(ob, thickness):
    m = ob.modifiers.new("wire", "WIREFRAME")
    m.thickness = thickness
    m.use_replace = True
    m.use_even_offset = True
    return m


def blocks_sign(p, margin=5.0):
    """True if point p sits between the camera and a sign's face (would cover the text)."""
    horiz = math.hypot(p.x, p.y)
    yaw = math.degrees(math.atan2(p.x, p.y))
    pitch = math.degrees(math.atan2(p.z, max(horiz, 1e-6)))
    for s in SIGN_INFO:
        dyaw = (yaw - s["yaw"] + 180) % 360 - 180
        if (abs(dyaw) < s["halfW"] + margin and abs(pitch - s["pitch"]) < s["halfH"] + margin + 3
                and (s.get("see_through") or horiz < s["dist"] + 4)):
            return True
    return False


# ------------------------------------------------------------------- fonts --
def get_fonts():
    names = {"display": "archivo-expanded-black.ttf", "mono": "jetbrains-mono-500.ttf",
             "mono_bold": "jetbrains-mono-700.ttf"}
    paths = {k: os.path.join(FONT_DIR, v) for k, v in names.items()}
    if not all(os.path.exists(p) for p in paths.values()):
        try:
            import re
            import urllib.request
            os.makedirs(FONT_DIR, exist_ok=True)
            req = urllib.request.Request(FONT_CSS, headers={"User-Agent": "Mozilla/4.0"})
            css = urllib.request.urlopen(req, timeout=20).read().decode()
            urls = re.findall(r"url\((https://[^)]+\.ttf)\)", css)
            for key, url in zip(("display", "mono", "mono_bold"), urls):  # CSS order
                urllib.request.urlretrieve(url, paths[key])
            print("[universe] downloaded site fonts")
        except Exception as e:
            print(f"[universe] font download failed ({e}); using Windows fonts")
    fallback = {"display": r"C:\Windows\Fonts\ariblk.ttf", "mono": r"C:\Windows\Fonts\consola.ttf",
                "mono_bold": r"C:\Windows\Fonts\consolab.ttf"}
    fonts = {}
    for k in names:
        p = paths[k] if os.path.exists(paths[k]) else fallback[k]
        fonts[k] = bpy.data.fonts.load(p) if os.path.exists(p) else None  # None = Blender default
    return fonts


# ------------------------------------------------------------------- signs --
def text_obj(name, body, font, size, mat, parent, loc, *, extrude=0.0, outline=0.0,
             offset=0.0, spacing=1.0):
    """Upright text facing the camera (in the sign's local frame the viewer is at -Y)."""
    cu = bpy.data.curves.new(name, "FONT")
    cu.body = body
    if font:
        cu.font = font
    cu.size = size
    cu.align_x = "CENTER"
    cu.align_y = "CENTER"
    cu.space_character = spacing
    cu.extrude = extrude
    cu.offset = offset
    if outline:                      # neon tube that traces the letter outlines
        cu.fill_mode = "NONE"
        cu.bevel_depth = outline
        cu.bevel_resolution = 2
    cu.materials.append(mat)
    ob = link(bpy.data.objects.new(name, cu))
    ob.parent = parent
    ob.location = loc
    ob.rotation_euler = (math.pi / 2, 0, 0)
    return ob


def box(name, size, loc, mat, parent):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1, matrix=Matrix.Diagonal((*size, 1)))
    ob = mesh_object(name, bm, mat)
    ob.parent = parent
    ob.location = loc
    return ob


def sign_root(name, yaw_deg, dist):
    root = link(bpy.data.objects.new(name, None))
    yaw = math.radians(yaw_deg)
    root.location = (math.sin(yaw) * dist, math.cos(yaw) * dist, 0)
    root.rotation_euler = (0, 0, -yaw)          # local -Y faces the camera
    return root


def record_sign(sid, yaw, dist, width, z_bottom, z_top, see_through=False):
    lo = math.degrees(math.atan2(z_bottom, dist))
    hi = math.degrees(math.atan2(z_top, dist))
    SIGN_INFO.append(dict(id=sid, yaw=yaw, pitch=round((lo + hi) / 2, 3), halfH=round((hi - lo) / 2, 3),
                          halfW=round(math.degrees(math.atan2(width / 2, dist)), 3), dist=dist,
                          see_through=see_through))


def shadow_glow(name, width, height, loc, parent):
    """Soft dark haze behind floating text so the busy world doesn't fight the letters."""
    mat, nt, out = new_material(name)
    N, L = nt.nodes, nt.links
    tc = N.new("ShaderNodeTexCoord")
    mp = N.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (2 / width, 2 / height, 1)
    L.new(tc.outputs["Object"], mp.inputs["Vector"])
    gr = N.new("ShaderNodeTexGradient")
    gr.gradient_type = "SPHERICAL"
    L.new(mp.outputs["Vector"], gr.inputs["Vector"])
    ramp = N.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[0].color = (0, 0, 0, 1)
    ramp.color_ramp.elements[1].position = 0.55
    ramp.color_ramp.elements[1].color = (0.82, 0.82, 0.82, 1)
    L.new(gr.outputs["Fac"], ramp.inputs["Fac"])
    mix = N.new("ShaderNodeMixShader")
    L.new(ramp.outputs["Color"], mix.inputs["Fac"])
    L.new(N.new("ShaderNodeBsdfTransparent").outputs[0], mix.inputs[1])
    black = N.new("ShaderNodeEmission")
    black.inputs["Color"].default_value = (0, 0, 0, 1)
    black.inputs["Strength"].default_value = 0
    L.new(black.outputs[0], mix.inputs[2])
    L.new(mix.outputs[0], out.inputs["Surface"])
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=0.5,
                          matrix=Matrix.Diagonal((width, height, 1, 1)))
    ob = mesh_object(name, bm, mat)
    ob.parent = parent
    ob.location = loc
    ob.rotation_euler = (math.pi / 2, 0, 0)
    return ob


def build_signs(fonts):
    mats = {
        "title": emission_material("SignTitle", INK, 3.2),
        "kicker": emission_material("SignKicker", ACCENT, 6.0),
        "corner": emission_material("SignCorner", ACCENT, 12.0),
        "strip": emission_material("SignStrip", ACCENT, 5.0),
        "plate": dark_metal("SignPlate", roughness=0.4),
        "hero_tube": emission_material("HeroTube", INK, 7.0),
        "hero_sub": emission_material("HeroSub", INK, 2.2),
    }

    for sid, yaw, title, kicker in SIGNS:
        root = sign_root(f"Sign_{sid}", yaw, SIGN_DIST)
        zc = SIGN_Z
        t = text_obj(f"{sid}_title", title, fonts["display"], 1.3, mats["title"], root,
                     (0, 0, zc - 0.3), extrude=0.03)
        k = text_obj(f"{sid}_kicker", kicker, fonts["mono_bold"], 0.62, mats["kicker"], root,
                     (0, -0.01, zc + 1.1), spacing=1.1)
        bpy.context.view_layer.update()
        W = max(t.dimensions.x, k.dimensions.x) + 2.4
        H = 3.9
        pz = zc + 0.3
        box(f"{sid}_plate", (W, 0.12, H), (0, 0.3, pz), mats["plate"], root)
        box(f"{sid}_rule", (k.dimensions.x, 0.03, 0.03), (0, 0.15, zc + 0.62), mats["corner"], root)
        L, th = 0.9, 0.06                      # HUD corner brackets
        for sx in (-1, 1):
            for sz in (-1, 1):
                cx, cz = sx * W / 2, pz + sz * H / 2
                box(f"{sid}_cx", (L, 0.05, th), (cx - sx * L / 2, 0.2, cz), mats["corner"], root)
                box(f"{sid}_cz", (th, 0.05, L), (cx, 0.2, cz - sz * L / 2), mats["corner"], root)
        bottom = pz - H / 2
        h = bottom - FLOOR_Z
        for sx in (-1, 1):                     # legs with a light strip
            x = sx * (W / 2 - 0.8)
            box(f"{sid}_leg", (0.16, 0.16, h), (x, 0.3, FLOOR_Z + h / 2), mats["plate"], root)
            box(f"{sid}_legl", (0.035, 0.035, h), (x, 0.21, FLOOR_Z + h / 2), mats["strip"], root)
        record_sign(sid, yaw, SIGN_DIST, W, bottom, pz + H / 2)

    # hero: floating hologram of the name, mirroring the site's hero type
    d = HERO["dist"]
    root = sign_root("Sign_hero", 0, d)
    k = text_obj("hero_kicker", HERO["kicker"], fonts["mono_bold"], 0.6, mats["kicker"], root,
                 (0, 0, 4.6), spacing=1.1)
    a = text_obj("hero_line1", HERO["line1"], fonts["display"], 2.2, mats["title"], root,
                 (0, 0, 3.0), extrude=0.04)
    b = text_obj("hero_line2", HERO["line2"], fonts["display"], 2.2, mats["hero_tube"], root,
                 (0, 0, 1.0), outline=0.03)
    s = text_obj("hero_sub", HERO["sub"], fonts["mono"], 0.62, mats["hero_sub"], root,
                 (0, 0, -0.55), spacing=1.1)
    bpy.context.view_layer.update()
    sq = 0.36                                   # the orange square "full stop"
    box("hero_dot", (sq, 0.08, sq), (a.dimensions.x / 2 + 0.38, 0, 3.0 - a.dimensions.y / 2 + sq / 2 + 0.06),
        mats["corner"], root)
    box("hero_rule", (k.dimensions.x, 0.03, 0.03), (0, 0, 4.15), mats["corner"], root)
    W = max(a.dimensions.x + 1.2, b.dimensions.x, k.dimensions.x, s.dimensions.x) + 1.0
    shadow_glow("hero_haze", W * 1.5, 9.5, (0, 2.0, 2.0), root)
    # no backplate, so keep the whole line of sight clear (in front of and behind the name)
    record_sign("hero", 0, d, W, -1.0, 5.0, see_through=True)
    print(f"[universe] signs: {', '.join(i['id'] for i in SIGN_INFO)}")


# ------------------------------------------------------------------ render --
def setup_render(scene):
    scene.render.engine = "CYCLES"
    cy = scene.cycles
    cy.samples = SAMPLES
    cy.use_adaptive_sampling = True
    cy.adaptive_threshold = 0.02
    cy.use_denoising = True
    cy.max_bounces = 4
    cy.glossy_bounces = 2
    cy.diffuse_bounces = 1
    cy.transmission_bounces = 0
    cy.volume_bounces = 0
    cy.caustics_reflective = False
    cy.caustics_refractive = False

    device = "CPU"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    for kind in ("OPTIX", "CUDA", "HIP", "ONEAPI", "METAL"):
        try:
            prefs.compute_device_type = kind
        except TypeError:
            continue
        prefs.refresh_devices()
        gpus = [d for d in prefs.devices if d.type == kind]
        if gpus:
            for d in prefs.devices:
                d.use = d.type == kind
            cy.device = "GPU"
            device = f"GPU ({kind}: {gpus[0].name})"
            break
    print(f"[universe] render device: {device}")

    scene.render.resolution_x = RES
    scene.render.resolution_y = RES // 2
    scene.render.resolution_percentage = 100

    vs = scene.view_settings
    for vt in ("AgX", "Filmic", "Standard"):
        try:
            vs.view_transform = vt
            break
        except TypeError:
            pass
    for look in ("AgX - Punchy", "Punchy", "Medium High Contrast"):
        try:
            vs.look = look
            break
        except TypeError:
            pass
    print(f"[universe] colour: {vs.view_transform} / {vs.look}")


def setup_camera(scene):
    cam = bpy.data.cameras.new("PanoCam")
    cam.type = "PANO"
    cam.panorama_type = "EQUIRECTANGULAR"
    cam.clip_start = 0.05
    cam.clip_end = 2000
    ob = link(bpy.data.objects.new("PanoCam", cam))
    # Blender cameras look down -Z; this aims the image centre at +Y, horizon level.
    ob.rotation_euler = (math.pi / 2, 0, 0)
    ob.location = (0, 0, 0)
    scene.camera = ob


def setup_compositor(scene):
    """Neon bloom. Blender 5 uses a compositor node *group*."""
    try:
        tree = bpy.data.node_groups.new("Universe Comp", "CompositorNodeTree")
        tree.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
        rl = tree.nodes.new("CompositorNodeRLayers")
        out = tree.nodes.new("NodeGroupOutput")

        wide = tree.nodes.new("CompositorNodeGlare")
        wide.inputs["Type"].default_value = "Fog Glow"
        wide.inputs["Quality"].default_value = "High"
        wide.inputs["Threshold"].default_value = 0.6
        wide.inputs["Strength"].default_value = 0.55
        wide.inputs["Size"].default_value = 0.55

        tight = tree.nodes.new("CompositorNodeGlare")
        tight.inputs["Type"].default_value = "Bloom"
        tight.inputs["Quality"].default_value = "High"
        tight.inputs["Threshold"].default_value = 1.2
        tight.inputs["Strength"].default_value = 0.35
        tight.inputs["Size"].default_value = 0.25

        tree.links.new(rl.outputs["Image"], wide.inputs["Image"])
        tree.links.new(wide.outputs["Image"], tight.inputs["Image"])
        tree.links.new(tight.outputs["Image"], out.inputs[0])
        scene.compositing_node_group = tree
        scene.render.use_compositing = True
        print("[universe] compositor glow: on")
    except Exception as e:  # never let polish break the render
        print(f"[universe] compositor glow skipped: {e}")


# ------------------------------------------------------------------- world --
def setup_world(scene):
    """Sky = gradient + two nebula layers + two star layers, all procedural."""
    world = bpy.data.worlds.new("Universe")
    scene.world = world
    nt = world.node_tree
    nt.nodes.clear()
    N, L = nt.nodes, nt.links

    tc = N.new("ShaderNodeTexCoord")
    direction = tc.outputs["Generated"]  # for a world: view direction

    # vertical gradient with a warm haze band on the horizon
    sep = N.new("ShaderNodeSeparateXYZ")
    L.new(direction, sep.inputs[0])
    grad = N.new("ShaderNodeMapRange")
    grad.inputs["From Min"].default_value = -1
    grad.inputs["From Max"].default_value = 1
    L.new(sep.outputs["Z"], grad.inputs["Value"])
    ramp = N.new("ShaderNodeValToRGB")
    cr = ramp.color_ramp
    cr.elements[0].position = 0.0
    cr.elements[0].color = (0.0006, 0.0006, 0.0010, 1)
    cr.elements[1].position = 1.0
    cr.elements[1].color = (0.0004, 0.0006, 0.0018, 1)
    e = cr.elements.new(0.49)
    e.color = (0.010, 0.004, 0.003, 1)
    e = cr.elements.new(0.505)
    e.color = (0.050, 0.014, 0.006, 1)
    e = cr.elements.new(0.56)
    e.color = (0.004, 0.006, 0.016, 1)
    L.new(grad.outputs["Result"], ramp.inputs["Fac"])

    def noise_layer(scale, detail, lo, hi, color, strength, distortion=0.6):
        nz = N.new("ShaderNodeTexNoise")
        nz.inputs["Scale"].default_value = scale
        nz.inputs["Detail"].default_value = detail
        nz.inputs["Roughness"].default_value = 0.62
        nz.inputs["Distortion"].default_value = distortion
        L.new(direction, nz.inputs["Vector"])
        r = N.new("ShaderNodeValToRGB")
        r.color_ramp.elements[0].position = lo
        r.color_ramp.elements[0].color = (0, 0, 0, 1)
        r.color_ramp.elements[1].position = hi
        r.color_ramp.elements[1].color = tuple(c * strength for c in color[:3]) + (1,)
        L.new(nz.outputs["Fac"], r.inputs["Fac"])
        return r.outputs["Color"]

    neb_blue = noise_layer(1.4, 10, 0.48, 0.78, DEEP, 1.6)
    neb_warm = noise_layer(2.6, 8, 0.60, 0.86, ACCENT, 0.05, distortion=1.1)
    neb_elec = noise_layer(4.0, 6, 0.66, 0.90, ELECTRIC, 0.03, distortion=1.4)

    def stars(scale, size, strength):
        vo = N.new("ShaderNodeTexVoronoi")
        vo.inputs["Scale"].default_value = scale
        L.new(direction, vo.inputs["Vector"])
        r = N.new("ShaderNodeValToRGB")
        r.color_ramp.elements[0].position = 0.0
        r.color_ramp.elements[0].color = (strength, strength, strength * 0.95, 1)
        r.color_ramp.elements[1].position = size
        r.color_ramp.elements[1].color = (0, 0, 0, 1)
        L.new(vo.outputs["Distance"], r.inputs["Fac"])
        # random per-star brightness, and drop ~half the stars entirely
        rnd = N.new("ShaderNodeSeparateColor")
        L.new(vo.outputs["Color"], rnd.inputs[0])
        gate = N.new("ShaderNodeMapRange")
        gate.inputs["From Min"].default_value = 0.45
        gate.inputs["From Max"].default_value = 1.0
        L.new(rnd.outputs[0], gate.inputs["Value"])
        mul = N.new("ShaderNodeMix")
        mul.data_type = "RGBA"
        mul.blend_type = "MULTIPLY"
        mul.inputs["Factor"].default_value = 1.0
        L.new(r.outputs["Color"], mul.inputs["A"])
        L.new(gate.outputs["Result"], mul.inputs["B"])
        return mul.outputs["Result"]

    star_small = stars(420, 0.05, 1.8)
    star_big = stars(90, 0.025, 6.0)

    def add(a, b):
        m = N.new("ShaderNodeMix")
        m.data_type = "RGBA"
        m.blend_type = "ADD"
        m.inputs["Factor"].default_value = 1.0
        L.new(a, m.inputs["A"])
        L.new(b, m.inputs["B"])
        return m.outputs["Result"]

    sky = ramp.outputs["Color"]
    for layer in (neb_blue, neb_warm, neb_elec, star_small, star_big):
        sky = add(sky, layer)

    bg = N.new("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = 1.0
    L.new(sky, bg.inputs["Color"])
    out = N.new("ShaderNodeOutputWorld")
    L.new(bg.outputs[0], out.inputs["Surface"])


# ------------------------------------------------------------------- scene --
def build_floor():
    # glossy black ground that reflects the neon
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=900)
    floor = mesh_object("Floor", bm, dark_metal("FloorMetal", roughness=0.18))
    floor.location.z = FLOOR_Z - 0.02

    # neon grid lines (real geometry so they anti-alias and reflect cleanly)
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=80, y_segments=80, size=165)
    grid = mesh_object("Grid", bm, emission_material("GridNeon", ACCENT, 3.2, fade_dist=120, near_fade=22))
    cell = 165 * 2 / 80
    grid.location = (cell / 2, cell / 2, FLOOR_Z)  # camera sits mid-cell, not on a line
    wireframe(grid, 0.03)


def build_dome():
    # faint lat/long sphere far away: "you are inside a simulation"
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=36, v_segments=18, radius=230)
    dome = mesh_object("Dome", bm, emission_material("DomeLines", ELECTRIC, 0.09))
    wireframe(dome, 0.12)


def build_core():
    """Focal point straight ahead (+Y): what the site opens looking at."""
    c = Vector((0, 50, 32))   # high and far, so it glows above the name sign
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=1, radius=7.5)
    shell = mesh_object("CoreShell", bm, emission_material("CoreShell", ACCENT, 14.0))
    shell.location = c
    shell.rotation_euler = (0.4, 0.2, 0.7)
    wireframe(shell, 0.07)

    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=4.6)
    inner = mesh_object("CoreInner", bm, emission_material("CoreInner", ELECTRIC, 6.0))
    inner.location = c
    inner.rotation_euler = (1.1, 0.5, 0.1)
    wireframe(inner, 0.035)

    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=3, radius=1.6)
    heart = mesh_object("CoreHeart", bm, emission_material("CoreHeart", EMBER, 45.0))
    heart.location = c

    # orbit rings around the core
    for i, (r, tilt) in enumerate(((10, 0.35), (12.5, -0.6), (15, 1.2))):
        bpy.ops.mesh.primitive_torus_add(
            major_radius=r, minor_radius=0.05 + i * 0.015,
            major_segments=160, minor_segments=6, location=c,
            rotation=(tilt, random.uniform(-0.4, 0.4), random.uniform(0, math.pi)))
        ring = bpy.context.active_object
        ring.name = f"CoreRing{i}"
        ring.data.materials.append(
            emission_material(f"CoreRing{i}", EMBER if i == 1 else ACCENT, 10.0 - i * 2))
    return c


def build_orbits():
    """Huge thin rings around the viewer: sweeping arcs across the panorama."""
    specs = [(28, 0.05, ACCENT, 6.0), (42, 0.06, ELECTRIC, 3.5), (63, 0.09, INK, 2.2)]
    for i, (r, w, col, s) in enumerate(specs):
        bpy.ops.mesh.primitive_torus_add(
            major_radius=r, minor_radius=w, major_segments=256, minor_segments=6,
            location=(0, 0, 2 + i * 1.5),
            rotation=(random.uniform(0.25, 0.6) * random.choice((-1, 1)),
                      random.uniform(-0.3, 0.3), random.uniform(0, math.tau)))
        ob = bpy.context.active_object
        ob.name = f"Orbit{i}"
        ob.data.materials.append(emission_material(f"Orbit{i}", col, s, fade_dist=140))


def build_towers():
    """A ring of dark data-towers on the horizon with glowing LED bands."""
    mat, nt, out = new_material("TowerBands")
    N, L = nt.nodes, nt.links
    body = N.new("ShaderNodeBsdfPrincipled")
    body.inputs["Base Color"].default_value = (0.004, 0.004, 0.005, 1)
    body.inputs["Metallic"].default_value = 0.7
    body.inputs["Roughness"].default_value = 0.35
    geo = N.new("ShaderNodeNewGeometry")
    sep = N.new("ShaderNodeSeparateXYZ")
    L.new(geo.outputs["Position"], sep.inputs[0])
    wave = N.new("ShaderNodeTexWave")
    wave.wave_type = "BANDS"
    wave.bands_direction = "Z"
    wave.inputs["Scale"].default_value = 0.9
    wave.inputs["Distortion"].default_value = 0.0
    L.new(geo.outputs["Position"], wave.inputs["Vector"])
    band = N.new("ShaderNodeValToRGB")
    band.color_ramp.elements[0].position = 0.93
    band.color_ramp.elements[0].color = (0, 0, 0, 1)
    band.color_ramp.elements[1].position = 0.97
    band.color_ramp.elements[1].color = (1, 1, 1, 1)
    L.new(wave.outputs["Fac"], band.inputs["Fac"])
    # patchy lighting so not every tower glows the same
    nz = N.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 0.08
    L.new(geo.outputs["Position"], nz.inputs["Vector"])
    patch = N.new("ShaderNodeMapRange")
    patch.inputs["From Min"].default_value = 0.45
    patch.inputs["From Max"].default_value = 0.65
    patch.inputs["To Max"].default_value = 3.5
    L.new(nz.outputs["Fac"], patch.inputs["Value"])
    strength = N.new("ShaderNodeMath")
    strength.operation = "MULTIPLY"
    L.new(band.outputs["Color"], strength.inputs[0])
    L.new(patch.outputs["Result"], strength.inputs[1])
    tint = N.new("ShaderNodeMix")
    tint.data_type = "RGBA"
    tint.inputs["A"].default_value = ACCENT
    tint.inputs["B"].default_value = INK
    fac = N.new("ShaderNodeMapRange")  # taller = whiter
    fac.inputs["From Min"].default_value = FLOOR_Z
    fac.inputs["From Max"].default_value = 90  # mostly accent, only tall tips go pale
    L.new(sep.outputs["Z"], fac.inputs["Value"])
    L.new(fac.outputs["Result"], tint.inputs["Factor"])
    L.new(tint.outputs["Result"], sock(body, "Emission Color", "Emission"))
    L.new(strength.outputs["Value"], body.inputs["Emission Strength"])
    L.new(body.outputs[0], out.inputs["Surface"])

    bm = bmesh.new()
    for _ in range(260):
        p = ring_point(55, 140, 0, 0)
        h = random.choice((random.uniform(3, 10), random.uniform(3, 10), random.uniform(10, 34)))
        w = random.uniform(1.5, 5)
        d = random.uniform(1.5, 5)
        m = (Matrix.Translation((p.x, p.y, FLOOR_Z + h / 2))
             @ Matrix.Rotation(math.atan2(p.y, p.x), 4, "Z")
             @ Matrix.Diagonal((w, d, h, 1)))
        bmesh.ops.create_cube(bm, size=1, matrix=m)
    mesh_object("Towers", bm, mat)


def build_shapes(core):
    """Floating wireframe polyhedra scattered around the viewer."""
    cols = [ACCENT, ACCENT, EMBER, ELECTRIC, INK]
    mats = [emission_material(f"Shape{i}", c, s, fade_dist=90)
            for i, (c, s) in enumerate(zip(cols, (9, 6, 8, 5, 4)))]
    placed = []
    while len(placed) < 26:
        p = ring_point(9, 45, -1.5, 18)
        if (p - core).length < 16 or any((p - q).length < 6 for q in placed) or blocks_sign(p, 9):
            continue
        placed.append(p)
        kind = random.choice(("ico", "ico", "cube", "octa", "tet"))
        size = random.uniform(0.6, 2.4) * (p.length / 20) ** 0.5
        bm = bmesh.new()
        if kind == "ico":
            bmesh.ops.create_icosphere(bm, subdivisions=1, radius=size)
        elif kind == "cube":
            bmesh.ops.create_cube(bm, size=size * 1.4)
        elif kind == "octa":
            bmesh.ops.create_cone(bm, cap_ends=True, segments=4, radius1=size, radius2=0, depth=size)
            bmesh.ops.create_cone(bm, cap_ends=True, segments=4, radius1=size, radius2=0, depth=size,
                                  matrix=Matrix.Rotation(math.pi, 4, "X"))
        else:
            bmesh.ops.create_cone(bm, cap_ends=True, segments=3, radius1=size, radius2=0, depth=size * 1.4)
        ob = mesh_object(f"Shape_{kind}", bm, random.choice(mats))
        ob.location = p
        ob.rotation_euler = [random.uniform(0, math.tau) for _ in range(3)]
        wireframe(ob, random.uniform(0.025, 0.06) * (p.length / 20) ** 0.5)
    return placed


def build_network(anchors):
    """Glowing nodes in the sky joined to their nearest neighbours."""
    nodes = list(anchors)
    while len(nodes) < 90:
        p = ring_point(10, 60, 4, 40)
        if not blocks_sign(p):
            nodes.append(p)

    bm = bmesh.new()
    for p in nodes:
        bmesh.ops.create_icosphere(bm, subdivisions=1, radius=random.uniform(0.08, 0.22),
                                   matrix=Matrix.Translation(p))
    mesh_object("NetNodes", bm, emission_material("NetNodes", INK, 30.0, fade_dist=80))

    lines, seen = [], set()
    for i, p in enumerate(nodes):
        near = sorted(range(len(nodes)), key=lambda j: (nodes[j] - p).length)[1:3]
        for j in near:
            key = tuple(sorted((i, j)))
            if key in seen or (nodes[j] - p).length > 22 or blocks_sign((p + nodes[j]) / 2):
                continue
            seen.add(key)
            lines.append([p, nodes[j]])
    curve_object("NetLines", lines, 0.01, emission_material("NetLines", ELECTRIC, 1.6, fade_dist=80))


def lightning(a, b, generations=6, roughness=0.18):
    pts = [a, b]
    disp = (b - a).length * roughness
    for _ in range(generations):
        nxt = [pts[0]]
        for p, q in zip(pts, pts[1:]):
            nxt += [(p + q) / 2 + rand_unit() * disp, q]
        pts = nxt
        disp *= 0.55
    return pts


def build_bolts(core, anchors):
    """Electric arcs: core -> shapes, plus a few ground strikes, with forks."""
    bolts = []
    targets = random.sample(anchors, min(7, len(anchors)))
    for t in targets:
        bolts.append(lightning(core + (t - core).normalized() * 7.5, t))
    for _ in range(5):
        top = ring_point(25, 70, 25, 45)
        bolts.append(lightning(top, Vector((top.x * 1.1, top.y * 1.1, FLOOR_Z)), roughness=0.12))
    bolts = [b for b in bolts if not any(blocks_sign(p) for p in b[::3])]
    forks = []
    for b in bolts:
        for _ in range(random.randint(1, 3)):
            start = random.choice(b[len(b) // 5: -len(b) // 5])
            end = start + rand_unit() * random.uniform(2, 6)
            if not blocks_sign(end):
                forks.append(lightning(start, end, generations=4, roughness=0.3))
    curve_object("Bolts", bolts, 0.018, emission_material("BoltCore", INK, 40.0, fade_dist=120))
    curve_object("BoltHalo", bolts, 0.06, emission_material("BoltHalo", ELECTRIC, 0.7, fade_dist=120))
    curve_object("BoltForks", forks, 0.01, emission_material("BoltForks", ELECTRIC, 18.0, fade_dist=120))


def build_streams():
    """Vertical data streams: dashed light rising from the grid."""
    lines = []
    for _ in range(70):
        p = ring_point(12, 70, 0, 0)
        top = random.uniform(4, 26)
        if any(blocks_sign(Vector((p.x, p.y, z))) for z in (FLOOR_Z, 0, top / 2, top)):
            continue
        z = FLOOR_Z
        while z < top:
            seg = random.uniform(0.3, 1.6)
            lines.append([Vector((p.x, p.y, z)), Vector((p.x, p.y, min(z + seg, top)))])
            z += seg + random.uniform(0.4, 2.5)
    curve_object("Streams", lines, 0.02, emission_material("Streams", ACCENT, 8.0, fade_dist=90))


def build_dust():
    bm = bmesh.new()
    for _ in range(700):
        p = rand_unit() * random.uniform(3.5, 70)
        if p.z < FLOOR_Z + 0.2:
            p.z = random.uniform(FLOOR_Z + 0.3, 6)
        if blocks_sign(p, 2):
            continue
        bmesh.ops.create_icosphere(bm, subdivisions=1, radius=random.uniform(0.008, 0.035) * (p.length / 8) ** 0.6,
                                   matrix=Matrix.Translation(p))
    mesh_object("Dust", bm, emission_material("Dust", EMBER, 12.0, fade_dist=70))


# -------------------------------------------------------------------- main --
def save_webp(src_path, dst_path, w, h, quality):
    img = bpy.data.images.load(src_path)
    img.scale(w, h)
    img.filepath_raw = dst_path
    img.file_format = "WEBP"
    # plain save (not save_render): the PNG is already colour-managed
    img.save(filepath=dst_path, quality=quality)
    bpy.data.images.remove(img)
    print(f"[universe] wrote {os.path.relpath(dst_path, ROOT)} ({os.path.getsize(dst_path) // 1024} KB)")


def main():
    scene = reset_scene()
    setup_render(scene)
    setup_camera(scene)
    setup_world(scene)
    setup_compositor(scene)

    fonts = get_fonts()
    build_floor()
    build_dome()
    build_signs(fonts)
    core = build_core()
    build_orbits()
    build_towers()
    anchors = build_shapes(core)
    build_network(anchors)
    build_bolts(core, anchors)
    build_streams()
    build_dust()

    os.makedirs(OUT_DIR, exist_ok=True)
    import json
    with open(os.path.join(OUT_DIR, "world.json"), "w") as f:
        keep = ("id", "yaw", "pitch", "halfW", "halfH")
        json.dump({"signs": [{k: s[k] for k in keep} for s in SIGN_INFO]}, f, indent=1)
    print("[universe] wrote assets/bg/world.json")
    if not args.preview:
        bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)
        print(f"[universe] saved {os.path.relpath(BLEND_PATH, ROOT)}")
    if args.no_render:
        return

    master = os.path.join(OUT_DIR, "_preview.png" if args.preview else "_master.png")
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_depth = "8"
    scene.render.filepath = master
    bpy.ops.render.render(write_still=True)
    print(f"[universe] rendered {RES}x{RES // 2}")

    if args.preview:
        return
    save_webp(master, os.path.join(OUT_DIR, "universe-4k.webp"), RES, RES // 2, 82)
    save_webp(master, os.path.join(OUT_DIR, "universe-2k.webp"), 2048, 1024, 80)
    save_webp(master, os.path.join(OUT_DIR, "universe-tiny.webp"), 64, 32, 60)
    os.remove(master)


main()
