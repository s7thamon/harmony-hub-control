"""Strict pasted callbacks. No network, token files, or real sign-in."""
import unittest

from tools.catalog.harmony_catalog import CatalogError, parse_callback


class CallbackTests(unittest.TestCase):
    def test_url_and_query(self):
        for prefix in ("com.logitech.harmony://lidsoauth?", "?", ""):
            self.assertEqual(parse_callback(prefix + "code=fixture&state=expected", expected_state="expected"), "fixture")

    def test_refusals(self):
        for value in (
            "", "bare-nonce", "code=fixture", "state=expected", "code=&state=expected",
            "code=fixture&state=wrong", "code=fixture&state=", "code=fixture&state=expected&error=",
            "code=fixture&state=expected&error=access_denied", "code=a&code=b&state=expected",
            "code=fixture&state=expected&state=wrong",
            "https://id.logi.com/launch.html?nonce=fixture",
            "https://accounts.logi.com/?code=fixture&state=expected",
            "https://example.com/?code=fixture&state=expected",
            "com.logitech.harmony://other?code=fixture&state=expected",
        ):
            with self.subTest(value=value), self.assertRaises(CatalogError):
                parse_callback(value, expected_state="expected")
        with self.assertRaises(CatalogError):
            parse_callback("code=fixture&state=", expected_state="")


if __name__ == "__main__":
    unittest.main()
