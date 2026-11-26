"""READ-ONLY memory reader for Football Manager 27 (fm.exe) on Windows.

It never writes to the game: the process is opened with PROCESS_VM_READ | PROCESS_QUERY_INFORMATION only.
Offsets and the reverse-engineering method are documented in docs/TECHNICAL.md.
"""
from __future__ import annotations

import collections
import ctypes
import ctypes.wintypes as wt
import struct
import subprocess
import time
from dataclasses import dataclass, asdict

# ---------------------------------------------------------------- offsets
MODULE = 'game_plugin.dll'
RVA_PLAYER_VTABLE = 0x4E89908          # FM27 27.0.x (Steam) - see docs/TECHNICAL.md
RVA_CONTRACT_VTABLE = 0x4C5DFA8        # contracts (also pre-contracts / future renewals)
RVA_LOAN_VTABLE = 0x4F2A0F8            # loan records (current loans, past loans and offers)
L_PLAYER, L_CLUB, L_START = 0x08, 0x10, 0x4C   # loan: player, club the player is loaned to, start date (1900 = not active)

P_UID = 0x0C            # uint32, repeated at +0x10
P_FLAGS = 0x19          # flags byte: bit 0x10 = female
P_CA = -0x24            # int16 (stored BEFORE the vtable)
P_PA = -0x22            # int16 (negative = potential range, e.g. -7)
P_FIRST = 0x50          # -> name table entry -> +0 -> string
P_SECOND = 0x58
P_COMMON = 0x60
P_NATION = 0x68         # -> Nation: +0x18 name, +0x28 code
P_BIRTH = 0x88          # uint16 day of year, uint16 year
P_CONTRACT = 0xA8       # -> Contract (NULL = free agent)
C_PLAYER = 0x08         # Contract -> Player
C_CLUB = 0x10           # Contract -> Club
C_START = 0x44          # uint16 day of year (& 0x1FF), uint16 year - contract start
C_END = 0x48            # uint16 day of year, uint16 year
C_STATUS = 0x57         # byte: 0x01 = transfer listed, 0x02 = loan listed
C_WAGE = 0x20           # int32 wage per week (GBP)
C_SQUAD = 0x54          # byte: squad status (1 star, 2 important, 3 regular starter, 4 squad, 5 impact sub, 7 fringe, 10 hot prospect,
                        # 11 young, 15 first-choice goalkeeper; 15-21 are goalkeeper statuses)
C_CLAUSES = 0x68        # vector begin/end of 8-byte clauses [int32 value][uint16 arg][uint16 type]
CLAUSE_RELEASE = (0x10, 0x12)   # minimum fee release clause (foreign clubs / domestic clubs)
CLUB_UID = 0x0C
CLUB_NAMES = 0x30       # -> block: +0xC0 full name, +0xC8 short name
N_NAME, N_CODE = 0x18, 0x28
P_POS = -0x138          # 15 bytes: familiarity 1..20 per position (order in POSITIONS)
P_ATTR = -0x129         # 54 bytes: attributes 1..100 (shown = (v+2)//5), order in ATTRIBUTES

# Position order in memory (P_POS). The UI has its own labels per language (web/i18n.js).
POSITIONS = ['GK', 'SW', 'DL', 'DC', 'DR', 'DM', 'ML', 'MC', 'MR', 'AML', 'AMC', 'AMR', 'ST', 'WBL', 'WBR']
# Attribute order in memory (P_ATTR). Index 41 is the hidden "Dirtiness", index 45 the visible "Aggression".
ATTRIBUTES = [
    'Crossing', 'Dribbling', 'Finishing', 'Heading', 'Long Shots', 'Marking',
    'Off the Ball', 'Passing', 'Penalty Taking', 'Tackling', 'Vision',
    'Handling', 'Aerial Reach', 'Command of Area', 'Communication', 'Kicking', 'Throwing',
    'Anticipation', 'Decisions', 'One on Ones', 'Positioning', 'Reflexes',
    'First Touch', 'Technique', 'Left Foot', 'Right Foot', 'Flair', 'Corners',
    'Teamwork', 'Work Rate', 'Long Throws', 'Eccentricity',
    'Rushing Out', 'Punching', 'Acceleration', 'Free Kicks', 'Strength', 'Stamina', 'Pace',
    'Jumping Reach', 'Leadership', 'Dirtiness', 'Balance', 'Bravery',
    'Consistency', 'Aggression', 'Agility', 'Important Matches', 'Injury Proneness',
    'Versatility', 'Natural Fitness', 'Determination', 'Composure', 'Concentration']
GROUPS = {
    'technical': ['Corners', 'Crossing', 'Dribbling', 'Finishing', 'First Touch', 'Free Kicks', 'Heading',
                  'Long Shots', 'Long Throws', 'Marking', 'Passing', 'Penalty Taking', 'Tackling', 'Technique'],
    'mental': ['Aggression', 'Anticipation', 'Bravery', 'Composure', 'Concentration', 'Decisions', 'Determination',
               'Flair', 'Leadership', 'Off the Ball', 'Positioning', 'Teamwork', 'Vision', 'Work Rate'],
    'physical': ['Acceleration', 'Agility', 'Balance', 'Jumping Reach', 'Natural Fitness', 'Pace', 'Stamina',
                 'Strength'],
    'goalkeeping': ['Aerial Reach', 'Command of Area', 'Communication', 'Eccentricity', 'Handling', 'Kicking',
                    'One on Ones', 'Punching', 'Reflexes', 'Rushing Out', 'Throwing'],
    'hidden': ['Consistency', 'Dirtiness', 'Important Matches', 'Injury Proneness', 'Versatility'],
}
# Group id -> attribute indexes (what the UI uses; labels come from web/i18n.js).
GROUP_INDEX = {k: [ATTRIBUTES.index(a) for a in v] for k, v in GROUPS.items()}
FOOT_LEFT, FOOT_RIGHT = ATTRIBUTES.index('Left Foot'), ATTRIBUTES.index('Right Foot')


def preferred_foot(attrs: list) -> str:
    """'L' left, 'R' right, 'B' both (both feet 16+ on the 1-20 scale)."""
    left, right = attrs[FOOT_LEFT], attrs[FOOT_RIGHT]
    return 'B' if min(left, right) >= 16 else ('L' if left > right else 'R')

# ---------------------------------------------------------------- winapi
PROCESS_QUERY_INFORMATION = 0x0400
PROCESS_VM_READ = 0x0010
MEM_COMMIT = 0x1000
READABLE = {0x02, 0x04, 0x08, 0x20, 0x40, 0x80}

k32 = ctypes.WinDLL('kernel32', use_last_error=True)
psapi = ctypes.WinDLL('psapi')


class MBI(ctypes.Structure):
    _fields_ = [('BaseAddress', ctypes.c_void_p), ('AllocationBase', ctypes.c_void_p),
                ('AllocationProtect', wt.DWORD), ('PartitionId', wt.WORD),
                ('RegionSize', ctypes.c_size_t), ('State', wt.DWORD),
                ('Protect', wt.DWORD), ('Type', wt.DWORD)]


class MODINFO(ctypes.Structure):
    _fields_ = [('lpBaseOfDll', ctypes.c_void_p), ('SizeOfImage', wt.DWORD), ('EntryPoint', ctypes.c_void_p)]


k32.OpenProcess.restype = wt.HANDLE
k32.OpenProcess.argtypes = [wt.DWORD, wt.BOOL, wt.DWORD]
k32.CloseHandle.argtypes = [wt.HANDLE]
k32.VirtualQueryEx.argtypes = [wt.HANDLE, ctypes.c_void_p, ctypes.POINTER(MBI), ctypes.c_size_t]
k32.VirtualQueryEx.restype = ctypes.c_size_t
k32.ReadProcessMemory.argtypes = [wt.HANDLE, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_size_t,
                                  ctypes.POINTER(ctypes.c_size_t)]
psapi.EnumProcessModulesEx.argtypes = [wt.HANDLE, ctypes.c_void_p, wt.DWORD, ctypes.POINTER(wt.DWORD), wt.DWORD]
psapi.GetModuleInformation.argtypes = [wt.HANDLE, ctypes.c_void_p, ctypes.c_void_p, wt.DWORD]
psapi.GetModuleBaseNameW.argtypes = [wt.HANDLE, ctypes.c_void_p, ctypes.c_wchar_p, wt.DWORD]


def _is_ptr(p: int) -> bool:
    return 0x10000000000 <= p < 0x7FF000000000


class FMNotRunning(Exception):
    """Raised when FM27 is not running or no save is loaded. `code` is used by the UI for i18n."""
    def __init__(self, msg: str, code: str = 'not_running') -> None:
        super().__init__(msg)
        self.code = code


@dataclass
class Player:
    uid: int
    name: str
    ca: int
    pa: int
    nation: str
    nation_code: str
    birth_year: int
    birth_day: int
    club: str
    club_uid: int
    contract_year: int
    contract_day: int
    free: bool
    transfer_listed: bool
    loan_listed: bool
    female: bool
    pos: list          # 15 values 1..20 (order in POSITIONS)
    attrs: list        # 54 values 1..20 (order in ATTRIBUTES)
    foot: str            # 'L' / 'R' / 'B'
    pre_club: str = ''   # pre-contract already signed with another club ('' = none)
    pre_year: int = 0      # pre-contract start
    pre_day: int = 0
    wage: int = 0         # GBP per week (0 = no contract)
    release: int = 0      # lowest minimum-fee release clause in GBP (0 = none)
    squad: int = 0        # squad status code (see C_SQUAD)
    loan_club: str = ''   # club the player is on loan at right now ('' = not on loan)


class FMReader:
    def __init__(self) -> None:
        self.pid = self._find_pid()
        self.h = k32.OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, False, self.pid)
        if not self.h:
            raise FMNotRunning(f'Could not open fm.exe (error {ctypes.get_last_error()})', 'access')
        self.module_base, self.module_size = self._module(MODULE)
        self._strcache: dict[int, str] = {}
        self._nations: dict[int, tuple[str, str]] = {}
        self._clubs: dict[int, tuple[int, str]] = {}

    def close(self) -> None:
        if self.h:
            k32.CloseHandle(self.h)
            self.h = None

    # ------------------------------------------------------------ basics
    @staticmethod
    def _find_pid() -> int:
        out = subprocess.run(['tasklist', '/FI', 'IMAGENAME eq fm.exe', '/FO', 'CSV', '/NH'],
                             capture_output=True, text=True, creationflags=0x08000000).stdout
        for line in out.splitlines():
            if line.lower().startswith('"fm.exe"'):
                return int(line.split('","')[1])
        raise FMNotRunning('Football Manager 27 is not running.', 'not_running')

    def _module(self, wanted: str) -> tuple[int, int]:
        mods = (ctypes.c_void_p * 2048)()
        need = wt.DWORD()
        psapi.EnumProcessModulesEx(self.h, mods, ctypes.sizeof(mods), ctypes.byref(need), 3)
        for i in range(min(need.value // 8, 2048)):
            name = ctypes.create_unicode_buffer(260)
            psapi.GetModuleBaseNameW(self.h, mods[i], name, 260)
            if name.value.lower() == wanted.lower():
                mi = MODINFO()
                psapi.GetModuleInformation(self.h, mods[i], ctypes.byref(mi), ctypes.sizeof(mi))
                return mi.lpBaseOfDll or 0, mi.SizeOfImage
        raise FMNotRunning(f'{wanted} not loaded - load a save in FM.', 'no_save')

    def read(self, addr: int, size: int) -> bytes:
        buf = ctypes.create_string_buffer(size)
        n = ctypes.c_size_t()
        if not k32.ReadProcessMemory(self.h, ctypes.c_void_p(addr), buf, size, ctypes.byref(n)):
            return b''
        return buf.raw[:n.value]

    def q(self, addr: int) -> int:
        d = self.read(addr, 8)
        return struct.unpack('<Q', d)[0] if len(d) == 8 else 0

    def regions(self):
        addr, mbi = 0, MBI()
        while k32.VirtualQueryEx(self.h, ctypes.c_void_p(addr), ctypes.byref(mbi), ctypes.sizeof(mbi)):
            base = mbi.BaseAddress or 0
            if (mbi.State == MEM_COMMIT and (mbi.Protect & 0xFF) in READABLE
                    and not (mbi.Protect & 0x100) and mbi.Type == 0x20000):  # MEM_PRIVATE (heap)
                yield base, mbi.RegionSize
            addr = base + mbi.RegionSize
            if addr >= 0x7FFFFFFFFFFF:
                break

    def find_all(self, needle: bytes, align: int = 8) -> list[int]:
        return self.find_many([needle], align)[needle]

    def find_many(self, needles: list[bytes], align: int = 8) -> dict[bytes, list[int]]:
        """One pass over the heap looking for several byte patterns.

        Pointers end in zero bytes and the heap is full of zeros, which makes bytes.find crawl. So each needle is
        searched without its trailing zeros (at least 4 bytes kept) and the full match is checked afterwards:
        about 5x faster on a 7 GB heap.
        """
        hits: dict[bytes, list[int]] = {n: [] for n in needles}
        keys = [(n, n.rstrip(b'\x00') if len(n.rstrip(b'\x00')) >= 4 else n) for n in needles]
        for base, size in self.regions():
            off = 0
            while off < size:
                chunk = min(64 << 20, size - off)
                data = self.read(base + off, chunk)
                for needle, key in keys:
                    i = data.find(key)
                    while i != -1:
                        if (base + off + i) % align == 0 and data[i:i + len(needle)] == needle:
                            hits[needle].append(base + off + i)
                        i = data.find(key, i + 1)
                off += chunk
        return hits

    # ------------------------------------------------------------ strings / refs
    def rstr(self, p: int) -> str:
        if not _is_ptr(p):
            return ''
        s = self._strcache.get(p)
        if s is None:
            t = self.read(p, 0x90)
            s = ''
            if len(t) >= 4:
                n = struct.unpack_from('<I', t, 0)[0]
                if 0 < n <= 0x88:
                    s = t[4:4 + n].decode('utf-8', 'replace')
            self._strcache[p] = s
        return s

    def name_entry(self, p: int) -> str:
        return self.rstr(self.q(p)) if _is_ptr(p) else ''

    def nation(self, p: int) -> tuple[str, str]:
        if not _is_ptr(p):
            return ('', '')
        if p not in self._nations:
            d = self.read(p, 0x40)
            self._nations[p] = ((self.rstr(struct.unpack_from('<Q', d, N_NAME)[0]),
                                 self.rstr(struct.unpack_from('<Q', d, N_CODE)[0])) if len(d) == 0x40 else ('', ''))
        return self._nations[p]

    def club(self, p: int) -> tuple[int, str]:
        if not _is_ptr(p):
            return (0, '')
        if p not in self._clubs:
            d = self.read(p, 0x40)
            uid, name = 0, ''
            if len(d) == 0x40:
                uid = struct.unpack_from('<I', d, CLUB_UID)[0]
                blk = struct.unpack_from('<Q', d, CLUB_NAMES)[0]
                if _is_ptr(blk):
                    b = self.read(blk + 0xC0, 0x10)
                    if len(b) == 0x10:
                        name = self.rstr(struct.unpack_from('<Q', b, 8)[0]) or self.rstr(struct.unpack_from('<Q', b, 0)[0])
            self._clubs[p] = (uid, name)
        return self._clubs[p]

    # ------------------------------------------------------------ vtable
    def player_vtable(self) -> tuple[int, list[int], list[int]]:
        """Try the known RVA; if FM was updated, discover the player class by itself.
        Returns (vtable, player objects, contract objects)."""
        vt = self.module_base + RVA_PLAYER_VTABLE
        cvt = struct.pack('<Q', self.module_base + RVA_CONTRACT_VTABLE)
        lvt = struct.pack('<Q', self.module_base + RVA_LOAN_VTABLE)
        hits = self.find_many([struct.pack('<Q', vt), cvt, lvt])
        if len(hits[struct.pack('<Q', vt)]) <= 20000:
            vt = self.discover_vtable()
            hits = self.find_many([struct.pack('<Q', vt), cvt, lvt])
        self.loan_objs = hits[lvt]
        return vt, hits[struct.pack('<Q', vt)], hits[cvt]

    def discover_vtable(self, sample_bytes: int = 256 << 20) -> int:
        """Find the most common pointer into game_plugin.dll with the [vtable][int32][uid][uid] shape
        and plausible CA/PA at -0x24/-0x22."""
        lo, hi = self.module_base, self.module_base + self.module_size
        counts: collections.Counter[int] = collections.Counter()
        seen = 0
        for base, size in self.regions():
            if size < (1 << 20):
                continue
            data = self.read(base, min(size, 32 << 20))
            mv = memoryview(data)
            for off in range(0x30, len(data) - 0x18, 8):
                v = struct.unpack_from('<Q', mv, off)[0]
                if lo <= v < hi and mv[off + 0x0C:off + 0x10] == mv[off + 0x10:off + 0x14]:
                    ca, pa = struct.unpack_from('<hh', mv, off - 0x24)
                    if 1 <= ca <= 200 and -10 <= pa <= 200 and pa != 0:
                        counts[v] += 1
            seen += len(data)
            if seen >= sample_bytes:
                break
        if not counts:
            raise FMNotRunning('No players found in memory. Load a save in FM.', 'no_save')
        return counts.most_common(1)[0][0]

    # ------------------------------------------------------------ main
    def players(self) -> tuple[list[Player], dict]:
        t0 = time.time()
        vt, objs, contracts = self.player_vtable()
        by_addr: dict[int, tuple[Player, int, int]] = {}  # player addr -> (player, current contract, current club)
        out: list[Player] = []
        starts: collections.Counter[tuple[int, int]] = collections.Counter()
        pre = -P_POS
        for a in objs:
            d = self.read(a - pre, pre + 0xB0)
            if len(d) < pre + 0xB0:
                continue
            o = pre
            uid, uid2 = struct.unpack_from('<II', d, o + P_UID)
            if uid != uid2 or uid == 0:
                continue
            ca, pa = struct.unpack_from('<hh', d, o + P_CA)
            q = lambda off: struct.unpack_from('<Q', d, o + off)[0]
            first, second = self.name_entry(q(P_FIRST)), self.name_entry(q(P_SECOND))
            common = self.name_entry(q(P_COMMON))
            nat, natc = self.nation(q(P_NATION))
            bday, byear = struct.unpack_from('<HH', d, o + P_BIRTH)
            con = q(P_CONTRACT)
            cuid, cname, cday, cyear, st, club_ptr, wage, release, squad = 0, '', 0, 0, 0, 0, 0, 0, 0
            if _is_ptr(con):
                cd = self.read(con, 0x78)
                if len(cd) == 0x78:
                    club_ptr = struct.unpack_from('<Q', cd, C_CLUB)[0]
                    cuid, cname = self.club(club_ptr)
                    cday, cyear = struct.unpack_from('<HH', cd, C_END)
                    st = cd[C_STATUS]
                    wage = max(0, struct.unpack_from('<i', cd, C_WAGE)[0])
                    squad = cd[C_SQUAD]
                    release = self._release_clause(*struct.unpack_from('<QQ', cd, C_CLAUSES))
                    sday, syear = struct.unpack_from('<HH', cd, C_START)
                    if 1990 < syear < 2200:
                        starts[(syear, sday & 0x1FF)] += 1
            attrs = [(v + 2) // 5 for v in d[o + P_ATTR:o + P_ATTR + 54]]
            out.append(Player(uid, common or f'{first} {second}'.strip(), ca, pa, nat, natc, byear, bday,
                              cname, cuid, cyear, cday, not _is_ptr(con), bool(st & 1), bool(st & 2),
                              bool(d[o + P_FLAGS] & 0x10),
                              list(d[o + P_POS:o + P_POS + 15]), attrs, preferred_foot(attrs)))
            out[-1].wage, out[-1].release, out[-1].squad = wage, release, squad
            by_addr[a] = (out[-1], con, club_ptr)
        game = _game_date(starts)
        self._pre_contracts(contracts, by_addr, game)
        self._loans(getattr(self, 'loan_objs', []), by_addr)
        meta = dict(total=len(out), seconds=round(time.time() - t0, 1),
                    vtable_rva=hex(vt - self.module_base), read_at=time.strftime('%H:%M:%S'),
                    pre_contracts=sum(1 for p in out if p.pre_club), on_loan=sum(1 for p in out if p.loan_club), **game)
        return out, meta

    def _release_clause(self, begin: int, end: int) -> int:
        if not _is_ptr(begin) or not begin < end <= begin + 0x200 or (end - begin) % 8:
            return 0
        d = self.read(begin, end - begin)
        fees = [v for v, _, kind in struct.iter_unpack('<iHH', d) if kind in CLAUSE_RELEASE and v > 0]
        return min(fees) if fees else 0

    def _loans(self, loans: list[int], by_addr: dict) -> None:
        """Loan records also keep past loans and offers; only the one with a real start date is the current loan."""
        for o in loans:
            d = self.read(o, L_START + 4)
            if len(d) < L_START + 4:
                continue
            hit = by_addr.get(struct.unpack_from('<Q', d, L_PLAYER)[0])
            year = struct.unpack_from('<H', d, L_START + 2)[0]
            if hit and 2000 <= year < 2200:
                hit[0].loan_club = self.club(struct.unpack_from('<Q', d, L_CLUB)[0])[1]

    def _pre_contracts(self, contracts: list[int], by_addr: dict, game: dict) -> None:
        """A player can have a second contract object that starts in the future. When its club is not
        the current one, it is a pre-contract (Bosman) already signed - the player is not really available."""
        today = (game['game_year'], game['game_day']) if game['game_year'] else None
        for c in contracts:
            d = self.read(c, 0x4C)
            if len(d) < 0x4C:
                continue
            hit = by_addr.get(struct.unpack_from('<Q', d, C_PLAYER)[0])
            if not hit or hit[1] == c:
                continue
            player, _, cur_club = hit
            club = struct.unpack_from('<Q', d, C_CLUB)[0]
            sday, syear = struct.unpack_from('<HH', d, C_START)
            eyear = struct.unpack_from('<H', d, C_END + 2)[0]
            start = (syear, sday & 0x1FF)
            if club == cur_club or not 2000 <= eyear < 2200 or (today and start <= today):
                continue
            if not player.pre_club or start < (player.pre_year, player.pre_day):
                player.pre_club = self.club(club)[1]
                player.pre_year, player.pre_day = start


def _game_date(starts: collections.Counter) -> dict:
    """The game keeps no obvious 'today' value we have mapped, but many contracts start on the
    current in-game day. The latest start date shared by 3+ contracts is a good estimate."""
    common = [k for k, n in starts.items() if n >= 3]
    if not common:
        return {'game_year': None, 'game_day': None}
    year, day = max(common)
    return {'game_year': year, 'game_day': day}


def snapshot() -> tuple[list[dict], dict]:
    r = FMReader()
    try:
        players, meta = r.players()
        return [asdict(p) for p in players], meta
    finally:
        r.close()


if __name__ == '__main__':
    import sys
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    ps, meta = snapshot()
    print(meta)
    free = [p for p in ps if p['free'] and not p['female']]
    for p in sorted(free, key=lambda p: -p['ca'])[:10]:
        print(p['name'], p['ca'], p['pa'], p['birth_year'], p['nation'])
