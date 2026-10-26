#!/usr/bin/env python3
"""
CLI-Anything → Blender → GLB asset pipeline
===========================================

Turns the game's procedural low-poly asset specs (exported by
`npm run assets:spec`) into Blender scenes **through the CLI-Anything Blender
harness** (`cli-anything-blender`, https://github.com/HKUDS/CLI-Anything) and
exports them as GLB into `public/assets/models/` with a `manifest.json` that
the game loads at runtime (it falls back to identical in-browser procedural
meshes when no GLB is present).

Per asset the pipeline issues the very same commands a human/agent would type:

    cli-anything-blender scene new --name weapon_l85a2 --engine EEVEE -o work/weapon_l85a2.blend-cli.json
    cli-anything-blender --project … material create --name M_2a2b2e --color=0.16,0.17,0.18,1 --roughness 0.85
    cli-anything-blender --project … object add cube --name body__0 --location=0,0.06,0.05 --rotation=0,0,0 --scale=0.058,0.5,0.085 -p size=1
    cli-anything-blender --project … material assign 0 0
    cli-anything-blender --project … render script out.png        (→ generated bpy script)

then appends a join-per-bone + glTF export epilogue to the generated bpy
script and runs `blender --background --python`. A `commands.sh` transcript
is written next to every scene so each asset can be rebuilt by hand.

Usage:
    python3 tools/cli-anything/pipeline.py                 # all assets, fast in-process CLI calls
    python3 tools/cli-anything/pipeline.py --mode shell    # spawn the cli-anything-blender binary per command
    python3 tools/cli-anything/pipeline.py --only weapon_ --jobs 4
    python3 tools/cli-anything/pipeline.py --dry-run       # only write projects + transcripts, no Blender
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import contextlib
import io
import json
import math
import os
import pathlib
import shlex
import shutil
import subprocess
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parents[2]
HERE = ROOT / "tools" / "cli-anything"
BUILD = HERE / "build"
SPECS = BUILD / "specs"
WORK = BUILD / "work"
OUT = ROOT / "public" / "assets" / "models"
CACHE = HERE / ".cache"
VENV = CACHE / "venv"
REPO = "https://github.com/HKUDS/CLI-Anything.git"
EPILOGUE = HERE / "blender" / "export_epilogue.py"


# --------------------------------------------------------------------------- bootstrap
def ensure_cli() -> pathlib.Path:
    """Make sure the cli-anything-blender harness is installed (isolated venv)."""
    exe = VENV / "bin" / "cli-anything-blender"
    if exe.exists():
        return exe
    clone = CACHE / "CLI-Anything"
    CACHE.mkdir(parents=True, exist_ok=True)
    if not clone.exists():
        print(f"[pipeline] cloning {REPO}")
        subprocess.run(["git", "clone", "--depth", "1", REPO, str(clone)], check=True)
    print("[pipeline] creating venv + installing cli-anything-blender")
    subprocess.run([sys.executable, "-m", "venv", str(VENV)], check=True)
    subprocess.run([str(VENV / "bin" / "pip"), "install", "-q", "-e", str(clone / "blender" / "agent-harness")], check=True)
    return exe


def in_venv() -> bool:
    return pathlib.Path(sys.prefix).resolve() == VENV.resolve()


# --------------------------------------------------------------------------- math (Three.js Y-up → Blender Z-up)
def euler_xyz_matrix(rx: float, ry: float, rz: float):
    """Three.js Euler 'XYZ' → rotation matrix R = Rx·Ry·Rz."""
    cx, sx, cy, sy, cz, sz = math.cos(rx), math.sin(rx), math.cos(ry), math.sin(ry), math.cos(rz), math.sin(rz)
    Rx = [[1, 0, 0], [0, cx, -sx], [0, sx, cx]]
    Ry = [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]]
    Rz = [[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]]
    return mm(mm(Rx, Ry), Rz)


def mm(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(3)) for j in range(3)] for i in range(3)]


C = [[1, 0, 0], [0, 0, -1], [0, 1, 0]]  # (x, y, z)_three → (x, -z, y)_blender
CT = [[1, 0, 0], [0, 0, 1], [0, -1, 0]]


def to_blender(p, s, r_deg):
    """Return blender location, scale, euler-XYZ(deg) for a three.js part transform."""
    loc = (p[0], -p[2], p[1])
    scl = (s[0], s[2], s[1])
    R = euler_xyz_matrix(*(math.radians(v) for v in r_deg))
    M = mm(mm(C, R), CT)
    # Blender XYZ euler: M = Rz(c)·Ry(b)·Rx(a)
    b = math.asin(max(-1.0, min(1.0, -M[2][0])))
    if abs(math.cos(b)) > 1e-6:
        a = math.atan2(M[2][1], M[2][2])
        c = math.atan2(M[1][0], M[0][0])
    else:
        a = math.atan2(-M[1][2], M[1][1])
        c = 0.0
    return loc, scl, (math.degrees(a), math.degrees(b), math.degrees(c))


def hex_rgb(h: str):
    h = h.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    srgb = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    # spec colours are sRGB; Blender base colour is linear
    return [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb]


def f(v: float) -> str:
    return f"{v:.5f}".rstrip("0").rstrip(".") if abs(v) > 1e-9 else "0"


def vec(v) -> str:
    return ",".join(f(x) for x in v)


# --------------------------------------------------------------------------- command generation
PRIM = {
    "box": ("cube", ["size=1"]),
    "wedge": ("cube", ["size=1"]),
    "cyl": ("cylinder", ["radius=1.0", "depth=1.0"]),
    "cone": ("cone", ["radius1=1.0", "radius2=0.0", "depth=1.0"]),
    "sphere": ("sphere", ["radius=1.0", "segments=8", "rings=6"]),
}


def asset_commands(spec: dict, project: pathlib.Path) -> list[list[str]]:
    """The cli-anything-blender argv lists that build one asset."""
    proj = ["--json", "--project", str(project)]
    cmds: list[list[str]] = [["--json", "scene", "new", "--name", spec["id"], "--engine", "EEVEE", "--output", str(project)]]
    mats: dict[tuple[str, bool], int] = {}
    for part in spec["parts"]:
        key = (part["c"].lower(), bool(part.get("emissive")))
        if key in mats:
            continue
        idx = len(mats)
        mats[key] = idx
        rgb = hex_rgb(part["c"])
        cmds.append(proj + ["material", "create", "--name", f"M_{key[0].lstrip('#')}{'_glow' if key[1] else ''}", f"--color={vec(rgb + [1])}", "--roughness", "0.85", "--metallic", "0.05"])
        if key[1]:
            cmds.append(proj + ["material", "set", str(idx), "emission_color", vec(rgb + [1])])
            cmds.append(proj + ["material", "set", str(idx), "emission_strength", "4.0"])
    for i, part in enumerate(spec["parts"]):
        prim, params = PRIM[part["shape"]]
        seg = part.get("seg")
        if seg and part["shape"] in ("cyl", "cone"):
            params = params + [f"vertices={int(seg)}"]
        loc, scl, rot = to_blender(part["p"], part["s"], part.get("r", [0, 0, 0]))
        bone = part.get("bone") or "body"
        name = f"{bone}{'_glow' if part.get('emissive') else ''}__{i}"
        cmd = proj + ["object", "add", prim, "--name", name, f"--location={vec(loc)}", f"--rotation={vec(rot)}", f"--scale={vec(scl)}"]
        for p in params:
            cmd += ["-p", p]
        cmds.append(cmd)
        cmds.append(proj + ["material", "assign", str(mats[(part['c'].lower(), bool(part.get('emissive')))]), str(i)])
    return cmds


# --------------------------------------------------------------------------- execution
def run_inprocess(argvs: list[list[str]], script_out: pathlib.Path) -> str:
    """Invoke the CLI-Anything click entry point in-process (same parser & handlers, no fork per command)."""
    from cli_anything.blender import blender_cli  # type: ignore

    blender_cli._session = None
    for argv in argvs:
        with contextlib.redirect_stdout(io.StringIO()):
            try:
                blender_cli.cli.main(args=argv, prog_name="cli-anything-blender", standalone_mode=False)
            except SystemExit as e:  # handle_error() exits on failures
                if e.code:
                    raise RuntimeError(f"cli-anything-blender {' '.join(argv)} failed") from e
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        blender_cli.cli.main(args=argvs[1][:3] + ["render", "script", str(script_out.with_suffix(".png"))], prog_name="cli-anything-blender", standalone_mode=False)
    blender_cli._session = None
    return buf.getvalue()


def run_shell(exe: pathlib.Path, argvs: list[list[str]], script_out: pathlib.Path) -> str:
    for argv in argvs:
        subprocess.run([str(exe)] + argv, check=True, stdout=subprocess.DEVNULL)
    res = subprocess.run([str(exe)] + argvs[1][:3] + ["render", "script", str(script_out.with_suffix(".png"))], check=True, capture_output=True, text=True)
    return res.stdout


def build_asset(spec_path: pathlib.Path, mode: str, exe: pathlib.Path, blender: str | None, dry: bool) -> dict:
    spec = json.loads(spec_path.read_text())
    wid = spec["id"]
    wdir = WORK / wid
    wdir.mkdir(parents=True, exist_ok=True)
    project = wdir / f"{wid}.blend-cli.json"
    if project.exists():
        project.unlink()
    argvs = asset_commands(spec, project)
    rel = lambda a: a.replace(str(ROOT) + os.sep, "")  # noqa: E731  (repo-relative transcript)
    (wdir / "commands.sh").write_text(
        "#!/usr/bin/env bash\n# Rebuild this asset by hand with the CLI-Anything Blender harness\nset -e\ncd \"$(git rev-parse --show-toplevel)\"\n"
        + "\n".join("cli-anything-blender " + " ".join(shlex.quote(rel(a)) for a in argv) for argv in argvs) + "\n")
    script_out = wdir / "generated_bpy.py"
    t0 = time.time()
    generated = run_inprocess(argvs, script_out) if mode == "inprocess" else run_shell(exe, argvs, script_out)
    # strip the render section emitted by `render script`, append our glTF export epilogue
    cut = generated.find("# ── Render Output")
    body = generated[:cut] if cut >= 0 else generated
    glb = OUT / f"{wid}.glb"
    export = wdir / "export.py"
    export.write_text(body + "\n" + EPILOGUE.read_text().replace("__OUT__", str(glb)))
    script_out.write_text(generated)
    info = {"id": wid, "category": spec["category"], "parts": len(spec["parts"]), "commands": len(argvs) + 1, "cliSeconds": round(time.time() - t0, 2)}
    if dry or not blender:
        return info
    res = subprocess.run([blender, "--background", "--factory-startup", "--python-exit-code", "1", "--python", str(export)], capture_output=True, text=True)
    if res.returncode != 0 or not glb.exists():
        (wdir / "blender.log").write_text(res.stdout + res.stderr)
        raise RuntimeError(f"blender export failed for {wid} (see {wdir / 'blender.log'})")
    info["glb"] = f"{wid}.glb"
    info["bytes"] = glb.stat().st_size
    return info


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--mode", choices=["inprocess", "shell"], default="inprocess")
    ap.add_argument("--only", default="", help="comma separated id prefixes")
    ap.add_argument("--jobs", type=int, default=max(1, (os.cpu_count() or 2)))
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--blender", default=os.environ.get("BLENDER", shutil.which("blender") or ""))
    args = ap.parse_args()

    exe = ensure_cli()
    if args.mode == "inprocess" and not in_venv():
        # re-run inside the harness venv so `import cli_anything` works
        os.execv(str(VENV / "bin" / "python"), [str(VENV / "bin" / "python"), __file__] + sys.argv[1:])

    if not SPECS.exists():
        sys.exit("no specs — run `npm run assets:spec` first")
    specs = sorted(SPECS.glob("*.json"))
    if args.only:
        pref = tuple(p.strip() for p in args.only.split(","))
        specs = [s for s in specs if s.stem.startswith(pref)]
    OUT.mkdir(parents=True, exist_ok=True)
    blender = args.blender or None
    if not blender and not args.dry_run:
        print("[pipeline] Blender not found (set BLENDER=/path/to/blender) — writing CLI projects + transcripts only")
    print(f"[pipeline] {len(specs)} assets · mode={args.mode} · jobs={args.jobs} · blender={blender or '-'}")
    results, failed = [], []
    # in-process CLI calls share module globals → serialise them; Blender exports run in parallel
    pool_kind = cf.ThreadPoolExecutor if args.mode == "shell" else None
    if pool_kind:
        with pool_kind(max_workers=args.jobs) as ex:
            futs = {ex.submit(build_asset, s, args.mode, exe, blender, args.dry_run): s for s in specs}
            for fu in cf.as_completed(futs):
                try:
                    results.append(fu.result())
                except Exception as e:  # noqa: BLE001
                    failed.append(f"{futs[fu].stem}: {e}")
    else:
        # build CLI projects serially (fast), then run Blender exports in parallel
        prepared = []
        for s in specs:
            try:
                prepared.append(build_asset(s, args.mode, exe, None, True))
            except Exception as e:  # noqa: BLE001
                failed.append(f"{s.stem}: {e}")
        if blender and not args.dry_run:
            def export(info):
                wdir = WORK / info["id"]
                glb = OUT / f"{info['id']}.glb"
                res = subprocess.run([blender, "--background", "--factory-startup", "--python-exit-code", "1", "--python", str(wdir / "export.py")], capture_output=True, text=True)
                if res.returncode != 0 or not glb.exists():
                    (wdir / "blender.log").write_text(res.stdout + res.stderr)
                    raise RuntimeError(f"blender export failed (see {wdir / 'blender.log'})")
                return {**info, "glb": glb.name, "bytes": glb.stat().st_size}
            with cf.ThreadPoolExecutor(max_workers=args.jobs) as ex:
                futs = {ex.submit(export, i): i for i in prepared}
                for fu in cf.as_completed(futs):
                    try:
                        results.append(fu.result())
                    except Exception as e:  # noqa: BLE001
                        failed.append(f"{futs[fu]['id']}: {e}")
        else:
            results = prepared
    manifest_path = OUT / "manifest.json"
    manifest = {"generator": "cli-anything-blender (HKUDS/CLI-Anything) + Blender glTF exporter", "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "assets": {}}
    if manifest_path.exists() and args.only:
        manifest["assets"] = json.loads(manifest_path.read_text()).get("assets", {})
    for r in sorted(results, key=lambda x: x["id"]):
        if r.get("glb"):
            manifest["assets"][r["id"]] = {"file": r["glb"], "category": r["category"], "parts": r["parts"], "bytes": r["bytes"]}
    manifest_path.write_text(json.dumps(manifest, indent=1))
    total = sum(r.get("bytes", 0) for r in results)
    print(f"[pipeline] built {len([r for r in results if r.get('glb')])} GLB ({total / 1024:.0f} KiB) · {sum(r['commands'] for r in results)} CLI commands · failed {len(failed)}")
    for f_ in failed:
        print("  FAILED", f_)
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
