# ── Export epilogue (appended by tools/cli-anything/pipeline.py) ──────────────
# Joins every part that belongs to the same rig bone / sub-node into one mesh
# named after the bone (operators: hips torso head armL armR legL legR; weapons:
# body mag), forces flat shading (Tactical Low-Poly) and exports GLB (Y-up).
# Uses Blender's glTF add-on; if that is unavailable (e.g. distro Blender
# without numpy) a minimal built-in GLB writer is used instead.
import bpy
import json
import struct

for o in list(bpy.data.objects):
    if o.type in ("CAMERA", "LIGHT"):
        bpy.data.objects.remove(o, do_unlink=True)

groups = {}
for o in list(bpy.data.objects):
    if o.type == "MESH":
        groups.setdefault(o.name.split("__")[0], []).append(o)

joined = []
for bone, objs in groups.items():
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if len(objs) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = bone
    obj.data.name = bone
    for poly in obj.data.polygons:
        poly.use_smooth = False
    joined.append(obj)


def base_color(mat):
    if mat and mat.use_nodes:
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        if bsdf:
            c = bsdf.inputs["Base Color"].default_value
            e = bsdf.inputs.get("Emission Strength")
            return (c[0], c[1], c[2], e.default_value if e else 0.0)
    return (0.8, 0.8, 0.8, 0.0)


def write_glb_minimal(path, objs):
    """Flat-shaded triangles with per-vertex COLOR_0 (linear) — one node + mesh per bone, Y-up."""
    bin_chunks = bytearray()
    accessors, views, meshes, nodes = [], [], [], []

    def add_view(data, target):
        while len(bin_chunks) % 4:
            bin_chunks.append(0)
        off = len(bin_chunks)
        bin_chunks.extend(data)
        views.append({"buffer": 0, "byteOffset": off, "byteLength": len(data), "target": target})
        return len(views) - 1

    for obj in objs:
        me = obj.data
        me.calc_loop_triangles()
        pos, nrm, col = [], [], []
        mats = [base_color(m) for m in me.materials] or [(0.8, 0.8, 0.8, 0)]
        for tri in me.loop_triangles:
            n = tri.normal
            c = mats[min(tri.material_index, len(mats) - 1)]
            for vi in tri.vertices:
                v = me.vertices[vi].co
                pos += [v.x, v.z, -v.y]          # Blender Z-up → glTF Y-up
                nrm += [n.x, n.z, -n.y]
                col += [c[0], c[1], c[2], 1.0]
        if not pos:
            continue
        count = len(pos) // 3
        xs, ys, zs = pos[0::3], pos[1::3], pos[2::3]
        vp = add_view(struct.pack(f"<{len(pos)}f", *pos), 34962)
        vn = add_view(struct.pack(f"<{len(nrm)}f", *nrm), 34962)
        vc = add_view(struct.pack(f"<{len(col)}f", *col), 34962)
        accessors.append({"bufferView": vp, "componentType": 5126, "count": count, "type": "VEC3", "min": [min(xs), min(ys), min(zs)], "max": [max(xs), max(ys), max(zs)]})
        accessors.append({"bufferView": vn, "componentType": 5126, "count": count, "type": "VEC3"})
        accessors.append({"bufferView": vc, "componentType": 5126, "count": count, "type": "VEC4"})
        a = len(accessors) - 3
        meshes.append({"name": obj.name, "primitives": [{"attributes": {"POSITION": a, "NORMAL": a + 1, "COLOR_0": a + 2}, "material": 0}]})
        nodes.append({"name": obj.name, "mesh": len(meshes) - 1})
    gltf = {
        "asset": {"version": "2.0", "generator": "r6s cli-anything pipeline (minimal GLB writer)"},
        "scene": 0, "scenes": [{"nodes": list(range(len(nodes)))}], "nodes": nodes, "meshes": meshes,
        "materials": [{"name": "vertex_colour", "pbrMetallicRoughness": {"baseColorFactor": [1, 1, 1, 1], "metallicFactor": 0.05, "roughnessFactor": 0.85}}],
        "accessors": accessors, "bufferViews": views, "buffers": [{"byteLength": len(bin_chunks)}],
    }
    js = json.dumps(gltf, separators=(",", ":")).encode()
    js += b" " * ((4 - len(js) % 4) % 4)
    while len(bin_chunks) % 4:
        bin_chunks.append(0)
    with open(path, "wb") as fh:
        fh.write(struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(bin_chunks)))
        fh.write(struct.pack("<II", len(js), 0x4E4F534A) + js)
        fh.write(struct.pack("<II", len(bin_chunks), 0x004E4942) + bytes(bin_chunks))


try:
    import numpy  # noqa: F401  (Blender's glTF add-on needs it)
    bpy.ops.export_scene.gltf(filepath="__OUT__", export_format="GLB", export_yup=True, export_apply=True)
    print("exported (io_scene_gltf2) __OUT__")
except ImportError:
    write_glb_minimal("__OUT__", joined)
    print("exported (minimal writer) __OUT__")
