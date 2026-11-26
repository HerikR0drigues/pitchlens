"""Tests for the local server payloads, the update check and the face-pack index."""
import os
import sys
import tempfile
import unittest
from dataclasses import asdict
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import faces  # noqa: E402
import fmreader  # noqa: E402
import scout  # noqa: E402


def sample_player(uid=7):
    p = fmreader.Player(uid, 'Test Player', 120, 150, 'Brasil', 'BRA', 2004, 10, 'Avaí', 9, 2029, 365, False, True, False,
                        False, [1] * 15, list(range(1, 21)) * 2 + list(range(1, 15)), 'R', 'Santos', 2028, 1)
    p.wage, p.release, p.squad = 5000, 2_000_000, 4
    return asdict(p)


class TestPayloads(unittest.TestCase):
    def setUp(self):
        p = sample_player()
        scout._state.update(players=[p], by_uid={p['uid']: p}, meta={'total': 1}, error=None, error_code=None)

    def test_list_payload_shape(self):
        with mock.patch.object(faces, 'wait'), mock.patch.object(faces, 'has', return_value=True):
            d = scout.list_payload()
        self.assertEqual(d['fields'][-2:], ('photo', 'a'))
        row = dict(zip(d['fields'], d['rows'][0]))
        self.assertEqual(row['name'], 'Test Player')
        self.assertEqual(row['pre_club'], 'Santos')
        self.assertEqual(row['wage'], 5000)
        self.assertTrue(row['photo'])
        self.assertEqual(len(row['a']), 54)
        self.assertEqual([ord(c) - 48 for c in row['a']], sample_player()['attrs'])
        self.assertEqual(set(d['groups']), {'technical', 'mental', 'physical', 'goalkeeping', 'hidden'})

    def test_player_payload(self):
        with mock.patch.object(faces, 'has', return_value=False):
            d = scout.player_payload(7)
            missing = scout.player_payload(999)
        self.assertEqual(d['release'], 2_000_000)
        self.assertEqual(d['pre_day'], 1)
        self.assertFalse(d['photo'])
        self.assertEqual(missing['error_code'], 'player_not_found')


class TestUpdateCheck(unittest.TestCase):
    def setUp(self):
        scout._update.clear()

    def test_versions(self):
        self.assertGreater(scout._ver('v1.10.0'), scout._ver('1.9.3'))
        self.assertEqual(scout._ver('v1.1.0'), (1, 1, 0))

    def test_offline_is_silent(self):
        with mock.patch('urllib.request.urlopen', side_effect=OSError('offline')):
            info = scout.update_info()
        self.assertFalse(info['newer'])
        self.assertEqual(info['current'], scout.__version__)


class TestFaces(unittest.TestCase):
    def test_index_only_face_folders(self):
        with tempfile.TemporaryDirectory() as tmp:
            g = Path(tmp, 'graphics')
            for rel in ('facepack/123.png', 'facepack/sub/456.jpg', 'logos/123456.png', 'facepack/backup/789.png',
                        'facepack/readme.txt', 'kits/55.png'):
                Path(g, rel).parent.mkdir(parents=True, exist_ok=True)
                Path(g, rel).write_bytes(b'x')
            faces._index.clear()
            with mock.patch.object(faces, 'graphics_dirs', return_value=[g]):
                faces._scan()
            self.assertEqual(sorted(faces._index), [123, 456])
            self.assertTrue(os.path.isfile(faces.path(456)))


if __name__ == '__main__':
    unittest.main()
