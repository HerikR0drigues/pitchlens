import ctypes, ctypes.wintypes as wt, sys
sys.path.insert(0, '.')
import memscan as m

psapi = ctypes.WinDLL('psapi')
psapi.EnumProcessModulesEx.argtypes = [wt.HANDLE, ctypes.c_void_p, wt.DWORD, ctypes.POINTER(wt.DWORD), wt.DWORD]
psapi.GetModuleInformation.argtypes = [wt.HANDLE, ctypes.c_void_p, ctypes.c_void_p, wt.DWORD]
psapi.GetModuleBaseNameW.argtypes = [wt.HANDLE, ctypes.c_void_p, ctypes.c_wchar_p, wt.DWORD]


class MODINFO(ctypes.Structure):
    _fields_ = [('lpBaseOfDll', ctypes.c_void_p), ('SizeOfImage', wt.DWORD), ('EntryPoint', ctypes.c_void_p)]


h = m.open_proc()
mods = (ctypes.c_void_p * 1024)()
need = wt.DWORD()
psapi.EnumProcessModulesEx(h, mods, ctypes.sizeof(mods), ctypes.byref(need), 3)
targets = [int(x, 16) for x in sys.argv[1:]]
for i in range(need.value // 8):
    mi = MODINFO()
    psapi.GetModuleInformation(h, mods[i], ctypes.byref(mi), ctypes.sizeof(mi))
    name = ctypes.create_unicode_buffer(260)
    psapi.GetModuleBaseNameW(h, mods[i], name, 260)
    base = mi.lpBaseOfDll or 0
    for t in targets:
        if base <= t < base + mi.SizeOfImage:
            print(f'{t:#x} -> {name.value} base {base:#x} RVA {t - base:#x}')
