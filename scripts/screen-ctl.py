"""屏幕控制脚本（macos-screen-control 完整实现）

用法：
  /Users/orange/.workbuddy/binaries/python/envs/default/bin/python3 scripts/screen-ctl.py ocr-live
  /Users/orange/.workbuddy/binaries/python/envs/default/bin/python3 scripts/screen-ctl.py windows
  /Users/orange/.workbuddy/binaries/python/envs/default/bin/python3 scripts/screen-ctl.py click 500 300
  /Users/orange/.workbuddy/binaries/python/envs/default/bin/python3 scripts/screen-ctl.py find-text "云函数"
  /Users/orange/.workbuddy/binaries/python/envs/default/bin/python3 scripts/screen-ctl.py type "你好"
  /Users/orange/.workbuddy/binaries/python/envs/default/bin/python3 scripts/screen-ctl.py combo "command" "a"
  /Users/orange/.workbuddy/binaries/python/envs/default/bin/python3 scripts/screen-ctl.py screenshot /tmp/x.png

依赖：pyobjc（Quartz / Vision / ApplicationServices，已装在托管 venv）
前提：WorkBuddy 已授权 屏幕录制 + 辅助功能
"""
import sys, time, subprocess, json, os
import Quartz
import Vision
import objc
from Cocoa import NSWorkspace, NSScreen
from CoreFoundation import CFArrayRef

src = Quartz.CGEventSourceCreate(Quartz.kCGEventSourceStateHIDSystemState)

# 虚拟键码（macOS ANSI）— SKILL.md 强制要求 Cmd+A/V 等必须用虚拟键码
KEYCODES = {
    'a': 0, 's': 1, 'd': 2, 'f': 3, 'h': 4, 'g': 5, 'z': 6, 'x': 7, 'c': 8, 'v': 9,
    'b': 11, 'q': 12, 'w': 13, 'e': 14, 'r': 15, 'y': 16, 't': 17,
    '1': 18, '2': 19, '3': 20, '4': 21, '5': 22, '6': 23, '7': 24, '8': 25, '9': 26, '0': 29,
    'n': 45, 'm': 46, 'i': 34, 'o': 31, 'p': 35, 'l': 37, 'k': 40, 'j': 38,
    'u': 32,
    'return': 36, 'enter': 36, 'tab': 48, 'space': 49, 'escape': 53,
    'delete': 51, 'backspace': 51, 'forward_delete': 117,
    'left': 123, 'right': 124, 'down': 125, 'up': 126,
    'pageup': 116, 'pagedown': 121, 'home': 115, 'end': 119,
    'shift': 56, 'command': 55, 'option': 58, 'control': 59,
}

# 修饰键对应 CGEventFlags
MOD_FLAGS = {
    'shift': Quartz.kCGEventFlagMaskShift,
    'command': Quartz.kCGEventFlagMaskCommand,
    'option': Quartz.kCGEventFlagMaskAlternate,
    'control': Quartz.kCGEventFlagMaskControl,
}

def _click(x, y):
    """点击（必须先 mouseMoved，否则应用不响应）"""
    pt = Quartz.CGPoint(x, y)
    for kind in (Quartz.kCGEventMouseMoved, Quartz.kCGEventLeftMouseDown, Quartz.kCGEventLeftMouseUp):
        e = Quartz.CGEventCreateMouseEvent(src, kind, pt, 0)
        Quartz.CGEventPost(Quartz.kCGHIDEventTap, e)
        time.sleep(0.08)
    time.sleep(0.15)

def _type_text(text):
    """Unicode 文本输入（支持中文，每 ~20 字分块）"""
    for i in range(0, len(text), 20):
        chunk = text[i:i + 20]
        for down in (True, False):
            e = Quartz.CGEventCreateKeyboardEvent(src, 0, down)
            Quartz.CGEventKeyboardSetUnicodeString(e, len(chunk), chunk)
            Quartz.CGEventPost(Quartz.kCGHIDEventTap, e)
            time.sleep(0.02)
        time.sleep(0.05)

def _key_with_mods(key, mods):
    """按一个键，可带修饰键（mods: list of keycode names）"""
    flags = 0
    for m in mods:
        flags |= MOD_FLAGS.get(m.lower(), 0)
    for down in (True, False):
        e = Quartz.CGEventCreateKeyboardEvent(src, key, down)
        if flags:
            Quartz.CGEventSetFlags(e, flags)
        Quartz.CGEventPost(Quartz.kCGHIDEventTap, e)
        time.sleep(0.04)
    time.sleep(0.08)

def _screencapture(path):
    """截屏到指定路径"""
    subprocess.run(['screencapture', '-x', '-C', path], check=True, timeout=8)

def _ocr(image_path):
    """Vision OCR：返回 [(text, x, y, w, h, conf), ...]，坐标为左上原点逻辑坐标"""
    with open(image_path, 'rb') as f:
        data = f.read()
    url = Quartz.NSURL.fileURLWithPath_(image_path)
    img = Quartz.CIImage.imageWithContentsOfURL_(url)
    request = Vision.VNRecognizeTextRequest.new()
    request.setRecognitionLanguages_(['zh-Hans', 'en-US'])
    handler = Vision.VNImageRequestHandler.alloc().initWithCIImage_options_(img, None)
    handler.performRequests_error_([request], None)
    obs = request.results()
    results = []
    # 获取屏幕主屏缩放比例 → 把 Vision 的归一化坐标换成逻辑坐标
    main = NSScreen.mainScreen()
    scale = main.backingScaleFactor()
    h = main.frame().size.height
    for o in obs:
        cand = o.topCandidates_(1)
        if not cand: continue
        text = cand[0].string()
        bb = o.boundingBox()  # normalized, 左下原点
        # 转换：x_norm → 逻辑 x；y_norm 左下原点 → 屏幕左上原点 = (1 - y_norm - h_norm) * screen_h
        w = bb.size.width * main.frame().size.width
        h_box = bb.size.height * main.frame().size.height
        x = bb.origin.x * main.frame().size.width
        y_top = h - (bb.origin.y + bb.size.height) * main.frame().size.height
        results.append((text, int(x), int(y_top), int(w), int(h_box), float(cand[0].confidence())))
    return results

def _windows():
    """枚举可见窗口：app - title - (x,y) WxH"""
    arr = Quartz.CGWindowListCopyWindowInfo(
        Quartz.kCGWindowListOptionOnScreenOnly | Quartz.kCGWindowListExcludeDesktopElements,
        Quartz.kCGNullWindowID
    )
    out = []
    for w in arr:
        owner = w.get('kCGWindowOwnerName', '')
        title = w.get('kCGWindowName', '')
        bounds = w.get('kCGWindowBounds', {})
        x = int(bounds.get('X', 0))
        y = int(bounds.get('Y', 0))
        wx = int(bounds.get('Width', 0))
        wh = int(bounds.get('Height', 0))
        if owner and wx > 100 and wh > 100:
            out.append({'app': owner, 'title': title, 'x': x, 'y': y, 'w': wx, 'h': wh})
    return out

def cmd_ocr_live():
    """截屏+OCR 读屏"""
    path = '/tmp/screen-ctl-ocr.png'
    _screencapture(path)
    items = _ocr(path)
    for t, x, y, w, h, c in items:
        cx = x + w // 2
        cy = y + h // 2
        print(f'{t} | ({cx},{cy}) | {int(c*100)}%')
    return items

def cmd_windows():
    for w in _windows():
        print(f"{w['app']} | {w['title']} | ({w['x']},{w['y']}) {w['w']}x{w['h']}")

def cmd_click(args):
    x, y = int(args[0]), int(args[1])
    _click(x, y)
    print(f'clicked {x},{y}')

def cmd_drag(args):
    """drag <x1> <y1> <x2> <y2> — 鼠标拖拽（用于移动窗口等）"""
    x1, y1, x2, y2 = int(args[0]), int(args[1]), int(args[2]), int(args[3])
    pt1 = Quartz.CGPoint(x1, y1)
    pt2 = Quartz.CGPoint(x2, y2)
    # 必须先 mouseMoved 到起点（否则拖拽不生效）
    Quartz.CGEventPost(Quartz.kCGHIDEventTap,
        Quartz.CGEventCreateMouseEvent(src, Quartz.kCGEventMouseMoved, pt1, 0))
    time.sleep(0.08)
    Quartz.CGEventPost(Quartz.kCGHIDEventTap,
        Quartz.CGEventCreateMouseEvent(src, Quartz.kCGEventLeftMouseDown, pt1, 0))
    time.sleep(0.1)
    # 多步移动（更快被识别为拖拽）
    steps = 20
    for i in range(1, steps + 1):
        ix = x1 + (x2 - x1) * i // steps
        iy = y1 + (y2 - y1) * i // steps
        Quartz.CGEventPost(Quartz.kCGHIDEventTap,
            Quartz.CGEventCreateMouseEvent(src, Quartz.kCGEventMouseMoved, Quartz.CGPoint(ix, iy), 0))
        time.sleep(0.015)
    time.sleep(0.1)
    Quartz.CGEventPost(Quartz.kCGHIDEventTap,
        Quartz.CGEventCreateMouseEvent(src, Quartz.kCGEventLeftMouseUp, pt2, 0))
    time.sleep(0.15)
    print(f'dragged ({x1},{y1}) → ({x2},{y2})')

def cmd_type(args):
    _type_text(' '.join(args))

def cmd_combo(args):
    """combo <modifier1> [modifier2...] <key>"""
    if len(args) < 1:
        print('usage: combo <mod1> [mod2...] <key>'); return
    keyname = args[-1].lower()
    mods = args[:-1]
    key = KEYCODES.get(keyname)
    if key is None:
        print(f'unknown key: {keyname}'); return
    _key_with_mods(key, mods)

def cmd_press(args):
    """press <key> — 按单个键（无修饰）"""
    keyname = args[0].lower()
    key = KEYCODES.get(keyname)
    if key is None:
        print(f'unknown key: {keyname}'); return
    _key_with_mods(key, [])

def cmd_find_text(args):
    """截屏+OCR，返回最匹配 query 的元素中心坐标；多个候选全部列出"""
    query = ' '.join(args)
    path = '/tmp/screen-ctl-find.png'
    _screencapture(path)
    items = _ocr(path)
    matches = []
    for t, x, y, w, h, c in items:
        if query in t:
            matches.append((t, x + w // 2, y + h // 2, c))
    matches.sort(key=lambda m: -m[3])
    if not matches:
        print(f'NOT_FOUND: {query}')
        return 1
    for t, cx, cy, c in matches[:5]:
        print(f'{t} | ({cx},{cy}) | {int(c*100)}%')
    return 0

def cmd_screenshot(args):
    path = args[0] if args else '/tmp/screen-ctl.png'
    _screencapture(path)
    print(f'saved {path}')

def cmd_front():
    """打印前台应用"""
    a = NSWorkspace.sharedWorkspace().frontmostApplication()
    print(f"front: {a.localizedName()} (bundleId={a.bundleIdentifier()})")

def cmd_focus(args):
    """focus <app_name> — 把指定应用切到前台"""
    target = ' '.join(args).lower()
    from Cocoa import NSRunningApplication, NSApplicationActivateAllWindows
    apps = NSWorkspace.sharedWorkspace().runningApplications()
    found = []
    for a in apps:
        name = (a.localizedName() or '').lower()
        if target in name or target in (a.bundleIdentifier() or '').lower():
            found.append(a)
    if not found:
        print(f'NOT_FOUND: {target}')
        return 1
    for a in found:
        ok = a.activateWithOptions_(NSApplicationActivateAllWindows)
        if ok:
            print(f"focused: {a.localizedName()}")
            return 0
    print(f'ACTIVATE_FAILED: {target}')
    return 1

def cmd_open_url(args):
    """open_url <url> — 用前台应用打开 URL（通常是浏览器）"""
    import urllib.parse
    url = args[0]
    subprocess.run(['open', url], check=True)
    print(f'opened {url}')

def main():
    if len(sys.argv) < 2:
        print(__doc__); return 1
    cmd = sys.argv[1]
    args = sys.argv[2:]
    cmds = {
        'ocr-live': lambda: cmd_ocr_live(),
        'windows': lambda: cmd_windows(),
        'click': lambda: cmd_click(args),
        'drag': lambda: cmd_drag(args),
        'type': lambda: cmd_type(args),
        'combo': lambda: cmd_combo(args),
        'press': lambda: cmd_press(args),
        'find-text': lambda: cmd_find_text(args),
        'screenshot': lambda: cmd_screenshot(args),
        'front': lambda: cmd_front(),
        'focus': lambda: cmd_focus(args),
        'open_url': lambda: cmd_open_url(args),
    }
    if cmd not in cmds:
        print(f'unknown cmd: {cmd}'); return 1
    try:
        cmds[cmd]()
    except Exception as e:
        print(f'ERR: {e}')
        return 1
    return 0

if __name__ == '__main__':
    sys.exit(main())