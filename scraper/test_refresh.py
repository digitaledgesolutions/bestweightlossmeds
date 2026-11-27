"""Offline tests for the extractors and publishing rules. Run: python3 -m unittest scraper/test_refresh.py"""
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import refresh as r  # noqa: E402

MJ = r.DOSES["mounjaro"]


class Extractors(unittest.TestCase):
    def test_shopify(self):
        body = json.dumps({"product": {"variants": [
            {"title": "2.5mg", "price": "129.00", "compare_at_price": "149.00"},
            {"title": "5mg", "price": "149.00"},
            {"title": "Needles", "price": "5.00"}]}})
        p, w = r.ex_shopify(body, MJ)
        self.assertEqual(p, {"2.5mg": 129.0, "5mg": 149.0})
        self.assertEqual(w, {"2.5mg": 149.0})

    def test_wcapi(self):
        body = json.dumps([
            {"variation": [{"attribute": "Dose", "value": "2.5mg"}], "prices": {"price": "13999", "regular_price": "13999", "currency_minor_unit": 2}},
            {"variation": [{"attribute": "Dose", "value": "5mg"}], "prices": {"price": "15999", "regular_price": "17999", "currency_minor_unit": 2}}])
        p, w = r.ex_wcapi(body, MJ)
        self.assertEqual(p, {"2.5mg": 139.99, "5mg": 159.99})
        self.assertEqual(w, {"5mg": 179.99})

    def test_woo_attr(self):
        v = json.dumps([{"attributes": {"attribute_dose": "2.5mg"}, "display_price": 135, "display_regular_price": 135},
                        {"attributes": {"attribute_dose": "7.5mg"}, "display_price": 199, "display_regular_price": 219}])
        body = "<form data-product_variations='" + v.replace('"', "&quot;") + "'></form>"
        p, w = r.ex_woo(body, MJ)
        self.assertEqual(p, {"2.5mg": 135.0, "7.5mg": 199.0})
        self.assertEqual(w, {"7.5mg": 219.0})

    def test_jsonld(self):
        ld = {"@type": "Product", "name": "Mounjaro", "offers": [
            {"@type": "Offer", "name": "Mounjaro 2.5mg", "price": "125.00"},
            {"@type": "Offer", "name": "Mounjaro 10mg", "price": "229.00"}]}
        body = f'<script type="application/ld+json">{json.dumps(ld)}</script>'
        p, _ = r.ex_jsonld(body, MJ)
        self.assertEqual(p, {"2.5mg": 125.0, "10mg": 229.0})

    def test_embedded_next(self):
        nd = {"props": {"pageProps": {"product": {"variants": [
            {"name": "Mounjaro 5mg", "price": 16900}, {"name": "Mounjaro 15mg", "price": 26900}]}}}}
        body = f'<script id="__NEXT_DATA__" type="application/json">{json.dumps(nd)}</script>'
        p, _ = r.ex_embedded(body, MJ)
        self.assertEqual(p, {"5mg": 169.0, "15mg": 269.0})

    def test_text_does_not_confuse_25_with_2_5(self):
        body = "<p>Mounjaro 2.5mg £139.99</p><p>12.5mg £249.99</p><p>15mg £259</p>"
        p, _ = r.ex_text(body, MJ)
        self.assertEqual(p, {"2.5mg": 139.99, "12.5mg": 249.99, "15mg": 259.0})

    def test_auto_prefers_structured(self):
        ld = {"offers": [{"name": "2.5mg", "price": "120"}, {"name": "5mg", "price": "140"}]}
        body = f'<script type="application/ld+json">{json.dumps(ld)}</script><p>2.5mg £999</p>'
        p, _, m = r.extract({"method": "auto"}, body, MJ)
        self.assertEqual(m, "jsonld")
        self.assertEqual(p["2.5mg"], 120.0)

    def test_offer(self):
        self.assertEqual(r.find_offer("<div>Get £20 off your first order today</div>"),
                         "Get £20 off your first order today")
        self.assertIsNone(r.find_offer("<div>Delivery £3.99</div>"))


class Rules(unittest.TestCase):
    def test_ladder(self):
        self.assertTrue(r.ladder_ok({"2.5mg": 120, "5mg": 140}, MJ))
        self.assertFalse(r.ladder_ok({"2.5mg": 200, "5mg": 140}, MJ))

    def test_repair_drops_single_outlier(self):
        p, d = r.repair_ladder({"2.5mg": 135, "5mg": 155, "7.5mg": 205, "15mg": 145}, MJ)
        self.assertEqual(d, "15mg")
        self.assertNotIn("15mg", p)
        p, d = r.repair_ladder({"2.5mg": 300, "5mg": 100, "7.5mg": 90}, MJ)
        self.assertIsNone(p)

    def test_big_move_held_then_accepted(self):
        prev = {"prices": {"2.5mg": 120.0, "5mg": 140.0}, "verifiedAt": "2026-11-01T00:00:00Z"}
        new = {"2.5mg": 60.0, "5mg": 140.0}
        rec, st = r.merge(prev, new, "jsonld", {}, None, "u", "2026-11-02T00:00:00Z")
        self.assertEqual(st, "held")
        self.assertEqual(rec["prices"]["2.5mg"], 120.0)
        rec2, st2 = r.merge(rec, new, "jsonld", {}, None, "u", "2026-11-03T00:00:00Z")
        self.assertEqual(st2, "updated")
        self.assertEqual(rec2["prices"]["2.5mg"], 60.0)
        self.assertNotIn("pending", rec2)

    def test_low_confidence_change_held(self):
        prev = {"prices": {"2.5mg": 120.0, "5mg": 140.0}}
        _, st = r.merge(prev, {"2.5mg": 125.0, "5mg": 140.0}, "text", {}, None, "u", "t")
        self.assertEqual(st, "held")
        _, st = r.merge(prev, {"2.5mg": 125.0, "5mg": 140.0}, "jsonld", {}, None, "u", "t")
        self.assertEqual(st, "updated")


if __name__ == "__main__":
    unittest.main()
