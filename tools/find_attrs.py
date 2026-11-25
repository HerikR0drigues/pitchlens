"""Look for attribute blocks (runs of bytes 1..20) around a player object.
Usage: py -I tools/find_attrs.py "Common name" BIRTH_YEAR
"""
import sys, struct
sys.path.insert(0, '.')
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
import fmreader as f

name, year = sys.argv[1], int(sys.argv[2])
r = f.FMReader()
vt, objs, _ = r.player_vtable()
obj = None
for a in objs:
    if r.name_entry(r.q(a + 0x60)) == name:
        d = r.read(a + 0x88, 4)
        if len(d) == 4 and struct.unpack('<HH', d)[1] == year:
            obj = a
            break
print('obj', hex(obj) if obj else None)
if not obj:
    sys.exit()


def runs(data, base, label, lo, hi, minlen):
    i = 0
    while i < len(data):
        j = i
        while j < len(data) and lo <= data[j] <= hi:
            j += 1
        if j - i >= minlen:
            print(f'{label} {base + i:#x} (+{i:#x}) len {j - i}: {list(data[i:j])}')
        i = max(j, i + 1)


region = r.read(obj - 0x400, 0xC00)
runs(region, obj - 0x400, 'obj', 1, 20, 14)
for off in range(0, 0x400, 8):
    p = struct.unpack_from('<Q', region, 0x400 + off)[0]
    if f._is_ptr(p):
        d = r.read(p, 0x400)
        runs(d, p, f'obj+{off:#x}->', 1, 20, 14)
