"""Leitor de memoria SOMENTE LEITURA do fm.exe (fase de pesquisa).
Uso: py -I memscan.py find "texto" [texto2 ...]
     py -I memscan.py dump 0xADDR tamanho
"""
import ctypes, ctypes.wintypes as wt, sys, struct, subprocess
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

PROCESS_QUERY_INFORMATION = 0x0400
PROCESS_VM_READ = 0x0010
MEM_COMMIT = 0x1000
READABLE = {0x02, 0x04, 0x08, 0x20, 0x40, 0x80}  # RO, RW, WC, XR, XRW, XWC

k32 = ctypes.WinDLL('kernel32', use_last_error=True)

class MBI(ctypes.Structure):
    _fields_ = [('BaseAddress', ctypes.c_void_p), ('AllocationBase', ctypes.c_void_p),
                ('AllocationProtect', wt.DWORD), ('PartitionId', wt.WORD),
                ('RegionSize', ctypes.c_size_t), ('State', wt.DWORD),
                ('Protect', wt.DWORD), ('Type', wt.DWORD)]

k32.OpenProcess.restype = wt.HANDLE
k32.VirtualQueryEx.argtypes = [wt.HANDLE, ctypes.c_void_p, ctypes.POINTER(MBI), ctypes.c_size_t]
k32.VirtualQueryEx.restype = ctypes.c_size_t
k32.ReadProcessMemory.argtypes = [wt.HANDLE, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_size_t, ctypes.POINTER(ctypes.c_size_t)]


def fm_pid():
    out = subprocess.run(['tasklist', '/FI', 'IMAGENAME eq fm.exe', '/FO', 'CSV', '/NH'],
                         capture_output=True, text=True).stdout.strip().splitlines()
    if not out or 'fm.exe' not in out[0]:
        sys.exit('fm.exe nao esta rodando')
    return int(out[0].split('","')[1])


def open_proc():
    h = k32.OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, False, fm_pid())
    if not h:
        sys.exit(f'OpenProcess falhou: {ctypes.get_last_error()}')
    return h


def regions(h):
    addr, mbi = 0, MBI()
    while k32.VirtualQueryEx(h, ctypes.c_void_p(addr), ctypes.byref(mbi), ctypes.sizeof(mbi)):
        base = mbi.BaseAddress or 0
        if mbi.State == MEM_COMMIT and (mbi.Protect & 0xFF) in READABLE and not (mbi.Protect & 0x100):
            yield base, mbi.RegionSize
        addr = base + mbi.RegionSize
        if addr >= 0x7FFFFFFFFFFF:
            break


def read(h, addr, size):
    buf = ctypes.create_string_buffer(size)
    n = ctypes.c_size_t()
    if not k32.ReadProcessMemory(h, ctypes.c_void_p(addr), buf, size, ctypes.byref(n)):
        return b''
    return buf.raw[:n.value]


def find(h, needles, limit=20):
    hits = {n: [] for n in needles}
    total = 0
    for base, size in regions(h):
        off = 0
        while off < size:
            chunk = min(64 << 20, size - off)
            data = read(h, base + off, chunk)
            total += len(data)
            for n in needles:
                i = data.find(n)
                while i != -1 and len(hits[n]) < limit:
                    hits[n].append(base + off + i)
                    i = data.find(n, i + 1)
            off += chunk
    return hits, total


if __name__ == '__main__':
    h = open_proc()
    cmd = sys.argv[1]
    if cmd == 'find':
        needles = []
        for t in sys.argv[2:]:
            needles += [t.encode('utf-8'), t.encode('utf-16-le')]
        hits, total = find(h, needles)
        print(f'lidos {total/2**30:.2f} GB')
        for n, lst in hits.items():
            enc = 'utf16' if b'\x00' in n else 'utf8'
            print(f'{n.decode("utf-16-le" if enc=="utf16" else "utf-8")!r} [{enc}]: {len(lst)} -> ' +
                  ' '.join(hex(a) for a in lst[:8]))
    elif cmd == 'near':
        # near UID CA PA [janela]: acha int32 UID e procura int16 CA e PA por perto
        uid, ca, pa = int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
        win = int(sys.argv[5]) if len(sys.argv) > 5 else 0x800
        hits, _ = find(h, [struct.pack('<I', uid)], limit=200)
        lst = hits[struct.pack('<I', uid)]
        print(f'UID {uid}: {len(lst)} ocorrencias')
        for a in lst:
            data = read(h, a - win, 2 * win)
            res = []
            for tag, v in (('CA', ca), ('PA', pa)):
                pat = struct.pack('<h', v)
                i = data.find(pat)
                while i != -1:
                    if i % 2 == 0:
                        res.append(f'{tag}@{i - win:+#x}')
                    i = data.find(pat, i + 1)
            print(hex(a), ' '.join(res[:30]))
    elif cmd == 'vt':
        # vt VTABLE: lista objetos com esse ponteiro de classe, le UID(+0xC) e CA/PA(-0x24/-0x22)
        vt = int(sys.argv[2], 16)
        hits, _ = find(h, [struct.pack('<Q', vt)], limit=10**7)
        lst = hits[struct.pack('<Q', vt)]
        print(f'objetos: {len(lst)}')
        import collections
        okc = 0
        rows = []
        for a in lst:
            d = read(h, a - 0x30, 0x48)
            if len(d) < 0x48:
                continue
            ca, pa = struct.unpack_from('<hh', d, 0x30 - 0x24)
            uid1, uid2 = struct.unpack_from('<II', d, 0x30 + 0x0C)
            if uid1 == uid2:
                okc += 1
                rows.append((uid1, ca, pa))
        print(f'com UID duplicado: {okc}')
        cas = collections.Counter(min(r[1] // 20 * 20, 200) for r in rows)
        print('faixas de CA:', sorted(cas.items()))
        for r in rows[:15]:
            print(r)
    elif cmd == 'ptrs':
        # ptrs ADDR tamanho [profundidade]: segue ponteiros e mostra textos encontrados
        base, size = int(sys.argv[2], 16), int(sys.argv[3], 0)
        depth = int(sys.argv[4]) if len(sys.argv) > 4 else 2
        def txt(b):
            out = []
            for enc in ('utf-8', 'utf-16-le'):
                try:
                    s = b.split(b'\x00\x00')[0] if enc == 'utf-16-le' else b.split(b'\x00')[0]
                    t = s.decode(enc, 'strict')
                    if len(t) >= 3 and all(c.isprintable() for c in t):
                        out.append(f'{enc[:5]}:{t[:40]!r}')
                except Exception:
                    pass
            return ' '.join(out)
        def walk(addr, path, d):
            data = read(h, addr, size if d == depth else 0x80)
            for off in range(0, len(data) - 7, 8):
                p = struct.unpack_from('<Q', data, off)[0]
                if 0x10000000000 <= p < 0x7ff000000000:
                    tgt = read(h, p, 0x60)
                    if not tgt:
                        continue
                    t = txt(tgt) or txt(tgt[8:]) or txt(tgt[0x10:]) or txt(tgt[0x14:])
                    if t:
                        print(f'{path}+{off:#x} -> {p:#x}  {t}')
                    if d > 1:
                        walk(p, f'{path}+{off:#x}->', d - 1)
        walk(base, 'obj', depth)
    elif cmd == 'year':
        # year ADDR ANO: procura int16 ANO no objeto e nos objetos apontados (1 nivel)
        base, yr = int(sys.argv[2], 16), int(sys.argv[3])
        pat = struct.pack('<H', yr)
        def scan(addr, label, n):
            d = read(h, addr, n)
            i = d.find(pat)
            while i != -1:
                if i % 2 == 0 and i >= 2:
                    day = struct.unpack_from('<H', d, i - 2)[0]
                    print(f'{label}+{i:#x}: dia {day} ano {yr}')
                i = d.find(pat, i + 1)
            return d
        d = scan(base, 'obj', 0x400)
        for off in range(0, 0x400 - 7, 8):
            p = struct.unpack_from('<Q', d, off)[0]
            if 0x10000000000 <= p < 0x7ff000000000:
                scan(p, f'obj+{off:#x}->', 0x200)
    elif cmd == 'strs':
        # strs ADDR tamanho: le cada ponteiro do objeto como string [len int32][utf8]
        base, size = int(sys.argv[2], 16), int(sys.argv[3], 0)
        d = read(h, base, size)
        for off in range(0, len(d) - 7, 8):
            p = struct.unpack_from('<Q', d, off)[0]
            if 0x10000000000 <= p < 0x7ff000000000:
                t = read(h, p, 0x80)
                if len(t) >= 8:
                    n = struct.unpack_from('<I', t, 0)[0]
                    if 1 <= n <= 0x70:
                        try:
                            s = t[4:4 + n].decode('utf-8')
                            if s.isprintable():
                                print(f'+{off:#x} -> {s!r}')
                        except UnicodeDecodeError:
                            pass
    elif cmd == 'whoref':
        # whoref "texto": acha string len-prefixada e quem aponta para ela (2 niveis)
        txt = sys.argv[2].encode('utf-8')
        hits, _ = find(h, [txt], limit=50)
        starts = []
        for a in hits[txt]:
            d = read(h, a - 4, 4)
            if len(d) == 4 and struct.unpack('<I', d)[0] == len(txt):
                starts.append(a - 4)
        print('strings:', [hex(x) for x in starts])
        if starts:
            pats = [struct.pack('<Q', x) for x in starts]
            r1, _ = find(h, pats, limit=50)
            lvl1 = [a for p in pats for a in r1[p]]
            print('nivel1 (entradas que apontam):', [hex(x) for x in lvl1[:20]])
            pats2 = [struct.pack('<Q', x) for x in lvl1[:20]]
            if pats2:
                r2, _ = find(h, pats2, limit=50)
                for p in pats2:
                    print(f'  quem aponta p/ {struct.unpack("<Q", p)[0]:#x}:', [hex(x) for x in r2[p][:10]])
    elif cmd == 'dump':
        addr, size = int(sys.argv[2], 16), int(sys.argv[3], 0)
        data = read(h, addr, size)
        for i in range(0, len(data), 16):
            row = data[i:i+16]
            print(f'{addr+i:016x}  {row.hex(" "):<48}  {"".join(chr(b) if 32<=b<127 else "." for b in row)}')
