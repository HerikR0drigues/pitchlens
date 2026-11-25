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
RVA_PLAYER_VTABLE = 0x4E89908          # FM27 27.0.x (Steam) - ver CLAUDE.md
RVA_CONTRACT_VTABLE = 0x4C5DFA8        # contratos (inclui pre-contratos / renovacoes futuras)

P_UID = 0x0C            # uint32, repetido em +0x10
P_FLAGS = 0x19          # byte de flags: bit 0x10 = feminino
P_CA = -0x24            # int16 (fica ANTES do vtable)
P_PA = -0x22            # int16 (negativo = faixa de potencial, ex. -7)
P_FIRST = 0x50          # -> entrada tabela de nomes -> +0 -> string
P_SECOND = 0x58
P_COMMON = 0x60
P_NATION = 0x68         # -> Nation: +0x18 nome, +0x28 sigla
P_BIRTH = 0x88          # uint16 dia do ano, uint16 ano
P_CONTRACT = 0xA8       # -> Contract (NULL = sem contrato)
C_PLAYER = 0x08         # Contract -> Player
C_CLUB = 0x10           # Contract -> Club
C_START = 0x44          # uint16 dia do ano (& 0x1FF), uint16 ano - inicio do contrato
C_END = 0x48            # uint16 dia do ano, uint16 ano
C_STATUS = 0x57         # byte: 0x01 = lista de transferencias, 0x02 = lista de emprestimo
CLUB_UID = 0x0C
CLUB_NAMES = 0x30       # -> bloco: +0xC0 nome completo, +0xC8 nome curto
N_NAME, N_CODE = 0x18, 0x28
P_POS = -0x138          # 15 bytes: familiaridade 1..20 por posicao (ordem em POSICOES)
P_ATTR = -0x129         # 54 bytes: atributos 1..100 (exibido = (v+2)//5), ordem em ATRIBUTOS

POSICOES = ['GOL', 'LIB', 'LE', 'ZAG', 'LD', 'VOL', 'ME', 'MC', 'MD',
            'MEI-E', 'MEI', 'MEI-D', 'ATA', 'ALA-E', 'ALA-D']
ATRIBUTOS = [
    'Cruzamentos', 'Drible', 'Finalização', 'Cabeceamento', 'Remates de longe', 'Marcação',
    'Sem bola', 'Passe', 'Penáltis', 'Desarme', 'Visão de jogo',
    'Mãos', 'Jogo aéreo', 'Comando da área', 'Comunicação', 'Pontapé', 'Lançamento com mãos',
    'Antecipação', 'Decisões', 'Um contra um', 'Posicionamento', 'Reflexos',
    'Primeiro toque', 'Técnica', 'Pé esquerdo', 'Pé direito', 'Imprevisibilidade', 'Cantos',
    'Trabalho de equipa', 'Índice de trabalho', 'Lançamentos longos', 'Excentricidade',
    'Saídas', 'Socar a bola', 'Aceleração', 'Livres', 'Força', 'Resistência', 'Velocidade',
    'Impulsão', 'Liderança', 'Agressividade (oculto)', 'Equilíbrio', 'Bravura',
    'Consistência', 'Agressividade', 'Agilidade', 'Jogos importantes', 'Propensão a lesões',
    'Versatilidade', 'Aptidão física', 'Determinação', 'Compostura', 'Concentração']
# Observacao: indice 41 no FM e "Dirtiness" (jogo sujo); rotulado em GRUPOS como 'Jogo sujo'.
ATRIBUTOS[41] = 'Jogo sujo'
GRUPOS = {
    'Técnicos': ['Cabeceamento', 'Cruzamentos', 'Desarme', 'Drible', 'Finalização', 'Marcação', 'Passe',
                 'Primeiro toque', 'Remates de longe', 'Técnica', 'Cantos', 'Livres', 'Lançamentos longos', 'Penáltis'],
    'Mentais': ['Agressividade', 'Antecipação', 'Bravura', 'Compostura', 'Concentração', 'Decisões', 'Determinação',
                'Imprevisibilidade', 'Índice de trabalho', 'Liderança', 'Posicionamento', 'Sem bola',
                'Trabalho de equipa', 'Visão de jogo'],
    'Físicos': ['Aceleração', 'Agilidade', 'Aptidão física', 'Equilíbrio', 'Força', 'Impulsão', 'Resistência', 'Velocidade'],
    'Goleiro': ['Comando da área', 'Comunicação', 'Excentricidade', 'Jogo aéreo', 'Lançamento com mãos', 'Mãos',
                'Pontapé', 'Reflexos', 'Saídas', 'Socar a bola', 'Um contra um'],
    'Ocultos': ['Consistência', 'Jogo sujo', 'Jogos importantes', 'Propensão a lesões', 'Versatilidade'],
}
# Same order as ATRIBUTOS (English labels used by the web UI).
ATTRIBUTES_EN = [
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
POSITIONS_EN = ['GK', 'SW', 'DL', 'DC', 'DR', 'DM', 'ML', 'MC', 'MR', 'AML', 'AMC', 'AMR', 'ST', 'WBL', 'WBR']
# Group id -> attribute indexes (language independent).
GROUP_INDEX = {k: [ATRIBUTOS.index(a) for a in v] for k, v in zip(
    ('technical', 'mental', 'physical', 'goalkeeping', 'hidden'), GRUPOS.values())}
FOOT_LEFT, FOOT_RIGHT = ATRIBUTOS.index('Pé esquerdo'), ATRIBUTOS.index('Pé direito')


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
    nome: str
    ca: int
    pa: int
    nacao: str
    nacao_sigla: str
    nasc_ano: int
    nasc_dia: int
    clube: str
    clube_uid: int
    contrato_ano: int
    contrato_dia: int
    livre: bool
    lista_transf: bool
    lista_emprest: bool
    feminino: bool
    pos: list          # 15 valores 1..20 (ordem POSICOES)
    attrs: list        # 54 valores 1..20 (ordem ATRIBUTOS)
    pe: str            # 'L' / 'R' / 'B'
    pre_clube: str = ''   # pre-contrato assinado com outro clube (vazio = nenhum)
    pre_ano: int = 0      # inicio do pre-contrato
    pre_dia: int = 0


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
        """One pass over the heap looking for several byte patterns (reading memory is the slow part)."""
        hits: dict[bytes, list[int]] = {n: [] for n in needles}
        for base, size in self.regions():
            off = 0
            while off < size:
                chunk = min(64 << 20, size - off)
                data = self.read(base + off, chunk)
                for needle in needles:
                    i = data.find(needle)
                    while i != -1:
                        if (base + off + i) % align == 0:
                            hits[needle].append(base + off + i)
                        i = data.find(needle, i + 1)
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
        """Tenta o RVA conhecido; se a versao do FM mudou, descobre sozinho.
        Devolve (vtable, objetos jogador, objetos contrato)."""
        vt = self.module_base + RVA_PLAYER_VTABLE
        cvt = struct.pack('<Q', self.module_base + RVA_CONTRACT_VTABLE)
        hits = self.find_many([struct.pack('<Q', vt), cvt])
        if len(hits[struct.pack('<Q', vt)]) <= 20000:
            vt = self.discover_vtable()
            hits = self.find_many([struct.pack('<Q', vt), cvt])
        return vt, hits[struct.pack('<Q', vt)], hits[cvt]

    def discover_vtable(self, sample_bytes: int = 256 << 20) -> int:
        """Procura o ponteiro mais comum para dentro do game_plugin.dll que tenha
        o padrao [vtable][int32][uid][uid] e CA/PA plausiveis em -0x24/-0x22."""
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
        by_addr: dict[int, tuple[Player, int, int]] = {}  # player addr -> (player, contrato atual, clube atual)
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
            cuid, cname, cday, cyear, st, club_ptr = 0, '', 0, 0, 0, 0
            if _is_ptr(con):
                cd = self.read(con, 0x60)
                if len(cd) == 0x60:
                    club_ptr = struct.unpack_from('<Q', cd, C_CLUB)[0]
                    cuid, cname = self.club(club_ptr)
                    cday, cyear = struct.unpack_from('<HH', cd, C_END)
                    st = cd[C_STATUS]
                    sday, syear = struct.unpack_from('<HH', cd, C_START)
                    if 1990 < syear < 2200:
                        starts[(syear, sday & 0x1FF)] += 1
            attrs = [(v + 2) // 5 for v in d[o + P_ATTR:o + P_ATTR + 54]]
            out.append(Player(uid, common or f'{first} {second}'.strip(), ca, pa, nat, natc, byear, bday,
                              cname, cuid, cyear, cday, not _is_ptr(con), bool(st & 1), bool(st & 2),
                              bool(d[o + P_FLAGS] & 0x10),
                              list(d[o + P_POS:o + P_POS + 15]), attrs, preferred_foot(attrs)))
            by_addr[a] = (out[-1], con, club_ptr)
        game = _game_date(starts)
        self._pre_contracts(contracts, by_addr, game)
        meta = dict(total=len(out), segundos=round(time.time() - t0, 1),
                    vtable_rva=hex(vt - self.module_base), lido_em=time.strftime('%H:%M:%S'),
                    pre_contratos=sum(1 for p in out if p.pre_clube), **game)
        return out, meta

    def _pre_contracts(self, contracts: list[int], by_addr: dict, game: dict) -> None:
        """A player can have a second contract object that starts in the future. When its club is not
        the current one, it is a pre-contract (Bosman) already signed - the player is not really available."""
        today = (game['ano_jogo'], game['dia_jogo']) if game['ano_jogo'] else None
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
            if not player.pre_clube or start < (player.pre_ano, player.pre_dia):
                player.pre_clube = self.club(club)[1]
                player.pre_ano, player.pre_dia = start


def _game_date(starts: collections.Counter) -> dict:
    """The game keeps no obvious 'today' value we have mapped, but many contracts start on the
    current in-game day. The latest start date shared by 3+ contracts is a good estimate."""
    common = [k for k, n in starts.items() if n >= 3]
    if not common:
        return {'ano_jogo': None, 'dia_jogo': None}
    year, day = max(common)
    return {'ano_jogo': year, 'dia_jogo': day}


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
    free = [p for p in ps if p['livre'] and not p['feminino']]
    for p in sorted(free, key=lambda p: -p['ca'])[:10]:
        print(p['nome'], p['ca'], p['pa'], p['nasc_ano'], p['nacao'])
