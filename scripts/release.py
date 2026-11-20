#!/usr/bin/env python3
"""Build and verify the artifacts used by .github/workflows/release.yml."""

import base64
import datetime as dt
import hashlib
import json
import os
import platform
import plistlib
import re
import secrets
import shutil
import struct
import subprocess
import sys
import tarfile
import tempfile
import zipfile
from pathlib import Path


NSH = "0.5.1"
NSH_BUILD = "224d9a7"
UPSTREAM = f"https://github.com/longbridge/nsh/releases/download/v{NSH}"
DIGESTS = {
    "nsh-macos-arm64.tar.gz": "2710affd59e6345b6f87dfa1f579c36b9a9d7a58992b8399d14f39290da048a3",
    "nsh-macos-x86_64.tar.gz": "7381ffe37180584fb12b0488756ffd9e8ff585fede2deac450a51336141ccd69",
    "nsh-linux-x86_64.tar.gz": "f34729e613196ca122d956deb543a92f319e053ff17dfc09ba04a6ec2fb79c74",
    "nsh-windows-x86_64.zip": "9dc4b74037033c8ff50b1047b4702b36e6fd66beb9f5d61411d3497f4751df90",
    "nsh-android.tar.gz": "2dc5184b388aac219660e0a8375d5382a173c5c623ff5b13760028b718b5af2a",
    "nsh-ios-macos-arm64.tar.gz": "cc5ff3a57da0e47bce02390fb53a488ddb64fd35f4f8f1f108bea42c75683109",
    "nsh-web.tar.gz": "050b7caeb11e0323367fd1a15eb49456abe0f6bd9648e21e264f2ecc2175e003",
}
RUNTIME = {
    "macos-arm64": "macos/nsh-macos-app",
    "macos-x64": "macos/nsh-macos-app",
    "windows-x64": "windows/nsh-windows-app.exe",
    "linux-x64": "linux/nsh-linux-app",
    "web": "web/nsh-browser.wasm",
    "android": "android/release/classes.dex",
    "ios-device-arm64": "ios/iphoneos/nsh-ios-app",
    "ios-simulator-arm64": "ios/iphonesimulator/nsh-ios-app",
}
ASSETS = {
    "macos-arm64": ("macos-arm64.dmg", "macOS Apple silicon (ad hoc, not notarized)"),
    "macos-x64": ("macos-x64.dmg", "macOS Intel (ad hoc, not notarized)"),
    "windows-x64": ("windows-x64.zip", "Windows x64 (portable, not Authenticode-signed)"),
    "linux-x64": ("linux-x64.tar.gz", "Linux x64 (Ubuntu 24.04 runtime baseline)"),
    "web": ("web-static.zip", "Static Web files (not deployed)"),
    "android": ("android.apk", "Android ARM64/ARMv7 (maintainer-signed, sideload)"),
    "android-test": ("android-test-only.apk", "Android ARM64/ARMv7 (throwaway test key and separate app ID)"),
    "ios-device-arm64": ("ios-device-ad-hoc-arm64.ipa", "iOS ARM64 (Apple Ad Hoc, profile-listed devices only)"),
    "ios-simulator-arm64": ("ios-simulator-arm64.zip", "iOS Simulator on Apple silicon (not for physical devices)"),
}
OUT = Path("release-assets")


def require(condition, message):
    if not condition:
        raise SystemExit(message)


def run(*args, env=None, capture=False, private=False):
    result = subprocess.run(args, env=env, stdout=subprocess.PIPE if capture or private else None,
                            stderr=subprocess.PIPE if private else None, check=False)
    # Never include command arguments or tool diagnostics from signing commands.
    require(result.returncode == 0, f"{Path(args[0]).name} failed (exit {result.returncode}).")
    return result.stdout if capture else None


def digest(path):
    sha256 = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            sha256.update(chunk)
    return sha256.hexdigest()


def nonempty(path):
    return path.is_file() and path.stat().st_size > 0


def config():
    return json.loads(Path("nsh.json").read_text(encoding="utf-8"))


def enabled(name):
    value = os.getenv(name, "")
    require(value in ("", "false", "true"), f"{name} must be true, false or unset.")
    return value == "true"


def plan():
    app = config()
    version = app["version"]
    require(re.fullmatch(r"(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)", version),
            "nsh.json version must be numeric MAJOR.MINOR.PATCH.")
    require(type(app["build"]) is int and 0 < app["build"] <= 2100000000,
            "nsh.json build must be a positive Android versionCode.")
    tag = os.environ["GITHUB_EVENT_NAME"] == "push"
    android, ios = enabled("ENABLE_ANDROID"), enabled("ENABLE_IOS")
    if tag:
        require(os.environ["GITHUB_REF"] == f"refs/tags/v{version}", f"Expected tag v{version} to match nsh.json.")
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
        output.write(f"version={version}\nandroid={'signed' if tag and android else 'skip' if tag else 'test'}\n"
                     f"ios={'signed' if tag and ios else 'skip'}\n")


def install():
    target = os.environ["TARGET"]
    expected = os.environ["EXPECTED_ARCH"]
    plat = os.environ["NSH_PLATFORM"]
    require(os.environ["RUNNER_ARCH"] == expected, f"Expected runner architecture {expected}.")
    dist = Path(os.environ["RUNNER_TEMP"]) / "yantai-nsh"
    dist.mkdir()
    extension = "zip" if plat.startswith("windows-") else "tar.gz"
    assets = [f"nsh-{plat}.{extension}"]
    component = ("ios-macos-arm64" if target.startswith("ios-") else
                 target if target in ("web", "android") else None)
    if component and not (target == "android" and os.environ["ANDROID_MODE"] == "skip"):
        assets.append(f"nsh-{component}.tar.gz")
    with tempfile.TemporaryDirectory(dir=dist) as tmp:
        for filename in assets:
            download = Path(tmp) / filename
            run("curl.exe" if os.name == "nt" else "curl", "--fail", "--silent", "--show-error", "--location",
                "--retry", "3", f"{UPSTREAM}/{filename}", "--output", download)
            require(digest(download) == DIGESTS[filename], f"Pinned checksum mismatch: {filename}")
            if extension == "zip":
                with zipfile.ZipFile(download) as archive:
                    archive.extractall(dist)
            else:
                run("tar", "-xzf", download, "-C", dist)
    runtime = dist / "nsh/runtime" / RUNTIME[target]
    if target != "android" or os.environ["ANDROID_MODE"] != "skip":
        require(nonempty(runtime), f"Missing NSH runner: {RUNTIME[target]}")
    bin_dir = dist / "nsh/bin"
    exe = bin_dir / ("nsh.exe" if os.name == "nt" else "nsh")
    actual = run(exe, "--version", capture=True).decode().strip()
    require(actual == f"nsh {NSH} ({NSH_BUILD})", f"Unexpected NSH toolchain version: {actual}")
    with open(os.environ["GITHUB_PATH"], "a", encoding="utf-8") as path:
        path.write(f"{bin_dir}\n")


def asset_name(target):
    return f"yantai-v{os.environ['VERSION']}-{ASSETS[target][0]}"


def nsh(target, out, *args, env=None, private=False):
    run("nsh", "package", "--target", target, "--out", out, *args, env=env, private=private)


def zip_verify(path, required):
    with zipfile.ZipFile(path) as archive:
        require(archive.testzip() is None, f"Corrupt ZIP: {path.name}")
        for member in required:
            require(member in archive.namelist() and archive.getinfo(member).file_size > 0,
                    f"Missing or empty ZIP entry: {member}")


def apple_verify(app, app_id, arch, macho_platform, mac=False):
    contents = app / "Contents" if mac else app
    plist = plistlib.loads((contents / "Info.plist").read_bytes())
    require(plist["CFBundleIdentifier"] == app_id and plist["CFBundleShortVersionString"] == os.environ["VERSION"]
            and str(plist["CFBundleVersion"]) == str(config()["build"]), "Unexpected Apple bundle metadata.")
    executable = (contents / "MacOS" if mac else contents) / plist["CFBundleExecutable"]
    resources = contents / "Resources" if mac else contents
    require(nonempty(resources / "nsh/bundle.nshc"), "Missing Apple bundle bytecode.")
    require(run("lipo", "-archs", executable, capture=True).decode().split() == [arch], "Wrong Mach-O architecture.")
    build = run("xcrun", "vtool", "-show-build", executable, capture=True).decode()
    legacy_macos = mac and re.search(r"^\s*cmd\s+LC_VERSION_MIN_MACOSX\s*$", build, re.M)
    require(legacy_macos or re.search(rf"^\s*platform\s+{macho_platform}\s*$", build, re.M),
            "Wrong Mach-O target platform.")
    run("codesign", "--verify", "--strict", "--deep", app)


def mac_dmg(out, work, name, app_id, target, dest):
    arch = "arm64" if target == "macos-arm64" else "x86_64"
    nsh("macos", out, "--arch", arch)
    app = out / f"{name}.app"
    stage = work / "dmg"
    stage.mkdir()
    app_in_image = stage / app.name
    run("ditto", app, app_in_image)
    (stage / "Applications").symlink_to("/Applications")
    run("hdiutil", "create", "-quiet", "-volname", name, "-srcfolder", stage, "-fs", "HFS+",
        "-format", "UDZO", dest)
    run("hdiutil", "verify", "-quiet", dest)
    mount = work / "mounted"
    mount.mkdir()
    run("hdiutil", "attach", "-quiet", "-readonly", "-nobrowse", "-mountpoint", mount, dest)
    try:
        require((mount / "Applications").readlink() == Path("/Applications"), "Missing Applications shortcut.")
        apple_verify(mount / app.name, app_id, arch, "MACOS", mac=True)
    finally:
        run("hdiutil", "detach", "-quiet", mount)


def desktop_archive(out, name, app_id, target, dest):
    if target == "windows-x64":
        nsh("windows", out)
        archive = out / f"{name}.zip"
        bundle = f"{name}/nsh/bundle.nshc"
        zip_verify(archive, (bundle, f"{name}/nsh/app.json"))
        with zipfile.ZipFile(archive) as zipped:
            exes = [path for path in zipped.namelist() if re.fullmatch(rf"{re.escape(name)}/[^/]+\.exe", path)]
            require(len(exes) == 1, "Expected one portable Windows executable.")
            with zipped.open(exes[0]) as exe:
                header = exe.read(64)
                require(header[:2] == b"MZ" and len(header) == 64, "Missing Windows DOS header.")
                exe.seek(struct.unpack_from("<I", header, 60)[0])
                require(exe.read(6) == b"PE\0\0\x64\x86", "Not an x64 PE executable.")
    else:
        nsh("linux", out)
        archive = out / f"{name}.tar.gz"
        run("gzip", "-t", archive)
        with tarfile.open(archive) as packed:
            for entry in ("nsh/bundle.nshc", "nsh/app.json", f"{app_id}.desktop", "App"):
                member = packed.getmember(f"{name}/{entry}")
                require(member.isfile() and member.size > 0, f"Invalid Linux archive entry: {entry}")
            require(member.mode & 0o111, "Linux executable mode bits missing.")
            with packed.extractfile(member) as exe:
                header = exe.read(20)
            require(header[:6] == b"\x7fELF\x02\x01" and header[18:20] == b"\x3e\0", "Not an x64 ELF executable.")
    shutil.copyfile(archive, dest)


def secret_file(key, path):
    value = os.environ.pop(key, "")
    require(value, f"Missing required secret {key}.")
    try:
        data = base64.b64decode(value, validate=True)
    except ValueError:
        raise SystemExit(f"Invalid single-line base64 in {key}.") from None
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as file:
        file.write(data)


def android(out, work, name, app_id, mode, dest):
    require(mode in ("test", "signed"), "Android must be test-only or maintainer-signed.")
    root = Path(os.environ["ANDROID_HOME"])
    sdk = work / "sdk"
    tools = sdk / "build-tools/35.0.1"
    tools.parent.mkdir(parents=True)
    tools.symlink_to(root / "build-tools/35.0.1", target_is_directory=True)
    (sdk / "platforms").symlink_to(root / "platforms", target_is_directory=True)
    # NSH picks the newest tools directory; present only our pinned version.
    verify_env = dict(os.environ, ANDROID_HOME=str(sdk), ANDROID_SDK_ROOT=str(sdk))
    verify_env.pop("ANDROID_KEYSTORE_B64", None)
    verify_env.pop("NSH_KEYSTORE_PASSWORD", None)
    app_id += ".test" if mode == "test" else ""
    args = ["--id", app_id, "--abi", "arm64-v8a,armeabi-v7a"]
    apk = out / f"{name}.apk"
    test_key = work / "android-test.p12"
    run("keytool", "-genkeypair", "-storetype", "PKCS12", "-keystore", test_key, "-alias", "test",
        "-storepass", "test-only", "-keyalg", "RSA", "-validity", "30", "-dname", "CN=Yantai CI test only",
        env=verify_env)
    nsh("android", out, *args, "--keystore", test_key, "--key-alias", "test",
        env=dict(verify_env, NSH_KEYSTORE_PASSWORD="test-only"))
    if mode == "test":
        shutil.copyfile(apk, dest)
    else:
        key = work / "android.p12"
        alias = os.getenv("ANDROID_KEY_ALIAS", "")
        expected = os.getenv("ANDROID_CERT_SHA256", "").lower()
        password = os.environ.pop("NSH_KEYSTORE_PASSWORD", "")
        require(alias and password and re.fullmatch(r"[a-f0-9]{64}", expected),
                "Android requires ANDROID_KEY_ALIAS, ANDROID_KEYSTORE_PASSWORD and ANDROID_CERT_SHA256 (64 hex).")
        secret_file("ANDROID_KEYSTORE_B64", key)
        # NSH uses pass: arguments for its own signer. Re-sign the identical APK with
        # apksigner's env: support instead, without giving NSH our release credentials.
        run(tools / "apksigner", "sign", "--v4-signing-enabled", "false", "--ks", key, "--ks-key-alias", alias,
            "--ks-pass", "env:KEY_PASSWORD", "--key-pass", "env:KEY_PASSWORD", "--out", dest, apk,
            env=dict(verify_env, KEY_PASSWORD=password), private=True)
    run(tools / "zipalign", "-c", "4", dest, env=verify_env)
    certificates = run(tools / "apksigner", "verify", "--verbose", "--print-certs", dest,
                       env=verify_env, capture=True, private=True).decode()
    if mode == "signed":
        signers = re.findall(r"^Signer #\d+ certificate SHA-256 digest: ([0-9a-fA-F]{64})$", certificates, re.M)
        require([item.lower() for item in signers] == [expected], "APK signer does not match ANDROID_CERT_SHA256.")
    badging = run(tools / "aapt", "dump", "badging", dest, env=verify_env, capture=True).decode()
    require(f"package: name='{app_id}' versionCode='{config()['build']}' versionName='{os.environ['VERSION']}'" in badging,
            "Unexpected APK identity or version.")
    zip_verify(dest, ("classes.dex", "assets/nsh/bundle.nshc", "lib/arm64-v8a/libnsh.so", "lib/armeabi-v7a/libnsh.so"))


def ios_device(out, work, name, app_id, dest):
    cert, profile, keychain = (work / item for item in ("release.p12", "release.mobileprovision", "ci.keychain-db"))
    password = os.environ.pop("IOS_CERTIFICATE_PASSWORD", "")
    require(password, "Missing required secret IOS_CERTIFICATE_PASSWORD.")
    secret_file("IOS_CERTIFICATE_P12_B64", cert)
    secret_file("IOS_PROVISIONING_PROFILE_B64", profile)
    data = plistlib.loads(run("security", "cms", "-D", "-i", profile, capture=True, private=True))
    entitlements = data.get("Entitlements", {})
    teams = data.get("TeamIdentifier", [])
    require(data.get("ProvisionedDevices") and not data.get("ProvisionsAllDevices")
            and entitlements.get("get-task-allow") is False and "iOS" in data.get("Platform", [])
            and data["ExpirationDate"] > dt.datetime.now(dt.timezone.utc).replace(tzinfo=None)
            and len(teams) == 1 and entitlements.get("application-identifier") == f"{teams[0]}.{app_id}",
            "Expected a current Apple Ad Hoc iOS profile for the exact app ID with registered devices.")
    allowed = {hashlib.sha1(raw).hexdigest().upper() for raw in data["DeveloperCertificates"]}
    original = re.findall(rb'"([^"\n]+)"', run("security", "list-keychains", "-d", "user", capture=True))
    key_password = secrets.token_hex(32)
    run("security", "create-keychain", "-p", key_password, keychain, private=True)
    try:
        run("security", "list-keychains", "-d", "user", "-s", keychain)
        run("security", "unlock-keychain", "-p", key_password, keychain, private=True)
        run("security", "import", cert, "-k", keychain, "-P", password, "-T", "/usr/bin/codesign", private=True)
        run("security", "set-key-partition-list", "-S", "apple-tool:,apple:,codesign:", "-s", "-k", key_password,
            keychain, private=True)
        identities = run("security", "find-identity", "-v", "-p", "codesigning", keychain,
                         capture=True, private=True).decode()
        matches = allowed.intersection(re.findall(r'\b([A-F0-9]{40})\s+"(?:Apple Distribution|iPhone Distribution):', identities))
        require(len(matches) == 1, "Expected one valid Distribution identity matching the Ad Hoc profile.")
        nsh("ios", out, "--sign", matches.pop(), "--profile", profile, private=True)
        ipa = out / f"{name}.ipa"
        prefix = f"Payload/{name}.app"
        zip_verify(ipa, ())
        extracted = work / "ipa"
        run("ditto", "-x", "-k", ipa, extracted)
        apple_verify(extracted / prefix, app_id, "arm64", "IOS")
        require((extracted / prefix / "embedded.mobileprovision").read_bytes() == profile.read_bytes(),
                "IPA does not contain the supplied profile.")
        signed = plistlib.loads(run("codesign", "-d", "--entitlements", ":-", extracted / prefix,
                                    capture=True, private=True))
        require(signed.get("application-identifier") == entitlements["application-identifier"]
                and signed.get("get-task-allow") is False, "IPA signing entitlements do not match the profile.")
        shutil.copyfile(ipa, dest)
    finally:
        try:
            run("security", "list-keychains", "-d", "user", "-s", *(os.fsdecode(path) for path in original))
        finally:
            run("security", "delete-keychain", keychain, private=True)


def package():
    app = config()
    name, app_id = app["name"], app["id"]
    target = os.environ["TARGET"]
    mode = os.getenv("ANDROID_MODE", "")
    key = "android-test" if target == "android" and mode == "test" else target
    OUT.mkdir(exist_ok=True)
    final = OUT / asset_name(key)
    require(not final.exists(), f"Refusing to overwrite {final.name}.")
    with tempfile.TemporaryDirectory(prefix="yantai-package-") as temporary:
        work = Path(temporary)
        out = work / "nsh-output"
        dest = work / final.name
        if target.startswith("macos-"):
            mac_dmg(out, work, name, app_id, target, dest)
        elif target in ("windows-x64", "linux-x64"):
            desktop_archive(out, name, app_id, target, dest)
        elif target == "web":
            nsh("web", out)
            site = out / name
            entries = ["index.html"] + [item.name for item in site.glob("*.wasm")]
            require(len(entries) > 1 and any(site.glob("*.js")), "Missing Web runtime assets.")
            # Fixed timestamps and sorted paths for the static site's wrapper ZIP.
            with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as archive:
                for path in sorted(site.rglob("*")):
                    if path.is_file():
                        entry = zipfile.ZipInfo(path.relative_to(site).as_posix())
                        archive.writestr(entry, path.read_bytes(), compress_type=zipfile.ZIP_DEFLATED)
            zip_verify(dest, entries)
        elif target == "android":
            android(out, work, name, app_id, mode, dest)
        elif target == "ios-simulator-arm64":
            nsh("ios-simulator", out)
            app_path = out / f"{name}.app"
            run("ditto", "-c", "-k", "--keepParent", app_path, dest)
            zip_verify(dest, ())
            extracted = work / "simulator"
            # ditto may omit the ZIP UTF-8 flag for a Unicode bundle name.
            run("ditto", "-x", "-k", dest, extracted)
            apple_verify(extracted / app_path.name, app_id, "arm64", "IOSSIMULATOR")
        elif target == "ios-device-arm64":
            ios_device(out, work, name, app_id, dest)
        else:
            raise SystemExit(f"Unknown package target: {target}")
        require(nonempty(dest), f"Missing packaged asset: {dest.name}")
        shutil.copyfile(dest, final)
    print(f"Verified {final.name} ({final.stat().st_size} bytes)")


def collect():
    android_mode, ios_mode = os.environ["ANDROID_MODE"], os.environ["IOS_MODE"]
    require(android_mode in ("skip", "test", "signed") and ios_mode in ("skip", "signed"), "Invalid mobile package plan.")
    expected = ["macos-arm64", "macos-x64", "windows-x64", "linux-x64", "web", "ios-simulator-arm64"]
    if android_mode != "skip":
        expected.append("android-test" if android_mode == "test" else "android")
    if ios_mode == "signed":
        expected.append("ios-device-arm64")
    incoming = Path("downloaded")
    files = {incoming / f"package-{'android' if target == 'android-test' else target}" / asset_name(target): target
             for target in expected}
    require({path for path in incoming.rglob("*") if not path.is_dir()} == set(files), "Unexpected or missing release assets.")
    OUT.mkdir()
    lines = ["## Verified packages", "", "| File | Target |", "| --- | --- |"]
    for path, target in files.items():
        require(nonempty(path) and not path.is_symlink(), f"Invalid release asset: {path.name}")
        shutil.copyfile(path, OUT / path.name)
        lines.append(f"| `{path.name}` | {ASSETS[target][1]} |")
    lines.append("")
    if android_mode == "skip":
        lines.append("- Android APK omitted: `RELEASE_ANDROID_SIGNED` is disabled.")
    if ios_mode == "skip":
        lines.append("- Physical iOS device IPA omitted: Ad Hoc signing is disabled for this run.")
    if android_mode == "test":
        lines.append("- Dispatch dry-run only: no GitHub Release or Cloudflare deployment; no production signing secrets used.")
    notes = "\n".join(lines) + "\n"
    (OUT / "RELEASE-ASSETS.md").write_text(notes, encoding="utf-8")
    manifest = "".join(f"{digest(file)}  {file.name}\n" for file in sorted(OUT.iterdir()))
    (OUT / "SHA256SUMS").write_text(manifest, encoding="ascii")
    with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as summary:
        summary.write(notes)


if __name__ == "__main__":
    commands = {"plan": plan, "install": install, "package": package, "collect": collect}
    require(len(sys.argv) == 2 and sys.argv[1] in commands, "Usage: release.py plan|install|package|collect")
    commands[sys.argv[1]]()
