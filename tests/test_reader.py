"""Tests for the memory reader logic that does not need the game (decoding, pre-contracts, game date)."""
import struct
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import fmreader  # noqa: E402

BASE = 0x23100000000          # looks like a heap pointer to fmreader._is_ptr


def player(uid=1, **kw):
    p = fmreader.Player(uid, 'Test', 100, 120, 'Brasil', 'BRA', 2000, 1, 'Club', 1, 2028, 1, False, False, False,
                        False, [1] * 15, [10] * 54, 'R')
    for k, v in kw.items():
        setattr(p, k, v)
    return p


class FakeReader(fmreader.FMReader):
    """FMReader without a process: read() serves bytes from a dict of address -> bytes."""

    def __init__(self, mem=None, clubs=None):  # noqa: D107 - no OpenProcess
        self.mem = mem or {}
        self._clubs = {}
        self._club_names = clubs or {}

    def read(self, addr, size):
        for base, data in self.mem.items():
            if base <= addr < base + len(data):
                off = addr - base
                return data[off:off + size]
        return b''

    def club(self, p):
        return (0, self._club_names.get(p, ''))


def contract(player_addr, club, start, end_year):
    d = bytearray(0x78)
    struct.pack_into('<Q', d, fmreader.C_PLAYER, player_addr)
    struct.pack_into('<Q', d, fmreader.C_CLUB, club)
    struct.pack_into('<HH', d, fmreader.C_START, start[1], start[0])
    struct.pack_into('<HH', d, fmreader.C_END, 365, end_year)
    return bytes(d)


class TestHelpers(unittest.TestCase):
    def test_preferred_foot(self):
        a = [10] * 54
        a[fmreader.FOOT_LEFT], a[fmreader.FOOT_RIGHT] = 20, 8
        self.assertEqual(fmreader.preferred_foot(a), 'L')
        a[fmreader.FOOT_LEFT], a[fmreader.FOOT_RIGHT] = 7, 20
        self.assertEqual(fmreader.preferred_foot(a), 'R')
        a[fmreader.FOOT_LEFT], a[fmreader.FOOT_RIGHT] = 17, 19
        self.assertEqual(fmreader.preferred_foot(a), 'B')

    def test_groups_cover_known_attributes(self):
        self.assertEqual(len(fmreader.ATTRIBUTES), 54)
        self.assertEqual(len(fmreader.POSITIONS), 15)
        used = [i for v in fmreader.GROUP_INDEX.values() for i in v]
        self.assertEqual(len(used), len(set(used)), 'an attribute is in two groups')
        self.assertTrue(all(0 <= i < 54 for i in used))

    def test_game_date_needs_three_contracts(self):
        from collections import Counter
        self.assertEqual(fmreader._game_date(Counter({(2027, 200): 2})), {'game_year': None, 'game_day': None})
        got = fmreader._game_date(Counter({(2027, 200): 5, (2027, 210): 3, (2027, 250): 1}))
        self.assertEqual(got, {'game_year': 2027, 'game_day': 210})


class TestReleaseClause(unittest.TestCase):
    def test_lowest_release_clause(self):
        clauses = struct.pack('<iHHiHHiHH', 5_000_000, 0, 0x10, 3_000_000, 0, 0x12, 20, 20, 0x08)
        r = FakeReader({BASE: clauses})
        self.assertEqual(r._release_clause(BASE, BASE + len(clauses)), 3_000_000)

    def test_no_clause_or_bad_vector(self):
        sell_on = struct.pack('<iHH', 20, 20, 0x08)
        r = FakeReader({BASE: sell_on})
        self.assertEqual(r._release_clause(BASE, BASE + 8), 0)
        self.assertEqual(r._release_clause(0, 0), 0)
        self.assertEqual(r._release_clause(BASE, BASE + 7), 0)          # not a multiple of 8
        self.assertEqual(r._release_clause(BASE, BASE + 0x10000), 0)    # absurd size


class TestPreContracts(unittest.TestCase):
    def setUp(self):
        self.p_addr, self.cur_con, self.cur_club, self.new_club = BASE + 0x1000, BASE + 0x2000, BASE + 0x3000, BASE + 0x4000
        self.game = {'game_year': 2027, 'game_day': 282}

    def run_case(self, club, start, end_year=2030):
        con = BASE + 0x5000
        r = FakeReader({con: contract(self.p_addr, club, start, end_year)}, {self.new_club: 'Avaí', self.cur_club: 'Boavista'})
        p = player()
        r._pre_contracts([con], {self.p_addr: (p, self.cur_con, self.cur_club)}, self.game)
        return p

    def test_future_contract_with_other_club(self):
        p = self.run_case(self.new_club, (2028, 1))
        self.assertEqual((p.pre_club, p.pre_year, p.pre_day), ('Avaí', 2028, 1))

    def test_renewal_with_same_club_is_ignored(self):
        self.assertEqual(self.run_case(self.cur_club, (2028, 1)).pre_club, '')

    def test_past_or_placeholder_contracts_are_ignored(self):
        self.assertEqual(self.run_case(self.new_club, (2027, 100)).pre_club, '')
        self.assertEqual(self.run_case(self.new_club, (2028, 1), end_year=1900).pre_club, '')



class TestNation(unittest.TestCase):
    def test_name_code_and_continent(self):
        nat, cont, s_name, s_code, s_cont = BASE + 0x100, BASE + 0x400, BASE + 0x800, BASE + 0x900, BASE + 0xA00
        n = bytearray(fmreader.N_CONTINENT + 8)
        struct.pack_into('<Q', n, fmreader.N_NAME, s_name)
        struct.pack_into('<Q', n, fmreader.N_CODE, s_code)
        struct.pack_into('<Q', n, fmreader.N_CONTINENT, cont)
        c = bytearray(0x20)
        struct.pack_into('<Q', c, 0x18, s_cont)
        txt = lambda s: struct.pack('<I', len(s.encode())) + s.encode()
        r = FakeReader({nat: bytes(n), cont: bytes(c), s_name: txt('Brasil'), s_code: txt('BRA'), s_cont: txt('América do Sul')})
        r._strcache, r._nations = {}, {}
        self.assertEqual(r.nation(nat), ('Brasil', 'BRA', 'América do Sul'))


class TestLoans(unittest.TestCase):
    def test_only_the_active_loan_counts(self):
        p_addr, avai, old = BASE + 0x1000, BASE + 0x3000, BASE + 0x4000
        def rec(club, year):
            d = bytearray(fmreader.L_START + 4)
            struct.pack_into('<Q', d, fmreader.L_PLAYER, p_addr)
            struct.pack_into('<Q', d, fmreader.L_CLUB, club)
            struct.pack_into('<HH', d, fmreader.L_START, 100, year)
            return bytes(d)
        r = FakeReader({BASE + 0x5000: rec(old, 1900), BASE + 0x6000: rec(avai, 2027)}, {avai: 'Avaí', old: 'Azuriz'})
        p = player()
        r._loans([BASE + 0x5000, BASE + 0x6000], {p_addr: (p, 0, 0)})
        self.assertEqual(p.loan_club, 'Avaí')

if __name__ == '__main__':
    unittest.main()
