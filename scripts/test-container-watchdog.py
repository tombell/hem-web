#!/usr/bin/env python3
"""Unit tests use fakes only; no runtime/service mutations."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "watchdog", Path(__file__).with_name("container-watchdog.py")
)
assert spec is not None and spec.loader is not None
watchdog = importlib.util.module_from_spec(spec)
spec.loader.exec_module(watchdog)


def target(status="running"):
    return {
        "id": "hem-web-test",
        "status": {"state": status},
        "configuration": {
            "publishedPorts": [{"hostAddress": "127.0.0.1", "hostPort": 13000,
                                "containerPort": 3000, "proto": "tcp", "count": 1}],
            "mounts": [{"destination": "/data", "type": {"volume": {"name": "hem-web-test-data"}}},
                       {"destination": "/tmp", "type": {"tmpfs": {}}}],
            "initProcess": {"user": {"raw": {"userString": "1000:1000"}}},
            "readOnly": True, "capDrop": ["ALL"], "capAdd": [],
            "publishedSockets": [], "ssh": False,
        },
    }


class WatchdogTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.directory = Path(self.temporary.name)
        self.addCleanup(self.temporary.cleanup)

    def recover(self):
        return watchdog.recover("container", "hem-web-test", 13000, self.directory)

    def test_maintenance_never_calls_runtime(self):
        (self.directory / "maintenance").touch()
        with patch.object(watchdog, "run") as run:
            self.assertIn("maintenance", self.recover())
            run.assert_not_called()

    def test_ready_does_not_restart(self):
        with patch.object(watchdog, "run", return_value=json.dumps([target()])) as run, \
                patch.object(watchdog, "host_ready", return_value=True):
            self.assertIn("ready", self.recover())
            self.assertEqual(run.call_count, 1)

    def test_stopped_starts_only_named_container(self):
        with patch.object(watchdog, "run", return_value=json.dumps([target("stopped")])) as run, \
                patch.object(watchdog, "host_ready", return_value=True):
            self.assertIn("recovered", self.recover())
            self.assertEqual(run.call_args_list[1].args, ("container", "start", "hem-web-test"))

    def test_three_app_failures_recover_only_named_container(self):
        with patch.object(watchdog, "run", return_value=json.dumps([target()])) as run, \
                patch.object(watchdog, "host_ready", side_effect=[False, False, False, True]), \
                patch.object(watchdog, "internal_ready", return_value=False):
            self.assertIn("threshold", self.recover())
            self.assertIn("threshold", self.recover())
            self.assertIn("recovered", self.recover())
            self.assertEqual(run.call_args_list[-2].args,
                             ("container", "stop", "--time", "30", "hem-web-test"))
            self.assertEqual(run.call_args_list[-1].args, ("container", "start", "hem-web-test"))

    def test_healthy_internal_app_never_restarted_for_forwarding(self):
        with patch.object(watchdog, "run", return_value=json.dumps([target()])) as run, \
                patch.object(watchdog, "host_ready", return_value=False), \
                patch.object(watchdog, "internal_ready", return_value=True):
            self.recover()
            self.recover()
            with self.assertRaisesRegex(watchdog.RecoveryError, "forwarding"):
                self.recover()
            self.assertEqual(run.call_count, 3)

    def test_cooldown_blocks_start(self):
        watchdog.save(self.directory / "state.json", {"lastRecovery": watchdog.time.time()})
        with patch.object(watchdog, "run", return_value=json.dumps([target("stopped")])) as run:
            with self.assertRaisesRegex(watchdog.RecoveryError, "cooldown"):
                self.recover()
            self.assertEqual(run.call_count, 1)

    def test_runtime_failure_does_not_manage_shared_runtime(self):
        with patch.object(watchdog, "run", side_effect=watchdog.RecoveryError("unavailable")) as run:
            with self.assertRaises(watchdog.RecoveryError):
                self.recover()
            self.assertEqual(run.call_count, 1)

    def test_bad_topology_is_rejected_before_mutation(self):
        cases = []
        for field, value in [("readOnly", False), ("capAdd", ["ALL"]), ("ssh", True),
                             ("publishedSockets", ["socket"])]:
            item = target("stopped")
            item["configuration"][field] = value
            cases.append(item)
        item = target("stopped")
        item["configuration"]["publishedPorts"][0]["hostAddress"] = "0.0.0.0"
        cases.append(item)
        item = target("stopped")
        item["configuration"]["mounts"].append({"destination": "/home", "type": {"bind": {}}})
        cases.append(item)
        for item in cases:
            with self.subTest(item=item), \
                    patch.object(watchdog, "run", return_value=json.dumps([item])) as run:
                with self.assertRaisesRegex(watchdog.RecoveryError, "topology"):
                    self.recover()
                self.assertEqual(run.call_count, 1)


if __name__ == "__main__":
    unittest.main()
