#!/usr/bin/env python3
"""xdnd_drop.py — ファイルを 1 つ、X11 の本物のドラッグ（XDND）で Chromium の窓に落とす（e2e_bridge_install.js が拡張の ZIP を落とすのに使う）。

A minimal X11 XDND *source*: drags one file (text/uri-list) onto a Chromium window and drops it.

This is the same OS-level protocol a Linux file manager uses when the user drags a file onto a browser window,
so the browser goes through its real drag-and-drop path (Ozone X11 → aura drop target → WebContentsViewAura),
not the DevTools Input.dispatchDragEvent shortcut (with that shortcut chrome://extensions gets the File but
installDroppedFile fails with "No dragged path" — Chromium 141).

  python3 -I xdnd_drop.py <absolute file path> [--name-contains TEXT] [--x X --y Y] [--hold-ms 800] [--no-drop] [--timeout 10]

Needs DISPLAY (run inside xvfb-run). Uses libX11 through ctypes only. Prints one JSON line with what happened.
The target is the largest mapped top-level window that has XdndAware (with --name-contains, only windows whose
title contains TEXT, e.g. "Extensions" for chrome://extensions in front). Without --x/--y the drop point is the
horizontal middle, 60 % down that window.
"""
import ctypes as C
import ctypes.util
import json
import os
import sys
import time
import urllib.parse

X = C.CDLL(ctypes.util.find_library('X11') or 'libX11.so.6')

Window = C.c_ulong
Atom = C.c_ulong
Time = C.c_ulong
Bool = C.c_int


class XClientMessageData(C.Union):
    _fields_ = [('b', C.c_char * 20), ('s', C.c_short * 10), ('l', C.c_long * 5)]


class XClientMessageEvent(C.Structure):
    _fields_ = [('type', C.c_int), ('serial', C.c_ulong), ('send_event', Bool), ('display', C.c_void_p), ('window', Window),
                ('message_type', Atom), ('format', C.c_int), ('data', XClientMessageData)]


class XSelectionRequestEvent(C.Structure):
    _fields_ = [('type', C.c_int), ('serial', C.c_ulong), ('send_event', Bool), ('display', C.c_void_p), ('owner', Window),
                ('requestor', Window), ('selection', Atom), ('target', Atom), ('property', Atom), ('time', Time)]


class XSelectionEvent(C.Structure):
    _fields_ = [('type', C.c_int), ('serial', C.c_ulong), ('send_event', Bool), ('display', C.c_void_p), ('requestor', Window),
                ('selection', Atom), ('target', Atom), ('property', Atom), ('time', Time)]


class XEvent(C.Union):
    _fields_ = [('type', C.c_int), ('xclient', XClientMessageEvent), ('xselectionrequest', XSelectionRequestEvent),
                ('xselection', XSelectionEvent), ('pad', C.c_long * 24)]


class XWindowAttributes(C.Structure):
    _fields_ = [('x', C.c_int), ('y', C.c_int), ('width', C.c_int), ('height', C.c_int), ('border_width', C.c_int), ('depth', C.c_int),
                ('visual', C.c_void_p), ('root', Window), ('class', C.c_int), ('bit_gravity', C.c_int), ('win_gravity', C.c_int),
                ('backing_store', C.c_int), ('backing_planes', C.c_ulong), ('backing_pixel', C.c_ulong), ('save_under', Bool),
                ('colormaps', C.c_ulong), ('map_installed', Bool), ('map_state', C.c_int), ('all_event_masks', C.c_long),
                ('your_event_mask', C.c_long), ('do_not_propagate_mask', C.c_long), ('override_redirect', Bool), ('screen', C.c_void_p)]


X.XOpenDisplay.restype = C.c_void_p
X.XOpenDisplay.argtypes = [C.c_char_p]
X.XDefaultRootWindow.restype = Window
X.XDefaultRootWindow.argtypes = [C.c_void_p]
X.XInternAtom.restype = Atom
X.XInternAtom.argtypes = [C.c_void_p, C.c_char_p, Bool]
X.XGetAtomName.restype = C.c_void_p
X.XGetAtomName.argtypes = [C.c_void_p, Atom]
X.XCreateSimpleWindow.restype = Window
X.XCreateSimpleWindow.argtypes = [C.c_void_p, Window, C.c_int, C.c_int, C.c_uint, C.c_uint, C.c_uint, C.c_ulong, C.c_ulong]
X.XSetSelectionOwner.argtypes = [C.c_void_p, Atom, Window, Time]
X.XGetSelectionOwner.restype = Window
X.XGetSelectionOwner.argtypes = [C.c_void_p, Atom]
X.XSendEvent.argtypes = [C.c_void_p, Window, Bool, C.c_long, C.POINTER(XEvent)]
X.XFlush.argtypes = [C.c_void_p]
X.XSync.argtypes = [C.c_void_p, Bool]
X.XPending.argtypes = [C.c_void_p]
X.XNextEvent.argtypes = [C.c_void_p, C.POINTER(XEvent)]
X.XChangeProperty.argtypes = [C.c_void_p, Window, Atom, Atom, C.c_int, C.c_int, C.c_char_p, C.c_int]
X.XQueryTree.argtypes = [C.c_void_p, Window, C.POINTER(Window), C.POINTER(Window), C.POINTER(C.POINTER(Window)), C.POINTER(C.c_uint)]
X.XGetWindowProperty.argtypes = [C.c_void_p, Window, Atom, C.c_long, C.c_long, Bool, Atom, C.POINTER(Atom), C.POINTER(C.c_int),
                                 C.POINTER(C.c_ulong), C.POINTER(C.c_ulong), C.POINTER(C.c_void_p)]
X.XGetWindowAttributes.argtypes = [C.c_void_p, Window, C.POINTER(XWindowAttributes)]
X.XTranslateCoordinates.argtypes = [C.c_void_p, Window, Window, C.c_int, C.c_int, C.POINTER(C.c_int), C.POINTER(C.c_int), C.POINTER(Window)]
X.XFree.argtypes = [C.c_void_p]
X.XSelectInput.argtypes = [C.c_void_p, Window, C.c_long]

ClientMessage, SelectionRequest, SelectionNotify, SelectionClear = 33, 30, 31, 29
PropModeReplace = 0

args = sys.argv[1:]
if not args:
    print(__doc__)
    sys.exit(2)
FILE = os.path.abspath(args[0])
opt = {'--x': None, '--y': None, '--hold-ms': '800', '--timeout': '10', '--name-contains': None}
no_drop = '--no-drop' in args
for k in list(opt):
    if k in args:
        opt[k] = args[args.index(k) + 1]

d = X.XOpenDisplay(None)
if not d:
    print(json.dumps({'ok': False, 'error': 'cannot open display ' + str(os.environ.get('DISPLAY'))}))
    sys.exit(1)
root = X.XDefaultRootWindow(d)


def atom(name):
    return X.XInternAtom(d, name.encode(), False)


def atom_name(a):
    if not a:
        return None
    p = X.XGetAtomName(d, a)
    s = C.cast(p, C.c_char_p).value.decode()
    X.XFree(p)
    return s


A = {n: atom(n) for n in ['XdndAware', 'XdndEnter', 'XdndPosition', 'XdndStatus', 'XdndLeave', 'XdndDrop', 'XdndFinished',
                          'XdndSelection', 'XdndActionCopy', 'XdndTypeList', 'text/uri-list', 'WM_NAME', '_NET_WM_NAME', 'UTF8_STRING', 'STRING']}
log = []


def note(*a):
    log.append('%.3f ' % (time.time() - T0) + ' '.join(str(x) for x in a))


T0 = time.time()


def get_prop(w, prop, req_type=0):
    at, fmt, n, after, data = Atom(), C.c_int(), C.c_ulong(), C.c_ulong(), C.c_void_p()
    st = X.XGetWindowProperty(d, w, prop, 0, 1024, False, req_type, C.byref(at), C.byref(fmt), C.byref(n), C.byref(after), C.byref(data))
    if st != 0 or not data.value:
        return None
    try:
        if fmt.value == 32:
            arr = C.cast(data, C.POINTER(C.c_ulong))
            return [arr[i] for i in range(n.value)]
        if fmt.value == 8:
            return C.string_at(data, n.value)
        return None
    finally:
        X.XFree(data)


def children(w):
    r, p, ch, n = Window(), Window(), C.POINTER(Window)(), C.c_uint()
    if not X.XQueryTree(d, w, C.byref(r), C.byref(p), C.byref(ch), C.byref(n)):
        return []
    out = [ch[i] for i in range(n.value)]
    if ch:
        X.XFree(ch)
    return out


def geom(w):
    a = XWindowAttributes()
    X.XGetWindowAttributes(d, w, C.byref(a))
    rx, ry, ch = C.c_int(), C.c_int(), Window()
    X.XTranslateCoordinates(d, w, root, 0, 0, C.byref(rx), C.byref(ry), C.byref(ch))
    return {'x': rx.value, 'y': ry.value, 'w': a.width, 'h': a.height, 'mapped': a.map_state == 2}


# find the top-level windows that accept XDND
aware = []
for w in children(root):
    v = get_prop(w, A['XdndAware'])
    if v:
        name = get_prop(w, A['_NET_WM_NAME'], A['UTF8_STRING']) or get_prop(w, A['WM_NAME'])
        g = geom(w)
        aware.append({'win': w, 'version': v[0], 'name': name.decode('utf-8', 'replace') if name else None, 'geom': g})
aware = [a for a in aware if a['geom']['mapped']]
if not aware:
    print(json.dumps({'ok': False, 'error': 'no mapped XdndAware top-level window'}))
    sys.exit(1)
if opt['--name-contains']:
    named = [a for a in aware if a['name'] and opt['--name-contains'] in a['name']]
    if not named:
        print(json.dumps({'ok': False, 'error': 'no XdndAware window whose title contains ' + opt['--name-contains'], 'windows': [a['name'] for a in aware]}))
        sys.exit(1)
    aware = named
aware.sort(key=lambda a: -a['geom']['w'] * a['geom']['h'])
target = aware[0]
tw = target['win']
version = min(5, target['version'])
g = target['geom']
px = int(opt['--x']) if opt['--x'] else g['x'] + g['w'] // 2
py = int(opt['--y']) if opt['--y'] else g['y'] + int(g['h'] * 0.6)
note('target', hex(tw), 'version', target['version'], 'name', target['name'], 'geom', g, 'point', px, py)

src = X.XCreateSimpleWindow(d, root, -10, -10, 1, 1, 0, 0, 0)
X.XSelectInput(d, src, 0)
X.XSetSelectionOwner(d, A['XdndSelection'], src, 0)
X.XSync(d, False)
owner = X.XGetSelectionOwner(d, A['XdndSelection'])
note('selection owner', hex(owner), 'is ours', owner == src)
# percent-encoded UTF-8, as GTK/Qt file managers send it
URI = ('file://' + urllib.parse.quote(FILE)).encode('utf-8') + b'\r\n'


def send_client(msg_type, l):
    ev = XEvent()
    ev.xclient.type = ClientMessage
    ev.xclient.display = d
    ev.xclient.window = tw
    ev.xclient.message_type = A[msg_type]
    ev.xclient.format = 32
    for i in range(5):
        ev.xclient.data.l[i] = l[i] if i < len(l) else 0
    X.XSendEvent(d, tw, False, 0, C.byref(ev))
    X.XFlush(d)
    note('sent', msg_type, l)


got = {'status': [], 'finished': None, 'requests': []}


def pump(seconds, until=None):
    end = time.time() + seconds
    while time.time() < end:
        while X.XPending(d):
            ev = XEvent()
            X.XNextEvent(d, C.byref(ev))
            t = ev.type
            if t == ClientMessage:
                mt = atom_name(ev.xclient.message_type)
                l = [ev.xclient.data.l[i] for i in range(5)]
                if mt == 'XdndStatus':
                    rec = {'accept': bool(l[1] & 1), 'action': atom_name(l[4]) if l[4] else None}
                    got['status'].append(rec)
                    note('XdndStatus', rec)
                elif mt == 'XdndFinished':
                    rec = {'accepted': bool(l[1] & 1) if version >= 5 else None, 'action': atom_name(l[2]) if version >= 5 and l[2] else None}
                    got['finished'] = rec
                    note('XdndFinished', rec)
                else:
                    note('client message', mt, l)
            elif t == SelectionRequest:
                r = ev.xselectionrequest
                tname = atom_name(r.target)
                note('SelectionRequest target', tname, 'property', atom_name(r.property), 'requestor', hex(r.requestor))
                got['requests'].append(tname)
                reply = XEvent()
                reply.xselection.type = SelectionNotify
                reply.xselection.display = d
                reply.xselection.requestor = r.requestor
                reply.xselection.selection = r.selection
                reply.xselection.target = r.target
                reply.xselection.time = r.time
                prop = r.property or r.target
                if tname == 'text/uri-list':
                    X.XChangeProperty(d, r.requestor, prop, r.target, 8, PropModeReplace, URI, len(URI))
                    reply.xselection.property = prop
                elif tname == 'TARGETS':
                    arr = (C.c_ulong * 2)(A['text/uri-list'], atom('TARGETS'))
                    X.XChangeProperty(d, r.requestor, prop, atom('ATOM'), 32, PropModeReplace, C.cast(arr, C.c_char_p), 2)
                    reply.xselection.property = prop
                else:
                    reply.xselection.property = 0  # refuse other targets
                X.XSendEvent(d, r.requestor, False, 0, C.byref(reply))
                X.XFlush(d)
            elif t == SelectionClear:
                note('SelectionClear')
            else:
                pass
        if until and until():
            return True
        time.sleep(0.02)
    return False


timeout = float(opt['--timeout'])
# XdndEnter: l[0]=source, l[1]=version<<24 (bit0 = more than 3 types → no), l[2..4]=types
send_client('XdndEnter', [src, version << 24, A['text/uri-list'], 0, 0])
pump(0.2)
# XdndPosition: l[0]=source, l[1]=0, l[2]=(x<<16)|y, l[3]=time, l[4]=action
for i in range(3):
    send_client('XdndPosition', [src, 0, (px << 16) | py, 0, A['XdndActionCopy']])
    n0 = len(got['status'])
    pump(2.0, until=lambda: len(got['status']) > n0)
pump(float(opt['--hold-ms']) / 1000.0)
result = {'ok': True, 'file': FILE, 'uri': URI.decode('utf-8').strip(), 'target': {'win': hex(tw), 'name': target['name'], 'xdndVersion': target['version'], 'geom': g},
          'point': [px, py], 'aware_windows': len(aware)}
accepted = any(s['accept'] for s in got['status'])
if no_drop or not accepted:
    send_client('XdndLeave', [src, 0, 0, 0, 0])
    pump(0.3)
    result['dropped'] = False
    result['why_not'] = '--no-drop' if no_drop else 'target never accepted (no XdndStatus with accept bit)'
else:
    send_client('XdndDrop', [src, 0, 0, 0, 0])
    pump(timeout, until=lambda: got['finished'] is not None)
    result['dropped'] = True
result['status'] = got['status']
result['finished'] = got['finished']
result['selection_requests'] = got['requests']
result['log'] = log
print(json.dumps(result))
